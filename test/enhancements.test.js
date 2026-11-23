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
    const deps = analyzer.extractDependencies(`${st.entryCode || ""}\n${st.exitCode || ""}`, clone);
    st.dependsOn = deps.memberIds;
    st.depsSignature = analyzer.serializeDepsSnapshot(deps.snapshot);
  }
  for (const tr of clone.transitions) {
    const deps = analyzer.extractDependencies("", clone, {
      triggerEvent: tr.event,
      guardText: tr.guard || "",
      actionText: tr.action || "",
    });
    tr.dependsOn = deps.memberIds;
    tr.depsSignature = analyzer.serializeDepsSnapshot(deps.snapshot);
  }
  return clone;
}

describe("Rusty Studio V3 Enhancements (Codec, Impact, Determinism, Layout, Importer)", () => {
  it("resolves machine-level directory inheritance and composes/parses pure V3 state modules losslessly", () => {
    const machine = contract.getSmartThermostatModel();
    machine.gitOwner = "alice";
    machine.gitRepo = "rusty";
    machine.gitBranch = "dev";
    machine.gitPath = "examples/smart-thermostat";

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

    const heating = machine.states.find((s) => s.name === "Heating");
    const composed = contract.composeStateModuleRs(machine, heating);
    assert.doesNotMatch(composed.code, /\bStateId\b/);
    assert.doesNotMatch(composed.code, /\bOutcome\b/);
    assert.match(composed.code, /pub fn tr_heat_step\(/);

    const parsed = contract.parseStateModuleRs(composed.code);
    assert.equal(parsed.isV3, true);
    assert.equal(parsed.entryCode, heating.entryCode);
    assert.equal(parsed.exitCode, heating.exitCode);
    assert.match(parsed.actionsByFnName.tr_heat_step, /globals\.cycle_ticks \+= 1;/);
  });

  it("tracks dependencies and computes design-to-code impact + determinism overlaps on model changes", () => {
    const cleanModel = attachSyntheticIdsAndDeps(contract.getSmartThermostatModel());
    const baseline = analyzer.computeDesignImpact(cleanModel);
    assert.equal(baseline.totalImpacted, 0);
    assert.equal(baseline.determinism.ok, true);

    // 1. Rename a referenced GlobalVar -> flags both states and guarded/action transitions
    const renamedModel = JSON.parse(JSON.stringify(cleanModel));
    const maxTicks = renamedModel.globals.find((g) => g.name === "max_cycle_ticks");
    maxTicks.name = "duty_limit";
    const renameImpact = analyzer.computeDesignImpact(renamedModel);
    assert.ok(renameImpact.impactedTransitions >= 4);

    // 2. Retype a referenced GlobalVar -> flags type-drift warnings across all transitions using eco_mode
    const retypedModel = JSON.parse(JSON.stringify(cleanModel));
    retypedModel.globals.find((g) => g.name === "eco_mode").rustType = "i32";
    const typeImpact = analyzer.computeDesignImpact(retypedModel);
    assert.equal(typeImpact.impactedTransitions, 5);

    // 3. Remove an EventDef -> flags transitions relying on it
    const droppedEvModel = JSON.parse(JSON.stringify(cleanModel));
    droppedEvModel.events = droppedEvModel.events.filter((e) => e.name !== "EmergencyShutoff");
    const evImpact = analyzer.computeDesignImpact(droppedEvModel);
    assert.ok(evImpact.impactedTransitions >= 4);

    // 4. Introduce an overlapping guard on Standby -> flags DESIGN_GUARD_OVERLAP with counterexample
    const overlapModel = JSON.parse(JSON.stringify(cleanModel));
    const startHeat = overlapModel.transitions.find(
      (t) => t.srcName === "Standby" && t.dstName === "Heating",
    );
    startHeat.guard = "current_temp_c < target_temp_c + hysteresis_c";
    const ovImpact = analyzer.computeDesignImpact(overlapModel);
    assert.equal(ovImpact.determinism.ok, false);
    assert.ok(ovImpact.byTransitionId[startHeat.id].reasons.some((r) => r.code === "DESIGN_GUARD_OVERLAP"));
  });

  it("computes deterministic, non-overlapping fixed layered layouts with clear labels and visible self-loops in LR and TB", () => {
    function sampleEdgePoints(d) {
      const qm = /^M\s+([-\d.]+)\s+([-\d.]+)\s+Q\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)$/.exec(d.trim());
      if (qm) {
        const [, x1, y1, cx, cy, x2, y2] = qm.map(Number);
        const pts = [];
        for (let t = 0.15; t <= 0.851; t += 0.05) {
          const om = 1 - t;
          pts.push({
            x: om * om * x1 + 2 * om * t * cx + t * t * x2,
            y: om * om * y1 + 2 * om * t * cy + t * t * y2,
          });
        }
        return pts;
      }
      const lm = /^M\s+([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)$/.exec(d.trim());
      if (lm) {
        const [, x1, y1, x2, y2] = lm.map(Number);
        const pts = [];
        for (let t = 0.15; t <= 0.851; t += 0.05) {
          pts.push({ x: (1 - t) * x1 + t * x2, y: (1 - t) * y1 + t * y2 });
        }
        return pts;
      }
      return [];
    }

    function rectClearance(a, b) {
      const dx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2;
      const dy = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2;
      if (dx < 0 && dy < 0) return -Math.min(-dx, -dy);
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    }

    for (const rawModel of [contract.getStarterBlinkyModel(), contract.getSmartThermostatModel()]) {
      const model = attachSyntheticIdsAndDeps(rawModel);
      for (const direction of ["LR", "TB"]) {
        const res1 = layout.computeLayout(model, { direction, compactLabels: true });
        const res2 = layout.computeLayout(model, { direction, compactLabels: true });
        assert.deepEqual(res1, res2, "Fixed layout must be 100% deterministic");

        const boxes = model.states.map((s) => res1.nodesById[s.id || s.name]);
        assert.equal(boxes.length, model.states.length);
        for (const b of boxes) {
          assert.ok(Number.isFinite(b.x) && b.x >= 0);
          assert.ok(Number.isFinite(b.y) && b.y >= 0);
          assert.ok(b.x + b.width <= res1.width);
          assert.ok(b.y + b.height <= res1.height);
        }

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

        const labelRects = model.transitions.map((tr) => {
          const e = res1.edgesById[tr.id];
          assert.ok(e, `Missing routed geometry for transition ${tr.srcName}->${tr.dstName} (${tr.event})`);
          if (tr.srcId === tr.dstId) {
            const box = res1.nodesById[tr.srcId];
            assert.ok(
              box.y - e.labelY >= 44,
              `${model.name} (${direction}) self-transition ${tr.name} too close to box (${box.y - e.labelY}px)`,
            );
          } else {
            const pts = sampleEdgePoints(e.d);
            for (const st of model.states) {
              if (st.id === tr.srcId || st.id === tr.dstId) continue;
              const ob = res1.nodesById[st.id];
              for (const pt of pts) {
                const inside =
                  pt.x >= ob.x && pt.x <= ob.x + ob.width && pt.y >= ob.y && pt.y <= ob.y + ob.height;
                assert.equal(
                  inside,
                  false,
                  `${model.name} (${direction}) edge ${tr.srcName}->${tr.dstName} cut through non-endpoint state ${st.name}`,
                );
              }
            }
          }
          const r = { id: tr.id, cx: e.labelX, cy: e.labelY, w: e.pillW, h: e.pillH };
          for (const st of model.states) {
            const b = res1.nodesById[st.id];
            const br = { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height };
            assert.ok(
              rectClearance(r, br) > 0,
              `${model.name} (${direction}) transition label ${tr.name} overlapped state ${st.name}`,
            );
          }
          return r;
        });

        let minClearance = Infinity;
        for (let i = 0; i < labelRects.length; i++) {
          for (let j = i + 1; j < labelRects.length; j++) {
            const clr = rectClearance(labelRects[i], labelRects[j]);
            if (clr < minClearance) minClearance = clr;
          }
        }
        assert.ok(
          minClearance >= 10,
          `${model.name} (${direction}) transition labels too close: minClearance=${minClearance.toFixed(1)}px`,
        );
      }
    }
  });

  it("losslessly round-trips V3 SmartThermostat crate (bounds + guards + self-transitions + tr_* actions) via RustyImporter", () => {
    const orig = contract.getSmartThermostatModel();
    const files = codegen.generateCrateFiles(orig);

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

    const hystVar = imported.globals.find((g) => g.name === "hysteresis_c");
    assert.equal(hystVar.minValue, "0.0");
    assert.equal(hystVar.maxValue, "5.0");

    const heatStepTr = imported.transitions.find((t) => t.srcName === "Heating" && t.name === "heat_step");
    assert.ok(heatStepTr && heatStepTr.action.includes("globals.energy_wh"));

    const sim = createSimulation(imported);
    sim.dispatch("Tick"); // Standby drift 21.0 -> 20.25
    sim.dispatch("Tick"); // Standby -> Heating
    assert.equal(sim.getSnapshot().currentState, "Heating");
  });

  it("stores V3 entryCode/exitCode/reenter/minValue/maxValue and dependsOn Sets in seed/RustySeed.webgmex", () => {
    const raw = execFileSync("unzip", ["-p", path.join(REPO_ROOT, "seed/RustySeed.webgmex"), "project.json"], {
      encoding: "utf8",
    });
    const project = JSON.parse(raw);
    const objs = Object.values(project.objects || {});
    const withDependsOn = objs.filter((o) => o._sets && o._sets.dependsOn);
    const withSig = objs.filter((o) => o.atr && o.atr.depsSignature);
    assert.ok(withDependsOn.length >= 40, `Expected >=40 nodes with dependsOn Set, got ${withDependsOn.length}`);
    assert.equal(withSig.length, withDependsOn.length);

    const heatingNode = objs.find((o) => o.atr && o.atr.name === "Heating");
    assert.ok(heatingNode && heatingNode.atr.entryCode.includes("cycle_ticks = 0"));
    assert.equal(heatingNode.atr.priority, undefined);

    // Verify `webgme-git` `git-seed` is imported as a genuine WebGME library and mixed into StateMachine & State
    const rootObj = objs.find((o) => o._id === project.rootHash);
    const gitSeedLibRoot = objs.find(
      (o) => o.atr && o.atr.name === "git-seed" && o.atr._libraryInfo,
    );
    assert.ok(gitSeedLibRoot, "Expected git-seed WebGME library root with _libraryInfo in RustySeed.webgmex");
    const libRelid = Object.keys(rootObj).find((k) => rootObj[k] === gitSeedLibRoot._id);
    assert.ok(libRelid, "git-seed library must be mounted directly under ROOT");

    const topChildIds = new Set(
      Object.entries(rootObj)
        .filter(([k, v]) => typeof v === "string" && !k.startsWith("_"))
        .map(([, v]) => v),
    );
    const localGitLink = objs.find(
      (o) => o.atr && o.atr.name === "GitArtifactLink" && topChildIds.has(o._id),
    );
    assert.equal(localGitLink, undefined, "GitArtifactLink must come from git-seed library, not be duplicated under ROOT");

    const libGitLinkRel = Object.keys(gitSeedLibRoot).find((k) => {
      if (typeof gitSeedLibRoot[k] !== "string" || k.startsWith("_")) return false;
      const child = objs.find((o) => o._id === gitSeedLibRoot[k]);
      return child && child.atr && child.atr.name === "GitArtifactLink";
    });
    assert.ok(libGitLinkRel, "Expected GitArtifactLink inside git-seed library");
    const libGitLinkPath = `/${libRelid}/${libGitLinkRel}`;

    const smMetaNode = objs.find((o) => o.atr && o.atr.name === "StateMachine" && o.atr.crateName);
    const stateMetaNode = objs.find((o) => o.atr && o.atr.name === "State" && typeof o.atr.entryCode === "string");
    const smPath = `/${Object.keys(rootObj).find((k) => rootObj[k] === smMetaNode._id)}`;
    const statePath = `/${Object.keys(rootObj).find((k) => rootObj[k] === stateMetaNode._id)}`;
    const hasMixinEntry = (nodePath) =>
      Object.entries(rootObj.ovr || {}).some(
        ([k, v]) => k.startsWith(`${nodePath}/_sets/_mixins/`) && v && v.member === libGitLinkPath,
      );
    assert.equal(hasMixinEntry(smPath), true, `StateMachine (${smPath}) must mixin ${libGitLinkPath}`);
    assert.equal(hasMixinEntry(statePath), true, `State (${statePath}) must mixin ${libGitLinkPath}`);
    assert.equal(smMetaNode.atr.gitArtifactType, "dir");
    assert.equal(stateMetaNode.atr.gitArtifactType, "file");
  });
});
