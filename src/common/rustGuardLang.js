(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rustContract"));
  } else {
    root.RustyGuardLang = factory(root.RustyContract);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract) {
  "use strict";

  const { toSnakeCase, toPascalCase, transitionKey } = contract;

  // =========================================================================
  // Exact BigInt Rational Arithmetic (zero floating-point drift in FME)
  // =========================================================================

  function gcdBig(a, b) {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x === 0n ? 1n : x;
  }

  function lcmBig(a, b) {
    if (a === 0n || b === 0n) return 1n;
    const ax = a < 0n ? -a : a;
    const bx = b < 0n ? -b : b;
    return (ax / gcdBig(ax, bx)) * bx;
  }

  function ratNorm(n, d = 1n) {
    if (d === 0n) throw new Error("Rational division by zero");
    if (n === 0n) return { n: 0n, d: 1n };
    let num = n;
    let den = d;
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcdBig(num, den);
    return { n: num / g, d: den / g };
  }

  const RAT_ZERO = { n: 0n, d: 1n };
  const RAT_ONE = { n: 1n, d: 1n };

  function ratFromStringOrNum(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) return null;
      return ratFromStringOrNum(String(raw));
    }
    const s = String(raw).trim();
    if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return null;
    const neg = s.startsWith("-");
    const unsigned = neg ? s.slice(1) : s;
    const dotIdx = unsigned.indexOf(".");
    if (dotIdx === -1) {
      const n = BigInt(unsigned);
      return ratNorm(neg ? -n : n, 1n);
    }
    const intPart = unsigned.slice(0, dotIdx) || "0";
    const fracPart = unsigned.slice(dotIdx + 1) || "0";
    const den = 10n ** BigInt(fracPart.length);
    const n = BigInt(intPart + fracPart);
    return ratNorm(neg ? -n : n, den);
  }

  function ratAdd(a, b) {
    return ratNorm(a.n * b.d + b.n * a.d, a.d * b.d);
  }

  function ratSub(a, b) {
    return ratNorm(a.n * b.d - b.n * a.d, a.d * b.d);
  }

  function ratMul(a, b) {
    return ratNorm(a.n * b.n, a.d * b.d);
  }

  function ratDiv(a, b) {
    if (b.n === 0n) throw new Error("Rational division by zero");
    return ratNorm(a.n * b.d, a.d * b.n);
  }

  function ratNeg(a) {
    return a.n === 0n ? RAT_ZERO : { n: -a.n, d: a.d };
  }

  function ratCmp(a, b) {
    const diff = a.n * b.d - b.n * a.d;
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  }

  function ratToNumber(r) {
    if (r.d === 1n) {
      const n = Number(r.n);
      if (Number.isSafeInteger(n)) return n;
    }
    return Math.round((Number(r.n) / Number(r.d)) * 1e9) / 1e9;
  }

  function ratToCleanDisplay(r, isInteger) {
    if (isInteger || r.d === 1n) {
      return Number(r.n / r.d);
    }
    const num = Number(r.n) / Number(r.d);
    const rounded = Math.round(num * 10000) / 10000;
    return rounded;
  }

  function ratFloor(r) {
    if (r.d === 1n) return r.n;
    const q = r.n / r.d;
    return r.n < 0n ? q - 1n : q;
  }

  function ratCeil(r) {
    if (r.d === 1n) return r.n;
    const q = r.n / r.d;
    return r.n > 0n ? q + 1n : q;
  }

  // =========================================================================
  // Guard Lexer & Parser
  // =========================================================================

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

  function tokenizeGuard(src) {
    const tokens = [];
    const errors = [];
    const s = String(src || "");
    let i = 0;

    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      const next = s[i + 1];

      // Two-char operators
      if (
        (ch === "|" && next === "|") ||
        (ch === "&" && next === "&") ||
        (ch === "=" && next === "=") ||
        (ch === "!" && next === "=") ||
        (ch === "<" && next === "=") ||
        (ch === ">" && next === "=")
      ) {
        tokens.push({ type: "OP", value: ch + next, start: i, end: i + 2 });
        i += 2;
        continue;
      }

      // Forbidden multi-char or assignment/Rust constructs
      if (
        (ch === ":" && next === ":") ||
        ((ch === "+" || ch === "-" || ch === "*" || ch === "/") && next === "=")
      ) {
        errors.push({
          severity: "error",
          code: "RUSTY_G002",
          message: `Forbidden construct \`${ch + next}\` in guard: guards must be pure boolean expressions (no assignments or enum paths)`,
          start: i,
          end: i + 2,
        });
        return { tokens, errors };
      }

      if (ch === "=" || ch === "{" || ch === "}" || ch === ";" || ch === "/" || ch === "%" || ch === "?" || ch === "&" || ch === "|") {
        const msg =
          ch === "="
            ? "Assignment `=` is not allowed in guards (did you mean `==`?)"
            : `Construct \`${ch}\` is not allowed in pure guards`;
        errors.push({
          severity: "error",
          code: "RUSTY_G002",
          message: msg,
          start: i,
          end: i + 1,
        });
        return { tokens, errors };
      }

      if (ch === "<" || ch === ">" || ch === "+" || ch === "-" || ch === "*" || ch === "!") {
        tokens.push({ type: "OP", value: ch, start: i, end: i + 1 });
        i++;
        continue;
      }

      if (ch === "(" || ch === ")" || ch === ".") {
        tokens.push({ type: ch, value: ch, start: i, end: i + 1 });
        i++;
        continue;
      }

      // String literal
      if (ch === '"') {
        const start = i;
        i++;
        let val = "";
        let closed = false;
        while (i < s.length) {
          const c = s[i];
          if (c === "\\" && i + 1 < s.length) {
            const esc = s[i + 1];
            val += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
            i += 2;
            continue;
          }
          if (c === '"') {
            closed = true;
            i++;
            break;
          }
          val += c;
          i++;
        }
        if (!closed) {
          errors.push({
            severity: "error",
            code: "RUSTY_G001",
            message: "Unterminated string literal in guard expression",
            start,
            end: i,
          });
          return { tokens, errors };
        }
        tokens.push({ type: "STRING", value: val, start, end: i });
        continue;
      }

      // Numeric literal
      if (/[0-9]/.test(ch)) {
        const start = i;
        while (i < s.length && /[0-9]/.test(s[i])) i++;
        let isFloat = false;
        if (s[i] === "." && /[0-9]/.test(s[i + 1] || "")) {
          isFloat = true;
          i++;
          while (i < s.length && /[0-9]/.test(s[i])) i++;
        }
        if (i < s.length && /[a-zA-Z_]/.test(s[i])) {
          errors.push({
            severity: "error",
            code: "RUSTY_G001",
            message: `Invalid numeric literal starting at \`${s.slice(start, i + 1)}\``,
            start,
            end: i + 1,
          });
          return { tokens, errors };
        }
        const raw = s.slice(start, i);
        tokens.push({
          type: isFloat ? "FLOAT" : "INT",
          value: isFloat ? Number(raw) : parseInt(raw, 10),
          raw,
          start,
          end: i,
        });
        continue;
      }

      // Identifier / boolean literal
      if (/[a-zA-Z_]/.test(ch)) {
        const start = i;
        while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) i++;
        const word = s.slice(start, i);
        if (word === "true" || word === "false") {
          tokens.push({ type: "BOOL", value: word === "true", start, end: i });
        } else {
          tokens.push({ type: "IDENT", value: word, start, end: i });
        }
        continue;
      }

      errors.push({
        severity: "error",
        code: "RUSTY_G001",
        message: `Unexpected character \`${ch}\` in guard expression`,
        start: i,
        end: i + 1,
      });
      return { tokens, errors };
    }

    return { tokens, errors };
  }

  function parseGuard(src) {
    const raw = String(src || "");
    if (!raw.trim()) {
      return { ast: null, errors: [] };
    }

    const { tokens, errors } = tokenizeGuard(raw);
    if (errors.length > 0) {
      return { ast: null, errors };
    }

    let pos = 0;
    const peek = () => tokens[pos] || null;
    const consume = () => tokens[pos++] || null;

    function syntaxError(tok, message) {
      const start = tok ? tok.start : Math.max(0, raw.length - 1);
      const end = tok ? tok.end : raw.length;
      const err = new Error(message);
      err.diag = { severity: "error", code: "RUSTY_G001", message, start, end };
      return err;
    }

    function parseOr() {
      let left = parseAnd();
      while (peek() && peek().type === "OP" && peek().value === "||") {
        const op = consume();
        const right = parseAnd();
        left = { kind: "Binary", op: op.value, left, right, start: left.start, end: right.end };
      }
      return left;
    }

    function parseAnd() {
      let left = parseCmp();
      while (peek() && peek().type === "OP" && peek().value === "&&") {
        const op = consume();
        const right = parseCmp();
        left = { kind: "Binary", op: op.value, left, right, start: left.start, end: right.end };
      }
      return left;
    }

    function isCmpOp(tok) {
      return (
        tok &&
        tok.type === "OP" &&
        (tok.value === "==" ||
          tok.value === "!=" ||
          tok.value === "<" ||
          tok.value === "<=" ||
          tok.value === ">" ||
          tok.value === ">=")
      );
    }

    function parseCmp() {
      let left = parseAdd();
      if (isCmpOp(peek())) {
        const op = consume();
        const right = parseAdd();
        if (isCmpOp(peek())) {
          throw syntaxError(
            peek(),
            "Chained comparisons are not allowed; combine comparisons explicitly with `&&`",
          );
        }
        return { kind: "Binary", op: op.value, left, right, start: left.start, end: right.end };
      }
      return left;
    }

    function parseAdd() {
      let left = parseMul();
      while (peek() && peek().type === "OP" && (peek().value === "+" || peek().value === "-")) {
        const op = consume();
        const right = parseMul();
        left = { kind: "Binary", op: op.value, left, right, start: left.start, end: right.end };
      }
      return left;
    }

    function parseMul() {
      let left = parseUnary();
      while (peek() && peek().type === "OP" && peek().value === "*") {
        const op = consume();
        const right = parseUnary();
        left = { kind: "Binary", op: op.value, left, right, start: left.start, end: right.end };
      }
      return left;
    }

    function parseUnary() {
      const tok = peek();
      if (tok && tok.type === "OP" && (tok.value === "!" || tok.value === "-")) {
        consume();
        const arg = parseUnary();
        return { kind: "Unary", op: tok.value, arg, start: tok.start, end: arg.end };
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const tok = peek();
      if (!tok) {
        throw syntaxError(null, "Unexpected end of guard expression");
      }

      if (tok.type === "(") {
        consume();
        const expr = parseOr();
        const close = peek();
        if (!close || close.type !== ")") {
          throw {
            diag: {
              severity: "error",
              code: "RUSTY_E032",
              message: "Unclosed '(' in guard expression — expected ')'",
              start: tok.start,
              end: close ? close.end : raw.length,
            },
          };
        }
        consume();
        return expr;
      }

      if (tok.type === "BOOL") {
        consume();
        return { kind: "BoolLit", value: tok.value, start: tok.start, end: tok.end };
      }
      if (tok.type === "INT") {
        consume();
        return { kind: "IntLit", value: tok.value, raw: tok.raw, start: tok.start, end: tok.end };
      }
      if (tok.type === "FLOAT") {
        consume();
        return { kind: "FloatLit", value: tok.value, raw: tok.raw, start: tok.start, end: tok.end };
      }
      if (tok.type === "STRING") {
        consume();
        return { kind: "StringLit", value: tok.value, start: tok.start, end: tok.end };
      }

      if (tok.type === "IDENT") {
        consume();
        if (tok.value === "globals") {
          const dot = peek();
          if (!dot || dot.type !== ".") {
            throw syntaxError(dot || tok, "Expected `globals.<field_name>`");
          }
          consume();
          const fieldTok = peek();
          if (!fieldTok || fieldTok.type !== "IDENT") {
            throw syntaxError(fieldTok || dot, "Expected field identifier after `globals.`");
          }
          consume();
          if (peek() && peek().type === "(") {
            throw {
              diag: {
                severity: "error",
                code: "RUSTY_G002",
                message: `Method/function call \`${fieldTok.value}(...)\` is not allowed in guards`,
                start: tok.start,
                end: peek().end,
              },
            };
          }
          return {
            kind: "VarRef",
            source: "global",
            name: fieldTok.value,
            rawName: `globals.${fieldTok.value}`,
            start: tok.start,
            end: fieldTok.end,
          };
        }

        if (peek() && peek().type === "(") {
          throw {
            diag: {
              severity: "error",
              code: "RUSTY_G002",
              message: `Function call \`${tok.value}(...)\` is not allowed in pure guard expressions`,
              start: tok.start,
              end: peek().end,
            },
          };
        }
        if (peek() && peek().type === ".") {
          throw {
            diag: {
              severity: "error",
              code: "RUSTY_G002",
              message: `Member/method access \`${tok.value}.\` is not allowed in guards (use \`globals.<name>\` or bare variable names)`,
              start: tok.start,
              end: peek().end,
            },
          };
        }

        if (tok.value === "payload") {
          return {
            kind: "VarRef",
            source: "payload",
            name: "payload",
            rawName: "payload",
            start: tok.start,
            end: tok.end,
          };
        }

        return {
          kind: "VarRef",
          source: "global",
          name: tok.value,
          rawName: tok.value,
          start: tok.start,
          end: tok.end,
        };
      }

      throw syntaxError(tok, `Unexpected token \`${tok.value}\` in guard expression`);
    }

    try {
      const ast = parseOr();
      if (pos < tokens.length) {
        const extra = tokens[pos];
        return {
          ast: null,
          errors: [
            {
              severity: "error",
              code: extra.type === ")" ? "RUSTY_E032" : "RUSTY_G001",
              message:
                extra.type === ")"
                  ? "Unexpected closing ')' in guard expression"
                  : `Unexpected trailing token \`${extra.value}\` in guard expression`,
              start: extra.start,
              end: extra.end,
            },
          ],
        };
      }
      return { ast, errors: [] };
    } catch (err) {
      if (err && err.diag) {
        return { ast: null, errors: [err.diag] };
      }
      return {
        ast: null,
        errors: [
          {
            severity: "error",
            code: "RUSTY_G001",
            message: (err && err.message) || "Invalid guard syntax",
            start: 0,
            end: Math.max(1, raw.length),
          },
        ],
      };
    }
  }

  // =========================================================================
  // Semantic Type Checker & Dependency Extractor
  // =========================================================================

  function rustTypeToCategory(rustType) {
    const t = String(rustType || "").trim();
    if (t === "bool") return "bool";
    if (t === "String" || t === "&str") return "String";
    if (t === "f32" || t === "f64") return "float";
    if (/^(?:i8|i16|i32|i64|isize)$/.test(t)) return "int";
    if (/^(?:u8|u16|u32|u64|usize)$/.test(t)) return "uint";
    return "unknown";
  }

  function isIntCategory(cat) {
    return cat === "int" || cat === "uint";
  }

  function isNumericCategory(cat) {
    return cat === "int" || cat === "uint" || cat === "float";
  }

  function validateGuard(guardExpr, model, transition) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const raw = String(guardExpr || "");
    const diagnostics = [];
    const referencedGlobals = new Set();
    let usesPayload = false;

    const lineStarts = [0];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "\n") lineStarts.push(i + 1);
    }
    const offsetToPos = (offset) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lineStarts[mid] <= offset) lo = mid + 1;
        else hi = mid - 1;
      }
      const lineIdx = Math.max(0, hi);
      return { line: lineIdx + 1, column: offset - lineStarts[lineIdx] + 1 };
    };
    const pushDiag = (severity, code, message, startOff, endOff, quickFix) => {
      const s = offsetToPos(Math.max(0, startOff || 0));
      const e = offsetToPos(Math.max((startOff || 0) + 1, endOff || 1));
      diagnostics.push({
        severity,
        code,
        message,
        startLine: s.line,
        startColumn: s.column,
        endLine: e.line,
        endColumn: e.column,
        quickFix: quickFix || null,
      });
    };

    const globalsBySnake = new Map();
    for (const g of (model && model.globals) || []) {
      globalsBySnake.set(toSnakeCase(g.name), g);
    }
    const globalNames = Array.from(globalsBySnake.keys());

    const eventsByPascal = new Map();
    for (const ev of (model && model.events) || []) {
      eventsByPascal.set(toPascalCase(ev.name), ev);
    }
    const eventNames = Array.from(eventsByPascal.keys());

    let evDef = null;
    if (transition && transition.event) {
      const evPascal = toPascalCase(transition.event);
      evDef = eventsByPascal.get(evPascal) || null;
      if (!evDef) {
        const suggestion = findClosest(evPascal, eventNames);
        const hint = suggestion
          ? ` Did you mean \`${suggestion}\`?`
          : eventNames.length > 0
            ? ` Defined events: ${eventNames.join(", ")}.`
            : "";
        pushDiag("error", "RUSTY_E010", `Transition references unknown event \`${transition.event}\`.${hint}`, 0, 1);
      }
    }

    if (!raw.trim()) {
      const durationMs =
        Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) / 100;
      return {
        ast: null,
        valid: diagnostics.filter((d) => d.severity === "error").length === 0,
        diagnostics,
        referencedGlobals: [],
        usesPayload: false,
        durationMs,
        stats: {
          errors: diagnostics.filter((d) => d.severity === "error").length,
          warnings: diagnostics.filter((d) => d.severity === "warning").length,
          total: diagnostics.length,
        },
      };
    }

    const { ast, errors: parseErrors } = parseGuard(raw);
    for (const pe of parseErrors) {
      pushDiag("error", pe.code, pe.message, pe.start, pe.end);
    }

    function infer(node) {
      if (!node) return { cat: "unknown", rustType: null, isNegativeLit: false };

      if (node.kind === "BoolLit") {
        node.cat = "bool";
        return { cat: "bool", rustType: "bool" };
      }
      if (node.kind === "IntLit") {
        node.cat = "int_lit";
        return { cat: "int_lit", rustType: null };
      }
      if (node.kind === "FloatLit") {
        node.cat = "float";
        return { cat: "float", rustType: "f64" };
      }
      if (node.kind === "StringLit") {
        node.cat = "String";
        return { cat: "String", rustType: "&str" };
      }

      if (node.kind === "VarRef") {
        if (node.source === "payload") {
          usesPayload = true;
          const pt = evDef && evDef.payloadType ? String(evDef.payloadType).trim() : "";
          if (!pt) {
            pushDiag(
              "error",
              "RUSTY_G006",
              `Event \`${transition ? transition.event : "unknown"}\` has no payload; \`payload\` cannot be referenced in guard`,
              node.start,
              node.end,
            );
            node.cat = "unknown";
            return { cat: "unknown", rustType: null };
          }
          const cat = rustTypeToCategory(pt);
          node.cat = cat;
          node.rustType = pt;
          return { cat, rustType: pt };
        }

        const key = toSnakeCase(node.name);
        const def = globalsBySnake.get(key) || globalsBySnake.get(node.name);
        if (!def) {
          const suggestion = findClosest(node.name, globalNames);
          const hint = suggestion
            ? ` Did you mean \`${suggestion}\`?`
            : globalNames.length > 0
              ? ` Defined globals: ${globalNames.join(", ")}.`
              : "";
          pushDiag(
            "error",
            "RUSTY_E001",
            `Unknown global \`${node.rawName}\` in guard.${hint}`,
            node.start,
            node.end,
            suggestion ? { title: `Replace with '${suggestion}'`, replacement: suggestion } : null,
          );
          node.cat = "unknown";
          return { cat: "unknown", rustType: null };
        }
        const canonical = toSnakeCase(def.name);
        referencedGlobals.add(canonical);
        node.canonicalName = canonical;
        node.rustType = def.rustType || "i32";
        const cat = rustTypeToCategory(node.rustType);
        node.cat = cat;
        return { cat, rustType: node.rustType };
      }

      if (node.kind === "Unary") {
        const sub = infer(node.arg);
        if (node.op === "!") {
          if (sub.cat !== "unknown" && sub.cat !== "bool") {
            pushDiag("error", "RUSTY_E003", `Operator \`!\` requires a \`bool\` expression, got \`${sub.cat}\``, node.start, node.end);
          }
          node.cat = "bool";
          return { cat: "bool", rustType: "bool" };
        }
        // unary '-'
        if (sub.cat !== "unknown" && !isNumericCategory(sub.cat) && sub.cat !== "int_lit") {
          pushDiag("error", "RUSTY_E003", `Unary \`-\` requires numeric expression, got \`${sub.cat}\``, node.start, node.end);
          node.cat = "unknown";
          return { cat: "unknown", rustType: null };
        }
        node.cat = sub.cat;
        node.isNegativeLit = node.arg.kind === "IntLit" || node.arg.kind === "FloatLit";
        return { cat: sub.cat, rustType: sub.rustType, isNegativeLit: node.isNegativeLit };
      }

      if (node.kind === "Binary") {
        const L = infer(node.left);
        const R = infer(node.right);
        const op = node.op;

        if (op === "&&" || op === "||") {
          if (L.cat !== "unknown" && L.cat !== "bool") {
            pushDiag("error", "RUSTY_E003", `Left side of \`${op}\` must be \`bool\`, got \`${L.cat}\``, node.left.start, node.left.end);
          }
          if (R.cat !== "unknown" && R.cat !== "bool") {
            pushDiag("error", "RUSTY_E003", `Right side of \`${op}\` must be \`bool\`, got \`${R.cat}\``, node.right.start, node.right.end);
          }
          node.cat = "bool";
          return { cat: "bool", rustType: "bool" };
        }

        if (op === "+" || op === "-" || op === "*") {
          const okNumL = L.cat === "unknown" || isNumericCategory(L.cat) || L.cat === "int_lit";
          const okNumR = R.cat === "unknown" || isNumericCategory(R.cat) || R.cat === "int_lit";
          if (!okNumL || !okNumR) {
            pushDiag("error", "RUSTY_E003", `Arithmetic \`${op}\` requires numeric operands`, node.start, node.end);
            node.cat = "unknown";
            return { cat: "unknown", rustType: null };
          }
          if ((L.cat === "int" && R.cat === "uint") || (L.cat === "uint" && R.cat === "int") || (L.rustType && R.rustType && L.rustType !== R.rustType && isIntCategory(L.cat) && isIntCategory(R.cat))) {
            pushDiag("error", "RUSTY_E003", `Type mismatch in guard arithmetic: \`${L.rustType}\` vs \`${R.rustType}\``, node.start, node.end);
          } else if (isIntCategory(L.cat) && R.cat === "float") {
            pushDiag("error", "RUSTY_E003", `Cannot mix integer \`${L.rustType}\` with float in \`${op}\``, node.start, node.end);
          } else if (L.cat === "float" && isIntCategory(R.cat)) {
            pushDiag("error", "RUSTY_E003", `Cannot mix float with integer \`${R.rustType}\` in \`${op}\``, node.start, node.end);
          }
          const resCat =
            L.cat === "float" || R.cat === "float"
              ? "float"
              : isIntCategory(L.cat)
                ? L.cat
                : isIntCategory(R.cat)
                  ? R.cat
                  : "int_lit";
          const rustType = L.rustType || R.rustType || (resCat === "float" ? "f64" : null);
          node.cat = resCat;
          return { cat: resCat, rustType };
        }

        // Comparisons: < <= > >= == !=
        const isOrderCmp = op === "<" || op === "<=" || op === ">" || op === ">=";
        if (isOrderCmp) {
          const okNumL = L.cat === "unknown" || isNumericCategory(L.cat) || L.cat === "int_lit";
          const okNumR = R.cat === "unknown" || isNumericCategory(R.cat) || R.cat === "int_lit";
          if (!okNumL || !okNumR) {
            pushDiag("error", "RUSTY_E003", `Comparison \`${op}\` requires numeric operands`, node.start, node.end);
          }
        }

        if (L.cat !== "unknown" && R.cat !== "unknown") {
          const bothBool = L.cat === "bool" && R.cat === "bool";
          const bothStr = L.cat === "String" && R.cat === "String";
          const bothNum = (isNumericCategory(L.cat) || L.cat === "int_lit") && (isNumericCategory(R.cat) || R.cat === "int_lit");
          if (!bothBool && !bothStr && !bothNum) {
            pushDiag(
              "error",
              "RUSTY_E003",
              `Type mismatch in comparison \`${op}\`: cannot compare \`${L.rustType || L.cat}\` with \`${R.rustType || R.cat}\``,
              node.start,
              node.end,
            );
          } else if (bothNum) {
            if ((L.cat === "uint" && R.isNegativeLit) || (R.cat === "uint" && L.isNegativeLit)) {
              pushDiag(
                "error",
                "RUSTY_E003",
                `Type mismatch: negative integer literal cannot be compared with unsigned type \`${L.cat === "uint" ? L.rustType : R.rustType}\``,
                node.start,
                node.end,
              );
            } else if ((isIntCategory(L.cat) && R.cat === "float") || (L.cat === "float" && isIntCategory(R.cat))) {
              pushDiag(
                "error",
                "RUSTY_E003",
                `Type mismatch in guard: cannot compare integer \`${isIntCategory(L.cat) ? L.rustType : R.rustType}\` with float`,
                node.start,
                node.end,
              );
            } else if (L.rustType && R.rustType && isIntCategory(L.cat) && isIntCategory(R.cat) && L.rustType !== R.rustType) {
              pushDiag(
                "error",
                "RUSTY_E003",
                `Type mismatch in guard: \`${L.rustType}\` vs \`${R.rustType}\``,
                node.start,
                node.end,
              );
            }
          }
        }

        node.cat = "bool";
        return { cat: "bool", rustType: "bool" };
      }

      return { cat: "unknown", rustType: null };
    }

    if (ast) {
      const top = infer(ast);
      if (top.cat !== "unknown" && top.cat !== "bool") {
        pushDiag(
          "error",
          "RUSTY_G005",
          `Guard expression must evaluate to \`bool\`, got \`${top.rustType || top.cat}\``,
          ast.start,
          ast.end,
        );
      }
    }

    const durationMs =
      Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) / 100;
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;

    return {
      ast,
      valid: errors === 0,
      diagnostics,
      referencedGlobals: Array.from(referencedGlobals),
      usesPayload,
      durationMs,
      stats: { errors, warnings, total: diagnostics.length },
    };
  }

  // =========================================================================
  // Rust Code Emitter & Direct JS Runtime Evaluator
  // =========================================================================

  function precOf(op) {
    if (op === "||") return 1;
    if (op === "&&") return 2;
    if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") return 3;
    if (op === "+" || op === "-") return 4;
    if (op === "*") return 5;
    return 6;
  }

  function hasFloatInside(node, globalsBySnake, eventPayloadCat) {
    if (!node) return false;
    if (node.kind === "FloatLit") return true;
    if (node.kind === "VarRef") {
      if (node.source === "payload") return eventPayloadCat === "float";
      const def = globalsBySnake.get(toSnakeCase(node.name));
      return def ? rustTypeToCategory(def.rustType) === "float" : false;
    }
    if (node.kind === "Unary") return hasFloatInside(node.arg, globalsBySnake, eventPayloadCat);
    if (node.kind === "Binary") {
      return (
        hasFloatInside(node.left, globalsBySnake, eventPayloadCat) ||
        hasFloatInside(node.right, globalsBySnake, eventPayloadCat)
      );
    }
    return false;
  }

  function emitGuardRust(guardInput, model, eventDef) {
    const ast =
      typeof guardInput === "string"
        ? parseGuard(guardInput).ast
        : guardInput || null;
    if (!ast) return "true";

    const globalsBySnake = new Map(
      ((model && model.globals) || []).map((g) => [toSnakeCase(g.name), g]),
    );
    const evCat = eventDef && eventDef.payloadType ? rustTypeToCategory(eventDef.payloadType) : "unknown";

    function emit(node, expectFloat) {
      if (!node) return "true";
      if (node.kind === "BoolLit") return node.value ? "true" : "false";
      if (node.kind === "IntLit") return expectFloat ? `${node.raw}.0` : node.raw;
      if (node.kind === "FloatLit") return node.raw;
      if (node.kind === "StringLit") return JSON.stringify(node.value);
      if (node.kind === "VarRef") {
        if (node.source === "payload") return "payload";
        const key = node.canonicalName || toSnakeCase(node.name);
        return `globals.${key}`;
      }
      if (node.kind === "Unary") {
        const subFloat = node.op === "-" ? expectFloat || hasFloatInside(node.arg, globalsBySnake, evCat) : false;
        const innerNeedsParens = node.arg.kind === "Binary";
        const s = emit(node.arg, subFloat);
        return innerNeedsParens ? `${node.op}(${s})` : `${node.op}${s}`;
      }
      if (node.kind === "Binary") {
        const isBoolOp = node.op === "&&" || node.op === "||";
        const subFloat = isBoolOp
          ? false
          : expectFloat || hasFloatInside(node, globalsBySnake, evCat);
        const p = precOf(node.op);
        let leftStr = emit(node.left, subFloat);
        let rightStr = emit(node.right, subFloat);
        if (node.left.kind === "Binary" && precOf(node.left.op) < p) leftStr = `(${leftStr})`;
        if (node.right.kind === "Binary" && precOf(node.right.op) <= p && node.op !== node.right.op) {
          rightStr = `(${rightStr})`;
        } else if (node.right.kind === "Binary" && precOf(node.right.op) < p) {
          rightStr = `(${rightStr})`;
        } else if (node.right.kind === "Binary" && (node.op === "-" || node.op === "==" || node.op === "!=") && precOf(node.right.op) === p) {
          rightStr = `(${rightStr})`;
        }
        return `${leftStr} ${node.op} ${rightStr}`;
      }
      return "true";
    }

    return emit(ast, false);
  }

  function evalGuardAst(ast, globalsObj, payloadVal) {
    if (!ast) return true;
    const g = globalsObj || {};

    function ev(n) {
      if (!n) return true;
      switch (n.kind) {
        case "BoolLit":
        case "IntLit":
        case "FloatLit":
        case "StringLit":
          return n.value;
        case "VarRef":
          if (n.source === "payload") return payloadVal;
          return g[n.canonicalName || toSnakeCase(n.name)];
        case "Unary":
          return n.op === "!" ? !ev(n.arg) : -Number(ev(n.arg));
        case "Binary": {
          if (n.op === "&&") return Boolean(ev(n.left)) && Boolean(ev(n.right));
          if (n.op === "||") return Boolean(ev(n.left)) || Boolean(ev(n.right));
          const l = ev(n.left);
          const r = ev(n.right);
          switch (n.op) {
            case "==": return l === r;
            case "!=": return l !== r;
            case "<": return l < r;
            case "<=": return l <= r;
            case ">": return l > r;
            case ">=": return l >= r;
            case "+": return l + r;
            case "-": return l - r;
            case "*": return l * r;
          }
        }
      }
      return false;
    }
    return ev(ast);
  }

  // =========================================================================
  // Formal Mutual-Exclusivity Prover (DNF + Boolean + String + Exact Rational FME)
  // =========================================================================

  const MAX_DNF_CLAUSES = 128;
  const MAX_FME_VARS = 10;
  const MAX_FME_INEQS = 120;
  const MAX_NEQ_SPLITS = 6;
  const MAX_BB_NODES = 64;

  function negateAtom(atom) {
    if (atom.kind === "BoolLit") return { ...atom, value: !atom.value };
    if (atom.kind === "Unary" && atom.op === "!") return atom.arg;
    if (atom.kind === "Binary") {
      switch (atom.op) {
        case "==": return { ...atom, op: "!=" };
        case "!=": return { ...atom, op: "==" };
        case "<": return { ...atom, op: ">=" };
        case "<=": return { ...atom, op: ">" };
        case ">": return { ...atom, op: "<=" };
        case ">=": return { ...atom, op: "<" };
      }
    }
    return { kind: "Unary", op: "!", arg: atom };
  }

  function isBooleanTypedNode(node, varMeta) {
    if (!node) return false;
    if (node.kind === "BoolLit") return true;
    if (node.kind === "Unary" && node.op === "!") return true;
    if (node.kind === "VarRef") {
      const m = varMeta.get(varKeyOf(node));
      return m ? m.cat === "bool" : false;
    }
    if (node.kind === "Binary") {
      return (
        node.op === "&&" ||
        node.op === "||" ||
        node.op === "==" ||
        node.op === "!=" ||
        node.op === "<" ||
        node.op === "<=" ||
        node.op === ">" ||
        node.op === ">="
      );
    }
    return false;
  }

  function varKeyOf(node) {
    if (node.source === "payload") return "$payload";
    return node.canonicalName || toSnakeCase(node.name);
  }

  function toDNF(node, negated, varMeta) {
    if (!node) return negated ? [] : [[]];

    if (node.kind === "Unary" && node.op === "!") {
      return toDNF(node.arg, !negated, varMeta);
    }

    if (node.kind === "Binary" && (node.op === "&&" || node.op === "||")) {
      const effectiveOp = negated ? (node.op === "&&" ? "||" : "&&") : node.op;
      const leftClauses = toDNF(node.left, negated, varMeta);
      if (leftClauses === null) return null;
      const rightClauses = toDNF(node.right, negated, varMeta);
      if (rightClauses === null) return null;

      if (effectiveOp === "||") {
        const merged = leftClauses.concat(rightClauses);
        return merged.length > MAX_DNF_CLAUSES ? null : merged;
      }
      // conjunction: cartesian product
      const product = [];
      for (const lc of leftClauses) {
        for (const rc of rightClauses) {
          product.push(lc.concat(rc));
          if (product.length > MAX_DNF_CLAUSES) return null;
        }
      }
      return product;
    }

    // Handle boolean equality/inequality (`a == b`, `a != b` where operands are booleans)
    if (
      node.kind === "Binary" &&
      (node.op === "==" || node.op === "!=") &&
      (isBooleanTypedNode(node.left, varMeta) || isBooleanTypedNode(node.right, varMeta))
    ) {
      const eq = negated ? (node.op === "==" ? "!=" : "==") : node.op;
      const expanded =
        eq === "=="
          ? {
              kind: "Binary",
              op: "||",
              left: { kind: "Binary", op: "&&", left: node.left, right: node.right },
              right: {
                kind: "Binary",
                op: "&&",
                left: { kind: "Unary", op: "!", arg: node.left },
                right: { kind: "Unary", op: "!", arg: node.right },
              },
            }
          : {
              kind: "Binary",
              op: "||",
              left: {
                kind: "Binary",
                op: "&&",
                left: node.left,
                right: { kind: "Unary", op: "!", arg: node.right },
              },
              right: {
                kind: "Binary",
                op: "&&",
                left: { kind: "Unary", op: "!", arg: node.left },
                right: node.right,
              },
            };
      return toDNF(expanded, false, varMeta);
    }

    const atom = negated ? negateAtom(node) : node;
    if (atom.kind === "BoolLit") {
      return atom.value ? [[]] : [];
    }
    return [[atom]];
  }

  function extractAffineForm(node) {
    if (!node) return null;
    if (node.kind === "IntLit") {
      const r = ratFromStringOrNum(node.raw);
      return r ? { coeffs: new Map(), constant: r } : null;
    }
    if (node.kind === "FloatLit") {
      const r = ratFromStringOrNum(node.raw);
      return r ? { coeffs: new Map(), constant: r } : null;
    }
    if (node.kind === "VarRef") {
      const m = new Map();
      m.set(varKeyOf(node), RAT_ONE);
      return { coeffs: m, constant: RAT_ZERO };
    }
    if (node.kind === "Unary" && node.op === "-") {
      const sub = extractAffineForm(node.arg);
      if (!sub) return null;
      const m = new Map();
      for (const [k, v] of sub.coeffs.entries()) m.set(k, ratNeg(v));
      return { coeffs: m, constant: ratNeg(sub.constant) };
    }
    if (node.kind === "Binary") {
      const L = extractAffineForm(node.left);
      const R = extractAffineForm(node.right);
      if (!L || !R) return null;
      if (node.op === "+" || node.op === "-") {
        const out = new Map(L.coeffs);
        for (const [k, v] of R.coeffs.entries()) {
          const term = node.op === "+" ? v : ratNeg(v);
          const summed = out.has(k) ? ratAdd(out.get(k), term) : term;
          if (summed.n === 0n) out.delete(k);
          else out.set(k, summed);
        }
        return {
          coeffs: out,
          constant: node.op === "+" ? ratAdd(L.constant, R.constant) : ratSub(L.constant, R.constant),
        };
      }
      if (node.op === "*") {
        const lConst = L.coeffs.size === 0;
        const rConst = R.coeffs.size === 0;
        if (!lConst && !rConst) {
          return null; // Non-linear variable * variable
        }
        const scalar = lConst ? L.constant : R.constant;
        const base = lConst ? R : L;
        const out = new Map();
        if (scalar.n !== 0n) {
          for (const [k, v] of base.coeffs.entries()) {
            const prod = ratMul(v, scalar);
            if (prod.n !== 0n) out.set(k, prod);
          }
        }
        return { coeffs: out, constant: ratMul(base.constant, scalar) };
      }
    }
    return null;
  }

  /**
   * Simplify an inequality `Σ c_i x_i + constant <= 0` (or `< 0` when strict=true).
   * Tightens integer-only inequalities cleanly (`2x < 3` => `2x <= 2` => `x <= 1`).
   */
  function normalizeInequality(coeffs, constant, strict, varMeta) {
    const clean = new Map();
    for (const [k, v] of coeffs.entries()) {
      if (v.n !== 0n) clean.set(k, v);
    }

    if (clean.size === 0) {
      return { coeffs: clean, constant, strict };
    }

    let allInt = true;
    for (const k of clean.keys()) {
      const m = varMeta.get(k);
      if (!m || !isIntCategory(m.cat)) {
        allInt = false;
        break;
      }
    }

    if (allInt) {
      // Scale all terms by common denominator to integers
      let denomLcm = constant.d;
      for (const v of clean.values()) denomLcm = lcmBig(denomLcm, v.d);

      let scaledC = (constant.n * denomLcm) / constant.d;
      const scaledCoeffs = new Map();
      let coeffGcd = 0n;
      for (const [k, v] of clean.entries()) {
        const sv = (v.n * denomLcm) / v.d;
        scaledCoeffs.set(k, sv);
        coeffGcd = coeffGcd === 0n ? (sv < 0n ? -sv : sv) : gcdBig(coeffGcd, sv);
      }

      // Strict integer `L + C < 0` is equivalent to `L + (C + 1) <= 0`
      if (strict) {
        scaledC += 1n;
        strict = false;
      }

      // If `coeffGcd > 1`, `gcd * (...) + scaledC <= 0` => `(...) + floor_div?`:
      // Since vars are integers, sum `(...)` is integer, so `gcd * Z <= -scaledC`
      // means `Z <= floor(-scaledC / gcd)` => `Z - floor(-scaledC / gcd) <= 0` => `Z + ceil(scaledC / gcd) <= 0`!
      if (coeffGcd > 1n) {
        for (const [k, sv] of scaledCoeffs.entries()) {
          clean.set(k, { n: sv / coeffGcd, d: 1n });
        }
        const remC = ratCeil({ n: scaledC, d: coeffGcd });
        return { coeffs: clean, constant: { n: remC, d: 1n }, strict: false };
      }

      for (const [k, sv] of scaledCoeffs.entries()) {
        clean.set(k, { n: sv, d: 1n });
      }
      return { coeffs: clean, constant: { n: scaledC, d: 1n }, strict: false };
    }

    return { coeffs: clean, constant, strict };
  }

  function isConstIneqSatisfied(ineq) {
    const cmp = ratCmp(ineq.constant, RAT_ZERO);
    return ineq.strict ? cmp < 0 : cmp <= 0;
  }

  function pickWitnessFromInterval(lo, loStrict, hi, hiStrict, varMetaItem) {
    const isInt = varMetaItem && isIntCategory(varMetaItem.cat);
    const pref = varMetaItem ? ratFromStringOrNum(varMetaItem.initialValue) : null;

    if (isInt) {
      let intLo = null;
      if (lo !== null) {
        if (lo.d === 1n) intLo = loStrict ? lo.n + 1n : lo.n;
        else intLo = ratCeil(lo);
      }
      let intHi = null;
      if (hi !== null) {
        if (hi.d === 1n) intHi = hiStrict ? hi.n - 1n : hi.n;
        else intHi = ratFloor(hi);
      }
      if (intLo !== null && intHi !== null && intLo > intHi) {
        return { ok: false, fracInterval: { lo, loStrict, hi, hiStrict } };
      }
      if (
        pref &&
        pref.d === 1n &&
        (intLo === null || pref.n >= intLo) &&
        (intHi === null || pref.n <= intHi)
      ) {
        return { ok: true, value: pref };
      }
      if (intLo !== null && intHi !== null) {
        return { ok: true, value: { n: (intLo + intHi) / 2n, d: 1n } };
      }
      if (intLo !== null) return { ok: true, value: { n: intLo, d: 1n } };
      if (intHi !== null) return { ok: true, value: { n: intHi, d: 1n } };
      return { ok: true, value: RAT_ZERO };
    }

    // Real/float variable
    if (lo !== null && hi !== null) {
      const cmp = ratCmp(lo, hi);
      if (cmp > 0 || (cmp === 0 && (loStrict || hiStrict))) {
        return { ok: false };
      }
      if (cmp === 0) return { ok: true, value: lo };
      if (
        pref &&
        (ratCmp(pref, lo) > 0 || (!loStrict && ratCmp(pref, lo) === 0)) &&
        (ratCmp(pref, hi) < 0 || (!hiStrict && ratCmp(pref, hi) === 0))
      ) {
        return { ok: true, value: pref };
      }
      return { ok: true, value: ratDiv(ratAdd(lo, hi), { n: 2n, d: 1n }) };
    }

    if (pref) {
      const okLo = lo === null || (loStrict ? ratCmp(pref, lo) > 0 : ratCmp(pref, lo) >= 0);
      const okHi = hi === null || (hiStrict ? ratCmp(pref, hi) < 0 : ratCmp(pref, hi) <= 0);
      if (okLo && okHi) return { ok: true, value: pref };
    }

    if (lo !== null) return { ok: true, value: loStrict ? ratAdd(lo, RAT_ONE) : lo };
    if (hi !== null) return { ok: true, value: hiStrict ? ratSub(hi, RAT_ONE) : hi };
    return { ok: true, value: RAT_ZERO };
  }

  /**
   * Solve a system of normalized inequalities over reals + integer constraints via FME + BB.
   * Returns `{ status: "unsat" }` | `{ status: "unknown" }` | `{ status: "sat", values: Map<varKey, rat> }`.
   */
  function solveLinearSystem(ineqs, varsOrder, varMeta, bbState) {
    if (bbState.nodes++ > MAX_BB_NODES) {
      return { status: "unknown" };
    }
    if (varsOrder.length > MAX_FME_VARS || ineqs.length > MAX_FME_INEQS) {
      return { status: "unknown" };
    }

    // Forward elimination keeping inequality lists per elimination stage for back-substitution
    const stages = [{ varKey: null, ineqs }];
    let current = ineqs;

    for (const v of varsOrder) {
      const pos = [];
      const neg = [];
      const zero = [];
      for (const iq of current) {
        const c = iq.coeffs.get(v);
        if (!c || c.n === 0n) zero.push(iq);
        else if (c.n > 0n) pos.push(iq);
        else neg.push(iq);
      }

      const next = zero.slice();
      for (const p of pos) {
        const cp = p.coeffs.get(v);
        for (const n of neg) {
          const cn = ratNeg(n.coeffs.get(v)); // > 0
          // Combine: cn * p + cp * n <= 0 (eliminating v)
          const mergedCoeffs = new Map();
          const allKeys = new Set([...p.coeffs.keys(), ...n.coeffs.keys()]);
          for (const k of allKeys) {
            if (k === v) continue;
            const tp = p.coeffs.has(k) ? ratMul(p.coeffs.get(k), cn) : RAT_ZERO;
            const tn = n.coeffs.has(k) ? ratMul(n.coeffs.get(k), cp) : RAT_ZERO;
            const sum = ratAdd(tp, tn);
            if (sum.n !== 0n) mergedCoeffs.set(k, sum);
          }
          const mergedConst = ratAdd(ratMul(p.constant, cn), ratMul(n.constant, cp));
          const ni = normalizeInequality(mergedCoeffs, mergedConst, p.strict || n.strict, varMeta);
          if (ni.coeffs.size === 0) {
            if (!isConstIneqSatisfied(ni)) return { status: "unsat" };
          } else {
            next.push(ni);
            if (next.length > MAX_FME_INEQS) return { status: "unknown" };
          }
        }
      }

      for (const iq of next) {
        if (iq.coeffs.size === 0 && !isConstIneqSatisfied(iq)) {
          return { status: "unsat" };
        }
      }
      stages.push({ varKey: v, ineqs: current });
      current = next;
    }

    // Constant check
    for (const iq of current) {
      if (iq.coeffs.size === 0 && !isConstIneqSatisfied(iq)) {
        return { status: "unsat" };
      }
    }

    // Back-substitution
    const assigned = new Map();
    for (let s = stages.length - 1; s >= 1; s--) {
      const v = stages[s].varKey;
      const stageIneqs = stages[s].ineqs;
      let lo = null;
      let loStrict = false;
      let hi = null;
      let hiStrict = false;

      for (const iq of stageIneqs) {
        const c = iq.coeffs.get(v);
        if (!c || c.n === 0n) continue;
        let rest = iq.constant;
        let unassignedFound = false;
        for (const [k, coeff] of iq.coeffs.entries()) {
          if (k === v) continue;
          if (!assigned.has(k)) {
            unassignedFound = true;
            break;
          }
          rest = ratAdd(rest, ratMul(coeff, assigned.get(k)));
        }
        if (unassignedFound) continue;

        if (c.n > 0n) {
          // v <= -rest / c
          const bound = ratDiv(ratNeg(rest), c);
          if (hi === null) {
            hi = bound;
            hiStrict = iq.strict;
          } else {
            const cmp = ratCmp(bound, hi);
            if (cmp < 0 || (cmp === 0 && iq.strict)) {
              hi = bound;
              hiStrict = iq.strict;
            }
          }
        } else {
          // v >= -rest / c  (remember c < 0 flips sense when dividing)
          const bound = ratDiv(ratNeg(rest), c);
          if (lo === null) {
            lo = bound;
            loStrict = iq.strict;
          } else {
            const cmp = ratCmp(bound, lo);
            if (cmp > 0 || (cmp === 0 && iq.strict)) {
              lo = bound;
              loStrict = iq.strict;
            }
          }
        }
      }

      const pick = pickWitnessFromInterval(lo, loStrict, hi, hiStrict, varMeta.get(v));
      if (!pick.ok) {
        const vm = varMeta.get(v);
        if (vm && isIntCategory(vm.cat) && lo !== null && hi !== null) {
          // Integer branch-and-bound on fractional real interval!
          const midFloor = ratFloor(ratDiv(ratAdd(lo, hi), { n: 2n, d: 1n }));
          const leftBranch = new Map([[v, RAT_ONE]]);
          const leftIneq = normalizeInequality(leftBranch, { n: -midFloor, d: 1n }, false, varMeta); // v <= midFloor
          const resLeft = solveLinearSystem(ineqs.concat([leftIneq]), varsOrder, varMeta, bbState);
          if (resLeft.status === "sat" || resLeft.status === "unknown") return resLeft;

          const rightBranch = new Map([[v, { n: -1n, d: 1n }]]);
          const rightIneq = normalizeInequality(rightBranch, { n: midFloor + 1n, d: 1n }, false, varMeta); // -v + (midFloor + 1) <= 0 => v >= midFloor + 1
          return solveLinearSystem(ineqs.concat([rightIneq]), varsOrder, varMeta, bbState);
        }
        return { status: "unsat" };
      }
      assigned.set(v, pick.value);
    }

    return { status: "sat", values: assigned };
  }

  function solveNumericAtoms(numAtoms, varMeta) {
    const fixedIneqs = [];
    const neqForms = [];
    const referencedVars = new Set();

    for (const atom of numAtoms) {
      const L = extractAffineForm(atom.left);
      const R = extractAffineForm(atom.right);
      if (!L || !R) return { status: "unknown" };

      // L - R
      const diffCoeffs = new Map(L.coeffs);
      for (const [k, v] of R.coeffs.entries()) {
        const s = diffCoeffs.has(k) ? ratSub(diffCoeffs.get(k), v) : ratNeg(v);
        if (s.n === 0n) diffCoeffs.delete(k);
        else diffCoeffs.set(k, s);
      }
      const diffConst = ratSub(L.constant, R.constant);
      for (const k of diffCoeffs.keys()) referencedVars.add(k);

      if (atom.op === "<" || atom.op === "<=") {
        fixedIneqs.push(normalizeInequality(diffCoeffs, diffConst, atom.op === "<", varMeta));
      } else if (atom.op === ">" || atom.op === ">=") {
        const negCoeffs = new Map();
        for (const [k, v] of diffCoeffs.entries()) negCoeffs.set(k, ratNeg(v));
        fixedIneqs.push(normalizeInequality(negCoeffs, ratNeg(diffConst), atom.op === ">", varMeta));
      } else if (atom.op === "==") {
        fixedIneqs.push(normalizeInequality(diffCoeffs, diffConst, false, varMeta));
        const negCoeffs = new Map();
        for (const [k, v] of diffCoeffs.entries()) negCoeffs.set(k, ratNeg(v));
        fixedIneqs.push(normalizeInequality(negCoeffs, ratNeg(diffConst), false, varMeta));
      } else if (atom.op === "!=") {
        neqForms.push({ coeffs: diffCoeffs, constant: diffConst });
      }
    }

    if (neqForms.length > MAX_NEQ_SPLITS) {
      return { status: "unknown" };
    }

    // Add domain bounds (u32 >= 0, GlobalVar minValue / maxValue) ONLY for referenced numeric vars
    for (const k of referencedVars) {
      const vm = varMeta.get(k);
      if (!vm) continue;
      let lowerRat = vm.cat === "uint" ? RAT_ZERO : null;
      const minR = ratFromStringOrNum(vm.minValue);
      if (minR) {
        if (!lowerRat || ratCmp(minR, lowerRat) > 0) lowerRat = minR;
      }
      if (lowerRat !== null) {
        fixedIneqs.push(normalizeInequality(new Map([[k, { n: -1n, d: 1n }]]), lowerRat, false, varMeta));
      }
      const maxR = ratFromStringOrNum(vm.maxValue);
      if (maxR !== null) {
        fixedIneqs.push(normalizeInequality(new Map([[k, RAT_ONE]]), ratNeg(maxR), false, varMeta));
      }
    }

    const varsOrder = Array.from(referencedVars);
    const branchCount = 1 << neqForms.length;
    let sawUnknown = false;

    for (let mask = 0; mask < branchCount; mask++) {
      const branchIneqs = fixedIneqs.slice();
      for (let bit = 0; bit < neqForms.length; bit++) {
        const nf = neqForms[bit];
        if ((mask & (1 << bit)) === 0) {
          // < 0
          branchIneqs.push(normalizeInequality(nf.coeffs, nf.constant, true, varMeta));
        } else {
          // > 0
          const negCoeffs = new Map();
          for (const [k, v] of nf.coeffs.entries()) negCoeffs.set(k, ratNeg(v));
          branchIneqs.push(normalizeInequality(negCoeffs, ratNeg(nf.constant), true, varMeta));
        }
      }

      // Immediate constant contradictions
      let constFail = false;
      const nonConst = [];
      for (const iq of branchIneqs) {
        if (iq.coeffs.size === 0) {
          if (!isConstIneqSatisfied(iq)) {
            constFail = true;
            break;
          }
        } else {
          nonConst.push(iq);
        }
      }
      if (constFail) continue;

      const res = solveLinearSystem(nonConst, varsOrder, varMeta, { nodes: 0 });
      if (res.status === "sat") {
        const outNums = new Map();
        for (const k of varsOrder) {
          const r = res.values.has(k) ? res.values.get(k) : RAT_ZERO;
          const vm = varMeta.get(k);
          outNums.set(k, ratToCleanDisplay(r, vm && isIntCategory(vm.cat)));
        }
        return { status: "sat", values: outNums };
      }
      if (res.status === "unknown") sawUnknown = true;
    }

    return sawUnknown ? { status: "unknown" } : { status: "unsat" };
  }

  function solveClause(atoms, varMeta) {
    const boolAssign = new Map();
    const strNodes = new Set();
    const strEqs = [];
    const strNeqs = [];
    const numAtoms = [];

    for (const atom of atoms) {
      if (atom.kind === "BoolLit") {
        if (!atom.value) return { status: "unsat" };
        continue;
      }
      if (atom.kind === "VarRef") {
        const k = varKeyOf(atom);
        if (boolAssign.has(k) && boolAssign.get(k) !== true) return { status: "unsat" };
        boolAssign.set(k, true);
        continue;
      }
      if (atom.kind === "Unary" && atom.op === "!" && atom.arg && atom.arg.kind === "VarRef") {
        const k = varKeyOf(atom.arg);
        if (boolAssign.has(k) && boolAssign.get(k) !== false) return { status: "unsat" };
        boolAssign.set(k, false);
        continue;
      }
      if (atom.kind === "Unary" && atom.op === "!") {
        return { status: "unknown" };
      }
      if (atom.kind === "Binary") {
        const isStr =
          atom.left.kind === "StringLit" ||
          atom.right.kind === "StringLit" ||
          (atom.left.kind === "VarRef" && (varMeta.get(varKeyOf(atom.left)) || {}).cat === "String") ||
          (atom.right.kind === "VarRef" && (varMeta.get(varKeyOf(atom.right)) || {}).cat === "String");
        if (isStr) {
          const sideKey = (n) => (n.kind === "StringLit" ? `LIT:${n.value}` : `VAR:${varKeyOf(n)}`);
          const lk = sideKey(atom.left);
          const rk = sideKey(atom.right);
          strNodes.add(lk);
          strNodes.add(rk);
          if (atom.op === "==") strEqs.push([lk, rk]);
          else if (atom.op === "!=") strNeqs.push([lk, rk]);
          else return { status: "unknown" };
          continue;
        }
        numAtoms.push(atom);
        continue;
      }
      return { status: "unknown" };
    }

    // Resolve strings (Union-Find)
    const strValues = new Map();
    if (strNodes.size > 0) {
      const parent = new Map(Array.from(strNodes).map((k) => [k, k]));
      const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
      const unite = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
      };
      for (const [a, b] of strEqs) unite(a, b);
      const litByRoot = new Map();
      for (const node of strNodes) {
        if (!node.startsWith("LIT:")) continue;
        const r = find(node);
        const val = node.slice(4);
        if (litByRoot.has(r) && litByRoot.get(r) !== val) return { status: "unsat" };
        litByRoot.set(r, val);
      }
      for (const [a, b] of strNeqs) {
        if (find(a) === find(b)) return { status: "unsat" };
      }
      let nextSynthIdx = 0;
      const usedLits = new Set(litByRoot.values());
      for (const node of strNodes) {
        if (!node.startsWith("VAR:")) continue;
        const vKey = node.slice(4);
        const r = find(node);
        if (!litByRoot.has(r)) {
          let cand = `s_${nextSynthIdx++}`;
          while (usedLits.has(cand)) cand = `s_${nextSynthIdx++}`;
          usedLits.add(cand);
          litByRoot.set(r, cand);
        }
        strValues.set(vKey, litByRoot.get(r));
      }
    }

    // Resolve linear numeric inequalities
    let numValues = new Map();
    if (numAtoms.length > 0) {
      const numRes = solveNumericAtoms(numAtoms, varMeta);
      if (numRes.status !== "sat") return numRes;
      numValues = numRes.values;
    }

    return { status: "sat", boolAssign, strValues, numValues };
  }

  function buildVarMeta(model, eventDef) {
    const varMeta = new Map();
    for (const g of (model && model.globals) || []) {
      const key = toSnakeCase(g.name);
      varMeta.set(key, {
        key,
        rustType: g.rustType || "i32",
        cat: rustTypeToCategory(g.rustType),
        initialValue: g.initialValue,
        minValue: g.minValue,
        maxValue: g.maxValue,
      });
    }
    if (eventDef && eventDef.payloadType) {
      varMeta.set("$payload", {
        key: "$payload",
        rustType: eventDef.payloadType,
        cat: rustTypeToCategory(eventDef.payloadType),
        initialValue: "0",
        minValue: "",
        maxValue: "",
      });
    }
    return varMeta;
  }

  function buildWitnessGlobals(model, sol) {
    const globals = {};
    for (const g of (model && model.globals) || []) {
      const key = toSnakeCase(g.name);
      if (sol.boolAssign.has(key)) {
        globals[key] = sol.boolAssign.get(key);
      } else if (sol.strValues.has(key)) {
        globals[key] = sol.strValues.get(key);
      } else if (sol.numValues.has(key)) {
        globals[key] = sol.numValues.get(key);
      } else {
        const t = String(g.rustType || "i32").trim();
        if (t === "bool") globals[key] = String(g.initialValue) === "true";
        else if (t === "String") globals[key] = String(g.initialValue || "").replace(/^"(.*)"$/, "$1");
        else {
          const n = Number(g.initialValue);
          globals[key] = Number.isFinite(n) ? n : 0;
        }
      }
    }
    let payload = undefined;
    if (sol.boolAssign.has("$payload")) payload = sol.boolAssign.get("$payload");
    else if (sol.strValues.has("$payload")) payload = sol.strValues.get("$payload");
    else if (sol.numValues.has("$payload")) payload = sol.numValues.get("$payload");
    return { globals, payload };
  }

  function checkPairExclusivity(guardA, guardB, model, eventDef, transitionA, transitionB) {
    const vA = validateGuard(guardA || "", model, transitionA || { event: eventDef && eventDef.name });
    const vB = validateGuard(guardB || "", model, transitionB || { event: eventDef && eventDef.name });
    if (!vA.valid || !vB.valid) {
      return { status: "invalid", reason: "Fix guard syntax/type errors first" };
    }

    const astA = vA.ast || { kind: "BoolLit", value: true };
    const astB = vB.ast || { kind: "BoolLit", value: true };
    const combined = { kind: "Binary", op: "&&", left: astA, right: astB };
    const varMeta = buildVarMeta(model, eventDef);

    const dnf = toDNF(combined, false, varMeta);
    if (dnf === null) {
      return { status: "unknown", reason: "Combined boolean structure exceeded exact DNF limit" };
    }

    let sawUnknown = false;
    for (const clause of dnf) {
      const res = solveClause(clause, varMeta);
      if (res.status === "sat") {
        const w = buildWitnessGlobals(model, res);
        // Self-certify counterexample against actual guard evaluator
        const aTrue = Boolean(evalGuardAst(astA, w.globals, w.payload));
        const bTrue = Boolean(evalGuardAst(astB, w.globals, w.payload));
        if (aTrue && bTrue) {
          const interesting = {};
          const keysUsed = new Set([
            ...res.boolAssign.keys(),
            ...res.strValues.keys(),
            ...res.numValues.keys(),
          ]);
          for (const k of keysUsed) {
            if (k === "$payload") interesting.payload = w.payload;
            else interesting[k] = w.globals[k];
          }
          return {
            status: "overlap",
            counterexample: interesting,
            fullGlobals: w.globals,
            payload: w.payload,
          };
        }
        sawUnknown = true;
      } else if (res.status === "unknown") {
        sawUnknown = true;
      }
    }

    if (sawUnknown) {
      return { status: "unknown", reason: "Contains non-linear or unsupported construct for exact proof" };
    }
    return { status: "exclusive" };
  }

  function formatCounterexample(ce) {
    if (!ce || typeof ce !== "object") return "";
    const entries = Object.entries(ce);
    if (entries.length === 0) return "(any state)";
    return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
  }

  function checkMachineDeterminism(model) {
    const m = model || {};
    const eventsByPascal = new Map(
      (m.events || []).map((ev) => [toPascalCase(ev.name), ev]),
    );
    const groups = new Map();

    for (const tr of m.transitions || []) {
      const srcKey = tr.srcId || tr.srcName || "";
      const evPascal = toPascalCase(tr.event || "Tick");
      const gKey = `${srcKey}::${evPascal}`;
      if (!groups.has(gKey)) {
        groups.set(gKey, {
          srcKey,
          srcName: tr.srcName || srcKey,
          event: evPascal,
          eventDef: eventsByPascal.get(evPascal) || null,
          transitions: [],
        });
      }
      groups.get(gKey).transitions.push(tr);
    }

    const byTransitionId = {};
    for (const tr of m.transitions || []) {
      const tid = tr.id || transitionKey(tr);
      byTransitionId[tid] = {
        status: "exclusive",
        siblingsCount: 0,
        overlaps: [],
        unknowns: [],
      };
    }

    const overlaps = [];
    const unknowns = [];

    for (const group of groups.values()) {
      const list = group.transitions;
      for (const tr of list) {
        const tid = tr.id || transitionKey(tr);
        byTransitionId[tid].siblingsCount = Math.max(0, list.length - 1);
      }
      if (list.length < 2) continue;

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const aid = a.id || transitionKey(a);
          const bid = b.id || transitionKey(b);
          const check = checkPairExclusivity(a.guard, b.guard, m, group.eventDef, a, b);

          if (check.status === "overlap") {
            const pairInfo = {
              srcName: group.srcName,
              event: group.event,
              trAId: aid,
              trBId: bid,
              trA: a,
              trB: b,
              counterexample: check.counterexample,
              counterexampleText: formatCounterexample(check.counterexample),
            };
            overlaps.push(pairInfo);
            byTransitionId[aid].status = "overlap";
            byTransitionId[aid].overlaps.push({ otherId: bid, other: b, ...pairInfo });
            byTransitionId[bid].status = "overlap";
            byTransitionId[bid].overlaps.push({ otherId: aid, other: a, ...pairInfo });
          } else if (check.status === "unknown") {
            const info = {
              srcName: group.srcName,
              event: group.event,
              trAId: aid,
              trBId: bid,
              reason: check.reason,
            };
            unknowns.push(info);
            if (byTransitionId[aid].status !== "overlap") byTransitionId[aid].status = "unknown";
            byTransitionId[aid].unknowns.push({ otherId: bid, other: b, reason: check.reason });
            if (byTransitionId[bid].status !== "overlap") byTransitionId[bid].status = "unknown";
            byTransitionId[bid].unknowns.push({ otherId: aid, other: a, reason: check.reason });
          }
        }
      }
    }

    return {
      ok: overlaps.length === 0,
      overlaps,
      unknowns,
      byTransitionId,
    };
  }

  return {
    tokenizeGuard,
    parseGuard,
    validateGuard,
    emitGuardRust,
    evalGuardAst,
    checkPairExclusivity,
    checkMachineDeterminism,
    formatCounterexample,
  };
});
