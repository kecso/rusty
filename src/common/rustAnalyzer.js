(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rustContract"), require("./rustGuardLang"));
  } else {
    root.RustyAnalyzer = factory(root.RustyContract, root.RustyGuardLang);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract, guardLang) {
  "use strict";

  const {
    toSnakeCase,
    toPascalCase,
    getStateHookBodies,
    composeStateModuleRs,
    resolveStateTransitionHooks,
  } = contract;

  /**
   * Blank out comments & string contents while preserving exact line/column offsets.
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

  function offsetToPos(lineStarts, offset, lineOffset = 0, colOffset = 0) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    const lineIdx = Math.max(0, hi);
    return {
      line: lineIdx + 1 + lineOffset,
      column: offset - lineStarts[lineIdx] + 1 + colOffset,
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
    const low = String(target || "").toLowerCase();
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

  function buildSymbolTables(model) {
    const globalMap = new Map();
    const globalById = new Map();
    for (const g of (model && model.globals) || []) {
      const key = toSnakeCase(g.name);
      const item = { ...g, snakeName: key };
      globalMap.set(key, item);
      if (g.id) globalById.set(g.id, item);
    }

    const eventMap = new Map();
    const eventById = new Map();
    for (const ev of (model && model.events) || []) {
      const pascal = toPascalCase(ev.name);
      const item = { ...ev, pascalName: pascal, payloadType: (ev.payloadType || "").trim() };
      eventMap.set(pascal, item);
      if (ev.id) eventById.set(ev.id, item);
    }

    const stateMap = new Map();
    const stateById = new Map();
    for (const st of (model && model.states) || []) {
      const pascal = toPascalCase(st.name);
      const item = { ...st, pascalName: pascal };
      stateMap.set(pascal, item);
      if (st.id) stateById.set(st.id, item);
    }

    return {
      globalMap,
      globalById,
      globalNames: Array.from(globalMap.keys()),
      eventMap,
      eventById,
      eventNames: Array.from(eventMap.keys()),
      stateMap,
      stateById,
      stateNames: Array.from(stateMap.keys()),
    };
  }

  function checkDelimiters(maskedClean, pushDiag) {
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
  }

  function scanGlobalsAndAssignments(maskedNoComments, globalMap, globalNames, pushDiag) {
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
  }

  function scanForbiddenControlFlow(maskedNoComments, pushDiag) {
    const forbiddenRe = /\b(StateId::[A-Za-z0-9_]*|Outcome::[A-Za-z0-9_]*|Event::[A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = forbiddenRe.exec(maskedNoComments)) !== null) {
      pushDiag(
        "error",
        "RUSTY_E040",
        `Control-flow reference \`${m[1]}\` is forbidden inside hook code — transitions and events belong strictly to the design`,
        m.index,
        m.index + m[0].length,
      );
    }
  }

  /**
   * Instant semantic analysis of a single hook body (`entry`, `exit`, or `transition` action),
   * optionally shifted by `lineOffset` / `colOffset` so markers align on the composed file.
   */
  function analyzeHookBody(bodyCode, model, opts = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const src = String(bodyCode || "");
    const maskedNoComments = maskSource(src, false);
    const maskedClean = maskSource(src, true);
    const lineStarts = buildLineStarts(src);
    const lineOffset = Number(opts.lineOffset || 0);
    const colOffset = Number(opts.colOffset || 0);
    const diagnostics = [];

    const pushDiag = (severity, codeId, message, startOff, endOff, quickFix) => {
      const s = offsetToPos(lineStarts, Math.max(0, startOff), lineOffset, colOffset);
      const e = offsetToPos(lineStarts, Math.max(startOff + 1, endOff), lineOffset, colOffset);
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
    };

    const { globalMap, globalNames } = buildSymbolTables(model);
    if (src.trim()) {
      checkDelimiters(maskedClean, pushDiag);
      scanForbiddenControlFlow(maskedNoComments, pushDiag);
      scanGlobalsAndAssignments(maskedNoComments, globalMap, globalNames, pushDiag);

      const hasPayload = opts.kind === "transition" && Boolean((opts.payloadType || "").trim());
      if (!hasPayload) {
        const payRe = /(?<![a-zA-Z0-9_.])\bpayload\b/g;
        let pm;
        while ((pm = payRe.exec(maskedNoComments)) !== null) {
          pushDiag(
            "error",
            "RUSTY_E041",
            opts.kind === "transition"
              ? "Trigger event has no payload; `payload` is not in scope in this transition action"
              : "`payload` is only available inside transition actions whose trigger event carries a payload",
            pm.index,
            pm.index + pm[0].length,
          );
        }
      }
    }

    const durationMs =
      Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) / 100;
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;

    return {
      diagnostics,
      durationMs,
      stats: { errors, warnings, total: diagnostics.length },
    };
  }

  /**
   * Perform instant edit-time semantic analysis on a complete composed V3 Rust state module
   * (`src/states/<state>.rs`) against the live WebGME StateMachine model.
   */
  function analyzeStateCode(code, model, currentState) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const src = String(code || "");
    const maskedNoComments = maskSource(src, false);
    const maskedClean = maskSource(src, true);
    const lineStarts = buildLineStarts(src);
    const diagnostics = [];

    const pushDiag = (severity, codeId, message, startOff, endOff, quickFix) => {
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
    };

    const { globalMap, globalNames } = buildSymbolTables(model);

    checkDelimiters(maskedClean, pushDiag);
    scanForbiddenControlFlow(maskedNoComments, pushDiag);

    if (!/\bpub\s+fn\s+on_enter\s*\(/.test(maskedClean)) {
      pushDiag(
        "warning",
        "RUSTY_W031",
        "Missing `pub fn on_enter(globals: &mut Globals)` entry hook function",
        0,
        Math.min(src.length, 1),
      );
    }
    if (!/\bpub\s+fn\s+on_exit\s*\(/.test(maskedClean)) {
      pushDiag(
        "warning",
        "RUSTY_W031",
        "Missing `pub fn on_exit(globals: &mut Globals)` exit hook function",
        0,
        Math.min(src.length, 1),
      );
    }

    scanGlobalsAndAssignments(maskedNoComments, globalMap, globalNames, pushDiag);

    // Check `payload` references inside on_enter / on_exit or unit-event transition hooks
    const hooksByFn = new Map();
    if (currentState && model) {
      for (const h of resolveStateTransitionHooks(model, currentState)) {
        hooksByFn.set(h.fnName, h);
      }
    }
    const composedLines = src.split("\n");
    const parsed = contract.parseStateModuleRs(src);
    if (parsed.entryCode && /(?<![a-zA-Z0-9_.])\bpayload\b/.test(maskSource(parsed.entryCode, true))) {
      const lineIdx = composedLines.findIndex((l) => /pub\s+fn\s+on_enter\b/.test(l));
      const off = lineIdx >= 0 ? lineStarts[lineIdx] : 0;
      pushDiag("error", "RUSTY_E041", "`payload` is not available inside `on_enter`", off, off + 1);
    }
    if (parsed.exitCode && /(?<![a-zA-Z0-9_.])\bpayload\b/.test(maskSource(parsed.exitCode, true))) {
      const lineIdx = composedLines.findIndex((l) => /pub\s+fn\s+on_exit\b/.test(l));
      const off = lineIdx >= 0 ? lineStarts[lineIdx] : 0;
      pushDiag("error", "RUSTY_E041", "`payload` is not available inside `on_exit`", off, off + 1);
    }
    for (const [fnName, body] of Object.entries(parsed.actionsByFnName || {})) {
      const meta = hooksByFn.get(fnName);
      if (meta && !meta.payloadType && /(?<![a-zA-Z0-9_.])\bpayload\b/.test(maskSource(body, true))) {
        const lineIdx = composedLines.findIndex((l) => new RegExp(`pub\\s+fn\\s+${fnName}\\b`).test(l));
        const off = lineIdx >= 0 ? lineStarts[lineIdx] : 0;
        pushDiag(
          "error",
          "RUSTY_E041",
          `\`payload\` referenced in \`${fnName}\`, but trigger event \`${meta.transition.event}\` carries no payload`,
          off,
          off + 1,
        );
      }
    }

    const durationMs =
      Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) / 100;
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;

    return {
      diagnostics,
      durationMs,
      stats: { errors, warnings, total: diagnostics.length },
    };
  }

  /**
   * Validate a transition guard expression using RustyGuardLang.
   */
  function analyzeGuardExpression(guardExpr, model, transition) {
    return guardLang.validateGuard(guardExpr, model, transition);
  }

  /**
   * Extract all live WebGME design elements referenced by State hook code OR a Transition
   * (`triggerEvent` + guard + action) for `dependsOn` Set membership & drift detection.
   */
  function extractDependencies(codeOrGuard, model, opts = {}) {
    const { globalMap, eventMap } = buildSymbolTables(model);
    const memberIdSet = new Set();
    const snapshot = { globals: {}, events: {}, states: {} };

    function recordGlobal(def) {
      if (!def) return;
      const key = def.id || `global:${def.snakeName}`;
      if (def.id) memberIdSet.add(def.id);
      snapshot.globals[key] = {
        name: def.snakeName || def.name,
        rustType: def.rustType || "i32",
        minValue: def.minValue !== undefined && def.minValue !== null ? String(def.minValue) : "",
        maxValue: def.maxValue !== undefined && def.maxValue !== null ? String(def.maxValue) : "",
      };
    }

    function recordEvent(def) {
      if (!def) return;
      const key = def.id || `event:${def.pascalName}`;
      if (def.id) memberIdSet.add(def.id);
      snapshot.events[key] = { name: def.pascalName || def.name, payloadType: def.payloadType || "" };
    }

    if (opts.triggerEvent) {
      recordEvent(eventMap.get(toPascalCase(opts.triggerEvent)));
    }

    // If guard text is explicitly passed (or caller is analyzing a guard expression via triggerEvent),
    // parse with guardLang so bare global names like `current_temp_c` are captured in dependsOn!
    const guardSource =
      opts.guardText !== undefined
        ? opts.guardText
        : opts.isGuard || opts.triggerEvent
          ? String(codeOrGuard || "")
          : "";
    if (guardSource && guardSource.trim()) {
      const vg = guardLang.validateGuard(guardSource, model, { event: opts.triggerEvent || "" });
      for (const snakeName of vg.referencedGlobals || []) {
        recordGlobal(globalMap.get(snakeName));
      }
    }

    const codeSource =
      opts.actionText !== undefined
        ? opts.actionText
        : !opts.isGuard
          ? String(codeOrGuard || "")
          : "";
    if (codeSource && codeSource.trim()) {
      const masked = maskSource(codeSource, false);
      const gRe = /\bglobals\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
      let m;
      while ((m = gRe.exec(masked)) !== null) {
        recordGlobal(globalMap.get(m[1]));
      }
    }

    return {
      memberIds: Array.from(memberIdSet).sort(),
      snapshot,
    };
  }

  function serializeDepsSnapshot(snapshot) {
    return JSON.stringify(snapshot || { globals: {}, events: {}, states: {} });
  }

  function parseDepsSnapshot(raw) {
    if (!raw) return null;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        return {
          globals: parsed.globals || {},
          events: parsed.events || {},
          states: parsed.states || {},
        };
      }
    } catch (_err) {
      // ignore malformed
    }
    return null;
  }

  function detectDriftReasons(node, _model, tables) {
    const reasons = [];
    const snap = parseDepsSnapshot(node.depsSignature);
    if (!snap) return reasons;

    const { globalById, eventById } = tables;

    for (const [id, prev] of Object.entries(snap.globals)) {
      if (!globalById.size && id.startsWith("global:")) continue;
      const cur = globalById.get(id);
      if (!cur) {
        if (!tables.globalMap.has(toSnakeCase(prev.name))) {
          reasons.push({
            severity: "error",
            code: "DESIGN_GLOBAL_REMOVED",
            message: `Referenced global \`globals.${prev.name}\` was removed from the design`,
          });
        }
      } else {
        const prevSnake = toSnakeCase(prev.name);
        if (cur.snakeName !== prevSnake) {
          reasons.push({
            severity: "error",
            code: "DESIGN_GLOBAL_RENAMED",
            message: `Referenced global \`${prevSnake}\` was renamed to \`${cur.snakeName}\``,
          });
        }
        if ((cur.rustType || "i32") !== (prev.rustType || "i32")) {
          reasons.push({
            severity: "warning",
            code: "DESIGN_TYPE_CHANGED",
            message: `Type of \`globals.${cur.snakeName}\` changed from \`${prev.rustType}\` to \`${cur.rustType}\` — review/recheck code`,
          });
        }
        if (
          (prev.minValue !== undefined || prev.maxValue !== undefined) &&
          ((String(cur.minValue || "") !== String(prev.minValue || "")) ||
            (String(cur.maxValue || "") !== String(prev.maxValue || "")))
        ) {
          reasons.push({
            severity: "warning",
            code: "DESIGN_BOUNDS_CHANGED",
            message: `Domain bounds of \`globals.${cur.snakeName}\` changed — verify guard exclusivity and hook logic`,
          });
        }
      }
    }

    for (const [id, prev] of Object.entries(snap.events)) {
      if (!eventById.size && id.startsWith("event:")) continue;
      const cur = eventById.get(id);
      if (!cur) {
        if (!tables.eventMap.has(toPascalCase(prev.name))) {
          reasons.push({
            severity: "error",
            code: "DESIGN_EVENT_REMOVED",
            message: `Referenced event \`${prev.name}\` was removed from the design`,
          });
        }
      } else {
        if (cur.pascalName !== toPascalCase(prev.name)) {
          reasons.push({
            severity: "error",
            code: "DESIGN_EVENT_RENAMED",
            message: `Referenced event \`${prev.name}\` was renamed to \`${cur.pascalName}\``,
          });
        }
        if ((cur.payloadType || "") !== (prev.payloadType || "")) {
          reasons.push({
            severity: "warning",
            code: "DESIGN_PAYLOAD_CHANGED",
            message: `Payload type of \`${cur.pascalName}\` changed (${prev.payloadType || "none"} → ${cur.payloadType || "none"})`,
          });
        }
      }
    }

    if (Array.isArray(node.dependsOn)) {
      for (const depId of node.dependsOn) {
        if (!globalById.has(depId) && !eventById.has(depId)) {
          if (!reasons.some((r) => r.code.endsWith("_REMOVED"))) {
            reasons.push({
              severity: "warning",
              code: "DESIGN_DEPENDENCY_MISSING",
              message: "A referenced design element (WebGME dependsOn Set member) was deleted — recheck code",
            });
          }
        }
      }
    }

    return reasons;
  }

  /**
   * Compute full design-to-code impact + formal determinism proof across all States and Transitions.
   */
  function computeDesignImpact(model) {
    const tables = buildSymbolTables(model);
    const det = guardLang.checkMachineDeterminism(model);
    const byStateId = {};
    const byTransitionId = {};
    const items = [];

    for (const st of (model && model.states) || []) {
      const { entryCode, exitCode } = getStateHookBodies(st);
      const composed =
        st.code && (!entryCode && !exitCode)
          ? st.code
          : composeStateModuleRs(model, { ...st, entryCode, exitCode }).code;
      const codeRes = analyzeStateCode(composed, model, st);
      const drift = detectDriftReasons(st, model, tables);
      const seenMsg = new Set();
      const reasons = [];
      for (const r of [...drift, ...codeRes.diagnostics]) {
        const key = `${r.code}:${r.message}`;
        if (seenMsg.has(key)) continue;
        seenMsg.add(key);
        reasons.push({ severity: r.severity, code: r.code, message: r.message });
      }
      if (reasons.length > 0) {
        const entry = {
          kind: "state",
          id: st.id || st.name,
          name: st.name,
          errors: reasons.filter((r) => r.severity === "error").length,
          warnings: reasons.filter((r) => r.severity === "warning").length,
          reasons,
        };
        byStateId[entry.id] = entry;
        items.push(entry);
      }
    }

    for (const tr of (model && model.transitions) || []) {
      const tid = tr.id || contract.transitionKey(tr);
      const evDef = tables.eventMap.get(toPascalCase(tr.event || ""));
      const guardRes = analyzeGuardExpression(tr.guard || "", model, tr);
      const actionRes = analyzeHookBody(tr.action || "", model, {
        kind: "transition",
        payloadType: evDef ? evDef.payloadType : "",
      });
      const drift = detectDriftReasons(tr, model, tables);
      const detInfo = det.byTransitionId[tid];
      const detReasons = [];

      if (detInfo && detInfo.overlaps.length > 0) {
        for (const ov of detInfo.overlaps) {
          const otherLabel = ov.other ? `${ov.other.dstName || "?"} (${ov.other.name || ov.other.event})` : "sibling transition";
          detReasons.push({
            severity: "error",
            code: "DESIGN_GUARD_OVERLAP",
            message: `Non-deterministic overlap with → ${otherLabel} when ${ov.counterexampleText}`,
          });
        }
      } else if (detInfo && detInfo.unknowns.length > 0) {
        detReasons.push({
          severity: "warning",
          code: "DESIGN_GUARD_UNVERIFIED",
          message: detInfo.unknowns[0].reason || "Guard exclusivity could not be automatically verified",
        });
      }

      const seenMsg = new Set();
      const reasons = [];
      for (const r of [...drift, ...guardRes.diagnostics, ...actionRes.diagnostics, ...detReasons]) {
        const key = `${r.code}:${r.message}`;
        if (seenMsg.has(key)) continue;
        seenMsg.add(key);
        reasons.push({ severity: r.severity, code: r.code, message: r.message });
      }
      if (reasons.length > 0) {
        const entry = {
          kind: "transition",
          id: tid,
          name: `${tr.srcName || "?"} -> ${tr.dstName || "?"} (${tr.event})`,
          errors: reasons.filter((r) => r.severity === "error").length,
          warnings: reasons.filter((r) => r.severity === "warning").length,
          reasons,
        };
        byTransitionId[tid] = entry;
        items.push(entry);
      }
    }

    const impactedStates = Object.keys(byStateId).length;
    const impactedTransitions = Object.keys(byTransitionId).length;

    return {
      totalImpacted: impactedStates + impactedTransitions,
      impactedStates,
      impactedTransitions,
      determinism: det,
      byStateId,
      byTransitionId,
      items,
    };
  }

  function replaceMaskedIdentifiers(source, regex, replacement) {
    const src = String(source || "");
    if (!src) return { code: src, replacements: 0 };
    const masked = maskSource(src, true);
    let out = "";
    let lastIdx = 0;
    let count = 0;
    let m;
    while ((m = regex.exec(masked)) !== null) {
      const start = m.index + (m[1] ? m[1].length : 0);
      const end = m.index + m[0].length;
      out += src.slice(lastIdx, start) + replacement;
      lastIdx = end;
      count += 1;
    }
    if (count === 0) return { code: src, replacements: 0 };
    out += src.slice(lastIdx);
    return { code: out, replacements: count };
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Token-safe rename of `globals.<oldSnake>` inside Rust hook code without touching
   * comments or string literals.
   */
  function renameGlobalIdentifierInCode(code, oldSnakeName, newSnakeName) {
    const oldClean = toSnakeCase(oldSnakeName);
    const newClean = toSnakeCase(newSnakeName);
    if (!oldClean || !newClean || oldClean === newClean) {
      return { code: String(code || ""), replacements: 0 };
    }
    const re = new RegExp(`(\\bglobals\\.)${escapeRegExp(oldClean)}\\b`, "g");
    return replaceMaskedIdentifiers(code, re, newClean);
  }

  /**
   * Token-safe rename of `<oldSnake>` inside pure guard expressions.
   */
  function renameGlobalIdentifierInGuard(guardExpr, oldSnakeName, newSnakeName) {
    const oldClean = toSnakeCase(oldSnakeName);
    const newClean = toSnakeCase(newSnakeName);
    if (!oldClean || !newClean || oldClean === newClean) {
      return { guard: String(guardExpr || ""), replacements: 0 };
    }
    const re = new RegExp(`()\\b${escapeRegExp(oldClean)}\\b`, "g");
    const res = replaceMaskedIdentifiers(guardExpr, re, newClean);
    return { guard: res.code, replacements: res.replacements };
  }

  return {
    analyzeHookBody,
    analyzeStateCode,
    analyzeGuardExpression,
    extractDependencies,
    serializeDepsSnapshot,
    parseDepsSnapshot,
    computeDesignImpact,
    renameGlobalIdentifierInCode,
    renameGlobalIdentifierInGuard,
  };
});
