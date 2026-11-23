/* globals define */
/* eslint-env node, browser */

define([
  "plugin/PluginConfig",
  "text!./metadata.json",
  "plugin/PluginBase",
], function (PluginConfig, pluginMetadata, PluginBase) {
  "use strict";

  pluginMetadata = JSON.parse(pluginMetadata);

  function GenerateRustCrate() {
    PluginBase.call(this);
    this.pluginMetadata = pluginMetadata;
  }

  GenerateRustCrate.metadata = pluginMetadata;
  GenerateRustCrate.prototype = Object.create(PluginBase.prototype);
  GenerateRustCrate.prototype.constructor = GenerateRustCrate;

  GenerateRustCrate.prototype.main = function (callback) {
    const core = this.core;
    const activeNode = this.activeNode;
    const self = this;

    // Load codegen (Node.js server-side)
    let codegen;
    let contract;
    try {
      codegen = require("../../common/rustCodegen");
      contract = require("../../common/rustContract");
    } catch (_err) {
      codegen = typeof globalThis !== "undefined" ? globalThis.RustyCodegen : null;
      contract = typeof globalThis !== "undefined" ? globalThis.RustyContract : null;
    }

    if (!codegen || !contract) {
      callback(new Error("RustyCodegen module not available"), self.result);
      return;
    }

    core
      .loadChildren(activeNode)
      .then((children) => {
        const model = {
          name: core.getAttribute(activeNode, "name") || "StateMachine",
          crateName: core.getAttribute(activeNode, "crateName") || "rusty_machine",
          description: core.getAttribute(activeNode, "description") || "",
          tickMs: core.getAttribute(activeNode, "tickMs") || 800,
          gitOwner: core.getAttribute(activeNode, "gitOwner") || "",
          gitRepo: core.getAttribute(activeNode, "gitRepo") || "",
          gitBranch: core.getAttribute(activeNode, "gitBranch") || "main",
          gitPath: core.getAttribute(activeNode, "gitPath") || "src/states",
          states: [],
          transitions: [],
          globals: [],
          events: [],
        };

        const stateNameByPath = new Map();
        const transitionNodes = [];

        for (const child of children) {
          const metaNode = core.getMetaType(child);
          const metaName = metaNode ? core.getAttribute(metaNode, "name") : "";
          const childPath = core.getPath(child);

          if (metaName === "State") {
            const name = core.getAttribute(child, "name");
            stateNameByPath.set(childPath, name);
            const rawState = {
              id: childPath,
              name,
              description: core.getAttribute(child, "description") || "",
              isInitial: Boolean(core.getAttribute(child, "isInitial")),
              isFinal: Boolean(core.getAttribute(child, "isFinal")),
              code: core.getAttribute(child, "codeCache") || "",
              gitOwner: core.getAttribute(child, "gitOwner") || "",
              gitRepo: core.getAttribute(child, "gitRepo") || "",
              gitBranch: core.getAttribute(child, "gitBranch") || "",
              gitPath: core.getAttribute(child, "gitPath") || "",
              gitBaseCommitSha: core.getAttribute(child, "gitBaseCommitSha") || "",
            };
            const effective = contract.resolveStateGitLink(model, rawState);
            model.states.push({
              ...rawState,
              gitOwner: effective.gitOwner,
              gitRepo: effective.gitRepo,
              gitBranch: effective.gitBranch,
              gitPath: effective.gitPath,
            });
          } else if (metaName === "GlobalVar") {
            model.globals.push({
              name: core.getAttribute(child, "name"),
              rustType: core.getAttribute(child, "rustType") || "i32",
              initialValue: core.getAttribute(child, "initialValue") || "0",
              description: core.getAttribute(child, "description") || "",
            });
          } else if (metaName === "EventDef") {
            model.events.push({
              name: core.getAttribute(child, "name"),
              payloadType: core.getAttribute(child, "payloadType") || "",
              description: core.getAttribute(child, "description") || "",
            });
          } else if (metaName === "Transition") {
            transitionNodes.push(child);
          }
        }

        for (const tNode of transitionNodes) {
          const srcPath = core.getPointerPath(tNode, "src");
          const dstPath = core.getPointerPath(tNode, "dst");
          model.transitions.push({
            id: core.getPath(tNode),
            name: core.getAttribute(tNode, "name") || "transition",
            srcName: stateNameByPath.get(srcPath) || "",
            dstName: stateNameByPath.get(dstPath) || "",
            event: core.getAttribute(tNode, "event") || "Tick",
            guard: core.getAttribute(tNode, "guard") || "",
            action: core.getAttribute(tNode, "action") || "",
            priority: core.getAttribute(tNode, "priority") || 1,
          });
        }

        const files = codegen.generateCrateFiles(model);
        const artifact = self.blobClient.createArtifact(model.crateName || "rusty_crate");
        return artifact.addFiles(files).then(() => artifact.save());
      })
      .then((artifactHash) => {
        self.result.addArtifact(artifactHash);
        self.result.setSuccess(true);
        callback(null, self.result);
      })
      .catch((err) => {
        self.logger.error(err.stack || err.message);
        callback(err, self.result);
      });
  };

  return GenerateRustCrate;
});
