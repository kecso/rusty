"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getStarterBlinkyModel } = require("../src/common/rustContract");
const { createSimulation } = require("../src/common/rustSimEngine");

describe("RustySimEngine (dynamic browser simulator)", () => {
  it("initializes BlinkyController in Idle with led_high=false", () => {
    const model = getStarterBlinkyModel();
    const sim = createSimulation(model);
    const snap = sim.getSnapshot();

    assert.equal(snap.currentState, "Idle");
    assert.equal(snap.globals.led_high, false);
    assert.equal(snap.globals.blink_count, 0);
    assert.equal(snap.globals.max_blinks, 5);
    assert.equal(snap.globals.temperature_c, 28);
  });

  it("executes full blink cycle and returns to Idle after max_blinks", () => {
    const model = getStarterBlinkyModel();
    const sim = createSimulation(model);

    sim.dispatch("Start");
    let snap = sim.getSnapshot();
    assert.equal(snap.currentState, "LedOn");
    assert.equal(snap.globals.led_high, true);
    assert.equal(snap.globals.blink_count, 1);

    // 4 more blink pulses (each pulse is Tick -> LedOff, Tick -> LedOn)
    for (let i = 0; i < 4; i++) {
      sim.dispatch("Tick");
      assert.equal(sim.getSnapshot().currentState, "LedOff");
      assert.equal(sim.getSnapshot().globals.led_high, false);
      sim.dispatch("Tick");
      assert.equal(sim.getSnapshot().currentState, "LedOn");
      assert.equal(sim.getSnapshot().globals.blink_count, i + 2);
    }

    // 5th pulse finishes: LedOn -> LedOff -> Idle
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "LedOff");
    sim.dispatch("Tick");
    snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Idle");
    assert.equal(snap.globals.led_high, false);
    assert.equal(snap.globals.blink_count, 5);
  });

  it("triggers thermal Fault when temperature_c is injected >= 75 and recovers on Reset", () => {
    const model = getStarterBlinkyModel();
    const sim = createSimulation(model);

    sim.dispatch("Start");
    assert.equal(sim.getSnapshot().currentState, "LedOn");

    // Fault injection via live global override
    sim.setGlobal("temperature_c", 80);
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Fault");
    assert.equal(sim.getSnapshot().globals.led_high, false);

    // Tick is ignored in Fault
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Fault");

    // Reset returns to Idle and resets counters
    sim.dispatch("Reset");
    const snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Idle");
    assert.equal(snap.globals.blink_count, 0);
    assert.equal(snap.globals.temperature_c, 28);
  });
});
