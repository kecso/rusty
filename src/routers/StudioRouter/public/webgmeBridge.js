/* globals GME */
(function (global) {
  "use strict";

  /**
   * Proper WebGME Client Bridge.
   *
   * Connects directly to the running WebGME server via `GME.classes.Client`
   * (loaded from `/gme-dist/webgme.classes.build.js` + `/gmeConfig.json`).
   * All state-machine data is read from live WebGME territories and all edits
   * are committed inside WebGME transactions.
   */
  class WebGMEBridge {
    constructor() {
      this.client = null;
      this.gmeConfig = null;
      this.uiId = null;
      this.projectId = null;
      this.branchName = "master";
      this.metaByName = new Map();
      this.listeners = new Set();
      this.connected = false;
    }

    onModelChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    _emitChange() {
      const machines = this.readStateMachines();
      for (const fn of this.listeners) {
        try {
          fn(machines);
        } catch (err) {
          console.error("[WebGMEBridge] listener error:", err);
        }
      }
    }

    async connect() {
      const res = await fetch("/gmeConfig.json", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Failed to fetch /gmeConfig.json (${res.status})`);
      this.gmeConfig = await res.json();

      if (!global.GME || !global.GME.classes || !global.GME.classes.Client) {
        throw new Error("GME.classes.Client not loaded from /gme-dist/webgme.classes.build.js");
      }

      this.client = new global.GME.classes.Client(this.gmeConfig);
      await new Promise((resolve, reject) => {
        this.client.connectToDatabase((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.connected = true;
      return this;
    }

    async listProjects() {
      return new Promise((resolve, reject) => {
        this.client.getProjects({ rights: true, branches: true, info: true }, (err, projects) => {
          if (err) reject(err);
          else resolve(projects || []);
        });
      });
    }

    async createProjectFromSeed(projectName, seedName = "RustySeed") {
      return new Promise((resolve, reject) => {
        this.client.seedProject(
          {
            type: "file",
            seedName,
            projectName,
          },
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          },
        );
      });
    }

    async openProject(projectId, branchName) {
      if (this.uiId) {
        try {
          this.client.removeUI(this.uiId);
        } catch (_err) {
          // ignore
        }
        this.uiId = null;
      }

      await new Promise((resolve, reject) => {
        this.client.selectProject(projectId, branchName || null, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.projectId = projectId;
      this.branchName = this.client.getActiveBranchName() || branchName || "master";

      this._indexMetaNodes();

      this.uiId = this.client.addUI(null, (events) => {
        if (events && events.length > 0) {
          this._indexMetaNodes();
          this._emitChange();
        }
      });

      // Subscribe to ROOT + StateMachines + their children (States, Transitions, Globals, Events)
      this.client.updateTerritory(this.uiId, {
        "": { children: 2 },
      });
    }

    _indexMetaNodes() {
      this.metaByName.clear();
      if (!this.client) return;
      const metaNodes = this.client.getAllMetaNodes(false) || [];
      for (const node of metaNodes) {
        const name = node.getAttribute("name");
        if (name) {
          this.metaByName.set(name, node.getId());
        }
      }
    }

    getMetaId(metaName) {
      return this.metaByName.get(metaName) || null;
    }

    _isMetaType(node, metaName) {
      const metaId = this.getMetaId(metaName);
      if (!metaId || !node) return false;
      return node.isTypeOf(metaId);
    }

    readStateMachines() {
      if (!this.client || !this.projectId) return [];
      const rootNode = this.client.getNode("");
      if (!rootNode) return [];

      const smMetaId = this.getMetaId("StateMachine");
      const childIds = rootNode.getChildrenIds() || [];
      const machines = [];

      for (const cid of childIds) {
        const node = this.client.getNode(cid);
        if (!node) continue;
        // Skip Meta nodes themselves
        if (cid === smMetaId) continue;
        if (!this._isMetaType(node, "StateMachine")) continue;
        machines.push(this._extractMachine(node));
      }

      return machines;
    }

    _extractMachine(smNode) {
      const smId = smNode.getId();
      const childIds = smNode.getChildrenIds() || [];

      const states = [];
      const globals = [];
      const events = [];
      const rawTransitions = [];
      const stateNameById = new Map();

      for (const cid of childIds) {
        const child = this.client.getNode(cid);
        if (!child) continue;

        if (this._isMetaType(child, "State")) {
          const name = child.getAttribute("name") || "State";
          const pos = child.getRegistry("position") || { x: 160, y: 160 };
          stateNameById.set(cid, name);
          states.push({
            id: cid,
            name,
            description: child.getAttribute("description") || "",
            isInitial: Boolean(child.getAttribute("isInitial")),
            isFinal: Boolean(child.getAttribute("isFinal")),
            color: child.getAttribute("color") || "#38bdf8",
            code: child.getAttribute("codeCache") || "",
            gitOwner: child.getAttribute("gitOwner") || "",
            gitRepo: child.getAttribute("gitRepo") || "",
            gitBranch: child.getAttribute("gitBranch") || "",
            gitPath: child.getAttribute("gitPath") || "",
            gitArtifactType: child.getAttribute("gitArtifactType") || "file",
            gitBaseCommitSha: child.getAttribute("gitBaseCommitSha") || "",
            dependsOn: child.getMemberIds("dependsOn") || [],
            depsSignature: child.getAttribute("depsSignature") || "",
            position: { x: Number(pos.x) || 120, y: Number(pos.y) || 120 },
          });
        } else if (this._isMetaType(child, "GlobalVar")) {
          globals.push({
            id: cid,
            name: child.getAttribute("name") || "var",
            rustType: child.getAttribute("rustType") || "i32",
            initialValue: String(child.getAttribute("initialValue") ?? "0"),
            description: child.getAttribute("description") || "",
          });
        } else if (this._isMetaType(child, "EventDef")) {
          events.push({
            id: cid,
            name: child.getAttribute("name") || "Tick",
            payloadType: child.getAttribute("payloadType") || "",
            description: child.getAttribute("description") || "",
          });
        } else if (this._isMetaType(child, "Transition")) {
          rawTransitions.push(child);
        }
      }

      const transitions = rawTransitions.map((tNode) => {
        const srcId = tNode.getPointerId("src");
        const dstId = tNode.getPointerId("dst");
        return {
          id: tNode.getId(),
          name: tNode.getAttribute("name") || "transition",
          srcId,
          dstId,
          srcName: stateNameById.get(srcId) || "",
          dstName: stateNameById.get(dstId) || "",
          event: tNode.getAttribute("event") || "Tick",
          guard: tNode.getAttribute("guard") || "",
          action: tNode.getAttribute("action") || "",
          priority: Number(tNode.getAttribute("priority") ?? 1),
          dependsOn: tNode.getMemberIds("dependsOn") || [],
          depsSignature: tNode.getAttribute("depsSignature") || "",
        };
      });

      return {
        id: smId,
        name: smNode.getAttribute("name") || "StateMachine",
        crateName: smNode.getAttribute("crateName") || "rusty_machine",
        description: smNode.getAttribute("description") || "",
        tickMs: Number(smNode.getAttribute("tickMs") || 800),
        gitOwner: smNode.getAttribute("gitOwner") || "",
        gitRepo: smNode.getAttribute("gitRepo") || "",
        gitBranch: smNode.getAttribute("gitBranch") || "main",
        gitPath: smNode.getAttribute("gitPath") || "src/states",
        gitBaseCommitSha: smNode.getAttribute("gitBaseCommitSha") || "",
        states,
        transitions,
        globals,
        events,
      };
    }

    // ---- WebGME Transactional Write Helpers ----

    runTransaction(message, fn) {
      this.client.startTransaction(message);
      try {
        const res = fn();
        this.client.completeTransaction(message);
        return res;
      } catch (err) {
        this.client.completeTransaction(`${message} (aborted)`);
        throw err;
      }
    }

    createStateMachine(name) {
      const baseId = this.getMetaId("StateMachine");
      if (!baseId) throw new Error("StateMachine meta node not found in project");
      return this.runTransaction(`Create StateMachine ${name}`, () => {
        const id = this.client.createNode({ parentId: "", baseId });
        this.client.setAttribute(id, "name", name);
        this.client.setAttribute(id, "crateName", global.RustyContract.toSnakeCase(name));
        this.client.setAttribute(id, "tickMs", 800);
        this.client.setAttribute(id, "gitBranch", "main");
        this.client.setAttribute(id, "gitPath", "src/states");
        return id;
      });
    }

    createState(machineId, opts) {
      const baseId = this.getMetaId("State");
      if (!baseId) throw new Error("State meta node not found");
      return this.runTransaction(`Add State ${opts.name}`, () => {
        const id = this.client.createNode({ parentId: machineId, baseId });
        this.client.setAttribute(id, "name", opts.name);
        this.client.setAttribute(id, "description", opts.description || "");
        this.client.setAttribute(id, "isInitial", Boolean(opts.isInitial));
        this.client.setAttribute(id, "isFinal", Boolean(opts.isFinal));
        this.client.setAttribute(id, "color", opts.color || "#38bdf8");
        this.client.setAttribute(
          id,
          "codeCache",
          opts.code || global.RustyContract.defaultStateCode(opts.name, []),
        );
        this.client.setAttribute(id, "gitOwner", opts.gitOwner || "");
        this.client.setAttribute(id, "gitRepo", opts.gitRepo || "");
        this.client.setAttribute(id, "gitBranch", opts.gitBranch || "");
        this.client.setAttribute(id, "gitPath", opts.gitPath || "");
        this.client.setAttribute(id, "gitArtifactType", "file");
        this.client.setAttribute(id, "gitBaseCommitSha", "");
        this.client.setRegistry(id, "position", opts.position || { x: 220, y: 200 });
        return id;
      });
    }

    _applyDepsInsideTx(nodeId, nextMemberIds, depsSignature) {
      const node = this.client.getNode(nodeId);
      const current = new Set(node ? node.getMemberIds("dependsOn") || [] : []);
      const desired = new Set(nextMemberIds || []);
      for (const oldId of current) {
        if (!desired.has(oldId)) {
          this.client.removeMember(nodeId, oldId, "dependsOn");
        }
      }
      for (const newId of desired) {
        if (!current.has(newId)) {
          this.client.addMember(nodeId, newId, "dependsOn");
        }
      }
      if (depsSignature !== undefined) {
        this.client.setAttribute(nodeId, "depsSignature", depsSignature);
      }
    }

    syncNodeDependencies(nodeId, nextMemberIds, depsSignature, msg) {
      this.runTransaction(msg || `Update dependsOn for ${nodeId}`, () => {
        this._applyDepsInsideTx(nodeId, nextMemberIds, depsSignature);
      });
    }

    updateStateCodeAndDeps(nodeId, code, nextMemberIds, depsSignature, msg) {
      this.runTransaction(msg || `Update Rust code for ${nodeId}`, () => {
        this.client.setAttribute(nodeId, "codeCache", code);
        this._applyDepsInsideTx(nodeId, nextMemberIds, depsSignature);
      });
    }

    updateTransitionAndDeps(nodeId, attrs, nextMemberIds, depsSignature, msg) {
      this.runTransaction(msg || `Update Transition ${nodeId}`, () => {
        for (const [k, v] of Object.entries(attrs)) {
          this.client.setAttribute(nodeId, k, v);
        }
        this._applyDepsInsideTx(nodeId, nextMemberIds, depsSignature);
      });
    }

    bindMachineRepo(machineId, { gitOwner, gitRepo, gitBranch, gitPath, clearStateOverrides, stateIds }) {
      this.runTransaction(`Bind GitHub repo ${gitOwner}/${gitRepo}@${gitBranch}`, () => {
        this.client.setAttribute(machineId, "gitOwner", gitOwner);
        this.client.setAttribute(machineId, "gitRepo", gitRepo);
        this.client.setAttribute(machineId, "gitBranch", gitBranch);
        this.client.setAttribute(machineId, "gitPath", gitPath);

        if (clearStateOverrides && Array.isArray(stateIds)) {
          for (const stId of stateIds) {
            this.client.setAttribute(stId, "gitOwner", "");
            this.client.setAttribute(stId, "gitRepo", "");
            this.client.setAttribute(stId, "gitBranch", "");
            this.client.setAttribute(stId, "gitPath", "");
          }
        }
      });
    }

    _populateMachineChildrenInsideTx(smId, model) {
      const stBase = this.getMetaId("State");
      const trBase = this.getMetaId("Transition");
      const gBase = this.getMetaId("GlobalVar");
      const evBase = this.getMetaId("EventDef");
      if (!stBase || !trBase || !gBase || !evBase) {
        throw new Error("Rusty metamodel types not found in active WebGME project");
      }

      const globalsWithIds = (model.globals || []).map((g) => {
        const gid = this.client.createNode({ parentId: smId, baseId: gBase });
        this.client.setAttribute(gid, "name", g.name);
        this.client.setAttribute(gid, "rustType", g.rustType || "i32");
        this.client.setAttribute(gid, "initialValue", String(g.initialValue ?? "0"));
        this.client.setAttribute(gid, "description", g.description || "");
        return { ...g, id: gid };
      });

      const eventsWithIds = (model.events || []).map((ev) => {
        const eid = this.client.createNode({ parentId: smId, baseId: evBase });
        this.client.setAttribute(eid, "name", ev.name);
        this.client.setAttribute(eid, "payloadType", ev.payloadType || "");
        this.client.setAttribute(eid, "description", ev.description || "");
        return { ...ev, id: eid };
      });

      const stateIdByName = new Map();
      const statesWithIds = (model.states || []).map((st) => {
        const sid = this.client.createNode({ parentId: smId, baseId: stBase });
        this.client.setAttribute(sid, "name", st.name);
        this.client.setAttribute(sid, "description", st.description || "");
        this.client.setAttribute(sid, "isInitial", Boolean(st.isInitial));
        this.client.setAttribute(sid, "isFinal", Boolean(st.isFinal));
        this.client.setAttribute(sid, "color", st.color || "#38bdf8");
        this.client.setAttribute(sid, "codeCache", st.code || "");
        this.client.setAttribute(sid, "gitOwner", "");
        this.client.setAttribute(sid, "gitRepo", "");
        this.client.setAttribute(sid, "gitBranch", "");
        this.client.setAttribute(sid, "gitPath", "");
        this.client.setAttribute(sid, "gitArtifactType", "file");
        this.client.setAttribute(sid, "gitBaseCommitSha", "");
        this.client.setRegistry(sid, "position", st.position || { x: 160, y: 160 });
        stateIdByName.set(st.name, sid);
        return { ...st, id: sid };
      });

      const modelWithIds = { ...model, globals: globalsWithIds, events: eventsWithIds, states: statesWithIds };

      for (const st of statesWithIds) {
        const deps = global.RustyAnalyzer.extractDependencies(st.code || "", modelWithIds);
        const sig = global.RustyAnalyzer.serializeDepsSnapshot(deps.snapshot);
        this.client.setAttribute(st.id, "depsSignature", sig);
        for (const mid of deps.memberIds) {
          this.client.addMember(st.id, mid, "dependsOn");
        }
      }

      for (const tr of model.transitions || []) {
        const srcId = stateIdByName.get(tr.srcName);
        const dstId = stateIdByName.get(tr.dstName);
        if (!srcId || !dstId) continue;
        const tid = this.client.createNode({ parentId: smId, baseId: trBase });
        this.client.setAttribute(tid, "name", tr.name || `on_${global.RustyContract.toSnakeCase(tr.event)}`);
        this.client.setAttribute(tid, "event", tr.event || "Tick");
        this.client.setAttribute(tid, "guard", tr.guard || "");
        this.client.setAttribute(tid, "action", tr.action || "");
        this.client.setAttribute(tid, "priority", Number(tr.priority ?? 1));
        this.client.setPointer(tid, "src", srcId);
        this.client.setPointer(tid, "dst", dstId);
        const deps = global.RustyAnalyzer.extractDependencies(tr.guard || "", modelWithIds, { triggerEvent: tr.event });
        const sig = global.RustyAnalyzer.serializeDepsSnapshot(deps.snapshot);
        this.client.setAttribute(tid, "depsSignature", sig);
        for (const mid of deps.memberIds) {
          this.client.addMember(tid, mid, "dependsOn");
        }
      }
    }

    importStateMachineModel(model) {
      const smBase = this.getMetaId("StateMachine");
      if (!smBase) {
        throw new Error("Rusty metamodel types not found in active WebGME project");
      }

      return this.runTransaction(`Import StateMachine ${model.name}`, () => {
        const smId = this.client.createNode({ parentId: "", baseId: smBase });
        this.client.setAttribute(smId, "name", model.name);
        this.client.setAttribute(smId, "crateName", model.crateName || global.RustyContract.toSnakeCase(model.name));
        this.client.setAttribute(smId, "description", model.description || "");
        this.client.setAttribute(smId, "tickMs", Number(model.tickMs || 800));
        this.client.setAttribute(smId, "gitOwner", model.gitOwner || "");
        this.client.setAttribute(smId, "gitRepo", model.gitRepo || "");
        this.client.setAttribute(smId, "gitBranch", model.gitBranch || "main");
        this.client.setAttribute(smId, "gitPath", model.gitPath || "src/states");
        this.client.setAttribute(smId, "gitArtifactType", "dir");
        this._populateMachineChildrenInsideTx(smId, model);
        return smId;
      });
    }

    populateMachineFromImport(machineId, model) {
      return this.runTransaction(`Connect & import StateMachine ${model.name}`, () => {
        const smNode = this.client.getNode(machineId);
        if (!smNode) throw new Error(`StateMachine node ${machineId} not found`);

        const existingChildIds = (smNode.getChildrenIds() || []).slice();
        const nonTransitions = [];
        for (const cid of existingChildIds) {
          const child = this.client.getNode(cid);
          if (child && this._isMetaType(child, "Transition")) {
            this.client.deleteNode(cid);
          } else {
            nonTransitions.push(cid);
          }
        }
        for (const cid of nonTransitions) {
          this.client.deleteNode(cid);
        }

        const nextName = model.name || smNode.getAttribute("name") || "StateMachine";
        this.client.setAttribute(machineId, "name", nextName);
        this.client.setAttribute(
          machineId,
          "crateName",
          model.crateName || global.RustyContract.toSnakeCase(nextName),
        );
        this.client.setAttribute(machineId, "description", model.description || "");
        this.client.setAttribute(machineId, "tickMs", Number(model.tickMs || 800));
        this.client.setAttribute(machineId, "gitOwner", model.gitOwner || "");
        this.client.setAttribute(machineId, "gitRepo", model.gitRepo || "");
        this.client.setAttribute(machineId, "gitBranch", model.gitBranch || "main");
        this.client.setAttribute(machineId, "gitPath", model.gitPath || "src/states");
        this.client.setAttribute(machineId, "gitArtifactType", "dir");

        this._populateMachineChildrenInsideTx(machineId, model);
        return machineId;
      });
    }

    updateNodeAttributes(nodeId, attrs, msg) {
      this.runTransaction(msg || `Update ${nodeId}`, () => {
        for (const [k, v] of Object.entries(attrs)) {
          this.client.setAttribute(nodeId, k, v);
        }
      });
    }

    updateStatePositions(positionsById) {
      this.runTransaction("Update state layout positions", () => {
        for (const [id, pos] of Object.entries(positionsById)) {
          this.client.setRegistry(id, "position", {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
          });
        }
      });
    }

    deleteNode(nodeId, label) {
      this.runTransaction(`Delete ${label || nodeId}`, () => {
        this.client.deleteNode(nodeId);
      });
    }

    createTransition(machineId, { srcId, dstId, event, name, guard, action, priority }) {
      const baseId = this.getMetaId("Transition");
      if (!baseId) throw new Error("Transition meta node not found");
      return this.runTransaction(`Create Transition ${event}`, () => {
        const id = this.client.createNode({ parentId: machineId, baseId });
        this.client.setAttribute(id, "name", name || `on_${global.RustyContract.toSnakeCase(event)}`);
        this.client.setAttribute(id, "event", event || "Tick");
        this.client.setAttribute(id, "guard", guard || "");
        this.client.setAttribute(id, "action", action || "");
        this.client.setAttribute(id, "priority", Number(priority ?? 1));
        this.client.setPointer(id, "src", srcId);
        this.client.setPointer(id, "dst", dstId);
        return id;
      });
    }

    createGlobalVar(machineId, { name, rustType, initialValue, description }) {
      const baseId = this.getMetaId("GlobalVar");
      if (!baseId) throw new Error("GlobalVar meta node not found");
      return this.runTransaction(`Add GlobalVar ${name}`, () => {
        const id = this.client.createNode({ parentId: machineId, baseId });
        this.client.setAttribute(id, "name", name);
        this.client.setAttribute(id, "rustType", rustType || "i32");
        this.client.setAttribute(id, "initialValue", String(initialValue ?? "0"));
        this.client.setAttribute(id, "description", description || "");
        return id;
      });
    }

    createEventDef(machineId, { name, payloadType, description }) {
      const baseId = this.getMetaId("EventDef");
      if (!baseId) throw new Error("EventDef meta node not found");
      return this.runTransaction(`Add EventDef ${name}`, () => {
        const id = this.client.createNode({ parentId: machineId, baseId });
        this.client.setAttribute(id, "name", name);
        this.client.setAttribute(id, "payloadType", payloadType || "");
        this.client.setAttribute(id, "description", description || "");
        return id;
      });
    }

    // bindMachineRepo and importStateMachineModel live above
  }

  global.WebGMEBridge = WebGMEBridge;
})(window);
