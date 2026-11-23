"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getStarterBlinkyModel, getSmartThermostatModel } = require("../src/common/rustContract");
const {
  parseGuard,
  validateGuard,
  emitGuardRust,
  evalGuardAst,
  checkPairExclusivity,
  checkMachineDeterminism,
} = require("../src/common/rustGuardLang");

describe("RustyGuardLang & Formal Mutual-Exclusivity Prover", () => {
  it("parses, validates, emits Rust, and evaluates pure guard expressions cleanly", () => {
    const thermo = getSmartThermostatModel();
    const res = validateGuard(
      "current_temp_c < 45.0 && globals.current_temp_c < target_temp_c - hysteresis_c",
      thermo,
      { event: "Tick" },
    );
    assert.equal(res.valid, true, JSON.stringify(res.diagnostics));
    assert.deepEqual(res.referencedGlobals.sort(), ["current_temp_c", "hysteresis_c", "target_temp_c"]);

    const rustExpr = emitGuardRust(res.ast, thermo, thermo.events[0]);
    assert.match(rustExpr, /globals\.current_temp_c < 45\.0 && globals\.current_temp_c < globals\.target_temp_c - globals\.hysteresis_c/);

    const w1 = { current_temp_c: 20.0, target_temp_c: 22.0, hysteresis_c: 1.0 };
    assert.equal(evalGuardAst(res.ast, w1), true);
    const w2 = { current_temp_c: 21.5, target_temp_c: 22.0, hysteresis_c: 1.0 };
    assert.equal(evalGuardAst(res.ast, w2), false);

    // Integer literals paired with f64 globals widen cleanly to float literals
    const widenRes = validateGuard("current_temp_c >= 40", thermo, { event: "Tick" });
    assert.equal(widenRes.valid, true);
    assert.equal(emitGuardRust(widenRes.ast, thermo, thermo.events[0]), "globals.current_temp_c >= 40.0");
  });

  it("rejects assignments, blocks, calls, unknown globals, negative unsigneds, and non-boolean guards", () => {
    const blinky = getStarterBlinkyModel();

    assert.equal(parseGuard("blink_count = 1").errors[0].code, "RUSTY_G002");
    assert.equal(parseGuard("if true { false }").errors[0].code, "RUSTY_G002");
    assert.equal(parseGuard("foo()").errors[0].code, "RUSTY_G002");
    assert.equal(parseGuard("1 < temperature_c < 50").errors[0].code, "RUSTY_G001");
    assert.equal(parseGuard("(blink_count > 1").errors[0].code, "RUSTY_E032");

    const badGlobal = validateGuard("blnk_count < max_blinks", blinky, { event: "Tick" });
    assert.equal(badGlobal.valid, false);
    assert.equal(badGlobal.diagnostics[0].code, "RUSTY_E001");
    assert.match(badGlobal.diagnostics[0].message, /blink_count/);

    const badNeg = validateGuard("blink_count >= -1", blinky, { event: "Tick" });
    assert.equal(badNeg.valid, false);
    assert.equal(badNeg.diagnostics.some((d) => d.code === "RUSTY_E003"), true);

    const badNonBool = validateGuard("blink_count + 1", blinky, { event: "Tick" });
    assert.equal(badNonBool.valid, false);
    assert.equal(badNonBool.diagnostics.some((d) => d.code === "RUSTY_G005"), true);

    const badUnitPayload = validateGuard("payload > 0", blinky, { event: "Tick" });
    assert.equal(badUnitPayload.valid, false);
    assert.equal(badUnitPayload.diagnostics.some((d) => d.code === "RUSTY_G006"), true);
  });

  it("proves mutual exclusivity for BlinkyController and SmartThermostat with zero overlaps", () => {
    for (const model of [getStarterBlinkyModel(), getSmartThermostatModel()]) {
      const det = checkMachineDeterminism(model);
      assert.equal(det.ok, true, `${model.name} overlaps: ${JSON.stringify(det.overlaps)}`);
      assert.equal(det.overlaps.length, 0);
      assert.equal(det.unknowns.length, 0);
    }
  });

  it("proves disjointness across integers, booleans, strings, and bounded floats", () => {
    const thermo = getSmartThermostatModel();
    const blinky = getStarterBlinkyModel();

    // Tight integer gap on i32
    assert.equal(
      checkPairExclusivity("temperature_c > 5", "temperature_c < 6", blinky, blinky.events[0]).status,
      "exclusive",
    );

    // Tight u32 step arithmetic (`count + 1 < limit` vs `count + 1 >= limit`)
    assert.equal(
      checkPairExclusivity("blink_count + 1 < max_blinks", "blink_count + 1 >= max_blinks", blinky, blinky.events[0]).status,
      "exclusive",
    );

    // Boolean identity
    assert.equal(
      checkPairExclusivity("eco_mode == true && current_temp_c > 10.0", "!eco_mode", thermo, thermo.events[0]).status,
      "exclusive",
    );

    // String disjointness
    assert.equal(
      checkPairExclusivity('status_note == "Heating"', 'status_note == "Cooling"', thermo, thermo.events[0]).status,
      "exclusive",
    );

    // Bounded hysteresis_c (>= 0.0) proves deadband wings disjoint
    assert.equal(
      checkPairExclusivity(
        "current_temp_c < target_temp_c - hysteresis_c",
        "current_temp_c > target_temp_c + hysteresis_c",
        thermo,
        thermo.events[0],
      ).status,
      "exclusive",
    );
  });

  it("detects overlaps and produces self-certified concrete counterexamples", () => {
    const thermo = getSmartThermostatModel();

    // Missing hysteresis_c >= 0.0 domain bound allows negative hysteresis counterexample!
    const unboundedThermo = JSON.parse(JSON.stringify(thermo));
    unboundedThermo.globals.find((g) => g.name === "hysteresis_c").minValue = "";
    const negHyst = checkPairExclusivity(
      "current_temp_c < target_temp_c - hysteresis_c",
      "current_temp_c > target_temp_c + hysteresis_c",
      unboundedThermo,
      unboundedThermo.events[0],
    );
    assert.equal(negHyst.status, "overlap");
    assert.ok(negHyst.counterexample.hysteresis_c < 0);

    // Unbounded high-temp threshold overlap (`>= 45.0` vs `> target + hyst`)
    const highTempOv = checkPairExclusivity(
      "current_temp_c >= 45.0",
      "current_temp_c > target_temp_c + hysteresis_c",
      thermo,
      thermo.events[0],
    );
    assert.equal(highTempOv.status, "overlap");
    assert.ok(highTempOv.fullGlobals.current_temp_c >= 45.0);

    // Boundary touch overlap (`<= 10` vs `>= 10`) -> witness `10`
    const touchOv = checkPairExclusivity(
      "temperature_c <= 10",
      "temperature_c >= 10",
      getStarterBlinkyModel(),
      getStarterBlinkyModel().events[0],
    );
    assert.equal(touchOv.status, "overlap");
    assert.equal(touchOv.counterexample.temperature_c, 10);

    // Unconditional + guarded -> overlap
    const uncondOv = checkPairExclusivity("", "temperature_c > 20", getStarterBlinkyModel(), getStarterBlinkyModel().events[0]);
    assert.equal(uncondOv.status, "overlap");

    // Non-linear multiplication returns unknown cleanly rather than guessing
    const nonLin = checkPairExclusivity(
      "current_temp_c * hysteresis_c > 10.0",
      "current_temp_c < 0.0",
      thermo,
      thermo.events[0],
    );
    assert.equal(nonLin.status, "unknown");
  });
});
