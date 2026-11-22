#!/usr/bin/env node
"use strict";

/**
 * Build seed/RustySeed.webgmex from metamodel/Language.json + starter BlinkyController model.
 *
 * Uses sibling ../webgme-json-importer + MongoDB (e.g. local mongod or docker mongo:4.4).
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017/rusty_seed_build npm run build:seed
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { getStarterBlinkyModel } = require("../src/common/rustContract");

const REPO_ROOT = path.resolve(__dirname, "..");
const IMPORTER_ROOT = path.resolve(REPO_ROOT, "../webgme-json-importer");
const LANGUAGE_JSON = path.join(REPO_ROOT, "metamodel/Language.json");
const OUT_DIR = path.join(REPO_ROOT, "seed");
const OUT_WEBGMEX = path.join(OUT_DIR, "RustySeed.webgmex");
const META_SHEET = "MetaAspectSet_rusty-metamodel-v1";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(IMPORTER_ROOT)) {
  fail(`Missing sibling checkout at ${IMPORTER_ROOT}`);
}

const EMPTY_SEED = path.join(
  IMPORTER_ROOT,
  "node_modules/webgme-engine/seeds/EmptyProject.webgmex",
);
if (!fs.existsSync(EMPTY_SEED)) {
  fail(`EmptyProject seed not found at ${EMPTY_SEED}`);
}

process.chdir(IMPORTER_ROOT);

const mongoUri =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/rusty_seed_build";

const testFixture = require(path.join(IMPORTER_ROOT, "test/globals.js"));
const WebGME = testFixture.WebGME;
const Q = testFixture.Q;
const gmeConfig = testFixture.getGmeConfig();
gmeConfig.mongo.uri = mongoUri;
WebGME.addToRequireJsPaths(gmeConfig);

const Core = testFixture.requirejs("common/core/coreQ");
const Importer = testFixture.requirejs("webgme-json-importer/JSONImporter");
const storageUtils = testFixture.requirejs("common/storage/util");

function findByName(core, nodes, name) {
  return nodes.find((n) => core.getAttribute(n, "name") === name);
}

async function applyRustySeed(core, root, language) {
  const importer = new Importer(core, root);

  await importer.apply(root, {
    attributes: { name: "ROOT" },
    children: language.children || [],
  });

  const children = await core.loadChildren(root);
  const fco = await core.loadByPath(root, "/1");
  const gitLink = findByName(core, children, "GitArtifactLink");
  const stateMachine = findByName(core, children, "StateMachine");
  const stateMeta = findByName(core, children, "State");
  const transitionMeta = findByName(core, children, "Transition");
  const globalVarMeta = findByName(core, children, "GlobalVar");
  const eventDefMeta = findByName(core, children, "EventDef");

  const metaNodes = [fco, gitLink, stateMachine, stateMeta, transitionMeta, globalVarMeta, eventDefMeta];
  if (metaNodes.some((n) => !n)) {
    throw new Error(
      "Missing expected meta nodes after JSON apply. Found: " +
        children.map((c) => core.getAttribute(c, "name")).join(", "),
    );
  }

  // Ensure mixins are wired via Core API
  core.addMixin(stateMachine, core.getPath(gitLink));
  core.addMixin(stateMeta, core.getPath(gitLink));

  // ROOT containment rules
  for (const m of metaNodes) {
    core.setChildMeta(root, m, -1, -1);
  }

  // Register all meta nodes in MetaAspectSet + sheet
  const positions = {
    FCO: { x: 80, y: 40 },
    GitArtifactLink: { x: 120, y: 140 },
    StateMachine: { x: 380, y: 140 },
    State: { x: 120, y: 310 },
    Transition: { x: 320, y: 310 },
    GlobalVar: { x: 520, y: 310 },
    EventDef: { x: 720, y: 310 },
  };

  for (const m of metaNodes) {
    core.addMember(root, "MetaAspectSet", m);
    core.addMember(root, META_SHEET, m);
    const name = core.getAttribute(m, "name");
    const pos = positions[name] || { x: 100, y: 100 };
    core.setMemberRegistry(root, "MetaAspectSet", core.getPath(m), "position", pos);
    core.setMemberRegistry(root, META_SHEET, core.getPath(m), "position", pos);
  }

  core.setRegistry(root, "MetaSheets", [
    {
      SetID: META_SHEET,
      order: 0,
      title: "Rusty Language",
    },
  ]);

  // Instantiate starter BlinkyController model so new projects are immediately runnable!
  const starter = getStarterBlinkyModel();
  const smNode = core.createNode({ parent: root, base: stateMachine });
  core.setAttribute(smNode, "name", starter.name);
  core.setAttribute(smNode, "crateName", starter.crateName);
  core.setAttribute(smNode, "description", starter.description);
  core.setAttribute(smNode, "tickMs", starter.tickMs);
  core.setAttribute(smNode, "gitOwner", starter.gitOwner);
  core.setAttribute(smNode, "gitRepo", starter.gitRepo);
  core.setAttribute(smNode, "gitBranch", starter.gitBranch);
  core.setAttribute(smNode, "gitPath", starter.gitPath);
  core.setAttribute(smNode, "gitArtifactType", "dir");
  core.setRegistry(smNode, "position", { x: 380, y: 120 });

  // Globals
  starter.globals.forEach((g, idx) => {
    const gNode = core.createNode({ parent: smNode, base: globalVarMeta });
    core.setAttribute(gNode, "name", g.name);
    core.setAttribute(gNode, "rustType", g.rustType);
    core.setAttribute(gNode, "initialValue", g.initialValue);
    core.setAttribute(gNode, "description", g.description);
    core.setRegistry(gNode, "position", { x: 80, y: 420 + idx * 60 });
  });

  // Events
  starter.events.forEach((e, idx) => {
    const eNode = core.createNode({ parent: smNode, base: eventDefMeta });
    core.setAttribute(eNode, "name", e.name);
    core.setAttribute(eNode, "payloadType", e.payloadType);
    core.setAttribute(eNode, "description", e.description);
    core.setRegistry(eNode, "position", { x: 320, y: 420 + idx * 60 });
  });

  // States
  const stateNodesByName = new Map();
  for (const st of starter.states) {
    const sNode = core.createNode({ parent: smNode, base: stateMeta });
    core.setAttribute(sNode, "name", st.name);
    core.setAttribute(sNode, "description", st.description);
    core.setAttribute(sNode, "isInitial", Boolean(st.isInitial));
    core.setAttribute(sNode, "isFinal", Boolean(st.isFinal));
    core.setAttribute(sNode, "color", st.color);
    core.setAttribute(sNode, "codeCache", st.code);
    core.setAttribute(sNode, "gitOwner", starter.gitOwner);
    core.setAttribute(sNode, "gitRepo", starter.gitRepo);
    core.setAttribute(sNode, "gitBranch", starter.gitBranch);
    core.setAttribute(sNode, "gitPath", st.gitPath);
    core.setAttribute(sNode, "gitArtifactType", "file");
    core.setAttribute(sNode, "gitBaseCommitSha", "");
    core.setRegistry(sNode, "position", st.position);
    stateNodesByName.set(st.name, sNode);
  }

  // Transitions
  for (const tr of starter.transitions) {
    const srcNode = stateNodesByName.get(tr.srcName);
    const dstNode = stateNodesByName.get(tr.dstName);
    if (!srcNode || !dstNode) continue;
    const tNode = core.createNode({ parent: smNode, base: transitionMeta });
    core.setAttribute(tNode, "name", tr.name);
    core.setAttribute(tNode, "event", tr.event);
    core.setAttribute(tNode, "guard", tr.guard || "");
    core.setAttribute(tNode, "action", tr.action || "");
    core.setAttribute(tNode, "priority", tr.priority);
    core.setPointer(tNode, "src", srcNode);
    core.setPointer(tNode, "dst", dstNode);
  }

  return {
    metaPaths: {
      GitArtifactLink: core.getPath(gitLink),
      StateMachine: core.getPath(stateMachine),
      State: core.getPath(stateMeta),
      Transition: core.getPath(transitionMeta),
      GlobalVar: core.getPath(globalVarMeta),
      EventDef: core.getPath(eventDefMeta),
    },
    starterMachinePath: core.getPath(smNode),
  };
}

async function main() {
  const language = JSON.parse(fs.readFileSync(LANGUAGE_JSON, "utf8"));
  const logger = testFixture.logger.fork("rusty-seed");

  const gmeAuth = await testFixture.clearDBAndGetGMEAuth(gmeConfig, "rusty_seed_tmp");
  const storage = testFixture.getMongoStorage(logger, gmeConfig, gmeAuth);
  await storage.openDatabase();

  try {
    const imported = await testFixture.importProject(storage, {
      projectSeed: EMPTY_SEED,
      projectName: "rusty_seed_tmp",
      branchName: "master",
      logger,
      gmeConfig,
    });

    const project = imported.project;
    const core = new Core(project, { globConf: gmeConfig, logger: logger.fork("core") });
    const root = await Q.ninvoke(core, "loadRoot", imported.rootHash);

    const summary = await applyRustySeed(core, root, language);
    const persisted = await core.persist(root);
    const commitRes = await Q.ninvoke(
      project,
      "makeCommit",
      "master",
      [imported.commitHash],
      persisted.rootHash,
      persisted.objects,
      "Build RustySeed metamodel + BlinkyController starter",
    );

    if (!commitRes.hash) {
      throw new Error("makeCommit did not return a hash: " + JSON.stringify(commitRes));
    }

    const projectJson = await Q.ninvoke(storageUtils, "getProjectJson", project, {
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
    await gmeAuth.unload();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
