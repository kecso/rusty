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

  function defaultStatePath(stateName) {
    return `src/states/${toSnakeCase(stateName)}.rs`;
  }

  function defaultStateCode(stateName, outgoingTransitions) {
    const pascal = toPascalCase(stateName);
    const transitions = Array.isArray(outgoingTransitions) ? outgoingTransitions : [];
    const matchArms = transitions
      .filter((t) => t && t.event && t.dstName)
      .map((t) => {
        const ev = toPascalCase(t.event);
        const dst = toPascalCase(t.dstName);
        if (t.guard && t.guard.trim()) {
          return `        Event::${ev} if ${t.guard.trim()} => Outcome::Transition(StateId::${dst}),`;
        }
        return `        Event::${ev} => Outcome::Transition(StateId::${dst}),`;
      });

    const armsBlock =
      matchArms.length > 0
        ? matchArms.join("\n") + "\n        _ => Outcome::Stay,"
        : "        _ => Outcome::Stay,";

    return `//! State module: ${pascal}
//! Managed by Rusty Studio & synchronized via webgme-git (GitArtifactLink).

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(_globals: &mut Globals) {
    // Runs once when entering ${pascal}
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    let _ = globals;
    match event {
${armsBlock}
    }
}

pub fn on_exit(_globals: &mut Globals) {
    // Runs once when leaving ${pascal}
}
`;
  }

  function getStarterBlinkyModel() {
    return {
      name: "BlinkyController",
      crateName: "blinky_controller",
      description:
        "Hello-world Rust state machine demonstrating WebGME topology + webgme-git Rust state files + dynamic simulation.",
      tickMs: 800,
      gitOwner: "",
      gitRepo: "",
      gitBranch: "main",
      gitPath: "src/states",
      globals: [
        {
          name: "led_high",
          rustType: "bool",
          initialValue: "false",
          description: "Current GPIO LED output level",
        },
        {
          name: "blink_count",
          rustType: "u32",
          initialValue: "0",
          description: "Number of completed blink pulses",
        },
        {
          name: "max_blinks",
          rustType: "u32",
          initialValue: "5",
          description: "Stop blinking and return to Idle after this many pulses",
        },
        {
          name: "temperature_c",
          rustType: "i32",
          initialValue: "28",
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
          gitPath: "src/states/idle.rs",
          position: { x: 110, y: 180 },
          code: `//! State module: Idle
//! Waiting for Start command; ensures LED is driven low.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Start => {
            globals.blink_count = 0;
            Outcome::Transition(StateId::LedOn)
        }
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "LedOn",
          description: "LED energized; checks thermal limit and increments pulse count.",
          isInitial: false,
          isFinal: false,
          color: "#22c55e",
          gitPath: "src/states/led_on.rs",
          position: { x: 390, y: 90 },
          code: `//! State module: LedOn
//! Drives LED high and increments blink_count on entry.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = true;
    globals.blink_count += 1;
    globals.temperature_c += 2;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            if globals.temperature_c >= 75 {
                Outcome::Transition(StateId::Fault)
            } else {
                Outcome::Transition(StateId::LedOff)
            }
        }
        Event::Stop => Outcome::Transition(StateId::Idle),
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "LedOff",
          description: "LED off between pulses; returns to Idle once max_blinks is reached.",
          isInitial: false,
          isFinal: false,
          color: "#f59e0b",
          gitPath: "src/states/led_off.rs",
          position: { x: 670, y: 180 },
          code: `//! State module: LedOff
//! Drives LED low and cools down slightly before the next pulse.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
    if globals.temperature_c > 25 {
        globals.temperature_c -= 1;
    }
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            if globals.blink_count >= globals.max_blinks {
                Outcome::Transition(StateId::Idle)
            } else {
                Outcome::Transition(StateId::LedOn)
            }
        }
        Event::Stop => Outcome::Transition(StateId::Idle),
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "Fault",
          description: "Safe latched fault state; LED forced off until Reset.",
          isInitial: false,
          isFinal: false,
          color: "#ef4444",
          gitPath: "src/states/fault.rs",
          position: { x: 390, y: 310 },
          code: `//! State module: Fault
//! Latched safety state — keeps LED off until operator sends Reset.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Reset => {
            globals.blink_count = 0;
            globals.temperature_c = 28;
            Outcome::Transition(StateId::Idle)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
      ],
      transitions: [
        { name: "start_blinking", srcName: "Idle", dstName: "LedOn", event: "Start", guard: "", action: "", priority: 1 },
        { name: "pulse_off", srcName: "LedOn", dstName: "LedOff", event: "Tick", guard: "globals.temperature_c < 75", action: "", priority: 1 },
        { name: "overheat", srcName: "LedOn", dstName: "Fault", event: "Tick", guard: "globals.temperature_c >= 75", action: "", priority: 0 },
        { name: "next_pulse", srcName: "LedOff", dstName: "LedOn", event: "Tick", guard: "globals.blink_count < globals.max_blinks", action: "", priority: 1 },
        { name: "done_blinking", srcName: "LedOff", dstName: "Idle", event: "Tick", guard: "globals.blink_count >= globals.max_blinks", action: "", priority: 0 },
        { name: "stop_from_on", srcName: "LedOn", dstName: "Idle", event: "Stop", guard: "", action: "", priority: 2 },
        { name: "stop_from_off", srcName: "LedOff", dstName: "Idle", event: "Stop", guard: "", action: "", priority: 2 },
        { name: "fault_from_idle", srcName: "Idle", dstName: "Fault", event: "FaultDetected", guard: "", action: "", priority: 0 },
        { name: "fault_from_on", srcName: "LedOn", dstName: "Fault", event: "FaultDetected", guard: "", action: "", priority: 0 },
        { name: "fault_from_off", srcName: "LedOff", dstName: "Fault", event: "FaultDetected", guard: "", action: "", priority: 0 },
        { name: "reset_fault", srcName: "Fault", dstName: "Idle", event: "Reset", guard: "", action: "", priority: 1 },
      ],
    };
  }

  return {
    toSnakeCase,
    toPascalCase,
    toCrateName,
    defaultStatePath,
    defaultStateCode,
    getStarterBlinkyModel,
  };
});
