"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  getStarterBlinkyModel,
  getSmartThermostatModel,
  resolveStateGitLink,
  resolveCrateFilePath,
} = require("../src/common/rustContract");
const { analyzeStateCode } = require("../src/common/rustAnalyzer");
const { checkMachineDeterminism } = require("../src/common/rustGuardLang");
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

describe("Tutorial Examples (V3 Pure Model-Driven Blinky & SmartThermostat)", () => {
  it("passes RustyAnalyzer and formal mutual-exclusivity checks with 0 errors across all states", () => {
    for (const model of [getStarterBlinkyModel(), getSmartThermostatModel()]) {
      assert.equal(model.gitOwner, "");
      assert.equal(model.gitRepo, "rusty");
      assert.equal(model.gitBranch, "dev");

      const det = checkMachineDeterminism(model);
      assert.equal(det.ok, true, `${model.name} determinism check failed: ${JSON.stringify(det.overlaps)}`);

      const cargoPath = resolveCrateFilePath(model, "Cargo.toml");
      assert.match(cargoPath, /^examples\/[a-z-]+\/Cargo\.toml$/);

      for (const st of model.states) {
        assert.equal(st.gitPath, "");
        const eff = resolveStateGitLink(model, st);
        assert.match(eff.gitPath, /^examples\/[a-z-]+\/src\/states\/[a-z_]+\.rs$/);
        assert.equal(eff.isOverridden, false);
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

  it("simulates SmartThermostat pure Entry/Exit + guarded/self transitions cleanly", () => {
    const model = getSmartThermostatModel();
    const sim = createSimulation(model);

    // 1. Starts in Standby at 21.0 C inside deadband -> Tick 1 drifts passively to 20.25 C
    assert.equal(sim.getSnapshot().currentState, "Standby");
    sim.dispatch("Tick");
    let snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Standby");
    assert.equal(snap.globals.current_temp_c, 20.25);

    // 2. Tick 2 sees 20.25 < 21.0 -> enters Heating (`on_enter` sets status_note="Heating")
    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Heating");
    assert.equal(snap.globals.status_note, "Heating");
    assert.equal(snap.globals.cycle_ticks, 0);

    // 3. Heating ticks run heat_step self-transition, then return to Standby once >= 23.0 C
    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.globals.energy_wh, 25);
    assert.equal(snap.globals.current_temp_c, 21.34);
    assert.equal(snap.currentState, "Heating");

    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.globals.energy_wh, 50);
    assert.equal(snap.globals.current_temp_c, 22.3);

    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.globals.energy_wh, 75);
    assert.equal(snap.globals.current_temp_c, 23.14);

    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Standby");

    // 4. ToggleEco + SetAmbient(36) + SetTarget(20) -> Standby -> Cooling
    sim.dispatch("ToggleEco");
    assert.equal(sim.getSnapshot().globals.eco_mode, true);
    assert.equal(sim.getSnapshot().globals.hysteresis_c, 1.5);

    sim.dispatch("SetAmbient", 36);
    sim.dispatch("SetTarget", 20);
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Cooling");

    // 5. Over-cycling (max_cycle_ticks=2) -> overheat guard transitions directly to Cooldown -> Standby
    sim.setGlobal("max_cycle_ticks", 2);
    sim.dispatch("Tick"); // cycle_ticks = 1
    assert.equal(sim.getSnapshot().currentState, "Cooling");
    sim.dispatch("Tick"); // cycle_ticks = 2
    assert.equal(sim.getSnapshot().currentState, "Cooling");
    sim.dispatch("Tick"); // cycle_ticks >= max_cycle_ticks -> Cooldown!
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Cooldown");
    assert.equal(snap.globals.fault_code, 202);
    assert.equal(snap.globals.cycle_ticks, 3);
    assert.equal(snap.globals.status_note, "Safety Cooldown");

    // 3 ticks count down 3->2->1->0, 4th tick recovers to Standby
    sim.dispatch("Tick");
    sim.dispatch("Tick");
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Cooldown");
    assert.equal(sim.getSnapshot().globals.cycle_ticks, 0);
    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Standby");
    assert.equal(snap.globals.fault_code, 0);

    // 6. EmergencyShutoff -> SafeLockout (ignores SetTarget because no SetTarget transition in SafeLockout!) -> Reset
    sim.dispatch("EmergencyShutoff");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "SafeLockout");
    assert.equal(snap.globals.fault_code, 999);
    assert.equal(snap.globals.status_note, "LOCKED OUT - Reset required");

    sim.dispatch("SetTarget", 12);
    assert.equal(sim.getSnapshot().globals.target_temp_c, 20); // unchanged in SafeLockout!

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

    const checkRes = spawnSync("cargo", ["check", "--offline"], {
      cwd: thermoDir,
      encoding: "utf8",
    });
    assert.equal(checkRes.status, 0, checkRes.stderr);
    assert.equal(checkRes.stderr.includes("warning:"), false, checkRes.stderr);

    const events = [
      "Tick",          // Standby drift -> 20.25
      "Tick",          // Standby -> Heating
      "Tick",          // Heating step 1
      "SetTarget:26",  // Raise target while heating
      "ToggleEco",     // Enable eco mode
      "Tick", "Tick", "Tick", "Tick", "Tick", "Tick", "Tick", "Tick", "Tick",
      "Tick",          // cycle_ticks == 10 >= max_cycle_ticks -> Cooldown!
      "Tick",          // Cooldown 3 -> 2
      "Tick",          // Cooldown 2 -> 1
      "Tick",          // Cooldown 1 -> 0
      "Tick",          // cycle_ticks == 0 -> Standby!
      "SetAmbient:38",
      "SetTarget:18",
      "Tick",          // Standby -> Cooling
      "Tick",          // Cooling step 1
      "EmergencyShutoff",
      "SetTarget:12",  // Ignored in SafeLockout
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
