(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rustContract"));
  } else {
    root.RustyAnalyzer = factory(root.RustyContract);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract) {
  "use strict";

  const { toSnakeCase, toPascalCase } = contract;

  /**
   * Blank out comments & string contents while preserving exact line/column offsets.
   * String contents are kept as quotes + spaces when `blankStrings` is true.
   */
  function maskSource(code, blankStrings) {
    const src = String(code || "");
    const out = new Array(src.length);
    let i = 0;
    let inLineComment = false;
    let inBlockComment = false;
    let inStr = false;

    while (i < src.length) {
      const ch = src[i];
      const next = src[i + 1];

      if (inLineComment) {
        if (ch === "\n") {
          inLineComment = false;
          out[i] = "\n";
        } else {
          out[i] = " ";
        }
        i++;
        continue;
      }

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          inBlockComment = false;
          i += 2;
        } else {
          out[i] = ch === "\n" ? "\n" : " ";
          i++;
        }
        continue;
      }

      if (inStr) {
        if (ch === "\\" && i + 1 < src.length) {
          out[i] = blankStrings ? " " : ch;
          out[i + 1] = blankStrings ? (next === "\n" ? "\n" : " ") : next;
          i += 2;
          continue;
        }
        if (ch === '"') {
          inStr = false;
          out[i] = '"';
          i++;
          continue;
        }
        out[i] = blankStrings ? (ch === "\n" ? "\n" : " ") : ch;
        i++;
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }

      if (ch === "/" && next === "*") {
        inBlockComment = true;
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }

      if (ch === '"') {
        inStr = true;
        out[i] = '"';
        i++;
        continue;
      }

      out[i] = ch;
      i++;
    }

    return out.join("");
  }

  function buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") starts.push(i + 1);
    }
    return starts;
  }

  function offsetToPos(lineStarts, offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    const lineIdx = Math.max(0, hi);
    return {
      line: lineIdx + 1,
      column: offset - lineStarts[lineIdx] + 1,
    };
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array(b.length + 1);
    const curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  function findClosest(target, candidates) {
    let best = null;
    let bestDist = Infinity;
    const low = target.toLowerCase();
    for (const c of candidates) {
      const d = levenshtein(low, c.toLowerCase());
      if (d < bestDist && d <= Math.max(2, Math.floor(c.length / 2))) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  function inferLiteralType(expr) {
    const t = String(expr || "").trim();
    if (!t) return null;
    if (t === "true" || t === "false") return "bool";
    if (/^"(?:[^"\\]|\\.)*"$/.test(t) || /^String::from\s*\(/.test(t) || /\.to_string\(\)$/.test(t)) {
      return "String";
    }
    if (/^-?\d+\.\d+$/.test(t)) return "float";
    if (/^-\d+$/.test(t)) return "neg_int";
    if (/^\d+$/.test(t)) return "pos_int";
    return null;
  }

  function isTypeCompatible(rustType, literalKind) {
    if (!literalKind) return true;
    const t = String(rustType || "").trim();
    if (t === "bool") return literalKind === "bool";
    if (t === "String") return literalKind === "String";
    if (t === "f32" || t === "f64") {
      return literalKind === "float" || literalKind === "pos_int" || literalKind === "neg_int";
    }
    if (t === "u32" || t === "u64" || t === "usize" || t === "u8" || t === "u16") {
      return literalKind === "pos_int";
    }
    if (t === "i32" || t === "i64" || t === "isize" || t === "i8" || t === "i16") {
      return literalKind === "pos_int" || literalKind === "neg_int";
    }
    return true;
  }

  function isNumericType(rustType) {
    return /^(?:i8|i16|i32|i64|isize|u8|u16|u32|u64|usize|f32|f64)$/.test(String(rustType || "").trim());
  }

  /**
   * Perform instant edit-time semantic analysis on a Rust state module
   * against the live WebGME StateMachine model.
   *
   * @param {string} code Rust source code of the state
   * @param {object} model Normalized StateMachine model from WebGME
   * @param {object} [currentState] Current State node object
   * @returns {{ diagnostics: Array<object>, durationMs: number, stats: object }}
   */
  function analyzeStateCode(code, model, currentState) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const src = String(code || "");
    const maskedNoComments = maskSource(src, false);
    const maskedClean = maskSource(src, true);
    const lineStarts = buildLineStarts(src);
    const diagnostics = [];

    function pushDiag(severity, codeId, message, startOff, endOff, quickFix) {
      const s = offsetToPos(lineStarts, Math.max(0, startOff));
      const e = offsetToPos(lineStarts, Math.max(startOff + 1, endOff));
      diagnostics.push({
        severity,
        code: codeId,
        message,
        startLine: s.line,
        startColumn: s.column,
        endLine: e.line,
        endColumn: e.column,
        quickFix: quickFix || null,
      });
    }

    // Build live WebGME symbol tables
    const globalMap = new Map();
    for (const g of (model && model.globals) || []) {
      const key = toSnakeCase(g.name);
      globalMap.set(key, { ...g, snakeName: key });
    }
    const globalNames = Array.from(globalMap.keys());

    const eventMap = new Map();
    for (const ev of (model && model.events) || []) {
      const pascal = toPascalCase(ev.name);
      eventMap.set(pascal, { ...ev, pascalName: pascal, payloadType: (ev.payloadType || "").trim() });
    }
    const eventNames = Array.from(eventMap.keys());

    const stateMap = new Map();
    for (const st of (model && model.states) || []) {
      const pascal = toPascalCase(st.name);
      stateMap.set(pascal, { ...st, pascalName: pascal });
    }
    const stateNames = Array.from(stateMap.keys());

    const outgoingTargets = new Set();
    const outgoingEvents = new Set();
    if (currentState && model && Array.isArray(model.transitions)) {
      for (const tr of model.transitions) {
        if (tr.srcName === currentState.name || (currentState.id && tr.srcId === currentState.id)) {
          if (tr.dstName) outgoingTargets.add(toPascalCase(tr.dstName));
          if (tr.event) outgoingEvents.add(toPascalCase(tr.event));
        }
      }
    }

    // 1. Delimiter balance check ({}, (), [])
    const stack = [];
    const pairs = { "{": "}", "(": ")", "[": "]" };
    const closers = { "}": "{", ")": "(", "]": "[" };
    for (let i = 0; i < maskedClean.length; i++) {
      const ch = maskedClean[i];
      if (pairs[ch]) {
        stack.push({ ch, offset: i });
      } else if (closers[ch]) {
        if (stack.length === 0 || stack[stack.length - 1].ch !== closers[ch]) {
          pushDiag("error", "RUSTY_E032", `Unexpected closing '${ch}'`, i, i + 1);
        } else {
          stack.pop();
        }
      }
    }
    for (const unclosed of stack) {
      pushDiag(
        "error",
        "RUSTY_E032",
        `Unclosed '${unclosed.ch}' — expected '${pairs[unclosed.ch]}'`,
        unclosed.offset,
        unclosed.offset + 1,
      );
    }

    // 2. Contract function presence check
    if (!/\bpub\s+fn\s+on_event\s*\(/.test(maskedClean)) {
      pushDiag(
        "error",
        "RUSTY_E030",
        "Missing required state contract function `pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome`",
        0,
        Math.min(src.length, 1),
      );
    }
    if (!/\bpub\s+fn\s+on_enter\s*\(/.test(maskedClean)) {
      pushDiag(
        "warning",
        "RUSTY_W031",
        "Missing `pub fn on_enter(globals: &mut Globals)` lifecycle function",
        0,
        Math.min(src.length, 1),
      );
    }
    if (!/\bpub\s+fn\s+on_exit\s*\(/.test(maskedClean)) {
      pushDiag(
        "warning",
        "RUSTY_W031",
        "Missing `pub fn on_exit(globals: &mut Globals)` lifecycle function",
        0,
        Math.min(src.length, 1),
      );
    }

    // 3. Global namespace checks (`globals.<field>`)
    const globalRefRe = /\bglobals\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let m;
    while ((m = globalRefRe.exec(maskedNoComments)) !== null) {
      const field = m[1];
      const fieldStart = m.index + "globals.".length;
      const fieldEnd = fieldStart + field.length;

      const def = globalMap.get(field);
      if (!def) {
        const suggestion = findClosest(field, globalNames);
        const hint = suggestion
          ? ` Did you mean \`globals.${suggestion}\`?`
          : globalNames.length > 0
            ? ` Defined globals: ${globalNames.join(", ")}.`
            : " No GlobalVar nodes are defined on this StateMachine.";
        pushDiag(
          "error",
          "RUSTY_E001",
          `Unknown global variable \`globals.${field}\`.${hint}`,
          fieldStart,
          fieldEnd,
          suggestion ? { title: `Replace with '${suggestion}'`, replacement: suggestion } : null,
        );
        continue;
      }

      // Check assignment / compound assignment immediately following `globals.<field>`
      const after = maskedNoComments.slice(fieldEnd);
      const assignMatch = /^\s*(\+=|-=|\*=|\/=|=(?!=))\s*([^;\n}]+)/.exec(after);
      if (assignMatch) {
        const op = assignMatch[1];
        const rhsRaw = assignMatch[2].trim();
        const rhsStart = fieldEnd + after.indexOf(rhsRaw);
        const rhsEnd = rhsStart + rhsRaw.length;

        if (op !== "=" && !isNumericType(def.rustType)) {
          pushDiag(
            "error",
            "RUSTY_E002",
            `Operator \`${op}\` cannot be applied to \`globals.${field}: ${def.rustType}\``,
            fieldStart,
            rhsEnd,
          );
        } else {
          const litType = inferLiteralType(rhsRaw);
          if (litType && !isTypeCompatible(def.rustType, litType)) {
            const extra =
              litType === "neg_int" && /^u/.test(def.rustType)
                ? " (negative literal cannot be assigned to unsigned integer)"
                : "";
            pushDiag(
              "error",
              "RUSTY_E003",
              `Type mismatch: \`globals.${field}\` has type \`${def.rustType}\`, cannot assign \`${rhsRaw}\`${extra}`,
              rhsStart,
              rhsEnd,
            );
          }
        }
      }
    }

    // Collect events explicitly matched in this state's `match event` arms
    const handledInCode = new Set();
    const matchArmEventRe = /\bEvent::([A-Za-z0-9_]+)\s*(?:\([^)]*\))?(?:\s+if\s+[^=]+)?\s*=>/g;
    while ((m = matchArmEventRe.exec(maskedNoComments)) !== null) {
      handledInCode.add(m[1]);
    }

    // 4. Event namespace & payload checks (`Event::<Variant>`)
    const eventRefRe = /\bEvent::([A-Za-z0-9_]+)(\s*\(([^)]*)\))?/g;
    while ((m = eventRefRe.exec(maskedNoComments)) !== null) {
      const variant = m[1];
      const hasParens = Boolean(m[2]);
      const argContent = m[3] !== undefined ? m[3].trim() : "";
      const varStart = m.index + "Event::".length;
      const varEnd = varStart + variant.length;

      const evDef = eventMap.get(variant);
      if (!evDef) {
        const suggestion = findClosest(variant, eventNames);
        const hint = suggestion
          ? ` Did you mean \`Event::${suggestion}\`?`
          : eventNames.length > 0
            ? ` Defined events: ${eventNames.join(", ")}.`
            : "";
        pushDiag(
          "error",
          "RUSTY_E010",
          `Unknown event variant \`Event::${variant}\`.${hint}`,
          varStart,
          varEnd,
          suggestion ? { title: `Replace with '${suggestion}'`, replacement: suggestion } : null,
        );
        continue;
      }

      // Check payload arity
      if (!evDef.payloadType && hasParens) {
        pushDiag(
          "error",
          "RUSTY_E011",
          `Event \`Event::${variant}\` is a unit event and takes no payload`,
          m.index,
          m.index + m[0].length,
        );
      } else if (evDef.payloadType && !hasParens) {
        pushDiag(
          "error",
          "RUSTY_E011",
          `Event \`Event::${variant}\` requires a \`${evDef.payloadType}\` payload (e.g. \`Event::${variant}(val)\`)`,
          varStart,
          varEnd,
        );
      } else if (evDef.payloadType && hasParens) {
        // If inside Outcome::Emit(...) or emit!(...), validate literal payload type
        const prefix = maskedNoComments.slice(Math.max(0, m.index - 24), m.index);
        if (/(?:Outcome::Emit|emit!)\s*\(\s*$/.test(prefix)) {
          if (!argContent) {
            pushDiag(
              "error",
              "RUSTY_E011",
              `Emitted \`Event::${variant}\` is missing its \`${evDef.payloadType}\` payload value`,
              m.index,
              m.index + m[0].length,
            );
          } else {
            const litType = inferLiteralType(argContent);
            if (litType && !isTypeCompatible(evDef.payloadType, litType)) {
              pushDiag(
                "error",
                "RUSTY_E012",
                `Payload type mismatch for \`Event::${variant}\`: expected \`${evDef.payloadType}\`, got \`${argContent}\``,
                m.index,
                m.index + m[0].length,
              );
            }
          }
        }
      }
    }

    // 5. Self-emitted event checks (`Outcome::Emit(Event::...)` and `emit!(...)`)
    const emitCallRe = /\bOutcome::Emit\s*\(\s*Event::([A-Za-z0-9_]+)/g;
    while ((m = emitCallRe.exec(maskedNoComments)) !== null) {
      const emittedVariant = m[1];
      if (
        eventMap.has(emittedVariant) &&
        !handledInCode.has(emittedVariant) &&
        !outgoingEvents.has(emittedVariant)
      ) {
        pushDiag(
          "warning",
          "RUSTY_W013",
          `Self-emitted \`Event::${emittedVariant}\` is not handled by \`on_event\` or any outgoing WebGME Transition from \`${currentState ? currentState.name : "this state"}\``,
          m.index,
          m.index + m[0].length,
        );
      }
    }

    const emitMacroRe = /\bemit!\s*\(/g;
    while ((m = emitMacroRe.exec(maskedNoComments)) !== null) {
      pushDiag(
        "warning",
        "RUSTY_W014",
        "Use `Outcome::Emit(Event::...)` instead of `emit!(...)` to emit events in the Rusty `#![no_std]` contract",
        m.index,
        m.index + m[0].length,
      );
    }

    // 6. StateId namespace & WebGME topology checks (`StateId::<Name>`)
    const stateRefRe = /\bStateId::([A-Za-z0-9_]+)\b/g;
    while ((m = stateRefRe.exec(maskedNoComments)) !== null) {
      const stName = m[1];
      const stStart = m.index + "StateId::".length;
      const stEnd = stStart + stName.length;

      if (!stateMap.has(stName)) {
        const suggestion = findClosest(stName, stateNames);
        const hint = suggestion
          ? ` Did you mean \`StateId::${suggestion}\`?`
          : stateNames.length > 0
            ? ` Defined states: ${stateNames.join(", ")}.`
            : "";
        pushDiag(
          "error",
          "RUSTY_E020",
          `Unknown state \`StateId::${stName}\`.${hint}`,
          stStart,
          stEnd,
          suggestion ? { title: `Replace with '${suggestion}'`, replacement: suggestion } : null,
        );
        continue;
      }

      // Warn if transitioning to a state without a declared WebGME Transition edge
      if (
        currentState &&
        stName !== toPascalCase(currentState.name) &&
        outgoingTargets.size > 0 &&
        !outgoingTargets.has(stName)
      ) {
        const prefix = maskedNoComments.slice(Math.max(0, m.index - 24), m.index);
        if (/Outcome::Transition\s*\(\s*$/.test(prefix)) {
          pushDiag(
            "warning",
            "RUSTY_W021",
            `Transition to \`StateId::${stName}\` has no matching WebGME Transition edge from \`${currentState.name}\``,
            m.index,
            stEnd,
          );
        }
      }
    }

    const durationMs =
      Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) /
      100;

    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;

    return {
      diagnostics,
      durationMs,
      stats: { errors, warnings, total: diagnostics.length },
    };
  }

  return {
    analyzeStateCode,
  };
});
