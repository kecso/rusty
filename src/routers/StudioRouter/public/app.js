(function () {
  "use strict";

  const bridge = new window.WebGMEBridge();
  const gitClient = new window.GitSyncClient("/routers/gitrouter");
  const {
    RustyContract,
    RustyGuardLang,
    RustyCodegen,
    RustySimEngine,
    RustyAnalyzer,
    RustyImporter,
    StateMachineCanvas,
  } = window;

  const state = {
    info: null,
    gitStatus: { hasGithubToken: false, githubAppConfigured: false },
    projects: [],
    machines: [],
    activeMachineId: null,
    selectedType: null, // 'state' | 'transition' | null
    selectedId: null,
    stateHookTab: "entry", // 'entry' | 'exit' | 'transitions'
    transSubTab: "guard", // 'guard' | 'action'
    connectMode: false,
    connectSourceId: null,
    dirtyStateIds: new Set(),
    dirtyTransIds: new Set(),
    draftEntryByStateId: new Map(),
    draftExitByStateId: new Map(),
    draftActionByTransId: new Map(),
    fetchedStateIds: new Set(),
    editorLoadedHookKey: null,
    transLoadedActionKey: null,
    activeCrateFile: "Cargo.toml",
    // Layout & UI visibility
    leftHidden: false,
    rightHidden: false,
    collapsedSections: new Set(),
    layoutDirection: "LR",
    compactLabels: true,
    highlightEventName: null,
    impact: null,
    // Simulator state
    sim: null,
    simTimer: null,
    simTickMs: 800,
    simLastTransitionId: null,
    // Active modals
    pendingConflict: null,
    elementModalConfirm: null,
    lastReadOnlyToastAt: 0,
  };

  const $ = (id) => document.getElementById(id);
  let monacoEditor = null;
  let transActionEditor = null;

  function toast(msg, kind = "ok") {
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.textContent = msg;
    $("toastStack").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function notifyReadOnlyBlocked() {
    const now = Date.now();
    if (now - state.lastReadOnlyToastAt < 1800) return;
    state.lastReadOnlyToastAt = now;
    toast("Surrounding module lines are generated and read-only — edit inside the highlighted hook body", "warn");
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

  function getLiveStateHookBody(st, kind) {
    if (!st) return "";
    if (kind === "entry") {
      return state.draftEntryByStateId.has(st.id) ? state.draftEntryByStateId.get(st.id) : st.entryCode || "";
    }
    return state.draftExitByStateId.has(st.id) ? state.draftExitByStateId.get(st.id) : st.exitCode || "";
  }

  function getLiveTransitionAction(tr) {
    if (!tr) return "";
    return state.draftActionByTransId.has(tr.id) ? state.draftActionByTransId.get(tr.id) : tr.action || "";
  }

  function openElementModal({ title, fields, confirmLabel = "Save", onConfirm }) {
    $("elementModalTitle").textContent = title;
    $("btnConfirmElementModal").textContent = confirmLabel;
    const body = $("elementModalBody");
    body.innerHTML = "";

    for (const f of fields) {
      const wrap = document.createElement("label");
      wrap.className = "form-row";
      const span = document.createElement("span");
      span.textContent = f.label;
      wrap.appendChild(span);

      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const optVal of f.options || []) {
          const opt = document.createElement("option");
          opt.value = optVal;
          opt.textContent = optVal || "(none — unit event)";
          if (optVal === (f.value ?? "")) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = f.type || "text";
        input.value = f.value ?? "";
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      input.id = `em_${f.name}`;
      wrap.appendChild(input);
      body.appendChild(wrap);
    }

    state.elementModalConfirm = () => {
      const values = {};
      for (const f of fields) {
        values[f.name] = $(`em_${f.name}`).value;
      }
      if (onConfirm(values) !== false) {
        $("elementModal").classList.add("hidden");
        state.elementModalConfirm = null;
      }
    };

    $("elementModal").classList.remove("hidden");
    const firstInput = body.querySelector("input, select");
    if (firstInput) firstInput.focus();
  }

  function updateCanvasTooltip(tr, evStyle, impactItem, mouseEvent) {
    const tip = $("canvasTooltip");
    if (!tr || !mouseEvent) {
      tip.classList.add("hidden");
      return;
    }

    const m = activeMachine();
    const payload = evStyle && evStyle.payloadType ? `(${evStyle.payloadType})` : "";
    const isSelf = tr.srcName === tr.dstName;
    const selfMode = isSelf ? (tr.reenter ? " · self: re-enter" : " · self: stay") : "";
    const slugName = m
      ? RustyContract.resolveTransitionFnName(
          tr,
          m.transitions.filter((t) => t.srcName === tr.srcName),
          tr.srcName,
        )
      : "";
    const guardHtml =
      tr.guard && tr.guard.trim()
        ? `<div class="tt-guard">[${escapeHtml(tr.guard.trim())}]</div>`
        : `<div class="muted" style="font-size:10.5px;">Unconditional (no guard)</div>`;
    const actionHtml =
      tr.action && tr.action.trim()
        ? `<div class="muted-mono" style="margin-top:3px;">action hook: ${escapeHtml(slugName)}</div>`
        : "";
    const impactHtml = impactItem
      ? `<div class="tt-impact">⚠ ${escapeHtml(impactItem.reasons.map((r) => r.message).join("; "))}</div>`
      : "";

    tip.innerHTML = `
      <div class="tt-title">[${escapeHtml(evStyle ? evStyle.glyph : "?")}] ${escapeHtml(tr.event)}${escapeHtml(payload)} · ${escapeHtml(tr.name || "")}</div>
      <div class="tt-route">${escapeHtml(tr.srcName)} → ${escapeHtml(tr.dstName)}${escapeHtml(selfMode)}</div>
      ${guardHtml}
      ${actionHtml}
      ${impactHtml}
    `;
    tip.classList.remove("hidden");

    const hostRect = $("canvasHost").getBoundingClientRect();
    const relX = mouseEvent.clientX - hostRect.left + 14;
    const relY = mouseEvent.clientY - hostRect.top + 14;
    const maxX = Math.max(10, hostRect.width - tip.offsetWidth - 12);
    const maxY = Math.max(10, hostRect.height - tip.offsetHeight - 12);
    tip.style.left = `${Math.min(relX, maxX)}px`;
    tip.style.top = `${Math.min(relY, maxY)}px`;
  }

  const canvas = new StateMachineCanvas($("smSvg"), {
    onSelectState(id) {
      if (state.rightHidden) togglePane("right", false);
      selectStateForEditing(id);
    },
    onSelectTransition(id) {
      if (state.rightHidden) togglePane("right", false);
      selectTransitionForEditing(id);
    },
    onBackgroundClick() {
      state.selectedType = null;
      state.selectedId = null;
      state.connectSourceId = null;
      updateCanvasTooltip(null);
      renderAll();
    },
    onHoverTransition: updateCanvasTooltip,
    onConnectClick(stateId) {
      const m = activeMachine();
      if (!m) return;
      if (!state.connectSourceId) {
        state.connectSourceId = stateId;
        toast("Select destination state for transition (click same state for self-transition)", "ok");
        renderCanvas();
        return;
      }
      const srcId = state.connectSourceId;
      state.connectSourceId = null;
      state.connectMode = false;
      $("btnConnectMode").classList.remove("btn-active");

      const srcSt = m.states.find((s) => s.id === srcId);
      const dstSt = m.states.find((s) => s.id === stateId);
      const isSelf = srcId === stateId;
      const evOptions = m.events.map((e) => e.name);
      openElementModal({
        title: `Create Transition (${srcSt ? srcSt.name : "?"} → ${dstSt ? dstSt.name : "?"})`,
        confirmLabel: "Create Transition",
        fields: [
          {
            name: "event",
            label: "Trigger Event",
            type: evOptions.length ? "select" : "text",
            options: evOptions,
            value: evOptions[0] || "Tick",
          },
          {
            name: "name",
            label: "Short Transition Name",
            placeholder: "e.g. step_count",
            value: "",
          },
          {
            name: "guard",
            label: "Pure Guard Expression (optional)",
            placeholder: "e.g. count < limit",
            value: "",
          },
        ],
        onConfirm(vals) {
          const eventName = (vals.event || "").trim() || "Tick";
          const guard = (vals.guard || "").trim();
          const shortName =
            (vals.name || "").trim() ||
            RustyContract.toSnakeCase(`${eventName}_${dstSt ? dstSt.name : "next"}`);
          const deps = RustyAnalyzer.extractDependencies("", m, {
            triggerEvent: eventName,
            guardText: guard,
            actionText: "",
          });
          const tid = bridge.createTransition(m.id, {
            srcId,
            dstId: stateId,
            name: shortName,
            event: eventName,
            guard,
            action: "",
            reenter: false,
          });
          bridge.syncNodeDependencies(
            tid,
            deps.memberIds,
            RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
            `Set dependsOn for transition ${eventName}`,
          );
          toast(`Created ${isSelf ? "self-transition" : "transition"} on ${eventName}`, "ok");
          selectTransitionForEditing(tid);
        },
      });
    },
  });

  async function selectStateForEditing(id) {
    state.selectedType = "state";
    state.selectedId = id;
    state.editorLoadedHookKey = null;
    renderAll();

    const m = activeMachine();
    const st = selectedStateObj();
    if (!m || !st) return;
    const eff = RustyContract.resolveStateGitLink(m, st);
    if (
      eff.gitOwner &&
      eff.gitRepo &&
      eff.gitPath &&
      state.gitStatus.hasGithubToken &&
      !state.dirtyStateIds.has(st.id) &&
      !state.fetchedStateIds.has(st.id)
    ) {
      await pullStateFromGitHub(st, { silentNotFound: true });
    }
  }

  function selectTransitionForEditing(id) {
    state.selectedType = "transition";
    state.selectedId = id;
    state.transLoadedActionKey = null;
    renderAll();
  }

  function renderAnalyzerDiagnosticsFor(badgeId, latencyId, listId, editorInstance, result) {
    const { diagnostics, durationMs, stats } = result;
    const badge = $(badgeId);
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
    $(latencyId).textContent = `${durationMs}ms`;

    const list = $(listId);
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
        if (editorInstance) editorInstance.revealPosition(d.startLine, d.startColumn);
      });
      list.appendChild(li);
    }
  }

  function renderGuardLivePanels(tr) {
    const m = activeMachine();
    const list = $("transGuardDiag");
    const detBox = $("transDeterminismBox");
    const rustPrev = $("transGuardRustPreview");
    const hintEl = $("transGuardHint");
    list.innerHTML = "";

    if (!m || !tr) {
      list.classList.add("hidden");
      return;
    }

    const guardVal = $("inpTransGuard").value;
    const evVal = $("inpTransEvent").value;
    const eventsByPascal = new Map(m.events.map((e) => [RustyContract.toPascalCase(e.name), e]));
    const evDef = eventsByPascal.get(RustyContract.toPascalCase(evVal)) || null;

    // Show concise variable & payload reference hint
    const gVars = m.globals.map((g) => RustyContract.toSnakeCase(g.name));
    const payHint = evDef && evDef.payloadType ? ` · payload: ${evDef.payloadType}` : "";
    hintEl.textContent = gVars.length ? `Vars: ${gVars.join(", ")}${payHint}` : `No globals defined${payHint}`;

    const vg = RustyGuardLang.validateGuard(guardVal, m, { ...tr, event: evVal });
    if (!vg.diagnostics.length) {
      list.classList.add("hidden");
    } else {
      list.classList.remove("hidden");
      for (const d of vg.diagnostics) {
        const li = document.createElement("li");
        li.className = `problem-row sev-${d.severity}`;
        li.innerHTML = `
          <span class="problem-loc">${escapeHtml(d.code)}</span>
          <span class="problem-msg">${escapeHtml(d.message)}</span>
        `;
        list.appendChild(li);
      }
    }

    rustPrev.textContent = vg.ast
      ? `if ${RustyGuardLang.emitGuardRust(vg.ast, m, evDef)}`
      : "Unconditional (always enabled when event matches)";

    // Live mutual-exclusivity check against every sibling transition on the same `(SrcState, Event)`
    const targetEvPascal = RustyContract.toPascalCase(evVal);
    const siblings = m.transitions.filter(
      (s) =>
        s.id !== tr.id &&
        (s.srcId === tr.srcId || s.srcName === tr.srcName) &&
        RustyContract.toPascalCase(s.event) === targetEvPascal,
    );

    if (!vg.valid) {
      detBox.className = "determinism-box warn";
      detBox.innerHTML = "<strong>⚠ Exclusivity pending:</strong> Fix guard syntax/type errors above to run determinism proof.";
      return;
    }

    if (siblings.length === 0) {
      detBox.className = "determinism-box ok";
      detBox.innerHTML = `<strong>✓ Mutually Exclusive (Deterministic):</strong> Only outgoing transition on <code>${escapeHtml(targetEvPascal)}</code> from <code>${escapeHtml(tr.srcName)}</code>.`;
      return;
    }

    const overlaps = [];
    const unknowns = [];
    for (const sib of siblings) {
      const check = RustyGuardLang.checkPairExclusivity(
        guardVal,
        sib.guard,
        m,
        evDef,
        { ...tr, event: evVal },
        sib,
      );
      if (check.status === "overlap") {
        overlaps.push({ sib, ceText: RustyGuardLang.formatCounterexample(check.counterexample) });
      } else if (check.status === "unknown") {
        unknowns.push({ sib, reason: check.reason });
      }
    }

    if (overlaps.length > 0) {
      detBox.className = "determinism-box err";
      detBox.innerHTML =
        `<strong>✕ Non-Deterministic Guard Overlap!</strong> Multiple <code>${escapeHtml(targetEvPascal)}</code> transitions from <code>${escapeHtml(tr.srcName)}</code> can fire together:` +
        overlaps
          .map(
            (o) =>
              `<div>• Overlaps <strong>→ ${escapeHtml(o.sib.dstName)} (${escapeHtml(o.sib.name || o.sib.event)})</strong> when <code>${escapeHtml(o.ceText)}</code></div>`,
          )
          .join("");
    } else if (unknowns.length > 0) {
      detBox.className = "determinism-box warn";
      detBox.innerHTML = `<strong>⚠ Exclusivity unverified:</strong> ${escapeHtml(unknowns[0].reason || "Non-linear expression")}`;
    } else {
      detBox.className = "determinism-box ok";
      detBox.innerHTML = `<strong>✓ Proven Mutually Exclusive:</strong> Disjoint from all ${siblings.length} sibling <code>${escapeHtml(targetEvPascal)}</code> transition(s) on <code>${escapeHtml(tr.srcName)}</code>.`;
    }
  }

  async function saveOrCommitActiveStateHook(doGitCommit = true) {
    const m = activeMachine();
    const st = selectedStateObj();
    if (!m || !st || !monacoEditor) return;
    if (state.stateHookTab === "transitions") return;

    const hookBody = monacoEditor.getEditableBody();
    if (state.stateHookTab === "entry") state.draftEntryByStateId.set(st.id, hookBody);
    else state.draftExitByStateId.set(st.id, hookBody);

    const check = monacoEditor.runInstantAnalysis();
    if (doGitCommit && check && check.stats.errors > 0) {
      const proceed = window.confirm(
        `Edit-time analyzer found ${check.stats.errors} error(s) in ${st.name}::${state.stateHookTab}. Commit & Push anyway?`,
      );
      if (!proceed) return;
    }

    const entryCode = getLiveStateHookBody(st, "entry");
    const exitCode = getLiveStateHookBody(st, "exit");
    const updatedState = { ...st, entryCode, exitCode };
    const composed = RustyContract.composeStateModuleRs(m, updatedState).code;
    const deps = RustyAnalyzer.extractDependencies(`${entryCode}\n${exitCode}`, m);

    bridge.updateStateHookAndCode(
      st.id,
      { entryCode, exitCode, codeCache: composed },
      deps.memberIds,
      RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
      `Save ${st.name} (${state.stateHookTab} hook & dependsOn)`,
    );

    state.draftEntryByStateId.delete(st.id);
    state.draftExitByStateId.delete(st.id);
    state.editorLoadedHookKey = null;

    const eff = RustyContract.resolveStateGitLink(m, updatedState);
    if (doGitCommit && eff.gitOwner && eff.gitRepo && state.gitStatus.hasGithubToken) {
      await commitStatesToGitHub([{ ...updatedState, code: composed }]);
    } else {
      state.dirtyStateIds.delete(st.id);
      $("codeDirtyHint").textContent = "Saved to WebGME";
      toast(`Saved ${st.name} ${state.stateHookTab} hook`, "ok");
      renderAll();
    }
  }

  function buildTempMachineWithTransitionOverride(m, tr, overrides) {
    return {
      ...m,
      transitions: (m.transitions || []).map((t) => (t.id === tr.id ? { ...t, ...overrides } : t)),
    };
  }

  async function saveOrCommitTransitionAction(doGitCommit = true) {
    const m = activeMachine();
    const tr = selectedTransitionObj();
    if (!m || !tr || !transActionEditor) return;

    const actionBody = transActionEditor.getEditableBody();
    state.draftActionByTransId.set(tr.id, actionBody);

    const check = transActionEditor.runInstantAnalysis();
    if (doGitCommit && check && check.stats.errors > 0) {
      const proceed = window.confirm(
        `Edit-time analyzer found ${check.stats.errors} error(s) in transition action. Save & Push anyway?`,
      );
      if (!proceed) return;
    }

    const srcSt = m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
    const liveName = $("inpTransName").value.trim() || tr.name;
    const liveEvent = $("inpTransEvent").value.trim() || tr.event;
    const liveGuard = $("inpTransGuard").value.trim();
    const liveReenter = Boolean($("inpTransReenter").checked);

    const tempMachine = buildTempMachineWithTransitionOverride(m, tr, {
      name: liveName,
      event: liveEvent,
      guard: liveGuard,
      reenter: liveReenter,
      action: actionBody,
    });
    const composedSrc = srcSt ? RustyContract.composeStateModuleRs(tempMachine, srcSt).code : "";
    const deps = RustyAnalyzer.extractDependencies("", m, {
      triggerEvent: liveEvent,
      guardText: liveGuard,
      actionText: actionBody,
    });

    bridge.updateTransitionAndDeps(
      tr.id,
      { name: liveName, event: liveEvent, guard: liveGuard, reenter: liveReenter, action: actionBody },
      deps.memberIds,
      RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
      `Save Transition ${liveName} action & dependsOn`,
      srcSt ? { stateId: srcSt.id, codeCache: composedSrc } : null,
    );

    state.draftActionByTransId.delete(tr.id);
    state.dirtyTransIds.delete(tr.id);
    state.transLoadedActionKey = null;

    const eff = srcSt ? RustyContract.resolveStateGitLink(tempMachine, srcSt) : null;
    if (doGitCommit && srcSt && eff && eff.gitOwner && eff.gitRepo && state.gitStatus.hasGithubToken) {
      await commitStatesToGitHub([{ ...srcSt, code: composedSrc }]);
    } else {
      $("transActionDirtyHint").textContent = "Saved to WebGME";
      toast(`Saved transition action (${liveName})`, "ok");
      renderAll();
    }
  }

  // ---- Pane Visibility & Collapsibles ----

  function togglePane(side, forceHidden) {
    if (side === "left") {
      state.leftHidden = typeof forceHidden === "boolean" ? forceHidden : !state.leftHidden;
      $("workspaceGrid").classList.toggle("left-hidden", state.leftHidden);
      $("btnToggleLeftPane").classList.toggle("is-collapsed", state.leftHidden);
      $("btnToggleLeftPane").title = state.leftHidden ? "Show left Explorer panel" : "Hide left Explorer panel";
    } else {
      state.rightHidden = typeof forceHidden === "boolean" ? forceHidden : !state.rightHidden;
      $("workspaceGrid").classList.toggle("right-hidden", state.rightHidden);
      $("btnToggleRightPane").classList.toggle("is-collapsed", state.rightHidden);
      $("btnToggleRightPane").title = state.rightHidden ? "Show right Inspector panel" : "Hide right Inspector panel";
    }
    if (monacoEditor) setTimeout(() => monacoEditor.layout(), 180);
    if (transActionEditor) setTimeout(() => transActionEditor.layout(), 180);
  }

  function applySectionCollapseStates() {
    document.querySelectorAll("[data-section-name]").forEach((sec) => {
      const key = sec.dataset.sectionName;
      const collapsed = state.collapsedSections.has(key);
      sec.classList.toggle("collapsed", collapsed);
      const toggleBtn = sec.querySelector("[data-collapse-section]");
      if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    });
  }

  // ---- Initialization ----

  async function init() {
    bindUIEvents();
    applySectionCollapseStates();

    monacoEditor = new window.MonacoStateEditor($("monacoEditorHost"), {
      onChange(bodyText) {
        const st = selectedStateObj();
        if (!st || state.stateHookTab === "transitions") return;
        if (state.stateHookTab === "entry") state.draftEntryByStateId.set(st.id, bodyText);
        else state.draftExitByStateId.set(st.id, bodyText);
        state.dirtyStateIds.add(st.id);
        $("codeDirtyHint").textContent = "Unsaved edits";
        renderCanvas();
      },
      onDiagnostics(result) {
        renderAnalyzerDiagnosticsFor("analyzerStatusBadge", "analyzerLatency", "editorProblemsList", monacoEditor, result);
      },
      onSaveShortcut() {
        const m = activeMachine();
        const st = selectedStateObj();
        const eff = m && st ? RustyContract.resolveStateGitLink(m, st) : null;
        const doPush = Boolean(eff && eff.gitOwner && eff.gitRepo && state.gitStatus.hasGithubToken);
        saveOrCommitActiveStateHook(doPush);
      },
      onReadOnlyBlocked: notifyReadOnlyBlocked,
    });

    transActionEditor = new window.MonacoStateEditor($("transMonacoHost"), {
      onChange(bodyText) {
        const tr = selectedTransitionObj();
        if (!tr) return;
        state.draftActionByTransId.set(tr.id, bodyText);
        state.dirtyTransIds.add(tr.id);
        $("transActionDirtyHint").textContent = "Unsaved edits";
      },
      onDiagnostics(result) {
        renderAnalyzerDiagnosticsFor(
          "transActionBadge",
          "transActionLatency",
          "transActionProblemsList",
          transActionEditor,
          result,
        );
      },
      onSaveShortcut() {
        const m = activeMachine();
        const tr = selectedTransitionObj();
        const srcSt = m && tr ? m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName) : null;
        const eff = m && srcSt ? RustyContract.resolveStateGitLink(m, srcSt) : null;
        const doPush = Boolean(eff && eff.gitOwner && eff.gitRepo && state.gitStatus.hasGithubToken);
        saveOrCommitTransitionAction(doPush);
      },
      onReadOnlyBlocked: notifyReadOnlyBlocked,
    });

    try {
      const infoRes = await fetch("/routers/studio/api/info", { credentials: "same-origin" });
      state.info = await infoRes.json();
    } catch (_err) {
      state.info = {
        defaultSeed: "RustySeed",
        docsAvailable: false,
        authEnabled: false,
        serveWebGMEUI: true,
        webgmeUrl: "/",
      };
    }

    const showDocs = Boolean(state.info.docsAvailable);
    $("linkDocs").classList.toggle("hidden", !showDocs);
    if (showDocs) {
      $("linkDocs").href = state.info.docsUrl || "/docs";
    }

    const showAuthLinks = Boolean(state.info.authEnabled);
    $("linkProfile").classList.toggle("hidden", !showAuthLinks || !state.info.profileUrl);
    if (showAuthLinks && state.info.profileUrl) {
      $("linkProfile").href = state.info.profileUrl;
    }
    $("linkLogout").classList.toggle("hidden", !showAuthLinks || !state.info.logoutUrl);
    if (showAuthLinks && state.info.logoutUrl) {
      $("linkLogout").href = state.info.logoutUrl;
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

    // Load Monaco AMD after WebGME Socket.IO connects
    await monacoEditor.init();
    await transActionEditor.init();

    bridge.onModelChange((machines) => {
      state.machines = machines;
      if (!state.activeMachineId || !machines.some((m) => m.id === state.activeMachineId)) {
        state.activeMachineId = machines[0] ? machines[0].id : null;
      }
      state.editorLoadedHookKey = null;
      state.transLoadedActionKey = null;
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
        setBadge("gitStatusBadge", "GitHub: Sign in via User Profile", "badge-warn");
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
    const m = activeMachine();
    state.impact = m ? RustyAnalyzer.computeDesignImpact(m) : null;
    renderMachineSelect();
    renderGitBar();
    renderImpactBanner();
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
    const isConnected = Boolean(m && m.gitOwner && m.gitRepo);
    if (!isConnected) {
      $("machineRepoDisplay").textContent = "Not connected (local draft)";
      $("machineRepoDisplay").className = "repo-pill repo-local";
      $("btnConnectRepo").classList.toggle("hidden", !m);
      $("btnPullAll").classList.add("hidden");
      $("btnPushCrate").classList.add("hidden");
    } else {
      $("machineRepoDisplay").textContent = `${m.gitOwner}/${m.gitRepo}@${m.gitBranch || "main"} · ${m.gitPath || "src/states"}`;
      $("machineRepoDisplay").className = "repo-pill repo-connected";
      $("btnConnectRepo").classList.add("hidden");
      $("btnPullAll").classList.remove("hidden");
      $("btnPushCrate").classList.remove("hidden");
    }
  }

  function renderImpactBanner() {
    const banner = $("impactBanner");
    const imp = state.impact;
    if (!imp || imp.totalImpacted === 0) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      return;
    }

    banner.classList.remove("hidden");
    banner.innerHTML = `<strong>⚠ Design Check:</strong> ${imp.totalImpacted} item(s) need attention: `;
    for (const item of imp.items.slice(0, 6)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `impact-chip${item.errors > 0 ? " err" : ""}`;
      chip.textContent = `${item.kind === "state" ? item.name : `[Guard] ${item.name}`} (${item.errors + item.warnings})`;
      chip.title = item.reasons.map((r) => r.message).join("\n");
      chip.addEventListener("click", () => {
        if (state.rightHidden) togglePane("right", false);
        if (item.kind === "state") {
          selectStateForEditing(item.id);
        } else {
          selectTransitionForEditing(item.id);
        }
      });
      banner.appendChild(chip);
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

    $("countStates").textContent = m ? String(m.states.length) : "0";
    $("countGlobals").textContent = m ? String(m.globals.length) : "0";
    $("countEvents").textContent = m ? String(m.events.length) : "0";
    if (!m) return;

    const imp = state.impact;

    // States
    for (const st of m.states) {
      const li = document.createElement("li");
      const isSel = state.selectedType === "state" && state.selectedId === st.id;
      li.className = `item-row${isSel ? " selected" : ""}`;
      const dotCls = state.dirtyStateIds.has(st.id)
        ? "dot-dirty"
        : st.gitBaseCommitSha
          ? "dot-synced"
          : "dot-local";
      const stImpact = imp && imp.byStateId[st.id];
      const impactBadge = stImpact
        ? `<span class="impact-dot${stImpact.errors > 0 ? " err" : ""}" title="${escapeHtml(stImpact.reasons.map((r) => r.message).join("; "))}">⚠${stImpact.errors + stImpact.warnings}</span>`
        : "";

      li.innerHTML = `
        <div class="item-main">
          <span class="dot ${dotCls}" title="${dotCls.replace("dot-", "")}"></span>
          <span class="item-name">${escapeHtml(st.name)}</span>
        </div>
        ${impactBadge}
        <span class="item-sub">${st.isInitial ? "INIT" : ""}</span>
      `;
      li.addEventListener("click", () => {
        selectStateForEditing(st.id);
      });
      stateList.appendChild(li);
    }

    // Globals (with optional min/max bounds badge)
    for (const g of m.globals) {
      const li = document.createElement("li");
      li.className = "item-row";
      const hasBounds = Boolean((g.minValue && g.minValue.trim()) || (g.maxValue && g.maxValue.trim()));
      const boundsStr = hasBounds
        ? ` [${g.minValue || "−∞"}..${g.maxValue || "+∞"}]`
        : "";
      li.innerHTML = `
        <div class="item-main">
          <span class="item-name">${escapeHtml(g.name)}</span>
          <span class="item-sub">${escapeHtml(g.rustType)} = ${escapeHtml(g.initialValue)}${escapeHtml(boundsStr)}</span>
        </div>
        <button class="btn btn-xs btn-edit-global" title="Edit GlobalVar & Bounds">✎</button>
        <button class="btn btn-xs btn-del-global" title="Delete GlobalVar">✕</button>
      `;
      li.querySelector(".btn-edit-global").addEventListener("click", (e) => {
        e.stopPropagation();
        openElementModal({
          title: `Edit Global Variable (${g.name})`,
          confirmLabel: "Apply to Design",
          fields: [
            { name: "name", label: "Field Name (snake_case)", value: g.name },
            {
              name: "rustType",
              label: "Rust Type",
              type: "select",
              options: ["bool", "i32", "i64", "u32", "f64", "String"],
              value: g.rustType,
            },
            { name: "initialValue", label: "Initial Value", value: g.initialValue },
            { name: "minValue", label: "Min Domain Bound (optional — for guard proof)", placeholder: "e.g. 0.0", value: g.minValue || "" },
            { name: "maxValue", label: "Max Domain Bound (optional — for guard proof)", placeholder: "e.g. 100.0", value: g.maxValue || "" },
          ],
          onConfirm(vals) {
            bridge.updateNodeAttributes(
              g.id,
              {
                name: vals.name.trim() || g.name,
                rustType: vals.rustType,
                initialValue: vals.initialValue.trim(),
                minValue: (vals.minValue || "").trim(),
                maxValue: (vals.maxValue || "").trim(),
              },
              `Update GlobalVar ${g.name}`,
            );
            toast(`Updated global ${vals.name.trim() || g.name}`, "ok");
          },
        });
      });
      li.querySelector(".btn-del-global").addEventListener("click", (e) => {
        e.stopPropagation();
        bridge.deleteNode(g.id, g.name);
      });
      globalList.appendChild(li);
    }

    // Events
    const evStyles = StateMachineCanvas.buildEventStyles(m.events);
    const suggestions = $("eventNameSuggestions");
    suggestions.innerHTML = "";
    for (const ev of m.events) {
      const opt = document.createElement("option");
      opt.value = ev.name;
      suggestions.appendChild(opt);

      const styleInfo = evStyles.get(ev.name) || { glyph: "?", color: "#94a3b8", dash: "" };
      const li = document.createElement("li");
      li.className = "item-row";
      li.title = `Diagram badge [${styleInfo.glyph}] · Hover to highlight connectors`;
      li.innerHTML = `
        <div class="item-main">
          <span class="event-glyph-pill" style="color:${styleInfo.color}">${escapeHtml(styleInfo.glyph)}</span>
          <svg class="event-swatch" width="24" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="23" y2="5" stroke="${styleInfo.color}" stroke-width="2.2" ${styleInfo.dash ? `stroke-dasharray="${styleInfo.dash}"` : ""}/>
          </svg>
          <span class="item-name">${escapeHtml(ev.name)}</span>
          <span class="item-sub">${ev.payloadType ? `(${escapeHtml(ev.payloadType)})` : ""}</span>
        </div>
        <button class="btn btn-xs btn-edit-event" title="Edit EventDef">✎</button>
        <button class="btn btn-xs btn-del-event" title="Delete EventDef">✕</button>
      `;
      li.addEventListener("mouseenter", () => {
        state.highlightEventName = ev.name;
        renderCanvas();
      });
      li.addEventListener("mouseleave", () => {
        state.highlightEventName = null;
        renderCanvas();
      });
      li.querySelector(".btn-edit-event").addEventListener("click", (e) => {
        e.stopPropagation();
        openElementModal({
          title: `Edit Event (${ev.name})`,
          confirmLabel: "Apply to Design",
          fields: [
            { name: "name", label: "Event Name (PascalCase)", value: ev.name },
            {
              name: "payloadType",
              label: "Payload Type",
              type: "select",
              options: ["", "bool", "i32", "i64", "u32", "f64", "String"],
              value: ev.payloadType || "",
            },
          ],
          onConfirm(vals) {
            bridge.updateNodeAttributes(
              ev.id,
              {
                name: vals.name.trim() || ev.name,
                payloadType: vals.payloadType,
              },
              `Update EventDef ${ev.name}`,
            );
            toast(`Updated event ${vals.name.trim() || ev.name}`, "ok");
          },
        });
      });
      li.querySelector(".btn-del-event").addEventListener("click", (e) => {
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
      layoutDirection: state.layoutDirection,
      compactLabels: state.compactLabels,
      highlightEventName: state.highlightEventName,
      impact: state.impact,
    });

    if (snap && snap.currentState) {
      $("simActiveBanner").classList.remove("hidden");
      $("simActiveStateName").textContent = snap.currentState;
    } else {
      $("simActiveBanner").classList.add("hidden");
    }
  }

  function renderDependsOnChips(containerEl, memberIds, m) {
    containerEl.innerHTML = "";
    const ids = Array.isArray(memberIds) ? memberIds : [];
    if (ids.length === 0) {
      containerEl.innerHTML = `<span class="muted">No referenced design nodes tracked yet.</span>`;
      return;
    }
    const gMap = new Map((m.globals || []).map((g) => [g.id, g]));
    const eMap = new Map((m.events || []).map((e) => [e.id, e]));
    const sMap = new Map((m.states || []).map((s) => [s.id, s]));

    for (const id of ids) {
      const chip = document.createElement("span");
      if (gMap.has(id)) {
        const g = gMap.get(id);
        chip.className = "dep-chip dep-global";
        chip.textContent = `var: ${g.name} (${g.rustType})`;
      } else if (eMap.has(id)) {
        const ev = eMap.get(id);
        chip.className = "dep-chip dep-event";
        chip.textContent = `ev: ${ev.name}${ev.payloadType ? `(${ev.payloadType})` : ""}`;
      } else if (sMap.has(id)) {
        const st = sMap.get(id);
        chip.className = "dep-chip dep-state";
        chip.textContent = `state: ${st.name}`;
      } else {
        chip.className = "dep-chip dep-stale";
        chip.textContent = `missing: ${id}`;
      }
      containerEl.appendChild(chip);
    }
  }

  function renderImpactBox(boxEl, impactItem) {
    if (!impactItem || !impactItem.reasons.length) {
      boxEl.classList.add("hidden");
      boxEl.innerHTML = "";
      return;
    }
    boxEl.className = `impact-box${impactItem.errors > 0 ? " err" : ""}`;
    boxEl.innerHTML =
      `<strong>⚠ Impacted by design / code check:</strong>` +
      impactItem.reasons
        .map((r) => `<div>• <code>${escapeHtml(r.code)}</code> ${escapeHtml(r.message)}</div>`)
        .join("");
  }

  function renderStateOutgoingTransitions(m, st) {
    const hooks = RustyContract.resolveStateTransitionHooks(m, st);
    $("stateTransCount").textContent = String(hooks.length);
    const list = $("stateOutgoingList");
    list.innerHTML = "";
    if (hooks.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:14px;">No outgoing transitions from <strong>${escapeHtml(st.name)}</strong>. Use <strong>⇢ Edge</strong> to add one.</div>`;
      return;
    }

    const detMap = state.impact && state.impact.determinism ? state.impact.determinism.byTransitionId : {};
    for (const h of hooks) {
      const tr = h.transition;
      const trId = tr.id || h.trKey;
      const det = detMap[trId];
      const hasOverlap = det && det.status === "overlap";
      const isSelf = tr.srcName === tr.dstName;
      const routeSuffix = isSelf ? (tr.reenter ? "(self · re-enter)" : "(self · stay)") : "";

      const card = document.createElement("div");
      card.className = `outgoing-item${hasOverlap ? " overlap" : ""}`;
      const guardTxt = tr.guard && tr.guard.trim() ? `[${tr.guard.trim()}]` : "(unconditional)";
      const actionBadge = h.hasAction
        ? `<span class="dep-chip dep-global">${escapeHtml(h.fnName)}</span>`
        : `<span class="muted-mono">no action</span>`;
      const detBadge = hasOverlap
        ? `<span class="badge badge-err">✕ Overlap</span>`
        : det && det.status === "unknown"
          ? `<span class="badge badge-warn">? Unverified</span>`
          : `<span class="badge badge-ok">✓ Exclusive</span>`;

      card.innerHTML = `
        <div class="outgoing-top">
          <span class="outgoing-route">On <code>${escapeHtml(tr.event)}</code> → ${escapeHtml(tr.dstName)} <span class="muted">${escapeHtml(routeSuffix)}</span></span>
          ${detBadge}
        </div>
        <div class="outgoing-meta">${escapeHtml(guardTxt)}</div>
        <div class="btn-row" style="justify-content:space-between;">
          <span class="muted-mono">${escapeHtml(tr.name || "")}</span>
          ${actionBadge}
        </div>
      `;
      card.addEventListener("click", () => {
        selectTransitionForEditing(tr.id);
      });
      list.appendChild(card);
    }
  }

  function loadStateHookIntoMonaco(m, st) {
    if (!monacoEditor || state.stateHookTab === "transitions") return;
    const hookKind = state.stateHookTab === "exit" ? "exit" : "entry";
    const loadKey = `${st.id}:${hookKind}`;

    const liveEntry = getLiveStateHookBody(st, "entry");
    const liveExit = getLiveStateHookBody(st, "exit");
    const tempSt = { ...st, entryCode: liveEntry, exitCode: liveExit };
    const composed = RustyContract.composeStateModuleRs(m, tempSt, {
      editableHook: hookKind,
    });
    const span = composed.hooks[hookKind];
    const snakeFile = `${RustyContract.toSnakeCase(st.name)}.rs`;

    $("stateHookSubtitle").textContent = `${span.fnName}(...) in ${snakeFile} · surrounding lines read-only`;
    monacoEditor.setContext(m, st, { kind: hookKind, payloadType: "" });

    if (state.editorLoadedHookKey !== loadKey) {
      state.editorLoadedHookKey = loadKey;
      monacoEditor.setContextualFile({
        code: composed.code,
        editableStartLine: span.startLine,
        editableEndLine: span.endLine,
        hookContext: { kind: hookKind, payloadType: "" },
        stateId: st.id,
        reveal: true,
      });
    }
    setTimeout(() => monacoEditor.layout(), 20);
  }

  function loadTransitionActionIntoMonaco(m, tr) {
    if (!transActionEditor || state.transSubTab !== "action") return;
    const srcSt = m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
    if (!srcSt) return;

    const liveAction = getLiveTransitionAction(tr);
    const liveName = $("inpTransName").value.trim() || tr.name;
    const liveEvent = $("inpTransEvent").value.trim() || tr.event;
    const liveGuard = $("inpTransGuard").value.trim();
    const liveReenter = Boolean($("inpTransReenter").checked);

    const tempMachine = buildTempMachineWithTransitionOverride(m, tr, {
      name: liveName,
      event: liveEvent,
      guard: liveGuard,
      reenter: liveReenter,
      action: liveAction,
    });

    const trKey = RustyContract.transitionKey(tr);
    const composed = RustyContract.composeStateModuleRs(tempMachine, srcSt, {
      editableHook: "transition",
      includeTransitionKey: trKey,
    });
    const span = composed.hooks.transitions[trKey];
    if (!span) return;

    const snakeFile = `${RustyContract.toSnakeCase(srcSt.name)}.rs`;
    $("transActionSubtitle").textContent = `${span.fnName}(...) in ${snakeFile} · surrounding lines read-only`;

    const hookCtx = { kind: "transition", payloadType: span.payloadType || "" };
    transActionEditor.setContext(tempMachine, srcSt, hookCtx);

    const loadKey = `${tr.id}:${liveName}:${liveEvent}:${liveGuard}:${liveReenter}`;
    if (state.transLoadedActionKey !== loadKey) {
      state.transLoadedActionKey = loadKey;
      transActionEditor.setContextualFile({
        code: composed.code,
        editableStartLine: span.startLine,
        editableEndLine: span.endLine,
        hookContext: hookCtx,
        stateId: srcSt.id,
        reveal: true,
      });
    }
    setTimeout(() => transActionEditor.layout(), 20);
  }

  function renderInspector() {
    const m = activeMachine();
    const st = selectedStateObj();
    const tr = selectedTransitionObj();
    const imp = state.impact;

    $("inspectorEmpty").classList.toggle("hidden", Boolean(st || tr));
    $("stateInspector").classList.toggle("hidden", !st);
    $("transitionInspector").classList.toggle("hidden", !tr);

    if (st && m) {
      const eff = RustyContract.resolveStateGitLink(m, st);
      const isConnected = Boolean(eff.gitOwner && eff.gitRepo);
      $("statePathHint").textContent = st.id;
      $("inpStateName").value = st.name;
      $("inpStateColor").value = st.color || "#38bdf8";
      $("inpStateDesc").value = st.description || "";
      $("inpStateInitial").checked = Boolean(st.isInitial);
      $("inpStateFinal").checked = Boolean(st.isFinal);

      $("stateGitEffective").textContent = isConnected
        ? `${eff.gitOwner}/${eff.gitRepo}@${eff.gitBranch}:${eff.gitPath}`
        : eff.gitPath;
      $("stateShaDisplay").textContent = st.gitBaseCommitSha ? st.gitBaseCommitSha.slice(0, 12) : "none";

      $("btnCommitState").classList.toggle("hidden", !isConnected);
      $("btnPullState").classList.toggle("hidden", !isConnected);
      $("btnSaveCodeCache").textContent = isConnected ? "Save Local Draft" : "Save Hook (⌘S)";

      if (state.dirtyStateIds.has(st.id)) {
        setBadge("stateSyncBadge", "Modified (unsynced)", "badge-warn");
      } else if (st.gitBaseCommitSha) {
        setBadge("stateSyncBadge", "Synced with GitHub", "badge-ok");
      } else if (isConnected) {
        setBadge("stateSyncBadge", "Connected Dir", "badge-muted");
      } else {
        setBadge("stateSyncBadge", "Local Draft", "badge-muted");
      }

      renderImpactBox($("stateImpactBox"), imp && imp.byStateId[st.id]);
      renderDependsOnChips($("stateDependsOnList"), st.dependsOn, m);
      renderStateOutgoingTransitions(m, st);

      document.querySelectorAll("[data-state-hook]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.stateHook === state.stateHookTab);
      });
      $("stateHookCodePane").classList.toggle("hidden", state.stateHookTab === "transitions");
      $("stateTransitionsPane").classList.toggle("hidden", state.stateHookTab !== "transitions");

      loadStateHookIntoMonaco(m, st);
      $("codeDirtyHint").textContent = state.dirtyStateIds.has(st.id) ? "Unsaved edits" : "";
    }

    if (tr && m) {
      const isSelf = tr.srcId === tr.dstId || tr.srcName === tr.dstName;
      $("transRouteHint").textContent = isSelf
        ? `${tr.srcName} ↺ (self)`
        : `${tr.srcName} → ${tr.dstName}`;
      $("inpTransName").value = tr.name;
      $("inpTransEvent").value = tr.event;
      $("transReenterRow").classList.toggle("hidden", !isSelf);
      $("inpTransReenter").checked = Boolean(tr.reenter);
      $("inpTransGuard").value = tr.guard || "";

      renderImpactBox($("transImpactBox"), imp && imp.byTransitionId[tr.id]);
      renderDependsOnChips($("transDependsOnList"), tr.dependsOn, m);
      renderGuardLivePanels(tr);

      document.querySelectorAll("[data-trans-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.transTab === state.transSubTab);
      });
      $("tabTransGuard").classList.toggle("hidden", state.transSubTab !== "guard");
      $("tabTransAction").classList.toggle("hidden", state.transSubTab !== "action");

      const srcSt = m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
      const eff = srcSt ? RustyContract.resolveStateGitLink(m, srcSt) : null;
      const isConnected = Boolean(eff && eff.gitOwner && eff.gitRepo);
      $("btnCommitTransAction").classList.toggle("hidden", !isConnected);
      $("btnSaveTransAction").textContent = isConnected ? "Save Local Draft" : "Save Action (⌘S)";
      $("transActionDirtyHint").textContent = state.dirtyTransIds.has(tr.id) ? "Unsaved edits" : "";

      if (state.transSubTab === "action") {
        loadTransitionActionIntoMonaco(m, tr);
      }
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
      state.sim = RustySimEngine.createSimulation(m);
    }
  }

  function renderSimulator() {
    const m = activeMachine();
    if (!m || !state.sim) return;
    const snap = state.sim.getSnapshot();

    $("simStateBig").textContent = snap.currentState || "—";
    $("simStepCount").textContent = String(snap.stepCount);

    const btnHost = $("simEventButtons");
    btnHost.innerHTML = "";
    for (const ev of m.events) {
      const btn = document.createElement("button");
      btn.className = "btn btn-xs btn-primary";
      btn.textContent = ev.payloadType ? `${ev.name}(${ev.payloadType})` : ev.name;
      btn.title = ev.description || `Dispatch Event::${ev.name}`;
      btn.addEventListener("click", () => {
        if (!ev.payloadType) {
          dispatchSimEvent(ev.name, undefined);
          return;
        }
        openElementModal({
          title: `Dispatch ${ev.name}(${ev.payloadType})`,
          confirmLabel: "Dispatch Event",
          fields: [
            {
              name: "payload",
              label: `Payload (${ev.payloadType})`,
              value: ev.payloadType === "bool" ? "true" : "0",
            },
          ],
          onConfirm(vals) {
            const raw = vals.payload;
            const payload =
              ev.payloadType === "bool" ? raw === "true" : ev.payloadType === "String" ? raw : Number(raw);
            dispatchSimEvent(ev.name, payload);
          },
        });
      });
      btnHost.appendChild(btn);
    }

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
        openElementModal({
          title: `Override globals.${key}`,
          confirmLabel: "Set Value",
          fields: [{ name: "val", label: `Value (${g.rustType})`, value: String(val) }],
          onConfirm(vals) {
            const nextRaw = vals.val;
            let parsed = nextRaw;
            if (g.rustType === "bool") parsed = nextRaw === "true";
            else if (g.rustType !== "String") parsed = Number(nextRaw);
            state.sim.setGlobal(key, parsed);
            renderSimulator();
          },
        });
      });
      tbody.appendChild(tr);
    }

    const traceUl = $("simTraceList");
    traceUl.innerHTML = "";
    for (const entry of [...snap.trace].reverse().slice(0, 40)) {
      const li = document.createElement("li");
      li.className = "trace-item";
      const diffParts = Object.entries(entry.diff || {}).map(([k, d]) => `${k}: ${d.before}→${d.after}`);
      const arrow =
        entry.fromState === entry.toState ? `${entry.toState} (stay)` : `${entry.fromState} → ${entry.toState}`;
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
    state.simLastTransitionId = entry.transitionId || null;
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
    const m = activeMachine();
    const eff = RustyContract.resolveStateGitLink(m, st);
    if (!eff.gitOwner || !eff.gitRepo || !eff.gitPath) {
      if (!opts.silentNotFound) toast("Connect a Git repository on this StateMachine first", "warn");
      return;
    }
    const statusEl = $("gitFetchStatus");
    if (statusEl) statusEl.textContent = "Fetching from GitHub…";
    try {
      const file = await gitClient.fetchFile({
        owner: eff.gitOwner,
        repo: eff.gitRepo,
        path: eff.gitPath,
        ref: eff.gitBranch || "main",
        projectId: bridge.projectId,
      });
      if (file.type !== "file") {
        if (statusEl) statusEl.textContent = "";
        toast(`Path ${eff.gitPath} is a directory, expected file`, "warn");
        return;
      }

      const parsed = RustyContract.parseStateModuleRs(file.content);
      const hooks = RustyContract.resolveStateTransitionHooks(m, st);

      bridge.runTransaction(`Pull ${eff.gitPath} from GitHub`, () => {
        bridge.client.setAttribute(st.id, "entryCode", parsed.entryCode || "");
        bridge.client.setAttribute(st.id, "exitCode", parsed.exitCode || "");
        bridge.client.setAttribute(st.id, "codeCache", file.content);
        const deps = RustyAnalyzer.extractDependencies(`${parsed.entryCode}\n${parsed.exitCode}`, m);
        bridge._applyDepsInsideTx(
          st.id,
          deps.memberIds,
          RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
        );

        for (const h of hooks) {
          if (Object.prototype.hasOwnProperty.call(parsed.actionsByFnName, h.fnName)) {
            const tr = h.transition;
            const act = parsed.actionsByFnName[h.fnName];
            bridge.client.setAttribute(tr.id, "action", act);
            const tDeps = RustyAnalyzer.extractDependencies("", m, {
              triggerEvent: tr.event,
              guardText: tr.guard || "",
              actionText: act,
            });
            bridge._applyDepsInsideTx(
              tr.id,
              tDeps.memberIds,
              RustyAnalyzer.serializeDepsSnapshot(tDeps.snapshot),
            );
            state.draftActionByTransId.delete(tr.id);
            state.dirtyTransIds.delete(tr.id);
          }
        }
      });

      state.fetchedStateIds.add(st.id);
      state.dirtyStateIds.delete(st.id);
      state.draftEntryByStateId.delete(st.id);
      state.draftExitByStateId.delete(st.id);
      state.editorLoadedHookKey = null;
      state.transLoadedActionKey = null;

      if (statusEl) statusEl.textContent = "Loaded from GitHub";
      toast(`Fetched ${eff.gitPath} from ${eff.gitOwner}/${eff.gitRepo}`, "ok");
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
    const m = activeMachine();
    if (!m || !statesToCommit.length) {
      toast("No states to commit", "warn");
      return;
    }
    const firstEff = RustyContract.resolveStateGitLink(m, statesToCommit[0]);
    if (!firstEff.gitOwner || !firstEff.gitRepo) {
      toast("Connect a Git repository first (click 'Connect Git Repository…')", "warn");
      return;
    }

    const changes = statesToCommit.map((st) => {
      const eff = RustyContract.resolveStateGitLink(m, st);
      const composed = RustyContract.composeStateModuleRs(m, st).code;
      return {
        path: eff.gitPath,
        content: st.code && st.code.includes("// @rusty:hook") ? st.code : composed,
        mode: "100644",
      };
    });

    const message =
      customMessage ||
      `rusty: update ${statesToCommit.map((s) => s.name).join(", ")}`;

    try {
      const res = await gitClient.commit({
        owner: firstEff.gitOwner,
        repo: firstEff.gitRepo,
        branch: firstEff.gitBranch || "main",
        expectedParentSha: statesToCommit[0].gitBaseCommitSha || undefined,
        message,
        changes,
        projectId: bridge.projectId,
      });

      if (res.conflict) {
        openConflictModal(res.body, {
          owner: firstEff.gitOwner,
          repo: firstEff.gitRepo,
          branch: firstEff.gitBranch || "main",
          states: statesToCommit,
          message,
        });
        return;
      }

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

    // State Hook Sub-Tabs (Entry / Exit / Transitions)
    document.querySelectorAll("[data-state-hook]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.stateHookTab = btn.dataset.stateHook;
        state.editorLoadedHookKey = null;
        renderInspector();
      });
    });

    // Transition Sub-Tabs (Guard / Action)
    document.querySelectorAll("[data-trans-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.transSubTab = btn.dataset.transTab;
        state.transLoadedActionKey = null;
        renderInspector();
      });
    });

    // Side panel toggles & sidebar section collapse toggles
    $("btnToggleLeftPane").addEventListener("click", () => togglePane("left"));
    $("btnToggleRightPane").addEventListener("click", () => togglePane("right"));

    document.querySelectorAll("[data-collapse-section]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.collapseSection;
        if (state.collapsedSections.has(key)) state.collapsedSections.delete(key);
        else state.collapsedSections.add(key);
        applySectionCollapseStates();
      });
    });

    // Project & Machine switching
    $("projectSelect").addEventListener("change", (e) => openSelectedProject(e.target.value));
    $("machineSelect").addEventListener("change", (e) => {
      state.activeMachineId = e.target.value;
      state.selectedType = null;
      state.selectedId = null;
      state.editorLoadedHookKey = null;
      state.transLoadedActionKey = null;
      rebuildSimulation(true);
      renderAll();
    });

    $("btnNewProject").addEventListener("click", () => {
      openElementModal({
        title: "New WebGME Project (from RustySeed)",
        confirmLabel: "Create Project",
        fields: [{ name: "name", label: "Project Name", value: "MyRustMachine" }],
        async onConfirm(vals) {
          const name = (vals.name || "").trim();
          if (!name) return false;
          try {
            const res = await bridge.createProjectFromSeed(name, state.info.defaultSeed || "RustySeed");
            state.projects = await bridge.listProjects();
            renderProjectSelect();
            $("projectSelect").value = res.projectId;
            await openSelectedProject(res.projectId);
          } catch (err) {
            toast(`Failed to create project: ${err.message}`, "err");
          }
        },
      });
    });

    $("btnNewMachine").addEventListener("click", () => {
      openElementModal({
        title: "Create New StateMachine",
        confirmLabel: "Create Machine",
        fields: [{ name: "name", label: "StateMachine Name", value: "SimpleCounter" }],
        onConfirm(vals) {
          const name = (vals.name || "").trim();
          if (!name) return false;
          const id = bridge.createStateMachine(name);
          state.activeMachineId = id;
          toast(`Created StateMachine ${name}`, "ok");
        },
      });
    });

    // Sidebar Add buttons
    $("btnAddState").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      openElementModal({
        title: "Add State",
        confirmLabel: "Add State",
        fields: [
          { name: "name", label: "State Name (PascalCase)", value: `State${m.states.length + 1}` },
          { name: "description", label: "Description", placeholder: "What does this state do?", value: "" },
          {
            name: "color",
            label: "Accent Color",
            type: "select",
            options: ["#38bdf8", "#22c55e", "#f97316", "#eab308", "#a855f7", "#ef4444"],
            value: "#38bdf8",
          },
        ],
        onConfirm(vals) {
          const name = (vals.name || "").trim();
          if (!name) return false;
          const idx = m.states.length;
          const id = bridge.createState(m.id, {
            name,
            description: vals.description || "",
            isInitial: idx === 0,
            color: vals.color || "#38bdf8",
            position: { x: 120 + (idx % 3) * 230, y: 100 + Math.floor(idx / 3) * 140 },
          });
          selectStateForEditing(id);
        },
      });
    });

    $("btnAddGlobal").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      openElementModal({
        title: "Add Global Variable",
        confirmLabel: "Add Variable",
        fields: [
          { name: "name", label: "Field Name (snake_case)", value: "counter" },
          {
            name: "rustType",
            label: "Rust Type",
            type: "select",
            options: ["u32", "i32", "i64", "f64", "bool", "String"],
            value: "u32",
          },
          { name: "initialValue", label: "Initial Value", value: "0" },
          { name: "minValue", label: "Min Domain Bound (optional)", placeholder: "e.g. 0", value: "" },
          { name: "maxValue", label: "Max Domain Bound (optional)", placeholder: "e.g. 100", value: "" },
        ],
        onConfirm(vals) {
          const name = (vals.name || "").trim();
          if (!name) return false;
          bridge.createGlobalVar(m.id, {
            name,
            rustType: vals.rustType || "i32",
            initialValue: (vals.initialValue || "0").trim(),
            minValue: (vals.minValue || "").trim(),
            maxValue: (vals.maxValue || "").trim(),
          });
        },
      });
    });

    $("btnAddEvent").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      openElementModal({
        title: "Add Event Definition",
        confirmLabel: "Add Event",
        fields: [
          { name: "name", label: "Event Name (PascalCase)", value: "Step" },
          {
            name: "payloadType",
            label: "Optional Payload Type",
            type: "select",
            options: ["", "i32", "u32", "f64", "bool", "String"],
            value: "",
          },
        ],
        onConfirm(vals) {
          const name = (vals.name || "").trim();
          if (!name) return false;
          bridge.createEventDef(m.id, {
            name,
            payloadType: vals.payloadType || "",
          });
        },
      });
    });

    // Canvas fixed-layout & badge controls
    $("btnConnectMode").addEventListener("click", () => {
      state.connectMode = !state.connectMode;
      state.connectSourceId = null;
      $("btnConnectMode").classList.toggle("btn-active", state.connectMode);
      renderCanvas();
      if (state.connectMode) toast("Click source state, then destination state", "ok");
    });

    $("btnLayoutDir").addEventListener("click", () => {
      state.layoutDirection = state.layoutDirection === "LR" ? "TB" : "LR";
      $("btnLayoutDir").textContent = `⇄ ${state.layoutDirection}`;
      renderCanvas();
    });

    $("btnEdgeLabels").addEventListener("click", () => {
      state.compactLabels = !state.compactLabels;
      $("btnEdgeLabels").classList.toggle("btn-active", state.compactLabels);
      $("btnEdgeLabels").textContent = state.compactLabels ? "🏷 Badges" : "🏷 Full Text";
      renderCanvas();
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
        },
        `Update State ${st.name}`,
      );
      toast(`Saved ${st.name} design attributes`, "ok");
    });

    const toggleExpand = () => {
      const ws = $("workspaceGrid");
      const expanded = ws.classList.toggle("editor-expanded");
      $("btnExpandEditor").textContent = expanded ? "⇒ Narrow" : "⇔ Wide";
      $("btnExpandTransEditor").textContent = expanded ? "⇒ Narrow" : "⇔ Wide";
      if (monacoEditor) setTimeout(() => monacoEditor.layout(), 180);
      if (transActionEditor) setTimeout(() => transActionEditor.layout(), 180);
    };
    $("btnExpandEditor").addEventListener("click", toggleExpand);
    $("btnExpandTransEditor").addEventListener("click", toggleExpand);

    $("btnSaveCodeCache").addEventListener("click", () => saveOrCommitActiveStateHook(false));
    $("btnCommitState").addEventListener("click", () => saveOrCommitActiveStateHook(true));

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

    // Transition Inspector actions (live guard validation + exclusivity check + dependsOn sync)
    $("inpTransGuard").addEventListener("input", () => {
      renderGuardLivePanels(selectedTransitionObj());
    });
    $("inpTransEvent").addEventListener("input", () => {
      renderGuardLivePanels(selectedTransitionObj());
    });

    $("btnSaveTransition").addEventListener("click", () => {
      const m = activeMachine();
      const tr = selectedTransitionObj();
      if (!m || !tr) return;
      const name = $("inpTransName").value.trim() || tr.name;
      const event = $("inpTransEvent").value.trim() || "Tick";
      const guard = $("inpTransGuard").value.trim();
      const reenter = Boolean($("inpTransReenter").checked);
      const currentAction = getLiveTransitionAction(tr);
      const srcSt = m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
      const tempMachine = buildTempMachineWithTransitionOverride(m, tr, {
        name,
        event,
        guard,
        reenter,
        action: currentAction,
      });
      const recomposedSrc = srcSt ? RustyContract.composeStateModuleRs(tempMachine, srcSt).code : "";
      const deps = RustyAnalyzer.extractDependencies("", m, {
        triggerEvent: event,
        guardText: guard,
        actionText: currentAction,
      });
      bridge.updateTransitionAndDeps(
        tr.id,
        { name, event, guard, reenter },
        deps.memberIds,
        RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
        `Update Transition ${name} & dependsOn`,
        srcSt ? { stateId: srcSt.id, codeCache: recomposedSrc } : null,
      );
      state.transLoadedActionKey = null;
      toast("Saved transition guard & metadata", "ok");
    });

    $("btnSaveTransAction").addEventListener("click", () => saveOrCommitTransitionAction(false));
    $("btnCommitTransAction").addEventListener("click", () => saveOrCommitTransitionAction(true));

    $("btnDeleteTransition").addEventListener("click", () => {
      const tr = selectedTransitionObj();
      if (!tr) return;
      bridge.deleteNode(tr.id, tr.name);
      state.selectedType = null;
      state.selectedId = null;
    });

    // GitBar actions
    $("btnConnectRepo").addEventListener("click", openRepoModal);
    $("btnConfirmRepoBind").addEventListener("click", confirmRepoBind);
    document.querySelectorAll('input[name="repoConnectMode"]').forEach((radio) => {
      radio.addEventListener("change", updateRepoModalModeUI);
    });

    $("btnPullAll").addEventListener("click", async () => {
      const m = activeMachine();
      if (!m) return;
      for (const st of m.states) {
        const eff = RustyContract.resolveStateGitLink(m, st);
        if (eff.gitOwner && eff.gitRepo && eff.gitPath) {
          await pullStateFromGitHub(st);
        }
      }
    });
    $("btnPushCrate").addEventListener("click", async () => {
      const m = activeMachine();
      if (!m || !m.gitOwner || !m.gitRepo) {
        toast("Connect a Git repository first", "warn");
        return;
      }
      const files = RustyCodegen.generateCrateFiles(m);
      const changes = Object.entries(files).map(([relPath, content]) => ({
        path: RustyContract.resolveCrateFilePath(m, relPath),
        content,
        mode: "100644",
      }));
      try {
        const res = await gitClient.commit({
          owner: m.gitOwner,
          repo: m.gitRepo,
          branch: m.gitBranch || "main",
          message: `rusty: push standalone crate ${m.crateName}`,
          changes,
          projectId: bridge.projectId,
        });
        if (res.conflict) {
          openConflictModal(res.body, {
            owner: m.gitOwner,
            repo: m.gitRepo,
            branch: m.gitBranch || "main",
            states: m.states,
            message: `rusty: push standalone crate ${m.crateName}`,
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

    // Element modal confirm
    $("btnConfirmElementModal").addEventListener("click", () => {
      if (state.elementModalConfirm) state.elementModalConfirm();
    });

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

  function getSelectedConnectMode() {
    const checked = document.querySelector('input[name="repoConnectMode"]:checked');
    return checked ? checked.value : "bind";
  }

  function updateRepoModalModeUI() {
    const mode = getSelectedConnectMode();
    document.querySelectorAll("[data-connect-card]").forEach((card) => {
      card.classList.toggle("selected", card.dataset.connectCard === mode);
    });
    $("importOptionsBox").classList.toggle("hidden", mode !== "import");
    $("btnConfirmRepoBind").textContent = mode === "import" ? "Connect & Import" : "Connect Repository";
  }

  async function openRepoModal() {
    const m = activeMachine();
    if (!m) return;
    if (m.gitOwner && m.gitRepo) {
      toast(`"${m.name}" is already connected to ${m.gitOwner}/${m.gitRepo}`, "ok");
      return;
    }

    $("modalGitOwner").value = "";
    $("modalGitRepo").value = m.gitRepo || "";
    $("modalGitBranch").value = m.gitBranch || "dev";
    $("modalGitDir").value = m.gitPath || `examples/${RustyContract.toSnakeCase(m.name)}`;
    $("modalImportMachineName").value = "";
    $("repoModalStatus").textContent = "";

    const bindRadio = document.querySelector('input[name="repoConnectMode"][value="bind"]');
    if (bindRadio) bindRadio.checked = true;
    updateRepoModalModeUI();

    const warnEl = $("modalImportWarning");
    if (m.states && m.states.length > 0) {
      warnEl.textContent = `Importing will replace the current draft elements of "${m.name}" (${m.states.length} state(s)) with the Rust machine found in this repository directory.`;
      warnEl.classList.remove("hidden");
    } else {
      warnEl.textContent = "";
      warnEl.classList.add("hidden");
    }

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
      dropdown.innerHTML = '<option value="">(Sign in via User Profile to browse repositories)</option>';
      $("repoPickerStatus").textContent = err.message;
    }
  }

  async function confirmRepoBind() {
    const m = activeMachine();
    if (!m) return;
    if (m.gitOwner && m.gitRepo) {
      $("repoModal").classList.add("hidden");
      return;
    }

    const gitOwner = $("modalGitOwner").value.trim();
    const gitRepo = $("modalGitRepo").value.trim();
    const gitBranch = $("modalGitBranch").value.trim() || "main";
    const gitPath = $("modalGitDir").value.trim();
    if (!gitOwner || !gitRepo || !gitPath) {
      toast("Enter Owner, Repo, and Machine Directory", "warn");
      return;
    }

    const mode = getSelectedConnectMode();
    if (mode === "bind") {
      bridge.bindMachineRepo(m.id, {
        gitOwner,
        gitRepo,
        gitBranch,
        gitPath,
        clearStateOverrides: true,
        stateIds: m.states.map((s) => s.id),
      });
      $("repoModal").classList.add("hidden");
      toast(`Connected ${gitOwner}/${gitRepo}@${gitBranch} (${gitPath})`, "ok");
      return;
    }

    const machineName = $("modalImportMachineName").value.trim();
    const status = $("repoModalStatus");
    const btn = $("btnConfirmRepoBind");
    btn.disabled = true;
    status.textContent = `Sweeping ${gitOwner}/${gitRepo}/${gitPath}@${gitBranch}…`;

    try {
      const filesMap = await gitClient.sweepDirectoryFiles({
        owner: gitOwner,
        repo: gitRepo,
        dirPath: gitPath,
        ref: gitBranch,
        projectId: bridge.projectId,
      });
      const { model, summary } = RustyImporter.parseCrateFilesToModel(filesMap, {
        owner: gitOwner,
        repo: gitRepo,
        branch: gitBranch,
        dirPath: gitPath,
        machineName,
      });
      bridge.populateMachineFromImport(m.id, model);
      state.selectedType = null;
      state.selectedId = null;
      state.dirtyStateIds.clear();
      state.dirtyTransIds.clear();
      state.draftEntryByStateId.clear();
      state.draftExitByStateId.clear();
      state.draftActionByTransId.clear();
      state.fetchedStateIds.clear();
      state.editorLoadedHookKey = null;
      state.transLoadedActionKey = null;
      $("repoModal").classList.add("hidden");
      toast(
        `Connected & imported ${model.name} (${summary.states} states, ${summary.transitions} transitions)`,
        "ok",
      );
      renderAll();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      toast(`Connect & import failed: ${err.message}`, "err");
    } finally {
      btn.disabled = false;
    }
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
