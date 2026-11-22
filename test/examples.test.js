"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { getStarterBlinkyModel, getSmartThermostatModel } = require("../src/common/rustContract");
const { analyzeStateCode } = require("../src/common/rustAnalyzer");
const { createSimulation } = require("../src/common/rustSimEngine");

const REPO_ROOT = path.resolve(__dirname, "..");

function dispatchWithPayload(sim, rawEvent) {
  const idx = rawEvent.indexOf(":");
  if (idx === -1) {
    sim.dispatch(rawEvent);
    return;
  }
  const name = rawEvent.slice(0, idx);
  const rawPayload = rawEvent.slice(idx + 1);
  const num = Number(rawPayload);
  sim.dispatch(name, Number.isFinite(num) ? num : rawPayload);
}

function runCargoTrace(crateDir, events) {
  const stdout = execFileSync(
    "cargo",
    ["run", "--offline", "--quiet", "--", ...events],
    { cwd: crateDir, encoding: "utf8" },
  );
  return stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("Tutorial Examples (BlinkyController & SmartThermostat)", () => {
  it("passes RustyAnalyzer with 0 errors and 0 warnings across all BlinkyController & SmartThermostat states", () => {
    for (const model of [getStarterBlinkyModel(), getSmartThermostatModel()]) {
      assert.equal(model.gitOwner, "kecso");
      assert.equal(model.gitRepo, "rusty");
      assert.equal(model.gitBranch, "dev");

      for (const st of model.states) {
        const res = analyzeStateCode(st.code, model, st);
        assert.equal(
          res.stats.errors,
          0,
          `Unexpected analyzer errors in ${model.name}::${st.name}: ${JSON.stringify(res.diagnostics)}`,
        );
        assert.equal(
          res.stats.warnings,
          0,
          `Unexpected analyzer warnings in ${model.name}::${st.name}: ${JSON.stringify(res.diagnostics)}`,
        );
      }
    }
  });

  it("simulates SmartThermostat thermal physics, Eco mode, Cooling, OverheatAlert emit->Cooldown, and SafeLockout->Reset", () => {
    const model = getSmartThermostatModel();
    const sim = createSimulation(model);

    // 1. Starts in Standby at 21.0 C, ambient 15.0 C -> passive drift 20.25 -> enters Heating
    assert.equal(sim.getSnapshot().currentState, "Standby");
    sim.dispatch("Tick");
    let snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Heating");
    assert.equal(snap.globals.current_temp_c, 20.25);
    assert.equal(snap.globals.status_note, "Heating");

    // 2. Heating ticks accumulate energy_wh and return to Standby when >= target(22) + hysteresis(1) = 23.0
    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.globals.energy_wh, 25);
    assert.equal(snap.globals.current_temp_c, 21.34);
    assert.equal(snap.currentState, "Heating");

    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.globals.energy_wh, 50);
    assert.equal(snap.globals.current_temp_c, 22.3);
    assert.equal(snap.currentState, "Heating");

    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.globals.energy_wh, 75);
    assert.equal(snap.globals.current_temp_c, 23.14);
    assert.equal(snap.currentState, "Standby");

    // 3. ToggleEco widens hysteresis_c to 1.5
    sim.dispatch("ToggleEco");
    assert.equal(sim.getSnapshot().globals.eco_mode, true);
    assert.equal(sim.getSnapshot().globals.hysteresis_c, 1.5);

    // 4. Warm outside ambient (36 C) + low target (20 C) drives Standby -> Cooling
    sim.dispatch("SetAmbient", 36);
    sim.dispatch("SetTarget", 20);
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Cooling");

    // 5. Over-cycling (max_cycle_ticks) triggers self-emitted OverheatAlert -> Cooldown -> 3 ticks -> Standby
    sim.setGlobal("max_cycle_ticks", 2);
    sim.dispatch("Tick"); // cycle_ticks = 1
    assert.equal(sim.getSnapshot().currentState, "Cooling");
    sim.dispatch("Tick"); // cycle_ticks = 2 >= max_cycle_ticks -> Outcome::Emit(OverheatAlert) -> Cooldown
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Cooldown");
    assert.equal(snap.globals.fault_code, 202);
    assert.equal(snap.globals.cycle_ticks, 3);
    assert.equal(snap.globals.status_note, "Safety Cooldown");

    // 3 ticks in Cooldown -> returns to Standby and clears fault_code
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Cooldown");
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Cooldown");
    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Standby");
    assert.equal(snap.globals.fault_code, 0);

    // 6. EmergencyShutoff -> SafeLockout -> Reset -> Standby
    sim.dispatch("EmergencyShutoff");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "SafeLockout");
    assert.equal(snap.globals.fault_code, 999);
    assert.equal(snap.globals.status_note, "LOCKED OUT - Reset required");

    sim.dispatch("Reset");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Standby");
    assert.equal(snap.globals.fault_code, 0);
    assert.equal(snap.globals.current_temp_c, 21);
  });

  it("compiles checked-in examples/blinky with zero warnings and 100% JS<->Rust trace parity", () => {
    const blinkyDir = path.join(REPO_ROOT, "examples", "blinky");
    const checkOut = execFileSync("cargo", ["test", "--offline"], {
      cwd: blinkyDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.match(checkOut, /test result: ok/);

    const checkRes = spawnSync("cargo", ["check", "--offline"], {
      cwd: blinkyDir,
      encoding: "utf8",
    });
    assert.equal(checkRes.status, 0, checkRes.stderr);
    assert.equal(checkRes.stderr.includes("warning:"), false, checkRes.stderr);

    const events = ["Start", "Tick", "Tick", "Tick", "FaultDetected", "Reset", "Start", "Stop"];
    const nativeTrace = runCargoTrace(blinkyDir, events);

    const sim = createSimulation(getStarterBlinkyModel());
    for (const ev of events) dispatchWithPayload(sim, ev);
    const jsTrace = sim.getSnapshot().trace;

    assert.equal(nativeTrace.length, jsTrace.length);
    for (let i = 0; i < nativeTrace.length; i++) {
      assert.equal(nativeTrace[i].to, jsTrace[i].toState, `Blinky state mismatch at step ${i}`);
      assert.deepEqual(nativeTrace[i].globals, jsTrace[i].globals, `Blinky globals mismatch at step ${i}`);
    }
  });

  it("compiles checked-in examples/smart-thermostat with zero warnings and 100% JS<->Rust trace parity", () => {
    const thermoDir = path.join(REPO_ROOT, "examples", "smart-thermostat");
    const testOut = execFileSync("cargo", ["test", "--offline"], {
      cwd: thermoDir,
      encoding: "utf8",
    });
    assert.match(testOut, /test result: ok/);

    // Ensure zero compiler warnings on check
    const checkRes = spawnSync("cargo", ["check", "--offline"], {
      cwd: thermoDir,
      encoding: "utf8",
    });
    assert.equal(checkRes.status, 0, checkRes.stderr);
    assert.equal(checkRes.stderr.includes("warning:"), false, checkRes.stderr);

    // Exercise Heating, SetTarget, ToggleEco, SetAmbient, Cooling, OverheatAlert->Cooldown, EmergencyShutoff->SafeLockout->Reset
    const events = [
      "Tick",          // Standby -> Heating (20.25 C)
      "Tick",          // Heating step 1
      "SetTarget:26",  // Raise target while heating
      "ToggleEco",     // Enable eco mode
      "Tick",          // Heating step 2 in eco mode
      "Tick",          // Heating step 3
      "Tick",          // Heating step 4
      "Tick",          // Heating step 5
      "Tick",          // Heating step 6
      "Tick",          // Heating step 7
      "Tick",          // Heating step 8
      "Tick",          // Heating step 9
      "Tick",          // Heating step 10 -> max_cycle_ticks -> Outcome::Emit(OverheatAlert) -> Cooldown!
      "Tick",          // Cooldown 3 -> 2
      "Tick",          // Cooldown 2 -> 1
      "Tick",          // Cooldown 1 -> Standby
      "SetAmbient:38", // Hot outside
      "SetTarget:18",  // Low target
      "Tick",          // Standby drifts up -> Cooling
      "Tick",          // Cooling step 1
      "EmergencyShutoff",
      "Reset",
    ];

    const nativeTrace = runCargoTrace(thermoDir, events);

    const sim = createSimulation(getSmartThermostatModel());
    for (const ev of events) dispatchWithPayload(sim, ev);
    const jsTrace = sim.getSnapshot().trace;

    assert.equal(nativeTrace.length, jsTrace.length);
    for (let i = 0; i < nativeTrace.length; i++) {
      assert.equal(nativeTrace[i].to, jsTrace[i].toState, `SmartThermostat state mismatch at step ${i}`);
      assert.deepEqual(nativeTrace[i].globals, jsTrace[i].globals, `SmartThermostat globals mismatch at step ${i}`);
    }
  });
});
