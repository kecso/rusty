(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rustContract"), require("./rustLayout"));
  } else {
    root.RustyImporter = factory(root.RustyContract, root.RustyLayout);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract, layoutMod) {
  "use strict";

  const { toSnakeCase, toPascalCase, toCrateName, parseStateModuleRs, hydrateModelStateCodes } = contract;

  const STATE_COLORS = ["#38bdf8", "#22c55e", "#f97316", "#eab308", "#06b6d4", "#a855f7", "#ef4444"];

  function parseCargoToml(text) {
    const out = { name: "", description: "" };
    if (!text) return out;
    const pkgSection = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(text);
    const body = pkgSection ? pkgSection[1] : text;
    const nameMatch = /^\s*name\s*=\s*"([^"]+)"/m.exec(body);
    if (nameMatch) out.name = nameMatch[1].trim();
    const descMatch = /^\s*description\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(body);
    if (descMatch) out.description = descMatch[1].replace(/\\"/g, '"').trim();
    return out;
  }

  function extractBraceBody(source, headerRegex) {
    const m = headerRegex.exec(source);
    if (!m) return null;
    const openIdx = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = openIdx; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) return source.slice(openIdx + 1, i);
      }
    }
    return null;
  }

  function parseTypesRs(text) {
    const states = [];
    const events = [];
    const globals = [];
    if (!text) return { states, events, globals };

    const stateBody = extractBraceBody(text, /pub\s+enum\s+StateId\s*\{/);
    if (stateBody) {
      for (const rawLine of stateBody.split("\n")) {
        const clean = rawLine.replace(/\/\/.*$/, "").trim().replace(/,$/, "");
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) {
          states.push(clean);
        }
      }
    }

    const eventBody = extractBraceBody(text, /pub\s+enum\s+Event\s*\{/);
    if (eventBody) {
      for (const rawLine of eventBody.split("\n")) {
        const clean = rawLine.replace(/\/\/.*$/, "").trim().replace(/,$/, "");
        if (!clean) continue;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]+)\))?$/.exec(clean);
        if (m) {
          events.push({
            name: m[1],
            payloadType: m[2] ? m[2].trim() : "",
            description: "",
          });
        }
      }
    }

    const defaultsMap = new Map();
    const defaultSection = /impl\s+Default\s+for\s+Globals\s*\{/.exec(text);
    if (defaultSection) {
      const sub = text.slice(defaultSection.index);
      const selfBody = extractBraceBody(sub, /\bSelf\s*\{/);
      if (selfBody) {
        for (const rawLine of selfBody.split("\n")) {
          const line = rawLine.trim().replace(/,$/, "");
          const fm = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(line);
          if (!fm) continue;
          const field = fm[1];
          let val = fm[2].trim();
          const strFrom = /^String::from\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)$/.exec(val);
          if (strFrom) {
            val = strFrom[1].replace(/\\"/g, '"');
          } else {
            val = val.replace(/^"(.*)"$/, "$1");
          }
          defaultsMap.set(field, val);
        }
      }
    }

    const globalsBody = extractBraceBody(text, /pub\s+struct\s+Globals\s*\{/);
    if (globalsBody) {
      let pendingBounds = { minValue: "", maxValue: "" };
      for (const rawLine of globalsBody.split("\n")) {
        const bMatch = /\/\/\s*@rusty:bounds\s+min=("(?:[^"\\]|\\.)*")\s+max=("(?:[^"\\]|\\.)*")/.exec(rawLine);
        if (bMatch) {
          try {
            pendingBounds = {
              minValue: JSON.parse(bMatch[1]),
              maxValue: JSON.parse(bMatch[2]),
            };
          } catch (_err) {
            pendingBounds = { minValue: "", maxValue: "" };
          }
          continue;
        }
        const clean = rawLine.replace(/\/\/.*$/, "").trim().replace(/,$/, "");
        const m = /^(?:pub\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([A-Za-z0-9_]+)$/.exec(clean);
        if (!m || m[1] === "_reserved") continue;
        globals.push({
          name: m[1],
          rustType: m[2],
          initialValue: defaultsMap.has(m[1])
            ? defaultsMap.get(m[1])
            : m[2] === "bool"
              ? "false"
              : m[2] === "String"
                ? ""
                : "0",
          minValue: pendingBounds.minValue,
          maxValue: pendingBounds.maxValue,
          description: "",
        });
        pendingBounds = { minValue: "", maxValue: "" };
      }
    }

    return { states, events, globals };
  }

  function parseMachineRs(text) {
    const out = { machineName: "", initialState: "", transitions: [] };
    if (!text) return out;

    const hdrMatch = /(?:Generated model-driven state machine dispatcher|Generated state machine dispatcher) for ([A-Za-z0-9_-]+)/.exec(
      text,
    );
    if (hdrMatch) out.machineName = hdrMatch[1].trim();

    const initMatch = /current:\s*StateId::([A-Za-z0-9_]+)/.exec(text);
    if (initMatch) out.initialState = initMatch[1].trim();

    // Preferred V3 lossless metadata lines (`// @rusty:tr {...}`)
    const trMetaRe = /\/\/\s*@rusty:tr\s+(\{[^\n]+\})/g;
    let m;
    while ((m = trMetaRe.exec(text)) !== null) {
      try {
        const meta = JSON.parse(m[1]);
        out.transitions.push({
          name: meta.name || `${toSnakeCase(meta.event || "ev")}_${toSnakeCase(meta.dst || "next")}`,
          srcName: meta.src || "",
          dstName: meta.dst || "",
          event: meta.event || "Tick",
          guard: meta.guard || "",
          action: "",
          reenter: Boolean(meta.reenter),
          fnName: meta.fn || "",
        });
      } catch (_err) {
        // ignore malformed comment
      }
    }

    // Legacy V2 fallback (`evaluate_model_transitions`)
    if (out.transitions.length === 0) {
      const evalBody = extractBraceBody(text, /fn\s+evaluate_model_transitions\s*\([^)]*\)[^{]*\{/);
      if (evalBody) {
        const ruleRe =
          /if\s+self\.current\s*==\s*StateId::([A-Za-z0-9_]+)\s*&&\s*matches!\s*\(\s*event\s*,\s*Event::([A-Za-z0-9_]+)(?:\s*\(_\))?\s*\)(?:\s*&&\s*\(([\s\S]*?)\))?\s*\{\s*return\s+Some\s*\(\s*StateId::([A-Za-z0-9_]+)\s*\)\s*;\s*\}/g;
        let idx = 0;
        while ((m = ruleRe.exec(evalBody)) !== null) {
          out.transitions.push({
            name: `tr_${idx + 1}_${toSnakeCase(m[2])}`,
            srcName: m[1],
            dstName: m[4],
            event: m[2],
            guard: m[3] ? m[3].trim() : "",
            action: "",
            reenter: false,
            fnName: "",
          });
          idx++;
        }
      }
    }

    return out;
  }

  function inferFromStateSource(stateName, code) {
    const globals = new Map();
    const events = new Map();
    const transitions = [];

    let m;
    const gRe = /\bglobals\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    while ((m = gRe.exec(code)) !== null) {
      if (!globals.has(m[1])) globals.set(m[1], "i32");
    }

    const evRe = /\bEvent::([A-Za-z0-9_]+)(\s*\(([^)]*)\))?/g;
    while ((m = evRe.exec(code)) !== null) {
      const evName = m[1];
      const hasArg = Boolean(m[2] && m[3].trim());
      if (!events.has(evName)) {
        events.set(evName, hasArg ? "f64" : "");
      }
    }

    const armRe = /Event::([A-Za-z0-9_]+)(?:\s*\([^)]*\))?(?:\s+if\s+([^=]+?))?\s*=>\s*([\s\S]*?)(?=\n\s*(?:Event::|_ =>))/g;
    let idx = 0;
    while ((m = armRe.exec(code)) !== null) {
      const ev = m[1];
      const guard = m[2] ? m[2].trim() : "";
      const armBody = m[3] || "";
      const trRe = /Outcome::Transition\s*\(\s*StateId::([A-Za-z0-9_]+)\s*\)/g;
      let tm;
      while ((tm = trRe.exec(armBody)) !== null) {
        transitions.push({
          name: `${toSnakeCase(ev)}_${idx + 1}`,
          srcName: stateName,
          dstName: tm[1],
          event: ev,
          guard,
          action: "",
          reenter: false,
          fnName: "",
        });
        idx++;
      }
    }

    return { globals, events, transitions };
  }

  /**
   * Reconstruct a normalized V3 Rusty Studio StateMachine model from a directory map
   * of Rust files swept from GitHub (or generated crate files).
   */
  function parseCrateFilesToModel(filesMap, opts = {}) {
    const entries = Object.entries(filesMap || {}).map(([p, content]) => [
      String(p).replace(/^\/+/, ""),
      String(content || ""),
    ]);

    const baseDir = String(opts.dirPath || "").trim().replace(/^\/+|\/+$/g, "");
    const relEntries = entries.map(([p, content]) => {
      let rel = p;
      if (baseDir && rel.startsWith(baseDir + "/")) {
        rel = rel.slice(baseDir.length + 1);
      }
      return [rel, content];
    });
    const byRel = new Map(relEntries);

    const cargo = parseCargoToml(byRel.get("Cargo.toml") || "");
    const types = parseTypesRs(byRel.get("src/types.rs") || "");
    const machineMeta = parseMachineRs(byRel.get("src/machine.rs") || "");

    const stateFileEntries = relEntries.filter(([rel]) => {
      if (!rel.endsWith(".rs")) return false;
      const base = rel.split("/").pop();
      if (base === "mod.rs" || base === "lib.rs" || base === "main.rs" || base === "types.rs" || base === "machine.rs") {
        return false;
      }
      return rel.startsWith("src/states/") || !rel.includes("/");
    });

    const parsedHooksByPascal = new Map();
    const stateDescByPascal = new Map();
    const fallbackGlobals = new Map();
    const fallbackEvents = new Map();
    const fallbackTransitions = [];

    for (const [rel, code] of stateFileEntries) {
      const stem = rel.split("/").pop().replace(/\.rs$/, "");
      let pascal = toPascalCase(stem);
      const headerMatch = /(?:State hooks for:|State module:)\s*([A-Za-z0-9_]+)/i.exec(code);
      if (headerMatch) {
        pascal = toPascalCase(headerMatch[1]);
      }
      const docLines = [];
      for (const line of code.split("\n").slice(0, 8)) {
        const dm = /^\/\/!\s*(.+)$/.exec(line.trim());
        if (
          dm &&
          !/^(?:State hooks for:|State module:|Topology and guards|Control flow)/i.test(dm[1])
        ) {
          docLines.push(dm[1].trim());
        }
      }
      const parsed = parseStateModuleRs(code);
      parsedHooksByPascal.set(pascal, { rawCode: code, ...parsed });
      stateDescByPascal.set(pascal, docLines.join(" "));

      const inferred = inferFromStateSource(pascal, code);
      for (const [g, t] of inferred.globals.entries()) {
        if (!fallbackGlobals.has(g)) fallbackGlobals.set(g, t);
      }
      for (const [e, p] of inferred.events.entries()) {
        if (!fallbackEvents.has(e)) fallbackEvents.set(e, p);
      }
      fallbackTransitions.push(...inferred.transitions);
    }

    const orderedStateNames =
      types.states.length > 0
        ? [...new Set([...types.states, ...parsedHooksByPascal.keys()])]
        : Array.from(parsedHooksByPascal.keys());

    if (orderedStateNames.length === 0) {
      throw new Error(
        "No Rust state files (*.rs) found in that GitHub directory. Point to either a crate root (with src/states/*.rs) or a states folder.",
      );
    }

    const initialName =
      machineMeta.initialState && orderedStateNames.includes(machineMeta.initialState)
        ? machineMeta.initialState
        : orderedStateNames[0];

    const states = orderedStateNames.map((name, idx) => {
      const parsed = parsedHooksByPascal.get(name);
      return {
        name,
        description: stateDescByPascal.get(name) || "",
        isInitial: name === initialName,
        isFinal: false,
        color: STATE_COLORS[idx % STATE_COLORS.length],
        gitOwner: "",
        gitRepo: "",
        gitBranch: "",
        gitPath: "",
        entryCode: parsed ? parsed.entryCode : "",
        exitCode: parsed ? parsed.exitCode : "",
        code: parsed ? parsed.rawCode : contract.defaultStateCode(name),
        position: { x: 120 + idx * 240, y: 160 },
      };
    });

    const globals =
      types.globals.length > 0
        ? types.globals
        : Array.from(fallbackGlobals.entries()).map(([name, rustType]) => ({
            name,
            rustType,
            initialValue: "0",
            minValue: "",
            maxValue: "",
            description: "",
          }));

    const events =
      types.events.length > 0
        ? types.events
        : Array.from(fallbackEvents.entries()).map(([name, payloadType]) => ({
            name,
            payloadType,
            description: "",
          }));

    const rawTransitions =
      machineMeta.transitions.length > 0 ? machineMeta.transitions : fallbackTransitions;

    const validStateSet = new Set(orderedStateNames);
    const transitions = rawTransitions
      .filter((t) => validStateSet.has(t.srcName) && validStateSet.has(t.dstName))
      .map((t) => {
        const srcHooks = parsedHooksByPascal.get(t.srcName);
        const actionFromHook =
          srcHooks && t.fnName && srcHooks.actionsByFnName && srcHooks.actionsByFnName[t.fnName] !== undefined
            ? srcHooks.actionsByFnName[t.fnName]
            : t.action || "";
        return {
          name: t.name,
          srcName: t.srcName,
          dstName: t.dstName,
          event: t.event,
          guard: t.guard || "",
          action: actionFromHook,
          reenter: Boolean(t.reenter),
        };
      });

    const inferredName =
      opts.machineName ||
      machineMeta.machineName ||
      (cargo.name ? toPascalCase(cargo.name) : "ImportedMachine");

    const model = {
      name: inferredName,
      crateName: toCrateName(cargo.name || inferredName),
      description: cargo.description || `Imported from ${opts.owner || "github"}/${opts.repo || "repo"}`,
      tickMs: 800,
      gitOwner: opts.owner || "",
      gitRepo: opts.repo || "",
      gitBranch: opts.branch || "main",
      gitPath: baseDir || "src/states",
      globals,
      events,
      states,
      transitions,
    };

    hydrateModelStateCodes(model);

    if (layoutMod && typeof layoutMod.computeLayout === "function") {
      const laidOut = layoutMod.computeLayout(model, { direction: "LR" });
      for (const st of model.states) {
        const box = laidOut.nodesById[st.name];
        if (box) st.position = { x: box.x, y: box.y };
      }
    }

    return {
      model,
      summary: {
        states: model.states.length,
        globals: model.globals.length,
        events: model.events.length,
        transitions: model.transitions.length,
      },
    };
  }

  return {
    parseCargoToml,
    parseTypesRs,
    parseMachineRs,
    parseCrateFilesToModel,
  };
});
