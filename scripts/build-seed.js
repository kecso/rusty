#!/usr/bin/env node
"use strict";

/**
 * Build seed/RustySeed.webgmex from metamodel/Language.json + starter example models.
 *
 * Uses `webgme-json-importer` and `webgme` resolved from `node_modules`
 * (installed from GitHub or linked locally via `npm link webgme-json-importer`).
 * Runs completely in memory via WebGME SafeStorage + Memory backend (no MongoDB required).
 *
 *   npm run build:seed
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  getStarterBlinkyModel,
  getSmartThermostatModel,
  getStateHookBodies,
} = require("../src/common/rustContract");
const {
  extractDependencies,
  serializeDepsSnapshot,
} = require("../src/common/rustAnalyzer");
const { computeLayout } = require("../src/common/rustLayout");

const REPO_ROOT = path.resolve(__dirname, "..");
const LANGUAGE_JSON = path.join(REPO_ROOT, "metamodel/Language.json");
const OUT_DIR = path.join(REPO_ROOT, "seed");
const OUT_WEBGMEX = path.join(OUT_DIR, "RustySeed.webgmex");
const META_SHEET = "MetaAspectSet_rusty-metamodel-v1";

const WebGME = require("webgme");
const gmeConfig = require("webgme/config/config.default");
WebGME.addToRequireJsPaths(gmeConfig);

const ENGINE_DIR = path.dirname(require.resolve("webgme-engine/package.json"));
const EMPTY_SEED = require.resolve("webgme-engine/seeds/EmptyProject.webgmex");
const GIT_SEED_NAME = "git-seed";
const GIT_SEED = path.join(
  path.dirname(require.resolve("webgme-git/package.json")),
  "seed/git-seed.webgmex",
);
const Logger = require(path.join(ENGINE_DIR, "src/server/logger"));
const SafeStorage = require(path.join(ENGINE_DIR, "src/server/storage/safestorage"));
const Memory = require(path.join(ENGINE_DIR, "src/server/storage/memory"));
const Core = WebGME.requirejs("common/core/coreQ");
const storageUtils = WebGME.requirejs("common/storage/util");
const ImporterMod = require("webgme-json-importer");
const Importer = ImporterMod.default || ImporterMod;

function createInMemoryAuth() {
  const projects = new Map();
  return {
    metadataStorage: {
      getProject: async (id) => projects.get(id),
      getProjects: async () => Array.from(projects.values()),
      addProject: async (owner, name, info) => {
        const doc = { _id: `${owner}+${name}`, owner, name, info: info || {} };
        projects.set(doc._id, doc);
        return doc._id;
      },
      updateProjectInfo: async () => {},
      deleteProject: async (id) => projects.delete(id),
    },
    authorizer: {
      ENTITY_TYPES: { PROJECT: "PROJECT" },
      getAccessRights: async () => ({ read: true, write: true, delete: true }),
      setAccessRights: async () => {},
    },
  };
}

function findByName(core, nodes, name) {
  return nodes.find((n) => core.getAttribute(n, "name") === name);
}

function instantiateMachine(core, root, meta, model, rootPos) {
  const { stateMachine, stateMeta, transitionMeta, globalVarMeta, eventDefMeta } = meta;

  const smNode = core.createNode({ parent: root, base: stateMachine });
  core.setAttribute(smNode, "name", model.name);
  core.setAttribute(smNode, "crateName", model.crateName);
  core.setAttribute(smNode, "description", model.description);
  core.setAttribute(smNode, "tickMs", model.tickMs);
  core.setAttribute(smNode, "gitOwner", model.gitOwner);
  core.setAttribute(smNode, "gitRepo", model.gitRepo);
  core.setAttribute(smNode, "gitBranch", model.gitBranch);
  core.setAttribute(smNode, "gitPath", model.gitPath);
  core.setAttribute(smNode, "gitArtifactType", "dir");
  core.setRegistry(smNode, "position", rootPos || { x: 240, y: 120 });

  // Compute crisp layered starter positions
  const laidOut = computeLayout(model, { direction: "LR" });

  // Globals
  const modelGlobalsWithIds = [];
  const targetNodesByPath = new Map();
  (model.globals || []).forEach((g, idx) => {
    const gNode = core.createNode({ parent: smNode, base: globalVarMeta });
    core.setAttribute(gNode, "name", g.name);
    core.setAttribute(gNode, "rustType", g.rustType);
    core.setAttribute(gNode, "initialValue", g.initialValue);
    core.setAttribute(gNode, "minValue", String(g.minValue ?? ""));
    core.setAttribute(gNode, "maxValue", String(g.maxValue ?? ""));
    core.setAttribute(gNode, "description", g.description || "");
    core.setRegistry(gNode, "position", { x: 80, y: 420 + idx * 55 });
    const gPath = core.getPath(gNode);
    targetNodesByPath.set(gPath, gNode);
    modelGlobalsWithIds.push({ ...g, id: gPath });
  });

  // Events
  const modelEventsWithIds = [];
  (model.events || []).forEach((e, idx) => {
    const eNode = core.createNode({ parent: smNode, base: eventDefMeta });
    core.setAttribute(eNode, "name", e.name);
    core.setAttribute(eNode, "payloadType", e.payloadType || "");
    core.setAttribute(eNode, "description", e.description || "");
    core.setRegistry(eNode, "position", { x: 320, y: 420 + idx * 55 });
    const ePath = core.getPath(eNode);
    targetNodesByPath.set(ePath, eNode);
    modelEventsWithIds.push({ ...e, id: ePath });
  });

  // States (design + GitArtifactLink metadata only; Rust code lives in webgme-git / GitHub)
  const stateNodesByName = new Map();
  const modelStatesWithIds = [];
  for (const st of model.states || []) {
    const hooks = getStateHookBodies(st);
    const sNode = core.createNode({ parent: smNode, base: stateMeta });
    core.setAttribute(sNode, "name", st.name);
    core.setAttribute(sNode, "description", st.description || "");
    core.setAttribute(sNode, "isInitial", Boolean(st.isInitial));
    core.setAttribute(sNode, "isFinal", Boolean(st.isFinal));
    core.setAttribute(sNode, "color", st.color || "#38bdf8");
    core.setAttribute(sNode, "gitOwner", st.gitOwner || "");
    core.setAttribute(sNode, "gitRepo", st.gitRepo || "");
    core.setAttribute(sNode, "gitBranch", st.gitBranch || "");
    core.setAttribute(sNode, "gitPath", st.gitPath || "");
    core.setAttribute(sNode, "gitArtifactType", "file");
    core.setAttribute(sNode, "gitBaseCommitSha", "");
    const layoutPos = laidOut.nodesById[st.name] || laidOut.nodesById[st.id];
    core.setRegistry(
      sNode,
      "position",
      layoutPos ? { x: layoutPos.x, y: layoutPos.y } : st.position || { x: 160, y: 160 },
    );
    const sPath = core.getPath(sNode);
    stateNodesByName.set(st.name, sNode);
    targetNodesByPath.set(sPath, sNode);
    modelStatesWithIds.push({ ...st, id: sPath, entryCode: hooks.entryCode, exitCode: hooks.exitCode });
  }

  // Transitions (NO priority, NO action code attribute; includes reenter flag)
  const transitionEntries = [];
  for (const tr of model.transitions || []) {
    const srcNode = stateNodesByName.get(tr.srcName);
    const dstNode = stateNodesByName.get(tr.dstName);
    if (!srcNode || !dstNode) continue;
    const tNode = core.createNode({ parent: smNode, base: transitionMeta });
    core.setAttribute(tNode, "name", tr.name);
    core.setAttribute(tNode, "event", tr.event);
    core.setAttribute(tNode, "guard", tr.guard || "");
    core.setAttribute(tNode, "reenter", Boolean(tr.reenter));
    core.setPointer(tNode, "src", srcNode);
    core.setPointer(tNode, "dst", dstNode);
    transitionEntries.push({ tr, tNode });
  }

  // Populate real WebGME `dependsOn` Set relationships + `depsSignature`
  const modelWithIds = {
    ...model,
    globals: modelGlobalsWithIds,
    events: modelEventsWithIds,
    states: modelStatesWithIds,
  };

  for (const st of modelStatesWithIds) {
    const sNode = stateNodesByName.get(st.name);
    const deps = extractDependencies(`${st.entryCode || ""}\n${st.exitCode || ""}`, modelWithIds);
    core.setAttribute(sNode, "depsSignature", serializeDepsSnapshot(deps.snapshot));
    core.createSet(sNode, "dependsOn");
    for (const mid of deps.memberIds) {
      const targetNode = targetNodesByPath.get(mid);
      if (targetNode) core.addMember(sNode, "dependsOn", targetNode);
    }
  }

  for (const { tr, tNode } of transitionEntries) {
    const deps = extractDependencies("", modelWithIds, {
      triggerEvent: tr.event,
      guardText: tr.guard || "",
      actionText: tr.action || "",
    });
    core.setAttribute(tNode, "depsSignature", serializeDepsSnapshot(deps.snapshot));
    core.createSet(tNode, "dependsOn");
    for (const mid of deps.memberIds) {
      const targetNode = targetNodesByPath.get(mid);
      if (targetNode) core.addMember(tNode, "dependsOn", targetNode);
    }
  }

  return core.getPath(smNode);
}

async function applyRustySeed(core, project, root, language, gitSeedJson) {
  const importer = new Importer(core, root);

  await importer.apply(root, {
    attributes: { name: "ROOT" },
    children: language.children || [],
  });

  // Import webgme-git's `git-seed.webgmex` as a genuine read-only WebGME library
  await storageUtils.insertProjectJson(project, gitSeedJson, {
    commitMessage: "Import webgme-git git-seed library objects",
  });
  await core.addLibrary(root, GIT_SEED_NAME, gitSeedJson.rootHash, {
    projectId: gitSeedJson.projectId || "guest+git-seed",
    branchName: gitSeedJson.branchName || "master",
    commitHash: gitSeedJson.commitHash,
  });

  const libMeta = core.getLibraryMetaNodes(root, GIT_SEED_NAME);
  const gitLink = Object.values(libMeta).find(
    (n) => core.getAttribute(n, "name") === "GitArtifactLink",
  );
  if (!gitLink || !core.isLibraryElement(gitLink) || core.getNamespace(gitLink) !== GIT_SEED_NAME) {
    throw new Error(`Failed to locate ${GIT_SEED_NAME}.GitArtifactLink inside imported library`);
  }

  const children = await core.loadChildren(root);
  const fco = await core.loadByPath(root, "/1");
  const stateMachine = findByName(core, children, "StateMachine");
  const stateMeta = findByName(core, children, "State");
  const transitionMeta = findByName(core, children, "Transition");
  const globalVarMeta = findByName(core, children, "GlobalVar");
  const eventDefMeta = findByName(core, children, "EventDef");

  const rustyMetaNodes = [fco, stateMachine, stateMeta, transitionMeta, globalVarMeta, eventDefMeta];
  if (rustyMetaNodes.some((n) => !n)) {
    throw new Error(
      "Missing expected meta nodes after JSON apply. Found: " +
        children.map((c) => core.getAttribute(c, "name")).join(", "),
    );
  }

  // Wire mixins directly to the `git-seed` library's GitArtifactLink and set defaults
  core.addMixin(stateMachine, core.getPath(gitLink));
  core.addMixin(stateMeta, core.getPath(gitLink));
  core.setAttribute(stateMachine, "gitArtifactType", "dir");
  core.setAttribute(stateMeta, "gitArtifactType", "file");

  // Computed Set relationship `dependsOn` from State & Transition -> GlobalVar / EventDef / State
  for (const srcMeta of [stateMeta, transitionMeta]) {
    core.setPointerMetaLimits(srcMeta, "dependsOn", -1, -1);
    for (const targetMeta of [globalVarMeta, eventDefMeta, stateMeta]) {
      core.setPointerMetaTarget(srcMeta, "dependsOn", targetMeta, -1, -1);
    }
  }

  // ROOT containment rules (only Rusty's own concepts; git-seed nodes stay library-owned)
  for (const m of rustyMetaNodes) {
    core.setChildMeta(root, m, -1, -1);
  }

  // Register Rusty meta nodes + `git-seed.GitArtifactLink` on the MetaAspectSet & sheet
  const positions = {
    FCO: { x: 80, y: 40 },
    GitArtifactLink: { x: 120, y: 140 },
    StateMachine: { x: 380, y: 140 },
    State: { x: 120, y: 310 },
    Transition: { x: 320, y: 310 },
    GlobalVar: { x: 520, y: 310 },
    EventDef: { x: 720, y: 310 },
  };

  for (const m of rustyMetaNodes) {
    core.addMember(root, "MetaAspectSet", m);
    core.addMember(root, META_SHEET, m);
    const name = core.getAttribute(m, "name");
    const pos = positions[name] || { x: 100, y: 100 };
    core.setMemberRegistry(root, "MetaAspectSet", core.getPath(m), "position", pos);
    core.setMemberRegistry(root, META_SHEET, core.getPath(m), "position", pos);
  }

  core.addMember(root, META_SHEET, gitLink);
  core.setMemberRegistry(root, "MetaAspectSet", core.getPath(gitLink), "position", positions.GitArtifactLink);
  core.setMemberRegistry(root, META_SHEET, core.getPath(gitLink), "position", positions.GitArtifactLink);

  core.setRegistry(root, "MetaSheets", [
    {
      SetID: META_SHEET,
      order: 0,
      title: "Rusty Language",
    },
  ]);

  const meta = { stateMachine, stateMeta, transitionMeta, globalVarMeta, eventDefMeta };

  // Instantiate both tutorial example StateMachines so new projects start rich and runnable
  const blinkyPath = instantiateMachine(core, root, meta, getStarterBlinkyModel(), { x: 240, y: 120 });
  const thermostatPath = instantiateMachine(core, root, meta, getSmartThermostatModel(), { x: 520, y: 120 });

  return {
    gitSeedLibrary: core.getLibraryInfo(root, GIT_SEED_NAME),
    metaPaths: {
      GitArtifactLink: core.getPath(gitLink),
      StateMachine: core.getPath(stateMachine),
      State: core.getPath(stateMeta),
      Transition: core.getPath(transitionMeta),
      GlobalVar: core.getPath(globalVarMeta),
      EventDef: core.getPath(eventDefMeta),
    },
    starterMachinePath: blinkyPath,
    starterMachinePaths: {
      BlinkyController: blinkyPath,
      SmartThermostat: thermostatPath,
    },
  };
}

async function main() {
  const language = JSON.parse(fs.readFileSync(LANGUAGE_JSON, "utf8"));
  const gitSeedJson = JSON.parse(
    execFileSync("unzip", ["-p", GIT_SEED, "project.json"], { encoding: "utf8" }),
  );
  const logger = Logger.create("gme:rusty-seed", gmeConfig.server.log, false);

  const storage = new SafeStorage(
    new Memory(logger, gmeConfig),
    logger,
    gmeConfig,
    createInMemoryAuth(),
  );
  await storage.openDatabase();

  try {
    const emptyJson = JSON.parse(
      execFileSync("unzip", ["-p", EMPTY_SEED, "project.json"], { encoding: "utf8" }),
    );
    const project = await storage.createProject({
      projectName: "rusty_seed_tmp",
      ownerId: "guest",
      username: "guest",
    });
    const initCommit = await storageUtils.insertProjectJson(project, emptyJson, {
      commitMessage: "Initialize from EmptyProject",
    });
    await project.createBranch("master", initCommit.hash);

    const core = new Core(project, { globConf: gmeConfig, logger: logger.fork("core") });
    const root = await core.loadRoot(emptyJson.rootHash);

    const summary = await applyRustySeed(core, project, root, language, gitSeedJson);
    const persisted = await core.persist(root);
    const commitRes = await project.makeCommit(
      "master",
      [initCommit.hash],
      persisted.rootHash,
      persisted.objects,
      "Build RustySeed metamodel + BlinkyController & SmartThermostat starters",
    );

    if (!commitRes.hash) {
      throw new Error("makeCommit did not return a hash: " + JSON.stringify(commitRes));
    }

    const projectJson = await storageUtils.getProjectJson(project, {
      branchName: "master",
      kind: "RustySeed",
    });
    projectJson.projectId = "guest+RustySeed";
    projectJson.kind = "RustySeed";
    projectJson.branchName = "master";

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const tmpDir = path.join(OUT_DIR, ".tmp-webgmex");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const projectJsonPath = path.join(tmpDir, "project.json");
    fs.writeFileSync(projectJsonPath, JSON.stringify(projectJson));

    const zipPath = path.join(tmpDir, "RustySeed.webgmex");
    execFileSync("zip", ["-0", "-j", zipPath, projectJsonPath], { stdio: "inherit" });
    fs.copyFileSync(zipPath, OUT_WEBGMEX);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    fs.writeFileSync(
      path.join(OUT_DIR, "ids.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );

    console.log("Built:", OUT_WEBGMEX);
    console.log("  objects   :", projectJson.objects.length);
    console.log("  metaPaths :", summary.metaPaths);
  } finally {
    await storage.closeDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
