(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rustContract"), require("./rustGuardLang"));
  } else {
    root.RustySimEngine = factory(root.RustyContract, root.RustyGuardLang);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract, guardLang) {
  "use strict";

  const { toSnakeCase, toPascalCase, compareTransitions, getStateHookBodies } = contract;

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

  function translateRustIfExpr(expr) {
    let out = String(expr || "");
    for (let guard = 0; guard < 32; guard++) {
      const found = findNextOutsideStrings(out, /\bif\b(?=\s|\()/);
      if (!found) break;
      const ifIdx = found.index;
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
        continue;
      }
      break;
    }
    return pos + 1;
  }

  function translateRustMethods(expr) {
    let out = String(expr || "");
    const methodRe = /^\.(round|abs|floor|ceil|clamp|min|max|to_string|len|trim)\s*\(/;
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
      let replacement;
      if (method === "to_string") replacement = `String(${recv})`;
      else if (method === "len") replacement = `String(${recv}).length`;
      else if (method === "trim") replacement = `String(${recv}).trim()`;
      else {
        replacement = argsStr
          ? `__r_${method}(${recv}, ${argsStr})`
          : `__r_${method}(${recv})`;
      }
      out = out.slice(0, recvStart) + replacement + out.slice(closeParen + 1);
    }
    return out;
  }

  function evalRustExpr(expr, globals, localVars) {
    const trimmed = String(expr || "").trim();
    if (!trimmed) return undefined;

    const strFrom = /^String::from\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)$/.exec(trimmed);
    if (strFrom) return strFrom[1];

    let jsExpr = trimmed
      .replace(/\btrue\b/g, "true")
      .replace(/\bfalse\b/g, "false")
      .replace(/\.to_string\(\)/g, "")
      .replace(/\bas\s+(?:i32|i64|u32|u64|usize|f32|f64)\b/g, "")
      .replace(/(?<![a-zA-Z0-9_)\]])\*([a-zA-Z_][a-zA-Z0-9_]*)/g, "$1");

    jsExpr = translateRustIfExpr(jsExpr);
    jsExpr = translateRustMethods(jsExpr);

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

  function executeBlock(blockStr, globals, localVars, logs) {
    const src = stripComments(String(blockStr || "")).trim();
    let i = 0;

    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;

      if (/^if\b/.test(src.slice(i))) {
        i = executeIfChain(src, i, globals, localVars, logs);
        if (src[i] === ";") i++;
        continue;
      }

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

      if (/^let\s+_\s*=/.test(stmt)) continue;

      const letMatch = /^let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*[^=]+)?\s*=\s*([\s\S]+)$/.exec(stmt);
      if (letMatch) {
        localVars[letMatch[1]] = evalRustExpr(letMatch[2], globals, localVars);
        continue;
      }

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
    }
  }

  function executeIfChain(src, startIdx, globals, localVars, logs) {
    let idx = startIdx;
    let executed = false;

    while (idx < src.length) {
      while (idx < src.length && /\s/.test(src[idx])) idx++;
      const isElseIf = idx !== startIdx && /^else\s+if\b/.test(src.slice(idx));
      const isElse = idx !== startIdx && !isElseIf && /^else\b/.test(src.slice(idx));
      const isFirstIf = idx === startIdx && /^if\b/.test(src.slice(idx));

      if (!isFirstIf && !isElseIf && !isElse) break;

      if (isElse) {
        const braceIdx = src.indexOf("{", idx);
        if (braceIdx === -1) break;
        const closeIdx = findMatchingBrace(src, braceIdx);
        if (closeIdx === -1) break;
        if (!executed) {
          executeBlock(src.slice(braceIdx + 1, closeIdx), globals, { ...localVars }, logs);
          executed = true;
        }
        idx = closeIdx + 1;
        break;
      }

      const condStart = isFirstIf ? idx + 2 : idx + src.slice(idx).indexOf("if") + 2;
      const braceIdx = src.indexOf("{", condStart);
      if (braceIdx === -1) break;
      const closeIdx = findMatchingBrace(src, braceIdx);
      if (closeIdx === -1) break;
      const condExpr = src.slice(condStart, braceIdx).trim();

      if (!executed && Boolean(evalRustExpr(condExpr, globals, localVars))) {
        executeBlock(src.slice(braceIdx + 1, closeIdx), globals, { ...localVars }, logs);
        executed = true;
      }
      idx = closeIdx + 1;
    }

    return idx;
  }

  function createSimulation(model) {
    const states = (model.states || []).map((s) => ({
      ...s,
      pascalName: toPascalCase(s.name),
      snakeName: toSnakeCase(s.name),
    }));
    const stateByPascal = new Map(states.map((s) => [s.pascalName, s]));
    const stateByName = new Map(states.map((s) => [s.name, s]));
    const stateById = new Map(states.filter((s) => s.id).map((s) => [s.id, s]));
    const transitions = (model.transitions || []).slice().sort(compareTransitions);

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

    function runLifecycle(state, hookName, logs) {
      if (!state) return;
      const bodies = getStateHookBodies(state);
      const body = hookName === "on_enter" ? bodies.entryCode : bodies.exitCode;
      if (!body || !body.trim()) return;
      executeBlock(body, globals, {}, logs);
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
      const fromState = currentState;
      const evPascal = toPascalCase(eventName);

      // Evaluate EVERY outgoing transition on `(fromState, evPascal)` via Guard AST
      const matching = [];
      for (const t of transitions) {
        const isSrc =
          (fromState.id && t.srcId === fromState.id) || t.srcName === fromState.name;
        if (!isSrc) continue;
        if (toPascalCase(t.event) !== evPascal) continue;

        const rawGuard = String(t.guard || "").trim();
        let guardOk = true;
        if (rawGuard) {
          const parsed = guardLang.parseGuard(rawGuard);
          if (parsed.errors.length > 0) {
            guardOk = false;
            logs.push(`guard parse error (${t.name || t.event}): ${parsed.errors[0].message}`);
          } else {
            try {
              guardOk = Boolean(guardLang.evalGuardAst(parsed.ast, globals, payload));
            } catch (err) {
              guardOk = false;
              logs.push(`guard eval error (${t.name || t.event}): ${err.message}`);
            }
          }
        }
        if (guardOk) matching.push(t);
      }

      if (matching.length > 1) {
        logs.push(
          `Non-deterministic guard overlap in ${fromState.name} on ${evPascal}: ${matching.length} transitions enabled`,
        );
      }

      const matchedTransition = matching[0] || null;
      let via = "stay";

      if (matchedTransition) {
        const targetState =
          (matchedTransition.dstId && stateById.get(matchedTransition.dstId)) ||
          stateByName.get(matchedTransition.dstName) ||
          stateByPascal.get(toPascalCase(matchedTransition.dstName)) ||
          fromState;
        const isSelf = targetState.name === fromState.name;
        const runLifecycleHooks = !isSelf || Boolean(matchedTransition.reenter);
        via = isSelf && !matchedTransition.reenter ? "model:self_transition" : "model:transition";

        if (runLifecycleHooks) {
          try {
            runLifecycle(fromState, "on_exit", logs);
          } catch (err) {
            logs.push(`on_exit error: ${err.message}`);
          }
        }

        if (matchedTransition.action && matchedTransition.action.trim()) {
          try {
            const actionLocals = payload !== undefined ? { payload } : {};
            executeBlock(matchedTransition.action, globals, actionLocals, logs);
          } catch (err) {
            logs.push(`action error (${matchedTransition.name || matchedTransition.event}): ${err.message}`);
          }
        }

        if (runLifecycleHooks) {
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
        fromState: fromState.name,
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
