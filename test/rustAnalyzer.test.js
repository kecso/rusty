"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { getStarterBlinkyModel } = require("../src/common/rustContract");
const { analyzeStateCode } = require("../src/common/rustAnalyzer");
const { generateCrateFiles } = require("../src/common/rustCodegen");
const { createSimulation } = require("../src/common/rustSimEngine");

describe("RustyAnalyzer (sub-2ms edit-time checks)", () => {
  it("reports zero errors on all starter BlinkyController states and runs in < 10ms", () => {
    const model = getStarterBlinkyModel();
    for (const st of model.states) {
      const res = analyzeStateCode(st.code, model, st);
      assert.equal(res.stats.errors, 0, `Unexpected errors in ${st.name}: ${JSON.stringify(res.diagnostics)}`);
      assert.ok(res.durationMs < 20, `Analyzer should be instant, took ${res.durationMs}ms`);
    }
  });

  it("catches unknown globals, typo suggestions, invalid compound ops, and type mismatches", () => {
    const model = getStarterBlinkyModel();
    const idle = model.states[0];
    const badCode = `
use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_hihg = true;
    globals.led_high += 1;
    globals.blink_count = -5;
    globals.led_high = 42;
}

pub fn on_event(_globals: &mut Globals, _event: &Event) -> Outcome {
    Outcome::Stay
}

pub fn on_exit(_globals: &mut Globals) {}
`;
    const res = analyzeStateCode(badCode, model, idle);
    const codes = res.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("RUSTY_E001"), "Expected unknown global error");
    assert.ok(
      res.diagnostics.some((d) => d.code === "RUSTY_E001" && d.message.includes("led_high")),
      "Expected typo suggestion for led_high",
    );
    assert.ok(codes.includes("RUSTY_E002"), "Expected invalid compound op on bool");
    assert.ok(
      res.diagnostics.filter((d) => d.code === "RUSTY_E003").length >= 2,
      "Expected type mismatch errors for unsigned negative and bool=int",
    );
  });

  it("validates Event variants, payload arity/types, and self-emitted event handling", () => {
    const model = getStarterBlinkyModel();
    model.events.push({ name: "SetSpeed", payloadType: "i32", description: "Target RPM" });
    const idle = model.states[0];

    const badEventCode = `
use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(_globals: &mut Globals) {}

pub fn on_event(_globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tock => Outcome::Emit(Event::SetSpeed("fast")),
        Event::Tick(123) => Outcome::Emit(Event::Stop),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`;
    const res = analyzeStateCode(badEventCode, model, idle);
    const codes = res.diagnostics.map((d) => d.code);

    assert.ok(codes.includes("RUSTY_E010"), "Expected unknown Event::Tock");
    assert.ok(
      res.diagnostics.some((d) => d.code === "RUSTY_E010" && d.message.includes("Tick")),
      "Expected suggestion Event::Tick",
    );
    assert.ok(codes.includes("RUSTY_E011"), "Expected unit event Event::Tick(123) payload error");
    assert.ok(codes.includes("RUSTY_E012"), "Expected payload type mismatch on Event::SetSpeed(\"fast\")");
    assert.ok(codes.includes("RUSTY_W013"), "Expected warning for unhandled self-emitted Event::Stop");
  });

  it("catches unknown StateId, undeclared topology transitions, and unbalanced braces", () => {
    const model = getStarterBlinkyModel();
    const fault = model.states.find((s) => s.name === "Fault");
    const badCode = `
use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(_globals: &mut Globals) {}

pub fn on_event(_globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Reset => Outcome::Transition(StateId::LedOn),
        Event::Tick => Outcome::Transition(StateId::Idel),
        _ => Outcome::Stay,
    }

pub fn on_exit(_globals: &mut Globals) {}
`;
    const res = analyzeStateCode(badCode, model, fault);
    const codes = res.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("RUSTY_E020"), "Expected unknown StateId::Idel");
    assert.ok(codes.includes("RUSTY_W021"), "Expected undeclared transition Fault -> LedOn warning");
    assert.ok(codes.includes("RUSTY_E032"), "Expected unclosed brace error");
  });

  it("executes Outcome::Emit(Event::FaultDetected) with exact parity in JS sim and native Rust", () => {
    const model = getStarterBlinkyModel();
    // Modify LedOn so when temperature_c >= 75 it emits Event::FaultDetected instead of transitioning directly
    const ledOn = model.states.find((s) => s.name === "LedOn");
    ledOn.code = `
use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = true;
    globals.blink_count += 1;
    globals.temperature_c += 50;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            if globals.temperature_c >= 75 {
                Outcome::Emit(Event::FaultDetected)
            } else {
                Outcome::Transition(StateId::LedOff)
            }
        }
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
`;

    // Instant analyzer should report 0 errors and 0 warnings (FaultDetected IS handled!)
    const analysis = analyzeStateCode(ledOn.code, model, ledOn);
    assert.equal(analysis.stats.errors, 0);
    assert.equal(analysis.stats.warnings, 0);

    // 1. JS simulator
    const sim = createSimulation(model);
    sim.dispatch("Start");
    assert.equal(sim.getSnapshot().currentState, "LedOn");
    sim.dispatch("Tick"); // temperature_c is 28+50=78 >= 75 -> emits FaultDetected -> transitions to Fault!
    assert.equal(sim.getSnapshot().currentState, "Fault");

    // 2. Native Rust binary
    const files = generateCrateFiles(model);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rusty-emit-test-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
      }
      const stdout = execFileSync(
        "cargo",
        ["run", "--offline", "--quiet", "--", "Start", "Tick"],
        { cwd: tmpDir, encoding: "utf8" },
      );
      const nativeTrace = stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.equal(nativeTrace[2].to, "Fault");
      assert.equal(nativeTrace[2].globals.led_high, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
