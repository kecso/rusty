"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getStarterBlinkyModel, getSmartThermostatModel } = require("../src/common/rustContract");
const { analyzeStateCode, analyzeHookBody, analyzeGuardExpression } = require("../src/common/rustAnalyzer");

describe("RustyAnalyzer (V3 Pure Hook Body & Composed Module Checks)", () => {
  it("reports zero errors on all V3 starter BlinkyController & SmartThermostat modules in < 10ms", () => {
    for (const model of [getStarterBlinkyModel(), getSmartThermostatModel()]) {
      for (const st of model.states) {
        const res = analyzeStateCode(st.code, model, st);
        assert.equal(res.stats.errors, 0, `Errors in ${model.name}::${st.name}: ${JSON.stringify(res.diagnostics)}`);
        assert.equal(res.stats.warnings, 0, `Warnings in ${model.name}::${st.name}: ${JSON.stringify(res.diagnostics)}`);
        assert.ok(res.durationMs < 20, `Analyzer should be instant, took ${res.durationMs}ms`);
      }
    }
  });

  it("catches unknown globals, typo suggestions, invalid compound ops, negative unsigned, and unbalanced braces", () => {
    const model = getStarterBlinkyModel();
    const badBody = `globals.led_hihg = true;
globals.led_high += 1;
globals.blink_count = -5;
globals.led_high = 42;
if true {`;

    const res = analyzeHookBody(badBody, model, { kind: "entry", lineOffset: 8, colOffset: 4 });
    const codes = res.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("RUSTY_E001"), "Expected unknown global error");
    assert.ok(
      res.diagnostics.some((d) => d.code === "RUSTY_E001" && d.message.includes("led_high")),
      "Expected typo suggestion for led_high",
    );
    assert.ok(codes.includes("RUSTY_E002"), "Expected invalid compound op on bool");
    assert.ok(codes.includes("RUSTY_E032"), "Expected unclosed brace error");
    assert.ok(
      res.diagnostics.filter((d) => d.code === "RUSTY_E003").length >= 2,
      "Expected type mismatch errors for unsigned negative and bool=int",
    );
    assert.ok(res.diagnostics.every((d) => d.startLine >= 9), "Expected shifted lineOffset >= 9");
  });

  it("forbids StateId::, Outcome::, Event:: control flow and invalid payload refs inside hook bodies", () => {
    const model = getStarterBlinkyModel();

    const ctrlRes = analyzeHookBody(
      `match Event::Tick { _ => Outcome::Transition(StateId::LedOn) }`,
      model,
      { kind: "entry" },
    );
    assert.equal(ctrlRes.diagnostics.filter((d) => d.code === "RUSTY_E040").length, 3);

    const payloadInEntry = analyzeHookBody("globals.blink_count = payload;", model, { kind: "entry" });
    assert.equal(payloadInEntry.diagnostics.some((d) => d.code === "RUSTY_E041"), true);

    const payloadInUnitTr = analyzeHookBody("globals.blink_count = payload;", model, {
      kind: "transition",
      payloadType: "",
    });
    assert.equal(payloadInUnitTr.diagnostics.some((d) => d.code === "RUSTY_E041"), true);

    const payloadInTypedTr = analyzeHookBody("globals.temperature_c = payload;", model, {
      kind: "transition",
      payloadType: "i32",
    });
    assert.equal(payloadInTypedTr.stats.errors, 0);
  });

  it("validates guard expressions via analyzeGuardExpression", () => {
    const model = getSmartThermostatModel();
    const ok = analyzeGuardExpression("current_temp_c >= 45.0", model, { event: "Tick" });
    assert.equal(ok.stats.errors, 0);

    const bad = analyzeGuardExpression("current_temp_c = 45.0", model, { event: "Tick" });
    assert.equal(bad.diagnostics[0].code, "RUSTY_G002");
  });
});
