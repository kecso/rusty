"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getStarterBlinkyModel } = require("../src/common/rustContract");
const { createSimulation } = require("../src/common/rustSimEngine");

describe("RustySimEngine (V3 model-driven browser simulator)", () => {
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

  it("executes full blink cycle purely from model transitions and returns to Idle after max_blinks", () => {
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

    // Reset runs transition action and re-enters Idle cleanly
    sim.dispatch("Reset");
    const snap = sim.getSnapshot();
    assert.equal(snap.currentState, "Idle");
    assert.equal(snap.globals.blink_count, 0);
    assert.equal(snap.globals.temperature_c, 28);
  });

  it("respects self-transition stay vs re-enter lifecycle semantics", () => {
    const model = {
      name: "SelfTest",
      globals: [{ name: "ticks", rustType: "u32", initialValue: "0" }],
      events: [
        { name: "StayTick", payloadType: "" },
        { name: "ReenterTick", payloadType: "" },
      ],
      states: [
        {
          name: "Active",
          isInitial: true,
          entryCode: "globals.ticks = 0;",
          exitCode: "",
        },
      ],
      transitions: [
        { name: "bump", srcName: "Active", dstName: "Active", event: "StayTick", guard: "", action: "globals.ticks += 1;", reenter: false },
        { name: "reset_re", srcName: "Active", dstName: "Active", event: "ReenterTick", guard: "", action: "", reenter: true },
      ],
    };

    const sim = createSimulation(model);
    sim.dispatch("StayTick");
    sim.dispatch("StayTick");
    assert.equal(sim.getSnapshot().globals.ticks, 2);

    sim.dispatch("ReenterTick");
    assert.equal(sim.getSnapshot().globals.ticks, 0);
  });
});
