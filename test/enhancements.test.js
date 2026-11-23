"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");

const contract = require("../src/common/rustContract");
const analyzer = require("../src/common/rustAnalyzer");
const codegen = require("../src/common/rustCodegen");
const layout = require("../src/common/rustLayout");
const importer = require("../src/common/rustImporter");
const { createSimulation } = require("../src/common/rustSimEngine");

const REPO_ROOT = path.resolve(__dirname, "..");

function attachSyntheticIdsAndDeps(model) {
  const clone = JSON.parse(JSON.stringify(model));
  clone.id = "machine-1";
  clone.globals.forEach((g, i) => {
    g.id = `g-${i}`;
  });
  clone.events.forEach((e, i) => {
    e.id = `e-${i}`;
  });
  clone.states.forEach((s, i) => {
    s.id = `s-${i}`;
  });
  clone.transitions.forEach((t, i) => {
    t.id = `t-${i}`;
    const src = clone.states.find((s) => s.name === t.srcName);
    const dst = clone.states.find((s) => s.name === t.dstName);
    t.srcId = src ? src.id : "";
    t.dstId = dst ? dst.id : "";
  });

  for (const st of clone.states) {
    const deps = analyzer.extractDependencies(st.code || "", clone);
    st.dependsOn = deps.memberIds;
    st.depsSignature = analyzer.serializeDepsSnapshot(deps.snapshot);
  }
  for (const tr of clone.transitions) {
    const deps = analyzer.extractDependencies(tr.guard || "", clone, { triggerEvent: tr.event });
    tr.dependsOn = deps.memberIds;
    tr.depsSignature = analyzer.serializeDepsSnapshot(deps.snapshot);
  }
  return clone;
}

