(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rustContract"));
  } else {
    root.RustySimEngine = factory(root.RustyContract);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract) {
  "use strict";

  const { toSnakeCase, toPascalCase } = contract;

  function parseInitialValue(rustType, rawVal) {
    const t = String(rustType || "i32").trim();
    const v = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : "";
    if (t === "bool") return v === "true";
    if (t === "String") return v.replace(/^"(.*)"$/, "$1");
    if (t === "f64" || t === "f32") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function stripComments(code) {
    return String(code || "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  }

  function extractFunctionBody(code, fnName) {
    const clean = stripComments(code);
    const re = new RegExp(`pub\\s+fn\\s+${fnName}\\s*\\([^)]*\\)(?:\\s*->\\s*[^{]+)?\\s*\\{`);
    const match = re.exec(clean);
    if (!match) return "";
    let idx = match.index + match[0].length;
    let depth = 1;
    const start = idx;
    while (idx < clean.length && depth > 0) {
      const ch = clean[idx];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      idx++;
    }
    return depth === 0 ? clean.slice(start, idx - 1).trim() : "";
  }

  function __r_round(x) {
    return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
  }
  function __r_abs(x) {
    return Math.abs(x);
  }
  function __r_floor(x) {
    return Math.floor(x);
  }
  function __r_ceil(x) {
    return Math.ceil(x);
  }
  function __r_clamp(x, lo, hi) {
    return Math.min(Math.max(x, lo), hi);
  }
  function __r_min(a, b) {
    return Math.min(a, b);
  }
  function __r_max(a, b) {
    return Math.max(a, b);
  }

  function findNextOutsideStrings(str, targetRe, startFrom = 0) {
    let inStr = false;
    for (let i = startFrom; i < str.length; i++) {
      const ch = str[i];
      if (ch === '"' && str[i - 1] !== "\\") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      const m = targetRe.exec(str.slice(i));
      if (m && m.index === 0) {
        return { index: i, match: m };
      }
    }
    return null;
  }

  function findMatchingParen(str, openIdx) {
    let depth = 0;
    let inStr = false;
    for (let i = openIdx; i < str.length; i++) {
      const ch = str[i];
      if (ch === '"' && str[i - 1] !== "\\") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function translateRustIfExpr(expr) {
    let out = String(expr || "");
    for (let guard = 0; guard < 32; guard++) {
      const found = findNextOutsideStrings(out, /\bif\b(?=\s|\()/);
      if (!found) break;
      const ifIdx = found.index;
      // Ensure `if` is not part of an identifier
      if (ifIdx > 0 && /[a-zA-Z0-9_]/.test(out[ifIdx - 1])) break;
      const brace1 = out.indexOf("{", ifIdx + 2);
      if (brace1 === -1) break;
      const close1 = findMatchingBrace(out, brace1);
      if (close1 === -1) break;
      const after1 = out.slice(close1 + 1);
      const elseMatch = /^\s*else\s*\{/.exec(after1);
      if (!elseMatch) break;
      const brace2 = close1 + 1 + elseMatch[0].length - 1;
      const close2 = findMatchingBrace(out, brace2);
      if (close2 === -1) break;

      const cond = out.slice(ifIdx + 2, brace1).trim();
      const thenBody = out.slice(brace1 + 1, close1).trim();
      const elseBody = out.slice(brace2 + 1, close2).trim();
      const ternary = `((${cond}) ? (${thenBody}) : (${elseBody}))`;
      out = out.slice(0, ifIdx) + ternary + out.slice(close2 + 1);
    }
    return out;
  }

  function findReceiverStart(str, dotIdx) {
    let pos = dotIdx - 1;
    while (pos >= 0 && /\s/.test(str[pos])) pos--;
    while (pos >= 0) {
      const ch = str[pos];
      if (/[a-zA-Z0-9_.]/.test(ch)) {
        pos--;
        continue;
      }
      if (ch === ")") {
        let depth = 1;
        let inStr = false;
        pos--;
        while (pos >= 0 && depth > 0) {
          const c = str[pos];
          if (c === '"' && str[pos - 1] !== "\\") inStr = !inStr;
          if (!inStr) {
            if (c === ")") depth++;
            else if (c === "(") depth--;
          }
          pos--;
        }
        // Include preceding function name or receiver chain if any
        continue;
      }
      break;
    }
    return pos + 1;
  }

  function translateRustMethods(expr) {
    let out = String(expr || "");
    const methodRe = /^\.(round|abs|floor|ceil|clamp|min|max)\s*\(/;
    for (let guard = 0; guard < 64; guard++) {
      const found = findNextOutsideStrings(out, methodRe);
      if (!found) break;
      const dotIdx = found.index;
      const method = found.match[1];
      const openParen = dotIdx + found.match[0].length - 1;
      const closeParen = findMatchingParen(out, openParen);
      if (closeParen === -1) break;

      const recvStart = findReceiverStart(out, dotIdx);
      const recv = out.slice(recvStart, dotIdx).trim();
      const argsStr = out.slice(openParen + 1, closeParen).trim();
      const replacement = argsStr
        ? `__r_${method}(${recv}, ${argsStr})`
        : `__r_${method}(${recv})`;
      out = out.slice(0, recvStart) + replacement + out.slice(closeParen + 1);
    }
    return out;
  }

  function evalRustExpr(expr, globals, localVars) {
    const trimmed = String(expr || "").trim();
    if (!trimmed) return undefined;

    // Outcome::Transition(StateId::Foo)
    const transMatch = /^Outcome::Transition\s*\(\s*StateId::([A-Za-z0-9_]+)\s*\)$/.exec(trimmed);
    if (transMatch) {
      return { __outcome: "Transition", target: transMatch[1] };
    }
    // Outcome::Emit(Event::Foo) or Outcome::Emit(Event::Foo(expr))
    const emitMatch = /^Outcome::Emit\s*\(\s*Event::([A-Za-z0-9_]+)(?:\s*\(([\s\S]*)\))?\s*\)$/.exec(trimmed);
    if (emitMatch) {
      const payloadVal =
        emitMatch[2] !== undefined && emitMatch[2].trim() !== ""
          ? evalRustExpr(emitMatch[2], globals, localVars)
          : undefined;
      return { __outcome: "Emit", event: emitMatch[1], payload: payloadVal };
    }
    if (trimmed === "Outcome::Stay") {
      return { __outcome: "Stay" };
    }

    // String::from("...")
    const strFrom = /^String::from\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)$/.exec(trimmed);
    if (strFrom) return strFrom[1];

    // Safe JS expression translation for Rust arithmetic/boolean/comparison expressions
    let jsExpr = trimmed
      .replace(/\btrue\b/g, "true")
      .replace(/\bfalse\b/g, "false")
      .replace(/\.to_string\(\)/g, "")
      .replace(/\bas\s+(?:i32|i64|u32|u64|usize|f32|f64)\b/g, "")
      .replace(/(?<![a-zA-Z0-9_)\]])\*([a-zA-Z_][a-zA-Z0-9_]*)/g, "$1");

    jsExpr = translateRustIfExpr(jsExpr);
    jsExpr = translateRustMethods(jsExpr);

    // Allow only safe characters & identifiers (no Function/window/process/eval/assignment)
    if (/\b(?:window|globalThis|process|require|import|eval|Function|fetch|constructor|__proto__|prototype)\b/.test(jsExpr)) {
      throw new Error(`Disallowed identifier in Rust expression: ${trimmed}`);
    }

    const keys = Object.keys(localVars || {});
    const vals = keys.map((k) => localVars[k]);
    const fn = new Function(
      "globals",
      "__r_round",
      "__r_abs",
      "__r_floor",
      "__r_ceil",
      "__r_clamp",
      "__r_min",
      "__r_max",
      ...keys,
      `"use strict"; return (${jsExpr});`,
    );
    return fn(
      globals,
      __r_round,
      __r_abs,
      __r_floor,
      __r_ceil,
      __r_clamp,
      __r_min,
      __r_max,
      ...vals,
    );
  }

  function findMatchingBrace(str, openIdx) {
    let depth = 0;
    let inStr = false;
    for (let i = openIdx; i < str.length; i++) {
      const ch = str[i];
      if (ch === '"' && str[i - 1] !== "\\") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function executeBlock(blockStr, globals, eventInfo, localVars, logs) {
    let src = String(blockStr || "").trim();
    let i = 0;
    let lastValue = undefined;

    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;

      // 1. match event { ... }
      if (src.slice(i).startsWith("match ")) {
        const braceIdx = src.indexOf("{", i);
        if (braceIdx === -1) break;
        const closeIdx = findMatchingBrace(src, braceIdx);
        if (closeIdx === -1) break;
        const matchBody = src.slice(braceIdx + 1, closeIdx);
        const result = executeMatchEvent(matchBody, globals, eventInfo, localVars, logs);
        lastValue = result;
        if (result && result.__outcome) return result;
        i = closeIdx + 1;
        if (src[i] === ";") i++;
        continue;
      }

      // 2. if cond { ... } [else if cond { ... }] [else { ... }]
      if (/^if\b/.test(src.slice(i))) {
        const res = executeIfChain(src, i, globals, eventInfo, localVars, logs);
        lastValue = res.value;
        if (lastValue && lastValue.__outcome) return lastValue;
        i = res.nextIdx;
        if (src[i] === ";") i++;
        continue;
      }

      // 3. Statement ending with ';' or end of block
      let stmtEnd = -1;
      let parenDepth = 0;
      let braceDepth = 0;
      let inStr = false;
      for (let j = i; j < src.length; j++) {
        const ch = src[j];
        if (ch === '"' && src[j - 1] !== "\\") inStr = !inStr;
        if (inStr) continue;
        if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (ch === ";" && parenDepth === 0 && braceDepth === 0) {
          stmtEnd = j;
          break;
        }
      }

      const stmt = (stmtEnd === -1 ? src.slice(i) : src.slice(i, stmtEnd)).trim();
      i = stmtEnd === -1 ? src.length : stmtEnd + 1;
      if (!stmt) continue;

      // Ignore `let _ = globals;`
      if (/^let\s+_\s*=/.test(stmt)) continue;

      // Local let binding: `let x = expr` or `let x: T = expr`
      const letMatch = /^let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*[^=]+)?\s*=\s*([\s\S]+)$/.exec(stmt);
      if (letMatch) {
        localVars[letMatch[1]] = evalRustExpr(letMatch[2], globals, localVars);
        continue;
      }

      // return expr
      const retMatch = /^return\s+([\s\S]+)$/.exec(stmt);
      if (retMatch) {
        return evalRustExpr(retMatch[1], globals, localVars);
      }

      // Compound or simple assignment to globals.field
      const assignMatch = /^globals\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(\+=|-=|\*=|\/=|=)\s*([\s\S]+)$/.exec(stmt);
      if (assignMatch) {
        const field = assignMatch[1];
        const op = assignMatch[2];
        const rhs = evalRustExpr(assignMatch[3], globals, localVars);
        if (op === "=") globals[field] = rhs;
        else if (op === "+=") globals[field] = globals[field] + rhs;
        else if (op === "-=") globals[field] = globals[field] - rhs;
        else if (op === "*=") globals[field] = globals[field] * rhs;
        else if (op === "/=") globals[field] = rhs !== 0 ? globals[field] / rhs : globals[field];
        continue;
      }

      // Standalone expression (e.g. Outcome::Transition(...) or Outcome::Stay)
      const val = evalRustExpr(stmt, globals, localVars);
      lastValue = val;
      if (val && val.__outcome) return val;
    }

    return lastValue;
  }

  function executeIfChain(src, startIdx, globals, eventInfo, localVars, logs) {
    let idx = startIdx;
    let executed = false;
    let value = undefined;

    while (idx < src.length) {
      while (idx < src.length && /\s/.test(src[idx])) idx++;
      const isElseIf = idx !== startIdx && /^else\s+if\b/.test(src.slice(idx));
      const isElse = idx !== startIdx && !isElseIf && /^else\b/.test(src.slice(idx));
      const isFirstIf = idx === startIdx && /^if\b/.test(src.slice(idx));

      if (!isFirstIf && !isElseIf && !isElse) break;

      if (isElse) {
        const braceIdx = src.indexOf("{", idx);
        const closeIdx = findMatchingBrace(src, braceIdx);
        if (!executed) {
          value = executeBlock(src.slice(braceIdx + 1, closeIdx), globals, eventInfo, { ...localVars }, logs);
          executed = true;
        }
        idx = closeIdx + 1;
        break;
      }

      const condStart = isFirstIf ? idx + 2 : idx + src.slice(idx).indexOf("if") + 2;
      const braceIdx = src.indexOf("{", condStart);
      const closeIdx = findMatchingBrace(src, braceIdx);
      const condExpr = src.slice(condStart, braceIdx).trim();

      if (!executed && Boolean(evalRustExpr(condExpr, globals, localVars))) {
        value = executeBlock(src.slice(braceIdx + 1, closeIdx), globals, eventInfo, { ...localVars }, logs);
        executed = true;
      }
      idx = closeIdx + 1;
    }

    return { value, nextIdx: idx };
  }

  function splitMatchArms(matchBody) {
    const arms = [];
    let i = 0;
    const len = matchBody.length;
    while (i < len) {
      while (i < len && /[\s,]/.test(matchBody[i])) i++;
      if (i >= len) break;

      const arrowIdx = matchBody.indexOf("=>", i);
      if (arrowIdx === -1) break;
      const patternPart = matchBody.slice(i, arrowIdx).trim();

      let bodyStart = arrowIdx + 2;
      while (bodyStart < len && /\s/.test(matchBody[bodyStart])) bodyStart++;

      let bodyStr = "";
      if (matchBody[bodyStart] === "{") {
        const closeIdx = findMatchingBrace(matchBody, bodyStart);
        if (closeIdx === -1) break;
        bodyStr = matchBody.slice(bodyStart + 1, closeIdx).trim();
        i = closeIdx + 1;
      } else {
        // Read until top-level comma
        let parenDepth = 0;
        let inStr = false;
        let j = bodyStart;
        for (; j < len; j++) {
          const ch = matchBody[j];
          if (ch === '"' && matchBody[j - 1] !== "\\") inStr = !inStr;
          if (inStr) continue;
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (ch === "," && parenDepth === 0) break;
        }
        bodyStr = matchBody.slice(bodyStart, j).trim();
        i = j + 1;
      }

      arms.push({ patternPart, bodyStr });
    }
    return arms;
  }

  function executeMatchEvent(matchBody, globals, eventInfo, localVars, logs) {
    const arms = splitMatchArms(matchBody);
    const evPascal = toPascalCase(eventInfo.name);

    for (const arm of arms) {
      // Split optional `if guard` on pattern
      const guardMatch = /^([\s\S]+?)\s+if\s+([\s\S]+)$/.exec(arm.patternPart);
      const pattern = (guardMatch ? guardMatch[1] : arm.patternPart).trim();
      const guard = guardMatch ? guardMatch[2].trim() : null;

      let matched = false;
      const armLocals = { ...localVars };

      if (pattern === "_") {
        matched = true;
      } else {
        // Support Event::Foo or Event::Foo(val) or Foo | Bar
        const alts = pattern.split("|").map((p) => p.trim());
        for (const alt of alts) {
          const evMatch = /^(?:Event::)?([A-Za-z0-9_]+)(?:\(\s*&?([a-zA-Z0-9_]+)\s*\))?$/.exec(alt);
          if (evMatch && evMatch[1] === evPascal) {
            matched = true;
            if (evMatch[2] && evMatch[2] !== "_") {
              armLocals[evMatch[2]] = eventInfo.payload;
            }
            break;
          }
        }
      }

      if (!matched) continue;
      if (guard && !Boolean(evalRustExpr(guard, globals, armLocals))) continue;

      return executeBlock(arm.bodyStr, globals, eventInfo, armLocals, logs);
    }

    return { __outcome: "Stay" };
  }

  function createSimulation(model) {
    const states = (model.states || []).map((s) => ({
      ...s,
      pascalName: toPascalCase(s.name),
      snakeName: toSnakeCase(s.name),
    }));
    const stateByPascal = new Map(states.map((s) => [s.pascalName, s]));
    const stateByName = new Map(states.map((s) => [s.name, s]));
    const transitions = [...(model.transitions || [])].sort(
      (a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0),
    );

    let globals = {};
    let currentState = null;
    let stepCount = 0;
    let trace = [];

    function initGlobals() {
      const g = {};
      for (const gv of model.globals || []) {
        g[toSnakeCase(gv.name)] = parseInitialValue(gv.rustType, gv.initialValue);
      }
      return g;
    }

    function diffGlobals(before, after) {
      const diff = {};
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const k of keys) {
        if (before[k] !== after[k]) {
          diff[k] = { before: before[k], after: after[k] };
        }
      }
      return diff;
    }

    function runLifecycle(state, fnName, logs) {
      if (!state || !state.code) return;
      const body = extractFunctionBody(state.code, fnName);
      if (!body) return;
      executeBlock(body, globals, { name: "__lifecycle__", payload: undefined }, {}, logs);
    }

    function reset() {
      globals = initGlobals();
      currentState = states.find((s) => s.isInitial) || states[0] || null;
      stepCount = 0;
      trace = [];

      const before = { ...globals };
      const logs = [];
      if (currentState) {
        try {
          runLifecycle(currentState, "on_enter", logs);
        } catch (err) {
          logs.push(`on_enter error: ${err.message}`);
        }
      }

      trace.push({
        step: 0,
        timestamp: Date.now(),
        event: "__init__",
        payload: null,
        fromState: currentState ? currentState.name : null,
        toState: currentState ? currentState.name : null,
        transitionId: null,
        via: "init",
        globals: { ...globals },
        diff: diffGlobals(before, globals),
        logs,
      });

      return getSnapshot();
    }

    function dispatch(eventName, payload) {
      if (!currentState) return getSnapshot();

      const before = { ...globals };
      const logs = [];
      const initialFromState = currentState;
      let matchedTransition = null;
      let via = "stay";

      let pending = { name: eventName, payload };
      let depth = 0;

      while (pending && depth < 8) {
        depth += 1;
        const activeEv = pending;
        pending = null;

        const fromState = currentState;
        let targetState = null;

        // 1. Run active state's Rust `on_event`
        try {
          const body = extractFunctionBody(currentState.code, "on_event");
          if (body) {
            const outcome = executeBlock(body, globals, activeEv, {}, logs);
            if (outcome && outcome.__outcome === "Transition" && outcome.target) {
              targetState =
                stateByPascal.get(outcome.target) || stateByName.get(outcome.target) || null;
              if (targetState) {
                via = "rust:on_event";
                matchedTransition =
                  transitions.find(
                    (t) =>
                      t.srcName === fromState.name &&
                      t.dstName === targetState.name &&
                      toPascalCase(t.event) === toPascalCase(activeEv.name),
                  ) || matchedTransition;
              }
            } else if (outcome && outcome.__outcome === "Emit" && outcome.event) {
              logs.push(`emitted Event::${outcome.event}`);
              pending = { name: outcome.event, payload: outcome.payload };
              via = "rust:emit";
              continue;
            }
          }
        } catch (err) {
          logs.push(`on_event error: ${err.message}`);
        }

        // 2. If Rust returned Stay, evaluate WebGME model-level transitions
        if (!targetState) {
          for (const t of transitions) {
            if (t.srcName !== fromState.name) continue;
            if (toPascalCase(t.event) !== toPascalCase(activeEv.name)) continue;
            let guardOk = true;
            if (t.guard && t.guard.trim()) {
              try {
                guardOk = Boolean(evalRustExpr(t.guard, globals, { payload: activeEv.payload }));
              } catch (err) {
                guardOk = false;
                logs.push(`guard error (${t.name}): ${err.message}`);
              }
            }
            if (guardOk) {
              targetState =
                stateByName.get(t.dstName) ||
                stateByPascal.get(toPascalCase(t.dstName)) ||
                null;
              matchedTransition = t;
              via = "model:transition";
              if (t.action && t.action.trim()) {
                try {
                  executeBlock(t.action, globals, activeEv, {}, logs);
                } catch (err) {
                  logs.push(`action error (${t.name}): ${err.message}`);
                }
              }
              break;
            }
          }
        }

        // 3. Perform state transition lifecycle (on_exit -> on_enter)
        if (targetState && targetState.name !== fromState.name) {
          try {
            runLifecycle(fromState, "on_exit", logs);
          } catch (err) {
            logs.push(`on_exit error: ${err.message}`);
          }
          currentState = targetState;
          try {
            runLifecycle(currentState, "on_enter", logs);
          } catch (err) {
            logs.push(`on_enter error: ${err.message}`);
          }
        }
      }

      stepCount += 1;
      const entry = {
        step: stepCount,
        timestamp: Date.now(),
        event: eventName,
        payload: payload !== undefined ? payload : null,
        fromState: initialFromState.name,
        toState: currentState.name,
        transitionId: matchedTransition ? matchedTransition.id || matchedTransition.name : null,
        via,
        globals: { ...globals },
        diff: diffGlobals(before, globals),
        logs,
      };
      trace.push(entry);
      if (trace.length > 250) trace.shift();

      return { entry, snapshot: getSnapshot() };
    }

    function setGlobal(name, value) {
      const key = toSnakeCase(name);
      if (Object.prototype.hasOwnProperty.call(globals, key)) {
        globals[key] = value;
      }
      return getSnapshot();
    }

    function getSnapshot() {
      return {
        currentState: currentState ? currentState.name : null,
        currentStateId: currentState ? currentState.id || null : null,
        stepCount,
        globals: { ...globals },
        trace: [...trace],
      };
    }

    reset();
    return {
      reset,
      dispatch,
      setGlobal,
      getSnapshot,
    };
  }

  return {
    createSimulation,
    extractFunctionBody,
    evalRustExpr,
  };
});
