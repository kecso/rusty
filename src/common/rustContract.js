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
      gitOwner: "kecso",
      gitRepo: "rusty",
      gitBranch: "dev",
      gitPath: "examples/blinky/src/states",
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
          gitPath: "examples/blinky/src/states/idle.rs",
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
          gitPath: "examples/blinky/src/states/led_on.rs",
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
          gitPath: "examples/blinky/src/states/led_off.rs",
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
          gitPath: "examples/blinky/src/states/fault.rs",
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

  function getSmartThermostatModel() {
    return {
      name: "SmartThermostat",
      crateName: "smart_thermostat",
      description:
        "Tutorial HVAC controller showcasing thermal physics computation, f64 payload events, self-emitted safety alerts (Outcome::Emit), hysteresis deadband, and safe lockout recovery.",
      tickMs: 700,
      gitOwner: "kecso",
      gitRepo: "rusty",
      gitBranch: "dev",
      gitPath: "examples/smart-thermostat/src/states",
      globals: [
        {
          name: "current_temp_c",
          rustType: "f64",
          initialValue: "21.0",
          description: "Measured room temperature in Celsius",
        },
        {
          name: "target_temp_c",
          rustType: "f64",
          initialValue: "22.0",
          description: "Desired setpoint temperature (clamped 10..32 C)",
        },
        {
          name: "hysteresis_c",
          rustType: "f64",
          initialValue: "1.0",
          description: "Deadband half-width (1.0 normal, 1.5 in eco_mode)",
        },
        {
          name: "ambient_temp_c",
          rustType: "f64",
          initialValue: "15.0",
          description: "Outside ambient temperature affecting thermal drift",
        },
        {
          name: "energy_wh",
          rustType: "f64",
          initialValue: "0.0",
          description: "Cumulative HVAC energy consumed in Watt-hours",
        },
        {
          name: "cycle_ticks",
          rustType: "u32",
          initialValue: "0",
          description: "Ticks spent in the current active cycle / cooldown",
        },
        {
          name: "max_cycle_ticks",
          rustType: "u32",
          initialValue: "10",
          description: "Maximum consecutive Heating/Cooling ticks before safety cooldown",
        },
        {
          name: "fault_code",
          rustType: "i32",
          initialValue: "0",
          description: "0=OK, 101=Overtemp, 201/202=DutyLimit, 999=E-Stop",
        },
        {
          name: "eco_mode",
          rustType: "bool",
          initialValue: "false",
          description: "Reduces power draw and widens deadband when true",
        },
        {
          name: "status_note",
          rustType: "String",
          initialValue: "Standby",
          description: "Human-readable controller status",
        },
      ],
      events: [
        { name: "Tick", payloadType: "", description: "Periodic thermal simulation step" },
        { name: "SetTarget", payloadType: "f64", description: "Update target_temp_c setpoint" },
        { name: "SetAmbient", payloadType: "f64", description: "Update outside ambient_temp_c" },
        { name: "ToggleEco", payloadType: "", description: "Toggle Eco energy-saving deadband" },
        { name: "OverheatAlert", payloadType: "", description: "Self-emitted safety duty-limit event" },
        { name: "EmergencyShutoff", payloadType: "", description: "Immediate operator E-stop to SafeLockout" },
        { name: "Reset", payloadType: "", description: "Clear fault_code and return to Standby" },
      ],
      states: [
        {
          name: "Standby",
          description: "Monitors room temperature with passive ambient drift; enters Heating or Cooling outside deadband.",
          isInitial: true,
          isFinal: false,
          color: "#38bdf8",
          gitPath: "examples/smart-thermostat/src/states/standby.rs",
          position: { x: 70, y: 200 },
          code: `//! State module: Standby
//! Applies passive ambient thermal drift and checks deadband thresholds.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Standby");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
            globals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;
            if globals.current_temp_c >= 45.0 {
                globals.fault_code = 101;
                Outcome::Transition(StateId::SafeLockout)
            } else if globals.current_temp_c < globals.target_temp_c - globals.hysteresis_c {
                Outcome::Transition(StateId::Heating)
            } else if globals.current_temp_c > globals.target_temp_c + globals.hysteresis_c {
                Outcome::Transition(StateId::Cooling)
            } else {
                Outcome::Stay
            }
        }
        Event::SetTarget(t) => {
            globals.target_temp_c = t.clamp(10.0, 32.0);
            Outcome::Stay
        }
        Event::SetAmbient(a) => {
            globals.ambient_temp_c = a.clamp(-20.0, 50.0);
            Outcome::Stay
        }
        Event::ToggleEco => {
            globals.eco_mode = !globals.eco_mode;
            globals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };
            Outcome::Stay
        }
        Event::EmergencyShutoff => {
            globals.fault_code = 999;
            Outcome::Transition(StateId::SafeLockout)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "Heating",
          description: "Actively heats room while tracking energy_wh; self-emits OverheatAlert if cycle limit or 40C reached.",
          isInitial: false,
          isFinal: false,
          color: "#f97316",
          gitPath: "examples/smart-thermostat/src/states/heating.rs",
          position: { x: 350, y: 65 },
          code: `//! State module: Heating
//! Drives heater, computes thermal gain minus ambient loss, and logs energy_wh.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Heating");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let power_c = if globals.eco_mode { 1.0 } else { 1.75 };
            let watts = if globals.eco_mode { 15.0 } else { 25.0 };
            let loss = (globals.current_temp_c - globals.ambient_temp_c) * 0.125;
            globals.current_temp_c =
                ((globals.current_temp_c + power_c - loss) * 100.0).round() / 100.0;
            globals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;
            globals.cycle_ticks += 1;

            if globals.current_temp_c >= 40.0 || globals.cycle_ticks >= globals.max_cycle_ticks {
                globals.fault_code = 201;
                Outcome::Emit(Event::OverheatAlert)
            } else if globals.current_temp_c >= globals.target_temp_c + globals.hysteresis_c {
                Outcome::Transition(StateId::Standby)
            } else {
                Outcome::Stay
            }
        }
        Event::OverheatAlert => Outcome::Transition(StateId::Cooldown),
        Event::SetTarget(t) => {
            globals.target_temp_c = t.clamp(10.0, 32.0);
            Outcome::Stay
        }
        Event::SetAmbient(a) => {
            globals.ambient_temp_c = a.clamp(-20.0, 50.0);
            Outcome::Stay
        }
        Event::ToggleEco => {
            globals.eco_mode = !globals.eco_mode;
            globals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };
            Outcome::Stay
        }
        Event::EmergencyShutoff => {
            globals.fault_code = 999;
            Outcome::Transition(StateId::SafeLockout)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "Cooling",
          description: "Actively cools room while tracking energy_wh; self-emits OverheatAlert if cycle limit reached.",
          isInitial: false,
          isFinal: false,
          color: "#06b6d4",
          gitPath: "examples/smart-thermostat/src/states/cooling.rs",
          position: { x: 350, y: 335 },
          code: `//! State module: Cooling
//! Drives compressor, computes cooling delta plus ambient gain, and logs energy_wh.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Cooling");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let cool_c = if globals.eco_mode { 1.0 } else { 1.75 };
            let watts = if globals.eco_mode { 12.0 } else { 20.0 };
            let gain = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
            globals.current_temp_c =
                ((globals.current_temp_c - cool_c + gain) * 100.0).round() / 100.0;
            globals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;
            globals.cycle_ticks += 1;

            if globals.cycle_ticks >= globals.max_cycle_ticks {
                globals.fault_code = 202;
                Outcome::Emit(Event::OverheatAlert)
            } else if globals.current_temp_c <= globals.target_temp_c - globals.hysteresis_c {
                Outcome::Transition(StateId::Standby)
            } else {
                Outcome::Stay
            }
        }
        Event::OverheatAlert => Outcome::Transition(StateId::Cooldown),
        Event::SetTarget(t) => {
            globals.target_temp_c = t.clamp(10.0, 32.0);
            Outcome::Stay
        }
        Event::SetAmbient(a) => {
            globals.ambient_temp_c = a.clamp(-20.0, 50.0);
            Outcome::Stay
        }
        Event::ToggleEco => {
            globals.eco_mode = !globals.eco_mode;
            globals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };
            Outcome::Stay
        }
        Event::EmergencyShutoff => {
            globals.fault_code = 999;
            Outcome::Transition(StateId::SafeLockout)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "Cooldown",
          description: "Mandatory 3-tick safety rest after duty limit or thermal alert before returning to Standby.",
          isInitial: false,
          isFinal: false,
          color: "#eab308",
          gitPath: "examples/smart-thermostat/src/states/cooldown.rs",
          position: { x: 640, y: 120 },
          code: `//! State module: Cooldown
//! Rests actuator for 3 ticks while allowing passive thermal equalization.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 3;
    globals.status_note = String::from("Safety Cooldown");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
            globals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;
            if globals.cycle_ticks > 0 {
                globals.cycle_ticks -= 1;
            }
            if globals.cycle_ticks == 0 {
                globals.fault_code = 0;
                Outcome::Transition(StateId::Standby)
            } else {
                Outcome::Stay
            }
        }
        Event::EmergencyShutoff => {
            globals.fault_code = 999;
            Outcome::Transition(StateId::SafeLockout)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
        {
          name: "SafeLockout",
          description: "Latched safety lockout after over-temperature or E-Stop; requires Reset.",
          isInitial: false,
          isFinal: false,
          color: "#ef4444",
          gitPath: "examples/smart-thermostat/src/states/safe_lockout.rs",
          position: { x: 640, y: 300 },
          code: `//! State module: SafeLockout
//! Latched fault state; disables HVAC outputs until operator sends Reset.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.status_note = String::from("LOCKED OUT - Reset required");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Reset => {
            globals.fault_code = 0;
            globals.cycle_ticks = 0;
            globals.current_temp_c = 21.0;
            Outcome::Transition(StateId::Standby)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`,
        },
      ],
      transitions: [
        { name: "heat_demand", srcName: "Standby", dstName: "Heating", event: "Tick", guard: "globals.current_temp_c < globals.target_temp_c - globals.hysteresis_c", action: "", priority: 1 },
        { name: "cool_demand", srcName: "Standby", dstName: "Cooling", event: "Tick", guard: "globals.current_temp_c > globals.target_temp_c + globals.hysteresis_c", action: "", priority: 2 },
        { name: "standby_overtemp", srcName: "Standby", dstName: "SafeLockout", event: "Tick", guard: "globals.current_temp_c >= 45.0", action: "", priority: 0 },
        { name: "standby_shutoff", srcName: "Standby", dstName: "SafeLockout", event: "EmergencyShutoff", guard: "", action: "", priority: 0 },
        { name: "heat_satisfied", srcName: "Heating", dstName: "Standby", event: "Tick", guard: "globals.current_temp_c >= globals.target_temp_c + globals.hysteresis_c", action: "", priority: 1 },
        { name: "heat_overheat", srcName: "Heating", dstName: "Cooldown", event: "OverheatAlert", guard: "", action: "", priority: 0 },
        { name: "heat_shutoff", srcName: "Heating", dstName: "SafeLockout", event: "EmergencyShutoff", guard: "", action: "", priority: 0 },
        { name: "cool_satisfied", srcName: "Cooling", dstName: "Standby", event: "Tick", guard: "globals.current_temp_c <= globals.target_temp_c - globals.hysteresis_c", action: "", priority: 1 },
        { name: "cool_overcycle", srcName: "Cooling", dstName: "Cooldown", event: "OverheatAlert", guard: "", action: "", priority: 0 },
        { name: "cool_shutoff", srcName: "Cooling", dstName: "SafeLockout", event: "EmergencyShutoff", guard: "", action: "", priority: 0 },
        { name: "cooldown_done", srcName: "Cooldown", dstName: "Standby", event: "Tick", guard: "globals.cycle_ticks == 0", action: "", priority: 1 },
        { name: "cooldown_shutoff", srcName: "Cooldown", dstName: "SafeLockout", event: "EmergencyShutoff", guard: "", action: "", priority: 0 },
        { name: "reset_lockout", srcName: "SafeLockout", dstName: "Standby", event: "Reset", guard: "", action: "", priority: 1 },
      ],
    };
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
    getStarterBlinkyModel,
    getSmartThermostatModel,
    getAllExampleModels,
  };
});