describe("Rusty Studio V2 Enhancements", () => {
  it("resolves machine-level directory inheritance and optional per-state overrides", () => {
    const machine = {
      gitOwner: "alice",
      gitRepo: "rusty",
      gitBranch: "dev",
      gitPath: "examples/smart-thermostat",
    };

    const inherited = contract.resolveStateGitLink(machine, { name: "SafeLockout", gitPath: "" });
    assert.equal(inherited.gitOwner, "alice");
    assert.equal(inherited.gitRepo, "rusty");
    assert.equal(inherited.gitBranch, "dev");
    assert.equal(inherited.gitPath, "examples/smart-thermostat/src/states/safe_lockout.rs");
    assert.equal(inherited.isOverridden, false);

    assert.equal(
      contract.resolveCrateFilePath(machine, "src/machine.rs"),
      "examples/smart-thermostat/src/machine.rs",
    );
    assert.equal(
      contract.resolveCrateFilePath({ gitPath: "examples/blinky/src/states" }, "Cargo.toml"),
      "examples/blinky/Cargo.toml",
    );

    const overridden = contract.resolveStateGitLink(machine, {
      name: "Heating",
      gitPath: "custom/my_heating.rs",
    });
    assert.equal(overridden.gitPath, "custom/my_heating.rs");
    assert.equal(overridden.isOverridden, true);
  });

  it("validates transition guard expressions and catches typos/type mismatches", () => {
    const model = contract.getSmartThermostatModel();
    const okRes = analyzer.analyzeGuardExpression(
      "globals.current_temp_c >= globals.target_temp_c + globals.hysteresis_c",
      model,
      { event: "Tick" },
    );
    assert.equal(okRes.stats.errors, 0);

    const badGlobal = analyzer.analyzeGuardExpression("globals.eco_mde == true", model, { event: "Tick" });
    assert.equal(badGlobal.diagnostics.some((d) => d.code === "RUSTY_E001"), true);

    const badEvent = analyzer.analyzeGuardExpression("globals.cycle_ticks > 0", model, { event: "MissingEv" });
    assert.equal(badEvent.diagnostics.some((d) => d.code === "RUSTY_E010"), true);

    const badNegUnsigned = analyzer.analyzeGuardExpression("globals.cycle_ticks == -1", model, { event: "Tick" });
    assert.equal(badNegUnsigned.diagnostics.some((d) => d.code === "RUSTY_E003"), true);

    const badParen = analyzer.analyzeGuardExpression("(globals.cycle_ticks > 0", model, { event: "Tick" });
    assert.equal(badParen.diagnostics.some((d) => d.code === "RUSTY_E032"), true);
  });

  it("tracks dependencies and computes design-to-code impact on model changes", () => {
    const cleanModel = attachSyntheticIdsAndDeps(contract.getSmartThermostatModel());
    const baseline = analyzer.computeDesignImpact(cleanModel);
    assert.equal(baseline.totalImpacted, 0);

    // 1. Rename a referenced GlobalVar -> flags both states and guards
    const renamedModel = JSON.parse(JSON.stringify(cleanModel));
    const maxTicks = renamedModel.globals.find((g) => g.name === "max_cycle_ticks");
    maxTicks.name = "duty_limit";
    const renameImpact = analyzer.computeDesignImpact(renamedModel);
    assert.ok(renameImpact.impactedStates >= 2);
    assert.ok(
      renameImpact.byStateId[cleanModel.states.find((s) => s.name === "Heating").id].reasons.some(
        (r) => r.code === "DESIGN_GLOBAL_RENAMED" || r.code === "RUSTY_E001",
      ),
    );

    // 2. Retype a referenced GlobalVar -> flags type-drift warnings
    const retypedModel = JSON.parse(JSON.stringify(cleanModel));
    retypedModel.globals.find((g) => g.name === "eco_mode").rustType = "i32";
    const typeImpact = analyzer.computeDesignImpact(retypedModel);
    assert.ok(typeImpact.impactedStates >= 3);
    assert.ok(
      typeImpact.byStateId[cleanModel.states.find((s) => s.name === "Heating").id].reasons.some(
        (r) => r.code === "DESIGN_TYPE_CHANGED",
      ),
    );

    // 3. Remove an EventDef -> flags transitions relying on it
    const droppedEvModel = JSON.parse(JSON.stringify(cleanModel));
    droppedEvModel.events = droppedEvModel.events.filter((e) => e.name !== "EmergencyShutoff");
    const evImpact = analyzer.computeDesignImpact(droppedEvModel);
    assert.ok(evImpact.impactedTransitions >= 4);
  });

  it("computes deterministic, non-overlapping fixed layered layouts in LR and TB", () => {
    for (const model of [contract.getStarterBlinkyModel(), contract.getSmartThermostatModel()]) {
      for (const direction of ["LR", "TB"]) {
        const res1 = layout.computeLayout(model, { direction });
        const res2 = layout.computeLayout(model, { direction });
        assert.deepEqual(res1, res2, "Fixed layout must be 100% deterministic");

        const boxes = model.states.map((s) => res1.nodesById[s.id || s.name]);
        assert.equal(boxes.length, model.states.length);
        for (const b of boxes) {
          assert.ok(Number.isFinite(b.x) && b.x >= 0);
          assert.ok(Number.isFinite(b.y) && b.y >= 0);
          assert.ok(b.x + b.width <= res1.width);
          assert.ok(b.y + b.height <= res1.height);
        }

        // Assert zero bounding-box overlaps between any two states
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const overlaps =
              a.x < b.x + b.width &&
              a.x + a.width > b.x &&
              a.y < b.y + b.height &&
              a.y + a.height > b.y;
            assert.equal(overlaps, false, `${model.name} (${direction}) had overlapping state boxes`);
          }
        }
      }
    }
  });

  it("round-trips generated SmartThermostat crate back into a full model via RustyImporter", () => {
    const orig = contract.getSmartThermostatModel();
    const files = codegen.generateCrateFiles(orig);

    // Prefix paths as they appear inside examples/smart-thermostat on GitHub
    const prefixed = {};
    for (const [k, v] of Object.entries(files)) {
      prefixed[`examples/smart-thermostat/${k}`] = v;
    }

    const { model: imported, summary } = importer.parseCrateFilesToModel(prefixed, {
      owner: "kecso",
      repo: "rusty",
      branch: "dev",
      dirPath: "examples/smart-thermostat",
    });

    assert.equal(imported.name, "SmartThermostat");
    assert.equal(summary.states, orig.states.length);
    assert.equal(summary.globals, orig.globals.length);
    assert.equal(summary.events, orig.events.length);
    assert.equal(summary.transitions, orig.transitions.length);

    const initState = imported.states.find((s) => s.isInitial);
    assert.equal(initState && initState.name, "Standby");
    assert.ok(
      imported.transitions.some(
        (t) => t.srcName === "Standby" && t.dstName === "Heating" && t.guard.includes("target_temp_c"),
      ),
    );

    // Verify imported model simulates equivalently
    const sim = createSimulation(imported);
    sim.dispatch("Tick");
    assert.equal(sim.getSnapshot().currentState, "Heating");
  });

  it("infers a model from loose state .rs files when Cargo.toml and types.rs are absent", () => {
    const looseFiles = {
      "src/states/ready.rs": `
        use crate::types::{Event, Globals, Outcome, StateId};
        pub fn on_enter(_globals: &mut Globals) {}
        pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
          match event {
            Event::Start if globals.enabled => Outcome::Transition(StateId::Running),
            _ => Outcome::Stay,
          }
        }
        pub fn on_exit(_globals: &mut Globals) {}
      `,
      "src/states/running.rs": `
        use crate::types::{Event, Globals, Outcome, StateId};
        pub fn on_enter(_globals: &mut Globals) {}
        pub fn on_event(_globals: &mut Globals, event: &Event) -> Outcome {
          match event {
            Event::Stop => Outcome::Transition(StateId::Ready),
            _ => Outcome::Stay,
          }
        }
        pub fn on_exit(_globals: &mut Globals) {}
      `,
    };

    const { model } = importer.parseCrateFilesToModel(looseFiles, {
      owner: "user",
      repo: "loose-repo",
      dirPath: "",
      machineName: "LooseMachine",
    });

    assert.equal(model.name, "LooseMachine");
    assert.deepEqual(
      model.states.map((s) => s.name),
      ["Ready", "Running"],
    );
    assert.ok(model.globals.some((g) => g.name === "enabled"));
    assert.ok(model.events.some((e) => e.name === "Start"));
    assert.ok(model.events.some((e) => e.name === "Stop"));
    assert.ok(model.transitions.some((t) => t.srcName === "Ready" && t.dstName === "Running"));
  });

  it("stores dependsOn Set members and inherited state paths in seed/RustySeed.webgmex", () => {
    const raw = execFileSync("unzip", ["-p", path.join(REPO_ROOT, "seed/RustySeed.webgmex"), "project.json"], {
      encoding: "utf8",
    });
    const project = JSON.parse(raw);
    const objs = Object.values(project.objects || {});
    const withDependsOn = objs.filter((o) => o._sets && o._sets.dependsOn);
    const withSig = objs.filter((o) => o.atr && o.atr.depsSignature);
    assert.ok(withDependsOn.length >= 30, `Expected >=30 nodes with dependsOn Set, got ${withDependsOn.length}`);
    assert.equal(withSig.length, withDependsOn.length);

    const machines = objs.filter((o) => o.atr && (o.atr.name === "BlinkyController" || o.atr.name === "SmartThermostat"));
    assert.equal(machines.length, 2);
    for (const m of machines) {
      assert.ok(
        m.atr.gitPath === "examples/blinky" || m.atr.gitPath === "examples/smart-thermostat",
        `Unexpected machine gitPath: ${m.atr.gitPath}`,
      );
    }
  });
});
