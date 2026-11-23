"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { getStarterBlinkyModel } = require("../src/common/rustContract");
const { generateCrateFiles } = require("../src/common/rustCodegen");
const { createSimulation } = require("../src/common/rustSimEngine");

describe("RustyCodegen + Native Rust Parity (V3 Model-Driven)", () => {
  it("generates pure hook state modules without StateId/Outcome and compiles/runs with exact JS parity", () => {
    const model = getStarterBlinkyModel();
    const files = generateCrateFiles(model);

    assert.ok(files["Cargo.toml"]);
    assert.ok(files["src/types.rs"]);
    assert.ok(files["src/machine.rs"]);
    assert.ok(files["src/lib.rs"]);
    assert.ok(files["src/main.rs"]);
    assert.ok(files["src/states/idle.rs"]);
    assert.ok(files["src/states/led_on.rs"]);
    assert.ok(files["src/states/led_off.rs"]);
    assert.ok(files["src/states/fault.rs"]);

    // Verify user state files NEVER import StateId/Outcome/Event and use squashed tr_* names
    assert.doesNotMatch(files["src/types.rs"], /pub enum Outcome/);
    for (const stFile of ["src/states/idle.rs", "src/states/led_on.rs", "src/states/led_off.rs", "src/states/fault.rs"]) {
      assert.doesNotMatch(files[stFile], /\bStateId\b/);
      assert.doesNotMatch(files[stFile], /\bOutcome\b/);
      assert.doesNotMatch(files[stFile], /\bEvent::/);
    }
    assert.match(files["src/states/idle.rs"], /pub fn tr_start\(/);
    assert.match(files["src/states/fault.rs"], /pub fn tr_reset\(/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rusty-codegen-test-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
      }

      // 1. Run `cargo test --offline`
      execFileSync("cargo", ["test", "--offline"], { cwd: tmpDir, stdio: "pipe" });

      // 2. Run native binary on an event sequence and compare every step with RustySimEngine
      const events = [
        "Start",
        "Tick",
        "Tick",
        "Tick",
        "Tick",
        "FaultDetected",
        "Reset",
        "Start",
        "Stop",
      ];

      const stdout = execFileSync(
        "cargo",
        ["run", "--offline", "--quiet", "--", ...events],
        { cwd: tmpDir, encoding: "utf8" },
      );
      const nativeTrace = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      const sim = createSimulation(model);
      for (const ev of events) {
        sim.dispatch(ev);
      }
      const jsTrace = sim.getSnapshot().trace;

      assert.equal(nativeTrace.length, jsTrace.length);
      for (let i = 0; i < nativeTrace.length; i++) {
        assert.equal(nativeTrace[i].to, jsTrace[i].toState, `State mismatch at step ${i}`);
        assert.deepEqual(nativeTrace[i].globals, jsTrace[i].globals, `Globals mismatch at step ${i}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
