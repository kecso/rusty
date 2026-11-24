/* globals define */
/* eslint-env node, browser */

define([
  "plugin/PluginConfig",
  "text!./metadata.json",
  "plugin/PluginBase",
], function (PluginConfig, pluginMetadata, PluginBase) {
  "use strict";

  pluginMetadata = JSON.parse(pluginMetadata);

  function ImportFromGitHub() {
    PluginBase.call(this);
    this.pluginMetadata = pluginMetadata;
  }

  ImportFromGitHub.metadata = pluginMetadata;
  ImportFromGitHub.prototype = Object.create(PluginBase.prototype);
  ImportFromGitHub.prototype.constructor = ImportFromGitHub;

  async function githubGetJson(url, token) {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "rusty-webgme-plugin",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub API ${res.status} for ${url}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  async function sweepGitHubDirectory(owner, repo, dirPath, ref, token) {
    const cleanDir = String(dirPath || "").replace(/^\/+|\/+$/g, "");
    const files = {};

    async function walk(curPath, depth) {
      if (depth > 3) return;
      const encoded = curPath
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/");
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
      const data = await githubGetJson(url, token);
      if (!Array.isArray(data)) {
        if (data && data.type === "file" && data.content) {
          files[data.path] = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
        }
        return;
      }

      for (const entry of data) {
        if (entry.type === "file") {
          const isInteresting =
            entry.name === "Cargo.toml" ||
            (entry.name.endsWith(".rs") && !entry.name.startsWith("."));
          if (!isInteresting) continue;
          const fileData = await githubGetJson(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${entry.path
              .split("/")
              .map(encodeURIComponent)
              .join("/")}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
            token,
          );
          if (fileData && fileData.content) {
            files[entry.path] = Buffer.from(fileData.content.replace(/\n/g, ""), "base64").toString("utf8");
          }
        } else if (entry.type === "dir" && (entry.name === "src" || entry.name === "states")) {
          await walk(entry.path, depth + 1);
        }
      }
    }

    await walk(cleanDir, 0);
    return files;
  }

  ImportFromGitHub.prototype.main = function (callback) {
    const core = this.core;
    const self = this;
    const cfg = this.getCurrentConfig() || {};
    const owner = String(cfg.owner || "").trim();
    const repo = String(cfg.repo || "").trim();
    const branch = String(cfg.branch || "main").trim();
    const dirPath = String(cfg.dirPath || "").trim();
    const machineName = String(cfg.machineName || "").trim();

    if (!owner || !repo || !dirPath) {
      callback(new Error("ImportFromGitHub requires owner, repo, and dirPath"), self.result);
      return;
    }

    const importer = require("../../common/rustImporter");
    const analyzer = require("../../common/rustAnalyzer");

    (async () => {
      const filesMap = await sweepGitHubDirectory(owner, repo, dirPath, branch, cfg.githubToken || "");
      const { model, summary } = importer.parseCrateFilesToModel(filesMap, {
        owner,
        repo,
        branch,
        dirPath,
        machineName,
      });

      const root = self.rootNode;
      const rootChildren = await core.loadChildren(root);
      const findMeta = (name) => rootChildren.find((n) => core.getAttribute(n, "name") === name);
      const smMeta = findMeta("StateMachine");
      const stateMeta = findMeta("State");
      const transMeta = findMeta("Transition");
      const globalMeta = findMeta("GlobalVar");
      const eventMeta = findMeta("EventDef");

      if (!smMeta || !stateMeta || !transMeta || !globalMeta || !eventMeta) {
        throw new Error("Project does not contain Rusty metamodel types");
      }

      const smNode = core.createNode({ parent: root, base: smMeta });
      core.setAttribute(smNode, "name", model.name);
      core.setAttribute(smNode, "crateName", model.crateName);
      core.setAttribute(smNode, "description", model.description || "");
      core.setAttribute(smNode, "tickMs", model.tickMs || 800);
      core.setAttribute(smNode, "gitOwner", model.gitOwner);
      core.setAttribute(smNode, "gitRepo", model.gitRepo);
      core.setAttribute(smNode, "gitBranch", model.gitBranch);
      core.setAttribute(smNode, "gitPath", model.gitPath);
      core.setAttribute(smNode, "gitArtifactType", "dir");

      const targetsByPath = new Map();
      const modelGlobals = [];
      for (const g of model.globals) {
        const gNode = core.createNode({ parent: smNode, base: globalMeta });
        core.setAttribute(gNode, "name", g.name);
        core.setAttribute(gNode, "rustType", g.rustType || "i32");
        core.setAttribute(gNode, "initialValue", String(g.initialValue ?? "0"));
        core.setAttribute(gNode, "minValue", String(g.minValue ?? ""));
        core.setAttribute(gNode, "maxValue", String(g.maxValue ?? ""));
        core.setAttribute(gNode, "description", g.description || "");
        const gp = core.getPath(gNode);
        targetsByPath.set(gp, gNode);
        modelGlobals.push({ ...g, id: gp });
      }

      const modelEvents = [];
      for (const ev of model.events) {
        const eNode = core.createNode({ parent: smNode, base: eventMeta });
        core.setAttribute(eNode, "name", ev.name);
        core.setAttribute(eNode, "payloadType", ev.payloadType || "");
        core.setAttribute(eNode, "description", ev.description || "");
        const ep = core.getPath(eNode);
        targetsByPath.set(ep, eNode);
        modelEvents.push({ ...ev, id: ep });
      }

      const stateByName = new Map();
      const modelStates = [];
      for (const st of model.states) {
        const sNode = core.createNode({ parent: smNode, base: stateMeta });
        core.setAttribute(sNode, "name", st.name);
        core.setAttribute(sNode, "description", st.description || "");
        core.setAttribute(sNode, "isInitial", Boolean(st.isInitial));
        core.setAttribute(sNode, "isFinal", Boolean(st.isFinal));
        core.setAttribute(sNode, "color", st.color || "#38bdf8");
        core.setAttribute(sNode, "gitOwner", "");
        core.setAttribute(sNode, "gitRepo", "");
        core.setAttribute(sNode, "gitBranch", "");
        core.setAttribute(sNode, "gitPath", "");
        core.setAttribute(sNode, "gitArtifactType", "file");
        core.setRegistry(sNode, "position", st.position || { x: 160, y: 160 });
        const sp = core.getPath(sNode);
        stateByName.set(st.name, sNode);
        targetsByPath.set(sp, sNode);
        modelStates.push({ ...st, id: sp });
      }

      const modelWithIds = { ...model, globals: modelGlobals, events: modelEvents, states: modelStates };

      for (const st of modelStates) {
        const sNode = stateByName.get(st.name);
        const deps = analyzer.extractDependencies(`${st.entryCode || ""}\n${st.exitCode || ""}`, modelWithIds);
        core.setAttribute(sNode, "depsSignature", analyzer.serializeDepsSnapshot(deps.snapshot));
        core.createSet(sNode, "dependsOn");
        for (const mid of deps.memberIds) {
          if (targetsByPath.has(mid)) core.addMember(sNode, "dependsOn", targetsByPath.get(mid));
        }
      }

      for (const tr of model.transitions) {
        const srcNode = stateByName.get(tr.srcName);
        const dstNode = stateByName.get(tr.dstName);
        if (!srcNode || !dstNode) continue;
        const tNode = core.createNode({ parent: smNode, base: transMeta });
        core.setAttribute(tNode, "name", tr.name);
        core.setAttribute(tNode, "event", tr.event);
        core.setAttribute(tNode, "guard", tr.guard || "");
        core.setAttribute(tNode, "reenter", Boolean(tr.reenter));
        core.setPointer(tNode, "src", srcNode);
        core.setPointer(tNode, "dst", dstNode);
        const deps = analyzer.extractDependencies("", modelWithIds, {
          triggerEvent: tr.event,
          guardText: tr.guard || "",
          actionText: tr.action || "",
        });
        core.setAttribute(tNode, "depsSignature", analyzer.serializeDepsSnapshot(deps.snapshot));
        core.createSet(tNode, "dependsOn");
        for (const mid of deps.memberIds) {
          if (targetsByPath.has(mid)) core.addMember(tNode, "dependsOn", targetsByPath.get(mid));
        }
      }

      await self.save(`Import ${model.name} from ${owner}/${repo}/${dirPath}`);
      self.createMessage(
        smNode,
        `Imported ${model.name}: ${summary.states} states, ${summary.transitions} transitions, ${summary.globals} globals, ${summary.events} events.`,
      );
      self.result.setSuccess(true);
      callback(null, self.result);
    })().catch((err) => {
      self.logger.error(err);
      callback(err, self.result);
    });
  };

  return ImportFromGitHub;
});
