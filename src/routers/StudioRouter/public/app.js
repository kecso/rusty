(function () {
  "use strict";

  const bridge = new window.WebGMEBridge();
  const gitClient = new window.GitSyncClient("/routers/gitrouter");
  const { RustyContract, RustyCodegen, RustySimEngine } = window;

  const state = {
    info: null,
    gitStatus: { hasGithubToken: false, githubAppConfigured: false },
    projects: [],
    machines: [],
    activeMachineId: null,
    selectedType: null, // 'state' | 'transition' | null
    selectedId: null,
    connectMode: false,
    connectSourceId: null,
    dirtyStateIds: new Set(),
    fetchedStateIds: new Set(),
    editorLoadedStateId: null,
    activeCrateFile: "Cargo.toml",
    // Simulator state
    sim: null,
    simTimer: null,
    simTickMs: 800,
    simLastTransitionId: null,
    // Pending 409 conflict
    pendingConflict: null,
  };

  const $ = (id) => document.getElementById(id);
  let monacoEditor = null;

  function toast(msg, kind = "ok") {
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.textContent = msg;
    $("toastStack").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function activeMachine() {
    return state.machines.find((m) => m.id === state.activeMachineId) || state.machines[0] || null;
  }

  function selectedStateObj() {
    const m = activeMachine();
    if (!m || state.selectedType !== "state") return null;
    return m.states.find((s) => s.id === state.selectedId) || null;
  }

  function selectedTransitionObj() {
    const m = activeMachine();
    if (!m || state.selectedType !== "transition") return null;
    return m.transitions.find((t) => t.id === state.selectedId) || null;
  }

  const canvas = new window.StateMachineCanvas($("smSvg"), {
    onSelectState(id) {
      selectStateForEditing(id);
    },
    onSelectTransition(id) {
      state.selectedType = "transition";
      state.selectedId = id;
      renderAll();
    },
    onBackgroundClick() {
      state.selectedType = null;
      state.selectedId = null;
      state.connectSourceId = null;
      renderAll();
    },
    onStateMoved(id, pos) {
      bridge.updateStatePositions({ [id]: pos });
    },
    onConnectClick(stateId) {
      const m = activeMachine();
      if (!m) return;
      if (!state.connectSourceId) {
        state.connectSourceId = stateId;
        toast("Select target state for transition", "ok");
        renderCanvas();
        return;
      }
      const eventName = window.prompt("Trigger event name (e.g. Tick, Start, Stop):", "Tick");
      if (eventName && eventName.trim()) {
        bridge.createTransition(m.id, {
          srcId: state.connectSourceId,
          dstId: stateId,
          event: eventName.trim(),
        });
        toast(`Created transition on ${eventName.trim()}`, "ok");
      }
      state.connectSourceId = null;
      state.connectMode = false;
      $("btnConnectMode").classList.remove("btn-active");
      renderAll();
    },
  });

  async function selectStateForEditing(id) {
    state.selectedType = "state";
    state.selectedId = id;
    renderAll();

    // Auto-fetch latest Rust file from GitHub via webgme-git (Octokit) when editing a bound state
    const st = selectedStateObj();
    if (
      st &&
      st.gitOwner &&
      st.gitRepo &&
      st.gitPath &&
      state.gitStatus.hasGithubToken &&
      !state.dirtyStateIds.has(st.id) &&
      !state.fetchedStateIds.has(st.id)
    ) {
      await pullStateFromGitHub(st, { silentNotFound: true });
    }
  }

  function renderAnalyzerDiagnostics(result) {
    const { diagnostics, durationMs, stats } = result;
    const badge = $("analyzerStatusBadge");
    if (stats.errors > 0) {
      badge.className = "badge badge-err";
      badge.textContent = `✕ ${stats.errors} error${stats.errors === 1 ? "" : "s"}${stats.warnings ? ` · ${stats.warnings} warn` : ""}`;
    } else if (stats.warnings > 0) {
      badge.className = "badge badge-warn";
      badge.textContent = `⚠ ${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}`;
    } else {
      badge.className = "badge badge-ok";
      badge.textContent = "✓ 0 errors";
    }
    $("analyzerLatency").textContent = `${durationMs}ms`;

    const list = $("editorProblemsList");
    list.innerHTML = "";
    if (!diagnostics.length) {
      list.classList.add("hidden");
      return;
    }
    list.classList.remove("hidden");
    for (const d of diagnostics) {
      const li = document.createElement("li");
      li.className = `problem-row sev-${d.severity}`;
      li.innerHTML = `
        <span class="problem-loc">L${d.startLine}:${d.startColumn}</span>
        <span class="problem-msg">${escapeHtml(d.message)}</span>
      `;
      li.addEventListener("click", () => {
        if (monacoEditor) monacoEditor.revealPosition(d.startLine, d.startColumn);
      });
      list.appendChild(li);
    }
  }

  async function saveOrCommitActiveState() {
    const st = selectedStateObj();
    if (!st || !monacoEditor) return;
    const code = monacoEditor.getValue();

    // Instant edit-time check before committing
    const check = monacoEditor.runInstantAnalysis();
    if (check && check.stats.errors > 0) {
      const proceed = window.confirm(
        `Edit-time analyzer found ${check.stats.errors} error(s) in ${st.name}. Commit & Push anyway?`,
      );
      if (!proceed) return;
    }

    bridge.updateNodeAttributes(st.id, { codeCache: code }, `Save Rust code for ${st.name}`);

    if (st.gitOwner && st.gitRepo && state.gitStatus.hasGithubToken) {
      await commitStatesToGitHub([{ ...st, code }]);
    } else {
      state.dirtyStateIds.delete(st.id);
      $("codeDirtyHint").textContent = "Saved to WebGME";
      toast(`Saved ${st.name} to WebGME (bind GitHub repo to Commit & Push)`, "ok");
      renderAll();
    }
  }

  // ---- Initialization ----

  async function init() {
    bindUIEvents();

    // Initialize embedded Monaco Editor with live WebGME IntelliSense & instant edit-time checks
    monacoEditor = new window.MonacoStateEditor($("monacoEditorHost"), {
      onChange() {
        const st = selectedStateObj();
        if (!st) return;
        state.dirtyStateIds.add(st.id);
        $("codeDirtyHint").textContent = "Unsaved edits";
        renderCanvas();
      },
      onDiagnostics(result) {
        renderAnalyzerDiagnostics(result);
      },
      onSaveShortcut() {
        saveOrCommitActiveState();
      },
    });
    monacoEditor.init();

    // Load studio info + rustc health + gitrouter status in parallel
    try {
      const infoRes = await fetch("/routers/studio/api/info", { credentials: "same-origin" });
      state.info = await infoRes.json();
    } catch (_err) {
      state.info = { defaultSeed: "RustySeed" };
    }

    refreshGitStatus();
    refreshRustcHealth();

    try {
      await bridge.connect();
      setBadge("gmeStatusBadge", "WebGME: Connected", "badge-ok");
    } catch (err) {
      setBadge("gmeStatusBadge", "WebGME: Error", "badge-err");
      toast(`WebGME connection failed: ${err.message}`, "err");
      return;
    }

    bridge.onModelChange((machines) => {
      state.machines = machines;
      if (!state.activeMachineId || !machines.some((m) => m.id === state.activeMachineId)) {
        state.activeMachineId = machines[0] ? machines[0].id : null;
      }
      rebuildSimulation(false);
      renderAll();
    });

    await loadProjectListAndOpen();
  }

  function setBadge(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = `badge ${cls}`;
  }

  async function refreshGitStatus() {
    try {
      const st = await gitClient.getStatus();
      state.gitStatus = st;
      if (st.hasGithubToken) {
        setBadge("gitStatusBadge", `GitHub: @${st.githubLogin || st.userId}`, "badge-ok");
      } else if (st.githubAppConfigured) {
        setBadge("gitStatusBadge", "GitHub: Sign in via /profile", "badge-warn");
      } else {
        setBadge("gitStatusBadge", "GitHub: Local Draft Mode", "badge-muted");
      }
    } catch (_err) {
      state.gitStatus = { hasGithubToken: false, githubAppConfigured: false };
      setBadge("gitStatusBadge", "GitHub: Offline", "badge-muted");
    }
  }

  async function refreshRustcHealth() {
    try {
      const res = await fetch("/routers/rustsim/health", { credentials: "same-origin" });
      const data = await res.json();
      if (data.available) {
        setBadge("rustcBadge", data.rustc || "rustc ready", "badge-ok");
      } else {
        setBadge("rustcBadge", "rustc unavailable", "badge-warn");
      }
    } catch (_err) {
      setBadge("rustcBadge", "rustsim offline", "badge-muted");
    }
  }

  async function loadProjectListAndOpen() {
    const projects = await bridge.listProjects();
    state.projects = projects;
    renderProjectSelect();

    if (projects.length === 0) {
      // Auto-create starter RustyDemo project from RustySeed on first run!
      try {
        toast("Creating starter project 'RustyDemo' from RustySeed…", "ok");
        const created = await bridge.createProjectFromSeed("RustyDemo", state.info.defaultSeed || "RustySeed");
        state.projects = await bridge.listProjects();
        renderProjectSelect();
        const pid = created.projectId || (state.projects[0] && state.projects[0]._id);
        if (pid) {
          $("projectSelect").value = pid;
          await openSelectedProject(pid);
        }
      } catch (err) {
        toast(`Could not auto-create starter project: ${err.message}`, "warn");
      }
      return;
    }

    const firstId = projects[0]._id;
    $("projectSelect").value = firstId;
    await openSelectedProject(firstId);
  }

  async function openSelectedProject(projectId) {
    if (!projectId) return;
    try {
      await bridge.openProject(projectId, "master");
      $("linkWebGME").href = `/?project=${encodeURIComponent(projectId)}`;
      toast(`Opened WebGME project ${projectId}`, "ok");
    } catch (err) {
      toast(`Failed to open project: ${err.message}`, "err");
    }
  }

  // ---- Rendering ----

  function renderProjectSelect() {
    const sel = $("projectSelect");
    sel.innerHTML = "";
    for (const p of state.projects) {
      const opt = document.createElement("option");
      opt.value = p._id;
      opt.textContent = `${p.owner}/${p.name}`;
      sel.appendChild(opt);
    }
  }

  function renderAll() {
    renderMachineSelect();
    renderGitBar();
    renderSidebar();
    renderCanvas();
    renderInspector();
    renderCrateViewer();
    renderSimulator();
  }

  function renderMachineSelect() {
    const sel = $("machineSelect");
    sel.innerHTML = "";
    for (const m of state.machines) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      if (m.id === state.activeMachineId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function renderGitBar() {
    const m = activeMachine();
    if (!m || !m.gitOwner || !m.gitRepo) {
      $("machineRepoDisplay").textContent = "Unbound (local draft)";
    } else {
      $("machineRepoDisplay").textContent = `${m.gitOwner}/${m.gitRepo}@${m.gitBranch || "main"}`;
    }
  }

  function renderSidebar() {
    const m = activeMachine();
    const stateList = $("stateList");
    const globalList = $("globalList");
    const eventList = $("eventList");
    stateList.innerHTML = "";
    globalList.innerHTML = "";
    eventList.innerHTML = "";
    if (!m) return;

    for (const st of m.states) {
      const li = document.createElement("li");
      const isSel = state.selectedType === "state" && state.selectedId === st.id;
      li.className = `item-row${isSel ? " selected" : ""}`;
      const dotCls = state.dirtyStateIds.has(st.id)
        ? "dot-dirty"
        : st.gitBaseCommitSha
          ? "dot-synced"
          : "dot-local";
      li.innerHTML = `
        <div class="item-main">
          <span class="dot ${dotCls}" title="${dotCls.replace("dot-", "")}"></span>
          <span class="item-name">${escapeHtml(st.name)}</span>
        </div>
        <span class="item-sub">${st.isInitial ? "INIT" : ""}</span>
      `;
      li.addEventListener("click", () => {
        selectStateForEditing(st.id);
      });
      stateList.appendChild(li);
    }

    for (const g of m.globals) {
      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="item-main">
          <span class="item-name">${escapeHtml(g.name)}</span>
          <span class="item-sub">${escapeHtml(g.rustType)} = ${escapeHtml(g.initialValue)}</span>
        </div>
        <button class="btn btn-xs" title="Delete GlobalVar">✕</button>
      `;
      li.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        bridge.deleteNode(g.id, g.name);
      });
      globalList.appendChild(li);
    }

    const suggestions = $("eventNameSuggestions");
    suggestions.innerHTML = "";
    for (const ev of m.events) {
      const opt = document.createElement("option");
      opt.value = ev.name;
      suggestions.appendChild(opt);

      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="item-main">
          <span class="item-name">${escapeHtml(ev.name)}</span>
          <span class="item-sub">${ev.payloadType ? `(${escapeHtml(ev.payloadType)})` : ""}</span>
        </div>
        <button class="btn btn-xs" title="Delete EventDef">✕</button>
      `;
      li.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        bridge.deleteNode(ev.id, ev.name);
      });
      eventList.appendChild(li);
    }
  }

  function renderCanvas() {
    const m = activeMachine();
    const snap = state.sim ? state.sim.getSnapshot() : null;
    canvas.setState({
      model: m,
      selectedType: state.selectedType,
      selectedId: state.selectedId,
      connectMode: state.connectMode,
      connectSourceId: state.connectSourceId,
      simActiveStateName: snap ? snap.currentState : null,
      simLastTransitionId: state.simLastTransitionId,
      dirtyStateIds: state.dirtyStateIds,
    });

    if (snap && snap.currentState) {
      $("simActiveBanner").classList.remove("hidden");
      $("simActiveStateName").textContent = snap.currentState;
    } else {
      $("simActiveBanner").classList.add("hidden");
    }
  }

  function renderInspector() {
    const st = selectedStateObj();
    const tr = selectedTransitionObj();

    $("inspectorEmpty").classList.toggle("hidden", Boolean(st || tr));
    $("stateInspector").classList.toggle("hidden", !st);
    $("transitionInspector").classList.toggle("hidden", !tr);

    if (st) {
      $("statePathHint").textContent = st.id;
      $("inpStateName").value = st.name;
      $("inpStateColor").value = st.color || "#38bdf8";
      $("inpStateDesc").value = st.description || "";
      $("inpStateInitial").checked = Boolean(st.isInitial);
      $("inpStateFinal").checked = Boolean(st.isFinal);
      $("inpGitOwner").value = st.gitOwner || "";
      $("inpGitRepo").value = st.gitRepo || "";
      $("inpGitBranch").value = st.gitBranch || "main";
      $("inpGitPath").value = st.gitPath || RustyContract.defaultStatePath(st.name);
      $("stateShaDisplay").textContent = st.gitBaseCommitSha ? st.gitBaseCommitSha.slice(0, 12) : "none";

      if (state.dirtyStateIds.has(st.id)) {
        setBadge("stateSyncBadge", "Modified (unsynced)", "badge-warn");
      } else if (st.gitBaseCommitSha) {
        setBadge("stateSyncBadge", "Synced with GitHub", "badge-ok");
      } else {
        setBadge("stateSyncBadge", "Local Draft", "badge-muted");
      }

      if (monacoEditor) {
        const m = activeMachine();
        monacoEditor.setContext(m, st);
        if (state.editorLoadedStateId !== st.id || !state.dirtyStateIds.has(st.id)) {
          state.editorLoadedStateId = st.id;
          monacoEditor.setValue(st.code || RustyContract.defaultStateCode(st.name, []), st.id);
        }
        setTimeout(() => monacoEditor.layout(), 20);
      }
      $("codeDirtyHint").textContent = state.dirtyStateIds.has(st.id) ? "Unsaved edits" : "";
    }

    if (tr) {
      $("transRouteHint").textContent = `${tr.srcName} → ${tr.dstName}`;
      $("inpTransName").value = tr.name;
      $("inpTransEvent").value = tr.event;
      $("inpTransPriority").value = tr.priority;
      $("inpTransGuard").value = tr.guard || "";
      $("inpTransAction").value = tr.action || "";
    }
  }

  function renderCrateViewer() {
    const m = activeMachine();
    const list = $("crateFileList");
    list.innerHTML = "";
    if (!m) {
      $("crateCodePreview").textContent = "";
      return;
    }

    const files = RustyCodegen.generateCrateFiles(m);
    const names = Object.keys(files);
    if (!files[state.activeCrateFile]) {
      state.activeCrateFile = names[0] || "Cargo.toml";
    }

    for (const f of names) {
      const li = document.createElement("li");
      li.textContent = f;
      if (f === state.activeCrateFile) li.className = "active";
      li.addEventListener("click", () => {
        state.activeCrateFile = f;
        renderCrateViewer();
      });
      list.appendChild(li);
    }

    $("crateFileTitle").textContent = state.activeCrateFile;
    $("crateCodePreview").textContent = files[state.activeCrateFile] || "";
  }

  // ---- Dynamic Simulator ----

  function rebuildSimulation(resetTrace = true) {
    const m = activeMachine();
    if (!m || m.states.length === 0) {
      state.sim = null;
      return;
    }
    if (!state.sim || resetTrace) {
      state.sim = RustySimEngine.createSimulation(m);
      state.simLastTransitionId = null;
      state.simTickMs = m.tickMs || 800;
      $("simSpeedRange").value = state.simTickMs;
      $("simSpeedLabel").textContent = `${state.simTickMs}ms`;
    } else {
      // Rebuild with latest model & code while keeping fresh state
      state.sim = RustySimEngine.createSimulation(m);
    }
  }

  function renderSimulator() {
    const m = activeMachine();
    if (!m || !state.sim) return;
    const snap = state.sim.getSnapshot();

    $("simStateBig").textContent = snap.currentState || "—";
    $("simStepCount").textContent = String(snap.stepCount);

    // Event Injector buttons
    const btnHost = $("simEventButtons");
    btnHost.innerHTML = "";
    for (const ev of m.events) {
      const btn = document.createElement("button");
      btn.className = "btn btn-xs btn-primary";
      btn.textContent = ev.payloadType ? `${ev.name}(${ev.payloadType})` : ev.name;
      btn.title = ev.description || `Dispatch Event::${ev.name}`;
      btn.addEventListener("click", () => {
        let payload;
        if (ev.payloadType) {
          const raw = window.prompt(`Payload (${ev.payloadType}) for ${ev.name}:`, "0");
          if (raw === null) return;
          payload = ev.payloadType === "bool" ? raw === "true" : ev.payloadType === "String" ? raw : Number(raw);
        }
        dispatchSimEvent(ev.name, payload);
      });
      btnHost.appendChild(btn);
    }

    // Live Globals table
    const lastEntry = snap.trace[snap.trace.length - 1];
    const lastDiff = (lastEntry && lastEntry.diff) || {};
    const tbody = $("simGlobalsBody");
    tbody.innerHTML = "";
    for (const g of m.globals) {
      const key = RustyContract.toSnakeCase(g.name);
      const val = snap.globals[key];
      const changed = Object.prototype.hasOwnProperty.call(lastDiff, key);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(key)}</td>
        <td class="muted">${escapeHtml(g.rustType)}</td>
        <td><button class="global-val-btn${changed ? " changed" : ""}" title="Click to override value">${escapeHtml(String(val))}</button></td>
      `;
      tr.querySelector("button").addEventListener("click", () => {
        const nextRaw = window.prompt(`Override globals.${key} (${g.rustType}):`, String(val));
        if (nextRaw === null) return;
        let parsed = nextRaw;
        if (g.rustType === "bool") parsed = nextRaw === "true";
        else if (g.rustType !== "String") parsed = Number(nextRaw);
        state.sim.setGlobal(key, parsed);
        renderSimulator();
      });
      tbody.appendChild(tr);
    }

    // Execution Trace (newest first)
    const traceUl = $("simTraceList");
    traceUl.innerHTML = "";
    for (const entry of [...snap.trace].reverse().slice(0, 40)) {
      const li = document.createElement("li");
      li.className = "trace-item";
      const diffParts = Object.entries(entry.diff || {}).map(([k, d]) => `${k}: ${d.before}→${d.after}`);
      const arrow = entry.fromState === entry.toState ? `${entry.toState} (stay)` : `${entry.fromState} → ${entry.toState}`;
      li.innerHTML = `
        <div class="trace-head">
          <span>#${entry.step} <strong>${escapeHtml(entry.event)}</strong></span>
          <span>${escapeHtml(arrow)}</span>
        </div>
        ${diffParts.length ? `<div class="trace-diff">${escapeHtml(diffParts.join(" · "))}</div>` : ""}
        ${entry.logs && entry.logs.length ? `<div class="trace-diff" style="color:#f87171">${escapeHtml(entry.logs.join("; "))}</div>` : ""}
      `;
      traceUl.appendChild(li);
    }
  }

  function dispatchSimEvent(eventName, payload) {
    if (!state.sim) rebuildSimulation(true);
    const { entry } = state.sim.dispatch(eventName, payload);
    state.simLastTransitionId = entry.fromState !== entry.toState ? entry.transitionId : null;
    renderCanvas();
    renderSimulator();
  }

  function startAutoTick() {
    stopAutoTick();
    $("btnSimPlay").classList.add("hidden");
    $("btnSimPause").classList.remove("hidden");
    state.simTimer = setInterval(() => {
      dispatchSimEvent("Tick");
    }, state.simTickMs);
  }

  function stopAutoTick() {
    if (state.simTimer) {
      clearInterval(state.simTimer);
      state.simTimer = null;
    }
    $("btnSimPlay").classList.remove("hidden");
    $("btnSimPause").classList.add("hidden");
  }

  // ---- GitHub Sync Operations (webgme-git) ----

  async function pullStateFromGitHub(st, opts = {}) {
    if (!st.gitOwner || !st.gitRepo || !st.gitPath) {
      if (!opts.silentNotFound) toast("Bind gitOwner, gitRepo, and gitPath first", "warn");
      return;
    }
    const statusEl = $("gitFetchStatus");
    if (statusEl) statusEl.textContent = "Fetching from GitHub…";
    try {
      const file = await gitClient.fetchFile({
        owner: st.gitOwner,
        repo: st.gitRepo,
        path: st.gitPath,
        ref: st.gitBranch || "main",
        projectId: bridge.projectId,
      });
      if (file.type !== "file") {
        if (statusEl) statusEl.textContent = "";
        toast(`Path ${st.gitPath} is a directory, expected file`, "warn");
        return;
      }
      state.fetchedStateIds.add(st.id);
      state.dirtyStateIds.delete(st.id);
      bridge.updateNodeAttributes(
        st.id,
        { codeCache: file.content },
        `Pull ${st.gitPath} from GitHub`,
      );
      if (monacoEditor && state.selectedId === st.id) {
        monacoEditor.setValue(file.content, st.id);
      }
      if (statusEl) statusEl.textContent = "Loaded from GitHub";
      toast(`Fetched ${st.gitPath} from ${st.gitOwner}/${st.gitRepo}`, "ok");
    } catch (err) {
      if (err.status === 404 && opts.silentNotFound) {
        state.fetchedStateIds.add(st.id);
        if (statusEl) statusEl.textContent = "New file (will be created on push)";
        return;
      }
      if (statusEl) statusEl.textContent = "";
      toast(`Pull failed: ${err.message}`, "err");
    }
  }

  async function commitStatesToGitHub(statesToCommit, customMessage) {
    if (!statesToCommit.length) {
      toast("No states to commit", "warn");
      return;
    }
    const first = statesToCommit[0];
    if (!first.gitOwner || !first.gitRepo) {
      toast("Bind a GitHub repository first (click 'Bind GitHub Repo…')", "warn");
      return;
    }

    const changes = statesToCommit.map((st) => ({
      path: st.gitPath || RustyContract.defaultStatePath(st.name),
      content: st.code || RustyContract.defaultStateCode(st.name, []),
      mode: "100644",
    }));

    const message =
      customMessage ||
      `rusty: update ${statesToCommit.map((s) => s.name).join(", ")}`;

    try {
      const res = await gitClient.commit({
        owner: first.gitOwner,
        repo: first.gitRepo,
        branch: first.gitBranch || "main",
        expectedParentSha: first.gitBaseCommitSha || undefined,
        message,
        changes,
        projectId: bridge.projectId,
      });

      if (res.conflict) {
        openConflictModal(res.body, {
          owner: first.gitOwner,
          repo: first.gitRepo,
          branch: first.gitBranch || "main",
          states: statesToCommit,
          message,
        });
        return;
      }

      // Persist newCommitSha back to WebGME State nodes inside a single transaction!
      bridge.runTransaction(`Sync gitBaseCommitSha (${res.newCommitSha.slice(0, 7)})`, () => {
        for (const st of statesToCommit) {
          bridge.client.setAttribute(st.id, "gitBaseCommitSha", res.newCommitSha);
          state.dirtyStateIds.delete(st.id);
        }
      });

      if (res.rebased) {
        toast(`Committed ${res.newCommitSha.slice(0, 7)} (transparently rebased over upstream changes!)`, "warn");
      } else {
        toast(`Committed ${changes.length} file(s) → ${res.newCommitSha.slice(0, 7)}`, "ok");
      }
      renderAll();
    } catch (err) {
      toast(`GitHub commit failed: ${err.message}`, "err");
    }
  }

  function openConflictModal(body, ctx) {
    const conflict = (body.conflicts && body.conflicts[0]) || { path: "", base: "", upstream: "", local: "" };
    state.pendingConflict = { body, ctx, conflict };
    $("conflictHeadSha").textContent = (body.currentHeadSha || "").slice(0, 12);
    $("conflictPath").textContent = conflict.path;
    $("conflictBase").textContent = conflict.base || "";
    $("conflictUpstream").textContent = conflict.upstream || "";
    $("conflictLocal").textContent = conflict.local || "";
    $("conflictResolved").value = conflict.local || "";
    $("conflictModal").classList.remove("hidden");
  }

  // ---- Rustc Verification & Native Trace ----

  async function runRustcCheck() {
    const m = activeMachine();
    if (!m) return;
    $("diagDrawer").classList.remove("hidden");
    $("diagTitle").textContent = `Running cargo check on ${m.name}…`;
    $("diagOutput").textContent = "Compiling generated Rust crate…";

    try {
      const res = await fetch("/routers/rustsim/check", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m }),
      });
      const data = await res.json();
      const activeSt = selectedStateObj();
      if (monacoEditor && activeSt) {
        const expectedPath = `src/states/${RustyContract.toSnakeCase(activeSt.name)}.rs`;
        monacoEditor.setRustcMarkers(data.diagnostics || [], expectedPath);
      }
      if (data.ok) {
        $("diagTitle").textContent = `✓ cargo check passed (${data.durationMs}ms · ${data.fileCount} files)`;
        const warnings = (data.diagnostics || []).map((d) => d.rendered).join("\n");
        $("diagOutput").textContent = warnings || "Zero errors, zero warnings. Generated Rust crate compiles cleanly!";
        toast(`rustc verified ${m.name} in ${data.durationMs}ms`, "ok");
      } else {
        $("diagTitle").textContent = `✕ cargo check failed (${data.durationMs}ms)`;
        const rendered = (data.diagnostics || []).map((d) => d.rendered).join("\n") || data.rawStderr || data.error;
        $("diagOutput").textContent = rendered;
        toast("rustc reported compilation errors (see diagnostics drawer)", "err");
      }
    } catch (err) {
      $("diagTitle").textContent = "✕ rustsim error";
      $("diagOutput").textContent = err.message;
    }
  }

  async function verifyTraceInNativeRust() {
    const m = activeMachine();
    if (!m || !state.sim) return;
    const snap = state.sim.getSnapshot();
    const events = snap.trace
      .filter((t) => t.event !== "__init__")
      .map((t) => (t.payload !== null && t.payload !== undefined ? `${t.event}:${t.payload}` : t.event));

    const banner = $("nativeVerifyBanner");
    banner.classList.remove("hidden", "ok", "err");
    banner.textContent = `Compiling & running native Rust binary for ${events.length} event(s)…`;

    try {
      const res = await fetch("/routers/rustsim/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, events }),
      });
      const data = await res.json();
      if (!data.ok) {
        banner.classList.add("err");
        banner.textContent = `Native Rust run failed: ${data.rawStderr || data.error}`;
        return;
      }

      const nativeLast = data.trace[data.trace.length - 1];
      const matches = nativeLast && nativeLast.to === snap.currentState;
      banner.classList.add(matches ? "ok" : "err");
      banner.textContent = matches
        ? `✓ Native Rust matches browser sim! Final state: ${nativeLast.to} (${data.durationMs}ms)`
        : `⚠ Divergence: browser=${snap.currentState}, native Rust=${nativeLast ? nativeLast.to : "?"}`;
    } catch (err) {
      banner.classList.add("err");
      banner.textContent = `Error: ${err.message}`;
    }
  }

  // ---- UI Event Wiring ----

  function bindUIEvents() {
    // Center tabs
    document.querySelectorAll("[data-center-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-center-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.centerTab;
        $("tabCanvas").classList.toggle("active", tab === "canvas");
        $("tabCrate").classList.toggle("active", tab === "crate");
        $("canvasToolbar").classList.toggle("hidden", tab !== "canvas");
      });
    });

    // Right tabs
    document.querySelectorAll("[data-right-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-right-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.rightTab;
        $("tabInspector").classList.toggle("active", tab === "inspector");
        $("tabSimulator").classList.toggle("active", tab === "simulator");
      });
    });

    // Project & Machine switching
    $("projectSelect").addEventListener("change", (e) => openSelectedProject(e.target.value));
    $("machineSelect").addEventListener("change", (e) => {
      state.activeMachineId = e.target.value;
      state.selectedType = null;
      state.selectedId = null;
      rebuildSimulation(true);
      renderAll();
    });

    $("btnNewProject").addEventListener("click", async () => {
      const name = window.prompt("New WebGME Project Name (seeded from RustySeed):", "MyRustMachine");
      if (!name || !name.trim()) return;
      try {
        const res = await bridge.createProjectFromSeed(name.trim(), state.info.defaultSeed || "RustySeed");
        state.projects = await bridge.listProjects();
        renderProjectSelect();
        $("projectSelect").value = res.projectId;
        await openSelectedProject(res.projectId);
      } catch (err) {
        toast(`Failed to create project: ${err.message}`, "err");
      }
    });

    $("btnNewMachine").addEventListener("click", () => {
      const name = window.prompt("New StateMachine name:", "MotorController");
      if (!name || !name.trim()) return;
      const id = bridge.createStateMachine(name.trim());
      state.activeMachineId = id;
      toast(`Created StateMachine ${name.trim()}`, "ok");
    });

    // Sidebar Add buttons
    $("btnAddState").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      const name = window.prompt("New State name (PascalCase):", `State${m.states.length + 1}`);
      if (!name || !name.trim()) return;
      const idx = m.states.length;
      const id = bridge.createState(m.id, {
        name: name.trim(),
        isInitial: idx === 0,
        gitOwner: m.gitOwner,
        gitRepo: m.gitRepo,
        gitBranch: m.gitBranch || "main",
        gitPath: `${(m.gitPath || "src/states").replace(/\/+$/, "")}/${RustyContract.toSnakeCase(name.trim())}.rs`,
        position: { x: 120 + (idx % 3) * 230, y: 100 + Math.floor(idx / 3) * 140 },
      });
      state.selectedType = "state";
      state.selectedId = id;
    });

    $("btnAddGlobal").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      const name = window.prompt("Global variable name (snake_case):", "counter");
      if (!name || !name.trim()) return;
      const rustType = window.prompt("Rust type (bool, i32, i64, u32, f64, String):", "u32") || "u32";
      const initialValue = window.prompt("Initial value:", rustType === "bool" ? "false" : "0") || "0";
      bridge.createGlobalVar(m.id, { name: name.trim(), rustType: rustType.trim(), initialValue: initialValue.trim() });
    });

    $("btnAddEvent").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      const name = window.prompt("Event variant name (PascalCase):", "ButtonPressed");
      if (!name || !name.trim()) return;
      const payloadType = window.prompt("Optional payload type (leave empty for unit event, or i32/f64/bool/String):", "") || "";
      bridge.createEventDef(m.id, { name: name.trim(), payloadType: payloadType.trim() });
    });

    // Canvas toolbar
    $("btnConnectMode").addEventListener("click", () => {
      state.connectMode = !state.connectMode;
      state.connectSourceId = null;
      $("btnConnectMode").classList.toggle("btn-active", state.connectMode);
      if (state.connectMode) toast("Click source state, then destination state", "ok");
    });

    $("btnAutoLayout").addEventListener("click", () => {
      const m = activeMachine();
      if (!m || !m.states.length) return;
      const positions = {};
      const cx = 390;
      const cy = 210;
      const rx = 250;
      const ry = 135;
      m.states.forEach((st, i) => {
        const angle = (2 * Math.PI * i) / m.states.length - Math.PI / 2;
        positions[st.id] = {
          x: Math.max(40, cx + rx * Math.cos(angle) - 86),
          y: Math.max(40, cy + ry * Math.sin(angle) - 34),
        };
      });
      bridge.updateStatePositions(positions);
      toast("Saved auto-layout positions to WebGME", "ok");
    });

    // State Inspector actions
    $("btnSaveStateMeta").addEventListener("click", () => {
      const st = selectedStateObj();
      if (!st) return;
      bridge.updateNodeAttributes(
        st.id,
        {
          name: $("inpStateName").value.trim() || st.name,
          color: $("inpStateColor").value,
          description: $("inpStateDesc").value,
          isInitial: $("inpStateInitial").checked,
          isFinal: $("inpStateFinal").checked,
          gitOwner: $("inpGitOwner").value.trim(),
          gitRepo: $("inpGitRepo").value.trim(),
          gitBranch: $("inpGitBranch").value.trim() || "main",
          gitPath: $("inpGitPath").value.trim(),
        },
        `Update State ${st.name}`,
      );
      toast(`Saved ${st.name} to WebGME`, "ok");
    });

    $("btnExpandEditor").addEventListener("click", () => {
      const ws = document.querySelector(".workspace");
      const expanded = ws.classList.toggle("editor-expanded");
      $("btnExpandEditor").textContent = expanded ? "⇒ Narrow" : "⇔ Wide";
      if (monacoEditor) setTimeout(() => monacoEditor.layout(), 180);
    });

    $("btnSaveCodeCache").addEventListener("click", () => {
      const st = selectedStateObj();
      if (!st || !monacoEditor) return;
      const code = monacoEditor.getValue();
      bridge.updateNodeAttributes(st.id, { codeCache: code }, `Update Rust code for ${st.name}`);
      state.dirtyStateIds.delete(st.id);
      $("codeDirtyHint").textContent = "Saved to WebGME";
      toast(`Saved draft Rust code for ${st.name} to WebGME`, "ok");
    });

    $("btnResetStateTemplate").addEventListener("click", () => {
      const m = activeMachine();
      const st = selectedStateObj();
      if (!m || !st || !monacoEditor) return;
      const outgoing = m.transitions.filter((t) => t.srcId === st.id);
      monacoEditor.setValue(RustyContract.defaultStateCode(st.name, outgoing), st.id);
      state.dirtyStateIds.add(st.id);
      $("codeDirtyHint").textContent = "Template inserted (unsaved)";
    });

    $("btnDeleteState").addEventListener("click", () => {
      const st = selectedStateObj();
      if (!st) return;
      if (!window.confirm(`Delete state "${st.name}" from WebGME?`)) return;
      bridge.deleteNode(st.id, st.name);
      state.selectedType = null;
      state.selectedId = null;
    });

    $("btnPullState").addEventListener("click", () => {
      const st = selectedStateObj();
      if (st) pullStateFromGitHub(st);
    });

    $("btnCommitState").addEventListener("click", () => {
      saveOrCommitActiveState();
    });

    // Transition Inspector actions
    $("btnSaveTransition").addEventListener("click", () => {
      const tr = selectedTransitionObj();
      if (!tr) return;
      bridge.updateNodeAttributes(
        tr.id,
        {
          name: $("inpTransName").value.trim() || tr.name,
          event: $("inpTransEvent").value.trim() || "Tick",
          priority: Number($("inpTransPriority").value || 1),
          guard: $("inpTransGuard").value.trim(),
          action: $("inpTransAction").value.trim(),
        },
        `Update Transition ${tr.name}`,
      );
      toast("Saved transition to WebGME", "ok");
    });

    $("btnDeleteTransition").addEventListener("click", () => {
      const tr = selectedTransitionObj();
      if (!tr) return;
      bridge.deleteNode(tr.id, tr.name);
      state.selectedType = null;
      state.selectedId = null;
    });

    // GitBar actions
    $("btnPickRepo").addEventListener("click", openRepoModal);
    $("btnConfirmRepoBind").addEventListener("click", confirmRepoBind);
    $("btnPullAll").addEventListener("click", async () => {
      const m = activeMachine();
      if (!m) return;
      for (const st of m.states) {
        if (st.gitOwner && st.gitRepo && st.gitPath) {
          await pullStateFromGitHub(st);
        }
      }
    });
    $("btnSyncAll").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      commitStatesToGitHub(m.states, `rusty: sync all ${m.states.length} states for ${m.name}`);
    });
    $("btnPushCrate").addEventListener("click", async () => {
      const m = activeMachine();
      if (!m || !m.gitOwner || !m.gitRepo) {
        toast("Bind a GitHub repository first", "warn");
        return;
      }
      const files = RustyCodegen.generateCrateFiles(m);
      const changes = Object.entries(files).map(([path, content]) => ({
        path,
        content,
        mode: "100644",
      }));
      try {
        const res = await gitClient.commit({
          owner: m.gitOwner,
          repo: m.gitRepo,
          branch: m.gitBranch || "main",
          message: `rusty: push generated crate ${m.crateName}`,
          changes,
          projectId: bridge.projectId,
        });
        if (res.conflict) {
          openConflictModal(res.body, {
            owner: m.gitOwner,
            repo: m.gitRepo,
            branch: m.gitBranch || "main",
            states: m.states,
            message: `rusty: push generated crate ${m.crateName}`,
          });
          return;
        }
        toast(`Pushed full Rust crate (${changes.length} files) → ${res.newCommitSha.slice(0, 7)}`, "ok");
      } catch (err) {
        toast(`Push failed: ${err.message}`, "err");
      }
    });

    // Rustc & Crate actions
    $("btnRustCheck").addEventListener("click", runRustcCheck);
    $("btnCloseDiag").addEventListener("click", () => $("diagDrawer").classList.add("hidden"));
    $("btnDownloadCrate").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      const files = RustyCodegen.generateCrateFiles(m);
      const blob = new Blob([JSON.stringify(files, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${RustyContract.toCrateName(m.crateName || m.name)}-crate.json`;
      a.click();
    });

    // Simulator controls
    $("btnSimPlay").addEventListener("click", startAutoTick);
    $("btnSimPause").addEventListener("click", stopAutoTick);
    $("btnSimStepTick").addEventListener("click", () => dispatchSimEvent("Tick"));
    $("btnSimReset").addEventListener("click", () => {
      stopAutoTick();
      rebuildSimulation(true);
      $("nativeVerifyBanner").classList.add("hidden");
      renderCanvas();
      renderSimulator();
    });
    $("simSpeedRange").addEventListener("input", (e) => {
      state.simTickMs = Number(e.target.value);
      $("simSpeedLabel").textContent = `${state.simTickMs}ms`;
      if (state.simTimer) startAutoTick();
    });
    $("btnVerifyNativeTrace").addEventListener("click", verifyTraceInNativeRust);

    // Conflict modal buttons
    $("btnUseUpstream").addEventListener("click", () => {
      if (state.pendingConflict) $("conflictResolved").value = state.pendingConflict.conflict.upstream || "";
    });
    $("btnUseLocal").addEventListener("click", () => {
      if (state.pendingConflict) $("conflictResolved").value = state.pendingConflict.conflict.local || "";
    });
    $("btnResolveConflictCommit").addEventListener("click", async () => {
      if (!state.pendingConflict) return;
      const { body, ctx, conflict } = state.pendingConflict;
      const resolved = $("conflictResolved").value;
      try {
        const res = await gitClient.commit({
          owner: ctx.owner,
          repo: ctx.repo,
          branch: ctx.branch,
          expectedParentSha: body.currentHeadSha,
          message: `${ctx.message} (resolved merge conflict)`,
          changes: [{ path: conflict.path, content: resolved, mode: "100644" }],
          projectId: bridge.projectId,
        });
        if (res.conflict) {
          toast("Upstream moved again; please review new conflict", "warn");
          openConflictModal(res.body, ctx);
          return;
        }
        $("conflictModal").classList.add("hidden");
        state.pendingConflict = null;
        toast(`Conflict resolved & committed → ${res.newCommitSha.slice(0, 7)}`, "ok");
      } catch (err) {
        toast(`Failed to commit resolution: ${err.message}`, "err");
      }
    });

    // Generic modal close buttons
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => $(btn.dataset.closeModal).classList.add("hidden"));
    });
  }

  async function openRepoModal() {
    const m = activeMachine();
    if (!m) return;
    $("modalGitOwner").value = m.gitOwner || "";
    $("modalGitRepo").value = m.gitRepo || "";
    $("modalGitBranch").value = m.gitBranch || "main";
    $("modalGitDir").value = m.gitPath || "src/states";
    $("repoModal").classList.remove("hidden");

    const dropdown = $("repoDropdown");
    dropdown.innerHTML = '<option value="">— Loading installed repos… —</option>';
    $("repoPickerStatus").textContent = "Querying /routers/gitrouter/repos…";

    try {
      const repos = await gitClient.listRepos();
      dropdown.innerHTML = '<option value="">— Select a repository —</option>';
      for (const r of repos) {
        const opt = document.createElement("option");
        opt.value = JSON.stringify({ owner: r.owner, name: r.name, branch: r.default_branch || "main" });
        opt.textContent = `${r.full_name}${r.private ? " (private)" : ""}`;
        dropdown.appendChild(opt);
      }
      $("repoPickerStatus").textContent = `Found ${repos.length} installed repo(s).`;
      dropdown.onchange = async () => {
        if (!dropdown.value) return;
        const picked = JSON.parse(dropdown.value);
        $("modalGitOwner").value = picked.owner;
        $("modalGitRepo").value = picked.name;
        $("modalGitBranch").value = picked.branch;
        try {
          const refs = await gitClient.listRefs(picked.owner, picked.name, bridge.projectId);
          const dl = $("branchSuggestions");
          dl.innerHTML = "";
          for (const rf of refs) {
            if (rf.ref.startsWith("refs/heads/")) {
              const opt = document.createElement("option");
              opt.value = rf.ref.replace("refs/heads/", "");
              dl.appendChild(opt);
            }
          }
        } catch (_err) {
          // ignore
        }
      };
    } catch (err) {
      dropdown.innerHTML = '<option value="">(Sign in via /profile to browse repos)</option>';
      $("repoPickerStatus").textContent = err.message;
    }
  }

  function confirmRepoBind() {
    const m = activeMachine();
    if (!m) return;
    const gitOwner = $("modalGitOwner").value.trim();
    const gitRepo = $("modalGitRepo").value.trim();
    const gitBranch = $("modalGitBranch").value.trim() || "main";
    const gitPath = $("modalGitDir").value.trim() || "src/states";
    const applyAll = $("modalApplyToAllStates").checked;

    bridge.bindMachineRepo(m.id, {
      gitOwner,
      gitRepo,
      gitBranch,
      gitPath,
      applyToStateIds: applyAll ? m.states : [],
    });
    $("repoModal").classList.add("hidden");
    toast(`Bound ${gitOwner}/${gitRepo}@${gitBranch} in WebGME`, "ok");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  init();
})();
