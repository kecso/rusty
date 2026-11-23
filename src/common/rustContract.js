(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RustyContract = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function toSnakeCase(input) {
    const cleaned = String(input || "unnamed")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    if (!cleaned) return "state_node";
    return /^[0-9]/.test(cleaned) ? `s_${cleaned}` : cleaned;
  }

  function toPascalCase(input) {
    const parts = String(input || "Unnamed")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean);
    if (parts.length === 0) return "Unnamed";
    const out = parts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join("");
    return /^[0-9]/.test(out) ? `S${out}` : out;
  }

  function toCrateName(input) {
    return toSnakeCase(input || "rusty_machine").replace(/_/g, "-");
  }

  function defaultStatePath(stateName, machine) {
    if (machine && machine.gitPath) {
      return resolveStateGitLink(machine, { name: stateName }).gitPath;
    }
    return `src/states/${toSnakeCase(stateName)}.rs`;
  }

  function resolveMachineCrateRoot(machine) {
    const raw = String((machine && machine.gitPath) || "")
      .trim()
      .replace(/^\/+|\/+$/g, "");
    if (!raw || raw === "src/states" || raw === "states") return "";
    if (raw.endsWith("/src/states")) return raw.slice(0, -"/src/states".length);
    if (raw.endsWith("/states")) return raw.slice(0, -"/states".length);
    return raw;
  }

  function resolveMachineStatesDir(machine) {
    const raw = String((machine && machine.gitPath) || "")
      .trim()
      .replace(/^\/+|\/+$/g, "");
    if (!raw) return "src/states";
    if (raw === "states" || raw.endsWith("/states")) return raw;
    return `${raw}/src/states`;
  }

  function resolveStateGitLink(machine, state) {
    const m = machine || {};
    const s = state || {};
    const statesDir = resolveMachineStatesDir(m);
    const derivedPath = `${statesDir}/${toSnakeCase(s.name)}.rs`;
    const stateOwner = String(s.gitOwner || "").trim();
    const stateRepo = String(s.gitRepo || "").trim();
    const stateBranch = String(s.gitBranch || "").trim();
    const statePath = String(s.gitPath || "").trim();

    const machineOwner = String(m.gitOwner || "").trim();
    const machineRepo = String(m.gitRepo || "").trim();
    const machineBranch = String(m.gitBranch || "").trim();

    const isOverridden = Boolean(
      (statePath && statePath !== derivedPath) ||
        (stateOwner && stateOwner !== machineOwner) ||
        (stateRepo && stateRepo !== machineRepo) ||
        (stateBranch && stateBranch !== (machineBranch || "main")),
    );

    return {
      gitOwner: stateOwner || machineOwner,
      gitRepo: stateRepo || machineRepo,
      gitBranch: stateBranch || machineBranch || "main",
      gitPath: statePath || derivedPath,
      derivedPath,
      isOverridden,
    };
  }

  function resolveCrateFilePath(machine, relFile) {
    const root = resolveMachineCrateRoot(machine);
    const cleanRel = String(relFile || "").replace(/^\/+/, "");
    return root ? `${root}/${cleanRel}` : cleanRel;
  }

  function transitionKey(t) {
    if (!t) return "";
    if (t.id) return String(t.id);
    return `${t.srcName || ""}|${t.event || ""}|${t.name || ""}|${t.dstName || ""}|${t.guard || ""}`;
  }

  function compareTransitions(a, b) {
    const evCmp = toPascalCase(a.event || "").localeCompare(toPascalCase(b.event || ""));
    if (evCmp !== 0) return evCmp;
    const nameCmp = String(a.name || "").localeCompare(String(b.name || ""));
    if (nameCmp !== 0) return nameCmp;
    const dstCmp = String(a.dstName || "").localeCompare(String(b.dstName || ""));
    if (dstCmp !== 0) return dstCmp;
    const gCmp = String(a.guard || "").localeCompare(String(b.guard || ""));
    if (gCmp !== 0) return gCmp;
    return transitionKey(a).localeCompare(transitionKey(b));
  }

  /**
   * Derive a squashed, human-readable Rust function identifier `tr_<short_slug>`
   * for a transition belonging to a source state, deduplicating with `_2`, `_3` if needed.
   */
  function squashTransitionSlug(transition, srcName) {
    const srcSnake = toSnakeCase(srcName || transition.srcName || "");
    const raw =
      transition.name && transition.name.trim() && !/^transition$/i.test(transition.name.trim())
        ? transition.name.trim()
        : `${transition.event || "ev"}_${transition.dstName || "next"}`;

    let slug = toSnakeCase(raw)
      .replace(/^(?:tr_|on_)+/, "");
    if (srcSnake && slug.startsWith(`${srcSnake}_`) && slug.length > srcSnake.length + 1) {
      slug = slug.slice(srcSnake.length + 1);
    }
    if (!slug || slug === "transition") {
      slug = toSnakeCase(`${transition.event || "ev"}_${transition.dstName || "next"}`);
    }
    if (slug.length > 18) {
      slug = slug.slice(0, 18).replace(/_+$/, "");
      if (!slug) slug = "step";
    }
    return `tr_${slug}`;
  }

  function resolveStateTransitionHooks(machine, state) {
    const m = machine || {};
    const s = state || {};
    const outgoing = (m.transitions || [])
      .filter((t) => (s.id && t.srcId === s.id) || (t.srcName && t.srcName === s.name))
      .slice()
      .sort(compareTransitions);

    const eventsByPascal = new Map(
      (m.events || []).map((ev) => [toPascalCase(ev.name), ev]),
    );
    const usedNames = new Set(["on_enter", "on_exit"]);
    const result = [];

    for (const tr of outgoing) {
      const baseFn = squashTransitionSlug(tr, s.name);
      let fnName = baseFn;
      let suffix = 2;
      while (usedNames.has(fnName)) {
        const stem = baseFn.slice(0, Math.max(4, 21 - String(suffix).length - 1)).replace(/_+$/, "");
        fnName = `${stem}_${suffix}`;
        suffix++;
      }
      usedNames.add(fnName);

      const evDef = eventsByPascal.get(toPascalCase(tr.event || ""));
      const payloadType = evDef && evDef.payloadType ? String(evDef.payloadType).trim() : "";
      const payloadRustParam = payloadType
        ? payloadType === "String"
          ? "payload: &str"
          : `payload: ${payloadType}`
        : "";
      const actionCode = String(tr.action || "");

      result.push({
        transition: tr,
        trKey: transitionKey(tr),
        fnName,
        payloadType,
        payloadRustParam,
        actionCode,
        hasAction: actionCode.trim().length > 0,
      });
    }

    return result;
  }

  function indentBody(rawBody, ensureLineWhenEmpty) {
    const trimmed = String(rawBody || "").replace(/^\n+|\s+$/g, "");
    if (!trimmed) {
      return ensureLineWhenEmpty ? ["    "] : [];
    }
    return trimmed.split("\n").map((line) => (line.trim() === "" ? "" : `    ${line}`));
  }

  function dedentBody(lines) {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) return "";
    let minIndent = Infinity;
    for (const l of nonEmpty) {
      const m = /^([ \t]*)/.exec(l);
      const len = m ? m[1].length : 0;
      if (len < minIndent) minIndent = len;
    }
    const strip = Math.min(minIndent === Infinity ? 0 : minIndent, 4);
    return lines
      .map((l) => (l.length >= strip && /^[ \t]+$/.test(l.slice(0, strip)) ? l.slice(strip) : l))
      .join("\n")
      .replace(/^\n+|\s+$/g, "");
  }

  /**
   * Resolves a state's entry/exit bodies, automatically reading V3 `entryCode`/`exitCode`
   * or extracting them from V3 `state.code`.
   */
  function getStateHookBodies(state) {
    const s = state || {};
    const hasExplicitEntry = typeof s.entryCode === "string" && s.entryCode.length > 0;
    const hasExplicitExit = typeof s.exitCode === "string" && s.exitCode.length > 0;
    if (hasExplicitEntry || hasExplicitExit || !s.code) {
      return {
        entryCode: String(s.entryCode || ""),
        exitCode: String(s.exitCode || ""),
      };
    }
    const parsed = parseStateModuleRs(s.code);
    return {
      entryCode: parsed.entryCode || "",
      exitCode: parsed.exitCode || "",
    };
  }

  /**
   * Deterministically compose a pure state `.rs` module (`src/states/<state>.rs`)
   * plus exact 1-based editable line ranges for contextual read-only Monaco editing.
   *
   * @param {object} machine
   * @param {object} state
   * @param {object} [opts]
   * @param {"entry"|"exit"|"transition"|null} [opts.editableHook]
   * @param {string|null} [opts.includeTransitionKey]
   */
  function composeStateModuleRs(machine, state, opts = {}) {
    const m = machine || {};
    const s = state || {};
    const pascal = toPascalCase(s.name || "State");
    const { entryCode, exitCode } = getStateHookBodies(s);
    const transHooks = resolveStateTransitionHooks(m, s);

    const lines = [
      "#![allow(unused_variables)]",
      `//! State hooks for: ${pascal}`,
      "//! Topology and guards are generated in src/machine.rs.",
      "",
      "use crate::types::Globals;",
      "",
    ];

    const hooks = {
      entry: null,
      exit: null,
      transitions: {},
    };

    function appendFunctionBlock({ docLines, marker, signature, bodyText, ensureEditableLine }) {
      for (const d of docLines) lines.push(d);
      lines.push(`// @rusty:hook ${marker}`);
      const sigLine = lines.length + 1;
      const bodyLines = indentBody(bodyText, ensureEditableLine);
      if (bodyLines.length === 0) {
        lines.push(`${signature} {}`);
        return {
          sigLine,
          startLine: sigLine,
          endLine: sigLine,
          closeLine: sigLine,
        };
      }
      lines.push(`${signature} {`);
      const startLine = lines.length + 1;
      for (const bl of bodyLines) lines.push(bl);
      const endLine = lines.length;
      const closeLine = lines.length + 1;
      lines.push("}");
      return { sigLine, startLine, endLine, closeLine };
    }

    hooks.entry = {
      fnName: "on_enter",
      ...appendFunctionBlock({
        docLines: [`/// Entry action when entering ${pascal}`],
        marker: "entry",
        signature: "pub fn on_enter(globals: &mut Globals)",
        bodyText: entryCode,
        ensureEditableLine: opts.editableHook === "entry",
      }),
    };

    lines.push("");

    hooks.exit = {
      fnName: "on_exit",
      ...appendFunctionBlock({
        docLines: [`/// Exit action when leaving ${pascal}`],
        marker: "exit",
        signature: "pub fn on_exit(globals: &mut Globals)",
        bodyText: exitCode,
        ensureEditableLine: opts.editableHook === "exit",
      }),
    };

    const forceTrKey = opts.includeTransitionKey || opts.includeTransitionId || null;
    for (const h of transHooks) {
      if (!h.hasAction && (!forceTrKey || forceTrKey !== h.trKey)) {
        continue;
      }
      lines.push("");
      const tr = h.transition;
      const evDisplay = h.payloadType ? `${toPascalCase(tr.event)}(${h.payloadType})` : toPascalCase(tr.event);
      const arrowTag =
        (tr.dstName === s.name || (s.id && tr.dstId === s.id))
          ? `${tr.dstName || pascal} (${tr.reenter ? "re-enter" : "stay"})`
          : `${tr.dstName || "?"}`;
      const guardLabel = tr.guard && tr.guard.trim() ? tr.guard.trim() : "(unconditional)";
      const sig = h.payloadRustParam
        ? `pub fn ${h.fnName}(globals: &mut Globals, ${h.payloadRustParam})`
        : `pub fn ${h.fnName}(globals: &mut Globals)`;

      const isEditedTr = opts.editableHook === "transition" && forceTrKey === h.trKey;
      const span = appendFunctionBlock({
        docLines: [
          `/// Transition: ${pascal} --(${evDisplay})--> ${arrowTag}`,
          `/// Guard: ${guardLabel}`,
        ],
        marker: `tr:${h.fnName}`,
        signature: sig,
        bodyText: h.actionCode,
        ensureEditableLine: isEditedTr,
      });

      hooks.transitions[h.trKey] = {
        ...span,
        fnName: h.fnName,
        trKey: h.trKey,
        payloadType: h.payloadType,
      };
    }

    lines.push("");
    return {
      code: lines.join("\n"),
      hooks,
    };
  }

  function findMatchingBraceOutsideStrings(source, openIdx) {
    let depth = 0;
    let inStr = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = openIdx; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Parse a composed state `.rs` module back into `{ isV3, entryCode, exitCode, actionsByFnName }`.
   */
  function parseStateModuleRs(rsSource) {
    const src = String(rsSource || "");
    const hasLegacyEvent = /\bOutcome::|\bStateId::|\bpub\s+fn\s+on_event\b/.test(src);
    const hasMarkers = /\/\/\s*@rusty:hook\s+/.test(src);

    let entryCode = "";
    let exitCode = "";
    const actionsByFnName = {};

    const fnRe = /(?:\/\/\s*@rusty:hook\s+(entry|exit|tr:([A-Za-z0-9_]+))\s*\n\s*)?pub\s+fn\s+([A-Za-z0-9_]+)\s*\([^)]*\)(?:\s*->\s*[^{]+)?\s*\{/g;
    let m;
    while ((m = fnRe.exec(src)) !== null) {
      const marker = m[1] || "";
      const trFnFromMarker = m[2] || "";
      const fnName = m[3];
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingBraceOutsideStrings(src, openIdx);
      if (closeIdx === -1) continue;

      const rawInner = src.slice(openIdx + 1, closeIdx);
      const innerLines = rawInner.replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "").split(/\r?\n/);
      const body = dedentBody(innerLines);

      if (marker === "entry" || fnName === "on_enter") {
        entryCode = body;
      } else if (marker === "exit" || fnName === "on_exit") {
        exitCode = body;
      } else if (marker.startsWith("tr:") || fnName.startsWith("tr_")) {
        const key = trFnFromMarker || fnName;
        actionsByFnName[key] = body;
      }
      fnRe.lastIndex = closeIdx + 1;
    }

    return {
      isV3: hasMarkers || !hasLegacyEvent,
      entryCode,
      exitCode,
      actionsByFnName,
    };
  }

  function defaultStateCode(stateName) {
    return composeStateModuleRs(
      { name: "StateMachine", events: [], transitions: [] },
      { name: stateName, entryCode: "", exitCode: "" },
    ).code;
  }

  function hydrateModelStateCodes(model) {
    for (const st of model.states || []) {
      st.code = composeStateModuleRs(model, st).code;
    }
    return model;
  }

  function getStarterBlinkyModel() {
    const model = {
      name: "BlinkyController",
      crateName: "blinky_controller",
      description:
        "Model-driven Rust state machine demonstrating pure Entry/Exit hooks, mutually exclusive guards, and native cargo parity.",
      tickMs: 800,
      gitOwner: "",
      gitRepo: "rusty",
      gitBranch: "dev",
      gitPath: "examples/blinky",
      globals: [
        {
          name: "led_high",
          rustType: "bool",
          initialValue: "false",
          minValue: "",
          maxValue: "",
          description: "Current GPIO LED output level",
        },
        {
          name: "blink_count",
          rustType: "u32",
          initialValue: "0",
          minValue: "0",
          maxValue: "",
          description: "Number of completed blink pulses",
        },
        {
          name: "max_blinks",
          rustType: "u32",
          initialValue: "5",
          minValue: "1",
          maxValue: "",
          description: "Stop blinking and return to Idle after this many pulses",
        },
        {
          name: "temperature_c",
          rustType: "i32",
          initialValue: "28",
          minValue: "",
          maxValue: "",
          description: "Simulated board temperature in Celsius (fault >= 75)",
        },
      ],
      events: [
        { name: "Start", payloadType: "", description: "Start the blink sequence" },
        { name: "Tick", payloadType: "", description: "Periodic hardware timer tick" },
        { name: "Stop", payloadType: "", description: "Stop blinking and return to Idle" },
        { name: "FaultDetected", payloadType: "", description: "Trigger thermal or hardware fault" },
        { name: "Reset", payloadType: "", description: "Clear fault and reset counters" },
      ],
      states: [
        {
          name: "Idle",
          description: "Waiting for Start command; LED is off.",
          isInitial: true,
          isFinal: false,
          color: "#38bdf8",
          gitPath: "",
          position: { x: 110, y: 180 },
          entryCode: "globals.led_high = false;",
          exitCode: "",
          code: "",
        },
        {
          name: "LedOn",
          description: "LED energized; increments pulse counter and board temperature on entry.",
          isInitial: false,
          isFinal: false,
          color: "#22c55e",
          gitPath: "",
          position: { x: 390, y: 90 },
          entryCode:
            "globals.led_high = true;\nglobals.blink_count += 1;\nglobals.temperature_c += 2;",
          exitCode: "",
          code: "",
        },
        {
          name: "LedOff",
          description: "LED off between pulses; cools slightly on entry.",
          isInitial: false,
          isFinal: false,
          color: "#f59e0b",
          gitPath: "",
          position: { x: 670, y: 180 },
          entryCode:
            "globals.led_high = false;\nif globals.temperature_c > 25 {\n    globals.temperature_c -= 1;\n}",
          exitCode: "",
          code: "",
        },
        {
          name: "Fault",
          description: "Safe latched fault state; LED forced off until Reset.",
          isInitial: false,
          isFinal: false,
          color: "#ef4444",
          gitPath: "",
          position: { x: 390, y: 310 },
          entryCode: "globals.led_high = false;",
          exitCode: "",
          code: "",
        },
      ],
      transitions: [
        { name: "start", srcName: "Idle", dstName: "LedOn", event: "Start", guard: "", action: "globals.blink_count = 0;", reenter: false },
        { name: "fault", srcName: "Idle", dstName: "Fault", event: "FaultDetected", guard: "", action: "", reenter: false },
        { name: "pulse_off", srcName: "LedOn", dstName: "LedOff", event: "Tick", guard: "temperature_c < 75", action: "", reenter: false },
        { name: "overheat", srcName: "LedOn", dstName: "Fault", event: "Tick", guard: "temperature_c >= 75", action: "", reenter: false },
        { name: "stop", srcName: "LedOn", dstName: "Idle", event: "Stop", guard: "", action: "", reenter: false },
        { name: "fault", srcName: "LedOn", dstName: "Fault", event: "FaultDetected", guard: "", action: "", reenter: false },
        { name: "next_pulse", srcName: "LedOff", dstName: "LedOn", event: "Tick", guard: "blink_count < max_blinks", action: "", reenter: false },
        { name: "done", srcName: "LedOff", dstName: "Idle", event: "Tick", guard: "blink_count >= max_blinks", action: "", reenter: false },
        { name: "stop", srcName: "LedOff", dstName: "Idle", event: "Stop", guard: "", action: "", reenter: false },
        { name: "fault", srcName: "LedOff", dstName: "Fault", event: "FaultDetected", guard: "", action: "", reenter: false },
        { name: "reset", srcName: "Fault", dstName: "Idle", event: "Reset", guard: "", action: "globals.blink_count = 0;\nglobals.temperature_c = 28;", reenter: false },
      ],
    };
    return hydrateModelStateCodes(model);
  }

  function getSmartThermostatModel() {
    const model = {
      name: "SmartThermostat",
      crateName: "smart_thermostat",
      description:
        "Model-driven HVAC controller showcasing pure Entry/Exit state hooks, self-transition physics actions, f64 payload events, and formally proven mutually exclusive guards.",
      tickMs: 700,
      gitOwner: "",
      gitRepo: "rusty",
      gitBranch: "dev",
      gitPath: "examples/smart-thermostat",
      globals: [
        {
          name: "current_temp_c",
          rustType: "f64",
          initialValue: "21.0",
          minValue: "",
          maxValue: "",
          description: "Measured room temperature in Celsius",
        },
        {
          name: "target_temp_c",
          rustType: "f64",
          initialValue: "22.0",
          minValue: "10.0",
          maxValue: "32.0",
          description: "Desired setpoint temperature (clamped 10..32 C)",
        },
        {
          name: "hysteresis_c",
          rustType: "f64",
          initialValue: "1.0",
          minValue: "0.0",
          maxValue: "5.0",
          description: "Deadband half-width (>= 0.0; 1.0 normal, 1.5 in eco_mode)",
        },
        {
          name: "ambient_temp_c",
          rustType: "f64",
          initialValue: "15.0",
          minValue: "-20.0",
          maxValue: "50.0",
          description: "Outside ambient temperature affecting thermal drift",
        },
        {
          name: "energy_wh",
          rustType: "f64",
          initialValue: "0.0",
          minValue: "0.0",
          maxValue: "",
          description: "Cumulative HVAC energy consumed in Watt-hours",
        },
        {
          name: "cycle_ticks",
          rustType: "u32",
          initialValue: "0",
          minValue: "0",
          maxValue: "",
          description: "Ticks spent in the current active cycle / cooldown",
        },
        {
          name: "max_cycle_ticks",
          rustType: "u32",
          initialValue: "10",
          minValue: "1",
          maxValue: "",
          description: "Maximum consecutive Heating/Cooling ticks before safety cooldown",
        },
        {
          name: "fault_code",
          rustType: "i32",
          initialValue: "0",
          minValue: "",
          maxValue: "",
          description: "0=OK, 101=Overtemp, 201/202=DutyLimit, 999=E-Stop",
        },
        {
          name: "eco_mode",
          rustType: "bool",
          initialValue: "false",
          minValue: "",
          maxValue: "",
          description: "Reduces power draw and widens deadband when true",
        },
        {
          name: "status_note",
          rustType: "String",
          initialValue: "Standby",
          minValue: "",
          maxValue: "",
          description: "Human-readable controller status",
        },
      ],
      events: [
        { name: "Tick", payloadType: "", description: "Periodic thermal simulation step" },
        { name: "SetTarget", payloadType: "f64", description: "Update target_temp_c setpoint" },
        { name: "SetAmbient", payloadType: "f64", description: "Update outside ambient_temp_c" },
        { name: "ToggleEco", payloadType: "", description: "Toggle Eco energy-saving deadband" },
        { name: "EmergencyShutoff", payloadType: "", description: "Immediate operator E-stop to SafeLockout" },
        { name: "Reset", payloadType: "", description: "Clear fault_code and return to Standby" },
      ],
      states: [
        {
          name: "Standby",
          description: "Monitors room temperature; drifts passively within deadband or enters Heating/Cooling.",
          isInitial: true,
          isFinal: false,
          color: "#38bdf8",
          gitPath: "",
          position: { x: 70, y: 200 },
          entryCode: 'globals.cycle_ticks = 0;\nglobals.status_note = String::from("Standby");',
          exitCode: "",
          code: "",
        },
        {
          name: "Heating",
          description: "Actively heats room; enters Cooldown if temp >= 40C or cycle limit reached.",
          isInitial: false,
          isFinal: false,
          color: "#f97316",
          gitPath: "",
          position: { x: 350, y: 65 },
          entryCode: 'globals.cycle_ticks = 0;\nglobals.status_note = String::from("Heating");',
          exitCode: "",
          code: "",
        },
        {
          name: "Cooling",
          description: "Actively cools room; enters Cooldown if temp >= 40C or cycle limit reached.",
          isInitial: false,
          isFinal: false,
          color: "#06b6d4",
          gitPath: "",
          position: { x: 350, y: 335 },
          entryCode: 'globals.cycle_ticks = 0;\nglobals.status_note = String::from("Cooling");',
          exitCode: "",
          code: "",
        },
        {
          name: "Cooldown",
          description: "Mandatory 3-tick safety rest after duty limit or thermal alert before returning to Standby.",
          isInitial: false,
          isFinal: false,
          color: "#eab308",
          gitPath: "",
          position: { x: 640, y: 120 },
          entryCode: 'globals.cycle_ticks = 3;\nglobals.status_note = String::from("Safety Cooldown");',
          exitCode: "",
          code: "",
        },
        {
          name: "SafeLockout",
          description: "Latched safety lockout after over-temperature or E-Stop; requires Reset.",
          isInitial: false,
          isFinal: false,
          color: "#ef4444",
          gitPath: "",
          position: { x: 640, y: 300 },
          entryCode: 'globals.status_note = String::from("LOCKED OUT - Reset required");',
          exitCode: "",
          code: "",
        },
      ],
      transitions: [
        // Standby
        {
          name: "overtemp",
          srcName: "Standby",
          dstName: "SafeLockout",
          event: "Tick",
          guard: "current_temp_c >= 45.0",
          action: "globals.fault_code = 101;",
          reenter: false,
        },
        {
          name: "start_heat",
          srcName: "Standby",
          dstName: "Heating",
          event: "Tick",
          guard: "current_temp_c < 45.0 && current_temp_c < target_temp_c - hysteresis_c",
          action: "",
          reenter: false,
        },
        {
          name: "start_cool",
          srcName: "Standby",
          dstName: "Cooling",
          event: "Tick",
          guard: "current_temp_c < 45.0 && current_temp_c > target_temp_c + hysteresis_c",
          action: "",
          reenter: false,
        },
        {
          name: "drift",
          srcName: "Standby",
          dstName: "Standby",
          event: "Tick",
          guard: "current_temp_c < 45.0 && current_temp_c >= target_temp_c - hysteresis_c && current_temp_c <= target_temp_c + hysteresis_c",
          action: "let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;\nglobals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;",
          reenter: false,
        },
        {
          name: "set_target",
          srcName: "Standby",
          dstName: "Standby",
          event: "SetTarget",
          guard: "",
          action: "globals.target_temp_c = payload.clamp(10.0, 32.0);",
          reenter: false,
        },
        {
          name: "set_ambient",
          srcName: "Standby",
          dstName: "Standby",
          event: "SetAmbient",
          guard: "",
          action: "globals.ambient_temp_c = payload.clamp(-20.0, 50.0);",
          reenter: false,
        },
        {
          name: "toggle_eco",
          srcName: "Standby",
          dstName: "Standby",
          event: "ToggleEco",
          guard: "",
          action: "globals.eco_mode = !globals.eco_mode;\nglobals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };",
          reenter: false,
        },
        {
          name: "shutoff",
          srcName: "Standby",
          dstName: "SafeLockout",
          event: "EmergencyShutoff",
          guard: "",
          action: "globals.fault_code = 999;",
          reenter: false,
        },

        // Heating
        {
          name: "overheat",
          srcName: "Heating",
          dstName: "Cooldown",
          event: "Tick",
          guard: "current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks",
          action: "globals.fault_code = 201;",
          reenter: false,
        },
        {
          name: "done_heat",
          srcName: "Heating",
          dstName: "Standby",
          event: "Tick",
          guard: "current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c >= target_temp_c + hysteresis_c",
          action: "",
          reenter: false,
        },
        {
          name: "heat_step",
          srcName: "Heating",
          dstName: "Heating",
          event: "Tick",
          guard: "current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c < target_temp_c + hysteresis_c",
          action:
            "let power_c = if globals.eco_mode { 1.0 } else { 1.75 };\nlet watts = if globals.eco_mode { 15.0 } else { 25.0 };\nlet loss = (globals.current_temp_c - globals.ambient_temp_c) * 0.125;\nglobals.current_temp_c = ((globals.current_temp_c + power_c - loss) * 100.0).round() / 100.0;\nglobals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;\nglobals.cycle_ticks += 1;",
          reenter: false,
        },
        {
          name: "set_target",
          srcName: "Heating",
          dstName: "Heating",
          event: "SetTarget",
          guard: "",
          action: "globals.target_temp_c = payload.clamp(10.0, 32.0);",
          reenter: false,
        },
        {
          name: "set_ambient",
          srcName: "Heating",
          dstName: "Heating",
          event: "SetAmbient",
          guard: "",
          action: "globals.ambient_temp_c = payload.clamp(-20.0, 50.0);",
          reenter: false,
        },
        {
          name: "toggle_eco",
          srcName: "Heating",
          dstName: "Heating",
          event: "ToggleEco",
          guard: "",
          action: "globals.eco_mode = !globals.eco_mode;\nglobals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };",
          reenter: false,
        },
        {
          name: "shutoff",
          srcName: "Heating",
          dstName: "SafeLockout",
          event: "EmergencyShutoff",
          guard: "",
          action: "globals.fault_code = 999;",
          reenter: false,
        },

        // Cooling
        {
          name: "overheat",
          srcName: "Cooling",
          dstName: "Cooldown",
          event: "Tick",
          guard: "current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks",
          action: "globals.fault_code = 202;",
          reenter: false,
        },
        {
          name: "done_cool",
          srcName: "Cooling",
          dstName: "Standby",
          event: "Tick",
          guard: "current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c <= target_temp_c - hysteresis_c",
          action: "",
          reenter: false,
        },
        {
          name: "cool_step",
          srcName: "Cooling",
          dstName: "Cooling",
          event: "Tick",
          guard: "current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c > target_temp_c - hysteresis_c",
          action:
            "let cool_c = if globals.eco_mode { 1.0 } else { 1.75 };\nlet watts = if globals.eco_mode { 12.0 } else { 20.0 };\nlet gain = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;\nglobals.current_temp_c = ((globals.current_temp_c - cool_c + gain) * 100.0).round() / 100.0;\nglobals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;\nglobals.cycle_ticks += 1;",
          reenter: false,
        },
        {
          name: "set_target",
          srcName: "Cooling",
          dstName: "Cooling",
          event: "SetTarget",
          guard: "",
          action: "globals.target_temp_c = payload.clamp(10.0, 32.0);",
          reenter: false,
        },
        {
          name: "set_ambient",
          srcName: "Cooling",
          dstName: "Cooling",
          event: "SetAmbient",
          guard: "",
          action: "globals.ambient_temp_c = payload.clamp(-20.0, 50.0);",
          reenter: false,
        },
        {
          name: "toggle_eco",
          srcName: "Cooling",
          dstName: "Cooling",
          event: "ToggleEco",
          guard: "",
          action: "globals.eco_mode = !globals.eco_mode;\nglobals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };",
          reenter: false,
        },
        {
          name: "shutoff",
          srcName: "Cooling",
          dstName: "SafeLockout",
          event: "EmergencyShutoff",
          guard: "",
          action: "globals.fault_code = 999;",
          reenter: false,
        },

        // Cooldown
        {
          name: "recovered",
          srcName: "Cooldown",
          dstName: "Standby",
          event: "Tick",
          guard: "cycle_ticks == 0",
          action: "globals.fault_code = 0;",
          reenter: false,
        },
        {
          name: "cool_wait",
          srcName: "Cooldown",
          dstName: "Cooldown",
          event: "Tick",
          guard: "cycle_ticks > 0",
          action:
            "let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;\nglobals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;\nglobals.cycle_ticks -= 1;",
          reenter: false,
        },
        {
          name: "shutoff",
          srcName: "Cooldown",
          dstName: "SafeLockout",
          event: "EmergencyShutoff",
          guard: "",
          action: "globals.fault_code = 999;",
          reenter: false,
        },

        // SafeLockout
        {
          name: "reset",
          srcName: "SafeLockout",
          dstName: "Standby",
          event: "Reset",
          guard: "",
          action: "globals.fault_code = 0;\nglobals.cycle_ticks = 0;\nglobals.current_temp_c = 21.0;",
          reenter: false,
        },
      ],
    };
    return hydrateModelStateCodes(model);
  }

  function getAllExampleModels() {
    return [getStarterBlinkyModel(), getSmartThermostatModel()];
  }

  return {
    toSnakeCase,
    toPascalCase,
    toCrateName,
    defaultStatePath,
    defaultStateCode,
    resolveMachineCrateRoot,
    resolveMachineStatesDir,
    resolveStateGitLink,
    resolveCrateFilePath,
    transitionKey,
    compareTransitions,
    resolveTransitionFnName: squashTransitionSlug,
    resolveStateTransitionHooks,
    getStateHookBodies,
    composeStateModuleRs,
    parseStateModuleRs,
    hydrateModelStateCodes,
    getStarterBlinkyModel,
    getSmartThermostatModel,
    getAllExampleModels,
  };
});
