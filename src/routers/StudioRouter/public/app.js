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
    centerTab: "canvas", // 'canvas' | 'crate'
    minimapCollapsed: false,
    codeEditorSession: null,
    connectMode: false,
    connectSourceId: null,
    dirtyStateIds: new Set(),
    dirtyTransIds: new Set(),
    fetchedStateIds: new Set(),
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
    pendingTransitionDraft: null,
    lastReadOnlyToastAt: 0,
    // Hybrid commit-pinned Git workspace state
    workspaceStatus: null,
    workspaceStatusByMachineId: new Map(),
    syncedMachineKeys: new Set(),
    workspaceQueue: Promise.resolve(),
    commitReviewStatus: null,
    commitValidationErrors: [],
  };

  const $ = (id) => document.getElementById(id);
  let centerCodeEditor = null;

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
    const sess = state.codeEditorSession;
    if (sess && sess.mode === "state-hook" && sess.stateId === st.id) {
      return kind === "entry" ? sess.draftEntry : sess.draftExit;
    }
    return kind === "entry" ? st.entryCode || "" : st.exitCode || "";
  }

  function getLiveTransitionAction(tr) {
    if (!tr) return "";
    const sess = state.codeEditorSession;
    if (sess && sess.mode === "transition-action" && sess.transitionId === tr.id) {
      return sess.draftAction;
    }
    return tr.action || "";
  }

  function openElementModal({ title, fields, confirmLabel = "Save", secondaryAction = null, onConfirm }) {
    $("elementModalTitle").textContent = title;
    $("btnConfirmElementModal").textContent = confirmLabel;
    const body = $("elementModalBody");
    body.innerHTML = "";

    const footer = $("elementModal").querySelector(".modal-footer");
    footer.querySelectorAll("[data-element-secondary]").forEach((el) => el.remove());

    for (const f of fields) {
      const wrap = document.createElement("label");
      wrap.className = "form-row";
      const span = document.createElement("span");
      span.textContent = f.label;
      wrap.appendChild(span);

      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const item of f.options || []) {
          const optVal = typeof item === "object" && item !== null ? item.value : item;
          const optLabel =
            typeof item === "object" && item !== null
              ? item.label
              : optVal || "(none — unit event)";
          const opt = document.createElement("option");
          opt.value = optVal;
          opt.textContent = optLabel;
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

    const collectValues = () => {
      const values = {};
      for (const f of fields) {
        values[f.name] = $(`em_${f.name}`).value;
      }
      return values;
    };

    if (secondaryAction && secondaryAction.label) {
      const secBtn = document.createElement("button");
      secBtn.type = "button";
      if (secondaryAction.id) secBtn.id = secondaryAction.id;
      secBtn.dataset.elementSecondary = "true";
      secBtn.className = secondaryAction.className || "btn btn-sm btn-accent modal-secondary-btn";
      secBtn.textContent = secondaryAction.label;
      if (secondaryAction.title) secBtn.title = secondaryAction.title;
      secBtn.addEventListener("click", () => {
        if (typeof secondaryAction.onClick === "function") {
          secondaryAction.onClick(collectValues());
        }
      });
      footer.prepend(secBtn);
    }

    state.elementModalConfirm = () => {
      const values = collectValues();
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

  function openTransitionCreateModal(defaultSrcId = null, defaultDstId = null, draft = null) {
    const m = activeMachine();
    if (!m || !m.states || m.states.length === 0) {
      toast("Create at least one State before adding a transition", "warn");
      return;
    }
    const stateOpts = m.states.map((s) => ({ value: s.id, label: s.name }));
    const initialSrc = defaultSrcId && m.states.some((s) => s.id === defaultSrcId) ? defaultSrcId : m.states[0].id;
    const initialDst = defaultDstId && m.states.some((s) => s.id === defaultDstId) ? defaultDstId : initialSrc;
    const evOptions = m.events.map((e) => e.name);
    const initialEvent =
      draft && draft.event !== undefined
        ? draft.event
        : evOptions[0] || "Tick";

    openElementModal({
      title: "Add Transition",
      confirmLabel: "Create Transition",
      secondaryAction: {
        id: "btnPickTransitionOnDiagram",
        label: "🎯 Pick on Diagram…",
        title: "Switch to diagram mode to click Source and Target states visually",
        onClick(vals) {
          state.pendingTransitionDraft = {
            event: vals.event,
            name: vals.name,
            guard: vals.guard,
          };
          $("elementModal").classList.add("hidden");
          state.elementModalConfirm = null;
          startTransitionCreation(null);
        },
      },
      fields: [
        {
          name: "srcId",
          label: "Source State",
          type: "select",
          options: stateOpts,
          value: initialSrc,
        },
        {
          name: "dstId",
          label: "Target State",
          type: "select",
          options: stateOpts,
          value: initialDst,
        },
        {
          name: "event",
          label: "Trigger Event",
          type: evOptions.length ? "select" : "text",
          options: evOptions,
          value: initialEvent,
        },
        {
          name: "name",
          label: "Short Transition Name",
          placeholder: "e.g. step_count",
          value: (draft && draft.name) || "",
        },
        {
          name: "guard",
          label: "Pure Guard Expression (optional)",
          placeholder: "e.g. count < limit",
          value: (draft && draft.guard) || "",
        },
      ],
      onConfirm(vals) {
        const srcId = vals.srcId;
        const dstId = vals.dstId;
        const srcSt = m.states.find((s) => s.id === srcId);
        const dstSt = m.states.find((s) => s.id === dstId);
        if (!srcSt || !dstSt) {
          toast("Select both Source and Target states", "warn");
          return false;
        }
        state.pendingTransitionDraft = null;
        const isSelf = srcId === dstId;
        const eventName = (vals.event || "").trim() || "Tick";
        const guard = (vals.guard || "").trim();
        const shortName =
          (vals.name || "").trim() ||
          RustyContract.toSnakeCase(`${eventName}_${dstSt.name || "next"}`);
        const deps = RustyAnalyzer.extractDependencies("", m, {
          triggerEvent: eventName,
          guardText: guard,
          actionText: "",
        });
        const tid = bridge.createTransition(m.id, {
          srcId,
          dstId,
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
        toast(`Created ${isSelf ? "self-transition" : "transition"} ${srcSt.name} → ${dstSt.name} (${eventName})`, "ok");
        selectTransitionForEditing(tid);
        const nextM = activeMachine();
        if (nextM) syncMachineArtifactsToWorkspace(nextM);
      },
    });
  }

  function startTransitionCreation(preselectedSourceId = null) {
    const m = activeMachine();
    if (!m || !m.states || m.states.length === 0) {
      toast("Create at least one State before adding a transition", "warn");
      return;
    }
    if (state.codeEditorSession && !confirmDiscardCodeEditorIfDirty()) {
      return;
    }
    if (state.codeEditorSession) {
      closeCodeEditorSession(false);
    }
    state.centerTab = "canvas";
    state.connectMode = true;
    state.connectSourceId =
      preselectedSourceId && m.states.some((s) => s.id === preselectedSourceId)
        ? preselectedSourceId
        : null;
    updateCanvasTooltip(null);
    renderAll();
  }

  function cancelTransitionCreation() {
    state.pendingTransitionDraft = null;
    if (!state.connectMode) return;
    state.connectMode = false;
    state.connectSourceId = null;
    renderAll();
  }

  const minimapCanvas = new StateMachineCanvas($("minimapSvg"), {});

  const canvas = new StateMachineCanvas($("smSvg"), {
    onSelectState(id) {
      if (state.rightHidden) togglePane("right", false);
      selectStateForEditing(id);
    },
    onSelectTransition(id) {
      if (state.rightHidden) togglePane("right", false);
      selectTransitionForEditing(id);
    },
    onDoubleClickState(id) {
      openStateHookEditor(id, "entry");
    },
    onDoubleClickTransition(id) {
      openTransitionActionEditor(id);
    },
    onBackgroundClick() {
      if (state.connectMode) {
        return;
      }
      state.selectedType = null;
      state.selectedId = null;
      updateCanvasTooltip(null);
      renderAll();
    },
    onHoverTransition: updateCanvasTooltip,
    onConnectClick(stateId) {
      const m = activeMachine();
      if (!m) return;
      if (!state.connectSourceId) {
        state.connectSourceId = stateId;
        renderCanvas();
        return;
      }
      const srcId = state.connectSourceId;
      const draft = state.pendingTransitionDraft;
      state.pendingTransitionDraft = null;
      state.connectSourceId = null;
      state.connectMode = false;
      renderCanvas();
      openTransitionCreateModal(srcId, stateId, draft);
    },
  });

  function selectStateForEditing(id) {
    state.selectedType = "state";
    state.selectedId = id;
    renderAll();
  }

  function selectTransitionForEditing(id) {
    state.selectedType = "transition";
    state.selectedId = id;
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

  function renderCenterMode() {
    const editing = Boolean(state.codeEditorSession);
    document.querySelectorAll("[data-center-tab]").forEach((b) => {
      const tab = b.dataset.centerTab;
      b.classList.toggle("active", !editing && tab === state.centerTab);
    });
    $("tabCanvas").classList.toggle("active", !editing && state.centerTab === "canvas");
    $("tabCodeEditor").classList.toggle("active", editing);
    $("tabCrate").classList.toggle("active", !editing && state.centerTab === "crate");
    $("canvasToolbar").classList.toggle("hidden", editing || state.centerTab !== "canvas");
    $("designMinimapCard").classList.toggle("collapsed", state.minimapCollapsed);
    $("btnToggleMinimap").textContent = state.minimapCollapsed ? "+" : "−";

    if (editing && centerCodeEditor) {
      requestAnimationFrame(() => {
        if (centerCodeEditor) centerCodeEditor.layout();
      });
    }
  }

  function confirmDiscardCodeEditorIfDirty() {
    const sess = state.codeEditorSession;
    if (!sess || !sess.dirty) return true;
    return window.confirm("Discard unsaved code edits and return to the design?");
  }

  function syncCodeEditorHeaderButtons(isConnected) {
    const sess = state.codeEditorSession;
    if (!sess) return;
    const showGit = Boolean(isConnected);
    $("btnPullCodeEditor").classList.toggle("hidden", !(showGit && sess.mode === "state-hook"));
    $("btnSaveCodeEditor").textContent = "Save to Workspace (⌘S)";
    $("codeEditorDirtyHint").textContent = sess.dirty ? "Unsaved edits" : "";
  }

  function loadCenterEditorFromSession() {
    const m = activeMachine();
    const sess = state.codeEditorSession;
    if (!m || !sess || !centerCodeEditor) return;

    if (sess.mode === "state-hook") {
      const st = m.states.find((s) => s.id === sess.stateId);
      if (!st) return;
      const hookKind = sess.hookKind === "exit" ? "exit" : "entry";
      const tempSt = { ...st, entryCode: sess.draftEntry, exitCode: sess.draftExit };
      const composed = RustyContract.composeStateModuleRs(m, tempSt, {
        editableHook: hookKind,
      });
      const span = composed.hooks[hookKind];
      const eff = RustyContract.resolveStateGitLink(m, st);
      const isConnected = Boolean(eff && eff.gitOwner && eff.gitRepo);
      const snakeFile = `${RustyContract.toSnakeCase(st.name)}.rs`;

      $("codeEditorKindPill").className = "kind-pill";
      $("codeEditorKindPill").textContent = "State Hook";
      $("codeEditorTitle").textContent = `${st.name} :: ${span.fnName}`;
      $("codeEditorFilePath").textContent = isConnected
        ? `${eff.gitOwner}/${eff.gitRepo}@${eff.gitBranch}:${eff.gitPath}`
        : eff.gitPath || `src/states/${snakeFile}`;
      $("codeEditorHookSwitcher").classList.remove("hidden");
      document.querySelectorAll("[data-editor-hook]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.editorHook === hookKind);
      });
      $("codeEditorSubtitle").textContent = `${span.fnName}(...) in ${snakeFile} · surrounding lines read-only`;
      syncCodeEditorHeaderButtons(isConnected);

      centerCodeEditor.setContext(m, tempSt, { kind: hookKind, payloadType: "" });
      centerCodeEditor.setContextualFile({
        code: composed.code,
        editableStartLine: span.startLine,
        editableEndLine: span.endLine,
        hookContext: { kind: hookKind, payloadType: "" },
        stateId: st.id,
        reveal: true,
      });
      requestAnimationFrame(() => {
        centerCodeEditor.layout();
        centerCodeEditor.revealEditableRegion();
      });
      return;
    }

    const tr = m.transitions.find((t) => t.id === sess.transitionId);
    const srcSt = tr && m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
    if (!tr || !srcSt) return;

    const liveName = ($("inpTransName") && $("inpTransName").value.trim()) || tr.name;
    const liveEvent = ($("inpTransEvent") && $("inpTransEvent").value.trim()) || tr.event;
    const liveGuard = $("inpTransGuard") ? $("inpTransGuard").value.trim() : tr.guard || "";
    const liveReenter = $("inpTransReenter") ? Boolean($("inpTransReenter").checked) : Boolean(tr.reenter);

    const tempMachine = buildTempMachineWithTransitionOverride(m, tr, {
      name: liveName,
      event: liveEvent,
      guard: liveGuard,
      reenter: liveReenter,
      action: sess.draftAction,
    });
    const trKey = RustyContract.transitionKey(tr);
    const composed = RustyContract.composeStateModuleRs(tempMachine, srcSt, {
      editableHook: "transition",
      includeTransitionKey: trKey,
    });
    const span = composed.hooks.transitions[trKey];
    if (!span) return;

    const eff = RustyContract.resolveStateGitLink(tempMachine, srcSt);
    const isConnected = Boolean(eff && eff.gitOwner && eff.gitRepo);
    const snakeFile = `${RustyContract.toSnakeCase(srcSt.name)}.rs`;

    $("codeEditorKindPill").className = "kind-pill kind-transition";
    $("codeEditorKindPill").textContent = "Action Hook";
    $("codeEditorTitle").textContent = `${tr.srcName} → ${tr.dstName} (${liveEvent})`;
    $("codeEditorFilePath").textContent = isConnected
      ? `${eff.gitOwner}/${eff.gitRepo}@${eff.gitBranch}:${eff.gitPath}`
      : eff.gitPath || `src/states/${snakeFile}`;
    $("codeEditorHookSwitcher").classList.add("hidden");
    $("codeEditorSubtitle").textContent = `${span.fnName}(...) in ${snakeFile} · surrounding lines read-only`;
    syncCodeEditorHeaderButtons(isConnected);

    const hookCtx = { kind: "transition", payloadType: span.payloadType || "" };
    centerCodeEditor.setContext(tempMachine, srcSt, hookCtx);
    centerCodeEditor.setContextualFile({
      code: composed.code,
      editableStartLine: span.startLine,
      editableEndLine: span.endLine,
      hookContext: hookCtx,
      stateId: srcSt.id,
      reveal: true,
    });
    requestAnimationFrame(() => {
      centerCodeEditor.layout();
      centerCodeEditor.revealEditableRegion();
    });
  }

  async function openStateHookEditor(stateId, hookKind = "entry") {
    const m = activeMachine();
    if (!m) return;
    const st = m.states.find((s) => s.id === stateId);
    if (!st) return;

    const normalizedKind = hookKind === "exit" ? "exit" : "entry";
    const existing = state.codeEditorSession;
    if (existing && existing.mode === "state-hook" && existing.stateId === st.id) {
      switchCodeEditorStateHook(normalizedKind);
      return;
    }
    if (existing && !confirmDiscardCodeEditorIfDirty()) {
      return;
    }

    state.connectMode = false;
    state.connectSourceId = null;
    state.selectedType = "state";
    state.selectedId = st.id;
    state.codeEditorSession = {
      mode: "state-hook",
      stateId: st.id,
      hookKind: normalizedKind,
      draftEntry: st.entryCode || "",
      draftExit: st.exitCode || "",
      dirty: false,
    };
    $("gitFetchStatus").textContent = "";
    renderAll();
    loadCenterEditorFromSession();
    if (centerCodeEditor && centerCodeEditor.editor) centerCodeEditor.editor.focus();

    const eff = RustyContract.resolveStateGitLink(m, st);
    if (
      eff.gitOwner &&
      eff.gitRepo &&
      eff.gitPath &&
      state.gitStatus.hasGithubToken &&
      !state.fetchedStateIds.has(st.id)
    ) {
      await pullStateFromGitHub(st, { silentNotFound: true });
    }
  }

  function openTransitionActionEditor(transitionId) {
    const m = activeMachine();
    if (!m) return;
    const tr = m.transitions.find((t) => t.id === transitionId);
    if (!tr) return;
    const srcSt = m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
    if (!srcSt) {
      toast("Source state not found for this transition", "err");
      return;
    }

    const existing = state.codeEditorSession;
    if (existing && existing.mode === "transition-action" && existing.transitionId === tr.id) {
      renderCenterMode();
      loadCenterEditorFromSession();
      if (centerCodeEditor && centerCodeEditor.editor) centerCodeEditor.editor.focus();
      return;
    }
    if (existing && !confirmDiscardCodeEditorIfDirty()) {
      return;
    }

    state.connectMode = false;
    state.connectSourceId = null;
    state.selectedType = "transition";
    state.selectedId = tr.id;
    state.codeEditorSession = {
      mode: "transition-action",
      transitionId: tr.id,
      stateId: srcSt.id,
      draftAction: tr.action || "",
      dirty: false,
    };
    $("gitFetchStatus").textContent = "";
    renderAll();
    loadCenterEditorFromSession();
    if (centerCodeEditor && centerCodeEditor.editor) centerCodeEditor.editor.focus();
  }

  function switchCodeEditorStateHook(nextHookKind) {
    const sess = state.codeEditorSession;
    if (!sess || sess.mode !== "state-hook" || !centerCodeEditor) return;
    const body = centerCodeEditor.getEditableBody();
    if (sess.hookKind === "entry") sess.draftEntry = body;
    else sess.draftExit = body;
    sess.hookKind = nextHookKind === "exit" ? "exit" : "entry";
    loadCenterEditorFromSession();
    if (centerCodeEditor && centerCodeEditor.editor) centerCodeEditor.editor.focus();
  }

  function closeCodeEditorSession(rerender = true) {
    const sess = state.codeEditorSession;
    if (sess) {
      if (sess.mode === "state-hook") state.dirtyStateIds.delete(sess.stateId);
      else state.dirtyTransIds.delete(sess.transitionId);
    }
    state.codeEditorSession = null;
    state.centerTab = "canvas";
    $("codeEditorDirtyHint").textContent = "";
    if (centerCodeEditor) centerCodeEditor.clearRustcMarkers();
    if (rerender) renderAll();
  }

  function cancelCodeEditorSession() {
    closeCodeEditorSession(true);
    toast("Discarded unsaved editor changes", "ok");
  }

  async function saveCodeEditorSession(doGitCommit = false) {
    const m = activeMachine();
    const sess = state.codeEditorSession;
    if (!m || !sess || !centerCodeEditor) return;

    const currentBody = centerCodeEditor.getEditableBody();
    const check = centerCodeEditor.runInstantAnalysis();
    if (doGitCommit && check && check.stats.errors > 0) {
      const proceed = window.confirm(
        `Edit-time analyzer found ${check.stats.errors} error(s). Save & Push anyway?`,
      );
      if (!proceed) return;
    }

    if (sess.mode === "state-hook") {
      const st = m.states.find((s) => s.id === sess.stateId);
      if (!st) return;
      if (sess.hookKind === "entry") sess.draftEntry = currentBody;
      else sess.draftExit = currentBody;

      const entryCode = sess.draftEntry;
      const exitCode = sess.draftExit;
      const updatedState = { ...st, entryCode, exitCode };
      const composed = RustyContract.composeStateModuleRs(m, updatedState).code;
      const deps = RustyAnalyzer.extractDependencies(`${entryCode}\n${exitCode}`, m);

      bridge.updateStateHookAndCode(
        st.id,
        { entryCode, exitCode, codeCache: composed },
        deps.memberIds,
        RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
        `Save ${st.name} (${sess.hookKind} hook & dependsOn)`,
      );

      sess.dirty = false;
      state.dirtyStateIds.delete(st.id);
      const nextM = activeMachine();
      if (nextM) syncMachineArtifactsToWorkspace(nextM);

      toast(`Saved ${st.name} hooks to workspace`, "ok");
      closeCodeEditorSession(true);
      return;
    }

    const tr = m.transitions.find((t) => t.id === sess.transitionId);
    if (!tr) return;
    const srcSt = m.states.find((s) => s.id === tr.srcId || s.name === tr.srcName);
    sess.draftAction = currentBody;

    const liveName = ($("inpTransName") && $("inpTransName").value.trim()) || tr.name;
    const liveEvent = ($("inpTransEvent") && $("inpTransEvent").value.trim()) || tr.event;
    const liveGuard = $("inpTransGuard") ? $("inpTransGuard").value.trim() : tr.guard || "";
    const liveReenter = $("inpTransReenter") ? Boolean($("inpTransReenter").checked) : Boolean(tr.reenter);

    const tempMachine = buildTempMachineWithTransitionOverride(m, tr, {
      name: liveName,
      event: liveEvent,
      guard: liveGuard,
      reenter: liveReenter,
      action: currentBody,
    });
    const composedSrc = srcSt ? RustyContract.composeStateModuleRs(tempMachine, srcSt).code : "";
    const deps = RustyAnalyzer.extractDependencies("", m, {
      triggerEvent: liveEvent,
      guardText: liveGuard,
      actionText: currentBody,
    });

    bridge.updateTransitionAndDeps(
      tr.id,
      { name: liveName, event: liveEvent, guard: liveGuard, reenter: liveReenter, action: currentBody },
      deps.memberIds,
      RustyAnalyzer.serializeDepsSnapshot(deps.snapshot),
      `Save Transition ${liveName} action & dependsOn`,
      srcSt ? { stateId: srcSt.id, codeCache: composedSrc } : null,
    );

    sess.dirty = false;
    state.dirtyTransIds.delete(tr.id);
    const nextM = activeMachine();
    if (nextM) syncMachineArtifactsToWorkspace(nextM);

    toast(`Saved transition action (${liveName}) to workspace`, "ok");
    closeCodeEditorSession(true);
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
    if (centerCodeEditor) setTimeout(() => centerCodeEditor.layout(), 180);
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

    centerCodeEditor = new window.MonacoStateEditor($("centerMonacoHost"), {
      onChange(bodyText) {
        const sess = state.codeEditorSession;
        const m = activeMachine();
        if (!sess || !m) return;
        sess.dirty = true;
        if (sess.mode === "state-hook") {
          if (sess.hookKind === "entry") sess.draftEntry = bodyText;
          else sess.draftExit = bodyText;
          state.dirtyStateIds.add(sess.stateId);
        } else {
          sess.draftAction = bodyText;
          state.dirtyTransIds.add(sess.transitionId);
        }
        $("codeEditorDirtyHint").textContent = "Unsaved edits";
        renderCanvas();
        renderMinimap();
      },
      onDiagnostics(result) {
        renderAnalyzerDiagnosticsFor(
          "codeEditorAnalyzerBadge",
          "codeEditorAnalyzerLatency",
          "codeEditorProblemsList",
          centerCodeEditor,
          result,
        );
      },
      onSaveShortcut() {
        if (!state.codeEditorSession || !activeMachine()) return;
        saveCodeEditorSession(false);
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
    await centerCodeEditor.init();

    bridge.onModelChange((machines) => {
      state.machines = machines;
      if (!state.activeMachineId || !machines.some((m) => m.id === state.activeMachineId)) {
        state.activeMachineId = machines[0] ? machines[0].id : null;
      }
      rebuildSimulation(false);
      renderAll();
      const curM = activeMachine();
      if (curM) ensureMachineWorkspaceReady(curM);
      if (state.codeEditorSession && !state.codeEditorSession.dirty) {
        const m = activeMachine();
        const sess = state.codeEditorSession;
        if (m && sess.mode === "state-hook") {
          const st = m.states.find((s) => s.id === sess.stateId);
          if (st) {
            sess.draftEntry = st.entryCode || "";
            sess.draftExit = st.exitCode || "";
            loadCenterEditorFromSession();
          } else {
            closeCodeEditorSession(false);
          }
        } else if (m && sess.mode === "transition-action") {
          const tr = m.transitions.find((t) => t.id === sess.transitionId);
          if (tr) {
            sess.draftAction = tr.action || "";
            loadCenterEditorFromSession();
          } else {
            closeCodeEditorSession(false);
          }
        }
      }
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
      } else if (st.githubAppConfigured && st.authenticated) {
        setBadge("gitStatusBadge", "GitHub: Connect via User Profile", "badge-warn");
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

    const urlParams = new URLSearchParams(window.location.search || "");
    const reqProjectRaw = urlParams.get("project") || "";
    const reqProjectPlus = reqProjectRaw.replace(/ /g, "+");
    const reqBranch = urlParams.get("branch") || null;
    const reqCommit = urlParams.get("commit") || null;

    if (projects.length === 0) {
      try {
        toast("Creating starter project 'RustyDemo' from RustySeed…", "ok");
        const created = await bridge.createProjectFromSeed("RustyDemo", state.info.defaultSeed || "RustySeed");
        state.projects = await bridge.listProjects();
        renderProjectSelect();
        const pid = created.projectId || (state.projects[0] && state.projects[0]._id);
        if (pid) {
          $("projectSelect").value = pid;
          await openSelectedProject(pid, null, null);
        }
      } catch (err) {
        toast(`Could not auto-create starter project: ${err.message}`, "warn");
      }
      return;
    }

    const matched = reqProjectRaw
      ? projects.find((p) => p._id === reqProjectRaw || p._id === reqProjectPlus)
      : null;
    const targetProject = matched || projects[0];
    const branchToOpen = matched ? reqBranch : null;
    const commitToOpen = matched && !reqBranch ? reqCommit : null;

    $("projectSelect").value = targetProject._id;
    await openSelectedProject(targetProject._id, branchToOpen, commitToOpen);
  }

  async function openSelectedProject(projectId, branchName = null, commitHash = null) {
    if (!projectId) return;
    let resolvedBranch = branchName;
    if (!resolvedBranch && !commitHash) {
      const proj = state.projects.find((p) => p._id === projectId);
      if (proj && proj.branches) {
        const bNames = Object.keys(proj.branches);
        if (bNames.length > 0 && !Object.hasOwn(proj.branches, "master")) {
          resolvedBranch = bNames[0];
        }
      }
    }
    try {
      await bridge.openProject(projectId, resolvedBranch, commitHash);
      const refLabel = bridge.branchName || (bridge.commitHash ? bridge.commitHash.slice(0, 8) : "master");
      setBadge("gmeStatusBadge", `WebGME: ${refLabel}`, "badge-ok");
      if (window.history && typeof window.history.replaceState === "function") {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("project", projectId);
        if (bridge.branchName) {
          nextUrl.searchParams.set("branch", bridge.branchName);
          nextUrl.searchParams.delete("commit");
        } else if (bridge.commitHash) {
          nextUrl.searchParams.set("commit", bridge.commitHash);
          nextUrl.searchParams.delete("branch");
        }
        window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
      }
      toast(`Opened WebGME project ${projectId} (${refLabel})`, "ok");
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
    renderCenterMode();
    renderCanvas();
    renderMinimap();
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

  // ---- Hybrid Commit-Pinned Git Workspace Helpers ----

  function workspaceParamsForMachine(m) {
    if (!m) return null;
    const isGithub = Boolean(m.gitOwner && m.gitRepo);
    if (isGithub) {
      return {
        mode: "github",
        projectId: bridge.projectId || "default",
        webgmeBranch: bridge.branchName || "master",
        owner: m.gitOwner,
        repo: m.gitRepo,
        rootPath: RustyContract.resolveMachineCrateRoot(m),
        baseCommitSha: m.gitBaseCommitSha || "",
        targetBranch: m.gitBranch || "main",
      };
    }
    return {
      mode: "local",
      projectId: bridge.projectId || "default",
      webgmeBranch: bridge.branchName || "master",
      owner: "local",
      repo: RustyContract.toCrateName(m.crateName || m.name),
      rootPath: "",
    };
  }

  function workspaceKeyTag(params) {
    if (!params) return "";
    return `${params.projectId}::${params.webgmeBranch}::${params.mode}::${params.owner}/${params.repo}::${params.rootPath || ""}`;
  }

  function enqueueWorkspaceTask(taskFn) {
    state.workspaceQueue = state.workspaceQueue.then(taskFn, taskFn);
    return state.workspaceQueue;
  }

  function renderWorkspaceStatusPill() {
    const pill = $("workspaceStatusPill");
    if (!pill) return;
    const m = activeMachine();
    if (!m) {
      pill.textContent = "● 0 pending";
      pill.className = "badge badge-muted ws-status-pill";
      return;
    }
    const ws = state.workspaceStatusByMachineId.get(m.id) || state.workspaceStatus;
    const count = ws && typeof ws.dirtyCount === "number" ? ws.dirtyCount : 0;
    const isGithub = Boolean(m.gitOwner && m.gitRepo);

    if (!isGithub) {
      pill.textContent = `Hybrid Store (${count || "ready"})`;
      pill.className = "badge badge-ok ws-status-pill";
      return;
    }

    const syncState = (ws && ws.syncState) || (count > 0 ? "dirty" : "clean");
    if (syncState === "diverged") {
      pill.textContent = `⚠ ${count} pending · upstream moved`;
      pill.className = "badge badge-err ws-status-pill";
    } else if (syncState === "behind") {
      pill.textContent = "↓ Upstream ahead";
      pill.className = "badge badge-warn ws-status-pill";
    } else if (count > 0) {
      pill.textContent = `● ${count} pending push`;
      pill.className = "badge badge-warn ws-status-pill";
    } else {
      pill.textContent = "✓ Clean vs pin";
      pill.className = "badge badge-ok ws-status-pill";
    }
  }

  async function refreshWorkspaceStatus(m, checkRemote = false) {
    const params = workspaceParamsForMachine(m);
    if (!params) return null;
    try {
      const status = await gitClient.getWorkspaceStatus(params, {
        checkRemote: Boolean(checkRemote && params.mode === "github" && state.gitStatus.hasGithubToken),
        includeDiff: false,
      });
      state.workspaceStatusByMachineId.set(m.id, status);
      if (activeMachine() && activeMachine().id === m.id) {
        state.workspaceStatus = status;
        renderWorkspaceStatusPill();
      }
      return status;
    } catch (_err) {
      return null;
    }
  }

  function syncMachineArtifactsToWorkspace(machine, extraOps = []) {
    const params = workspaceParamsForMachine(machine);
    if (!params) return Promise.resolve(null);
    const keyTag = workspaceKeyTag(params);

    const crateFiles = RustyCodegen.generateCrateFiles(machine);
    const excludedPaths = new Set();
    for (const op of extraOps || []) {
      if (op.op === "delete" && op.path) excludedPaths.add(op.path);
      if (op.op === "rename" && op.from) excludedPaths.add(op.from);
    }

    const ops = [];
    for (const op of extraOps || []) {
      if (op.op === "rename" || op.op === "delete") ops.push(op);
    }
    for (const [relPath, content] of Object.entries(crateFiles)) {
      const fullPath = RustyContract.resolveCrateFilePath(machine, relPath);
      if (excludedPaths.has(fullPath)) continue;
      ops.push({ op: "write", path: fullPath, content, mode: "100644" });
    }
    for (const op of extraOps || []) {
      if (op.op === "write") ops.push(op);
    }
    if (ops.length === 0) return Promise.resolve(null);

    return enqueueWorkspaceTask(async () => {
      try {
        await gitClient.patchWorkspaceOps(params, ops);
        state.syncedMachineKeys.add(keyTag);
        return await refreshWorkspaceStatus(machine, false);
      } catch (_err) {
        return null;
      }
    });
  }

  function ensureMachineWorkspaceReady(machine) {
    const params = workspaceParamsForMachine(machine);
    if (!params) return Promise.resolve(null);
    const keyTag = workspaceKeyTag(params);
    if (state.syncedMachineKeys.has(keyTag)) {
      return Promise.resolve(state.workspaceStatusByMachineId.get(machine.id) || null);
    }
    state.syncedMachineKeys.add(keyTag);

    if (params.mode === "github" && params.baseCommitSha) {
      return enqueueWorkspaceTask(() => refreshWorkspaceStatus(machine, true));
    }
    return syncMachineArtifactsToWorkspace(machine);
  }

  async function readVirtualCrateFilesForCheck(machine) {
    await state.workspaceQueue.catch(() => {});
    const params = workspaceParamsForMachine(machine);
    if (!params) return RustyCodegen.generateCrateFiles(machine);
    try {
      const tree = await gitClient.getWorkspaceTree(params, params.rootPath);
      const prefix = params.rootPath ? `${params.rootPath.replace(/\/+$/, "")}/` : "";
      const targetEntries = (tree.entries || []).filter((e) => {
        const rel = prefix && e.path.startsWith(prefix) ? e.path.slice(prefix.length) : e.path;
        return rel === "Cargo.toml" || (rel.startsWith("src/") && rel.endsWith(".rs"));
      });
      if (targetEntries.length === 0) {
        return RustyCodegen.generateCrateFiles(machine);
      }
      const files = {};
      await Promise.all(
        targetEntries.map(async (entry) => {
          const f = await gitClient.readWorkspaceFile(params, entry.path);
          const rel = prefix && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path;
          files[rel] = f.content;
        }),
      );
      return Object.keys(files).length > 0 ? files : RustyCodegen.generateCrateFiles(machine);
    } catch (_err) {
      return RustyCodegen.generateCrateFiles(machine);
    }
  }

  function renderGitBar() {
    const m = activeMachine();
    const isConnected = Boolean(m && m.gitOwner && m.gitRepo);
    if (!isConnected) {
      const crateSlug = m ? RustyContract.toCrateName(m.crateName || m.name) : "workspace";
      $("machineRepoDisplay").textContent = `Hybrid Local Store: local/${crateSlug}`;
      $("machineRepoDisplay").className = "repo-pill repo-local";
      $("btnConnectRepo").classList.toggle("hidden", !m);
      $("btnPullAll").classList.add("hidden");
      $("btnPushCrate").classList.add("hidden");
    } else {
      const shortSha = m.gitBaseCommitSha ? ` @ ${m.gitBaseCommitSha.slice(0, 7)}` : " @ HEAD";
      const rootDir = RustyContract.resolveMachineCrateRoot(m) || "repo root";
      $("machineRepoDisplay").textContent = `${m.gitOwner}/${m.gitRepo}${shortSha} → ${m.gitBranch || "main"} · ${rootDir}`;
      $("machineRepoDisplay").className = "repo-pill repo-connected";
      $("btnConnectRepo").classList.add("hidden");
      $("btnPullAll").classList.remove("hidden");
      $("btnPushCrate").classList.remove("hidden");
    }
    $("btnDownloadZip").disabled = !m;
    renderWorkspaceStatusPill();
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
    const transitionList = $("transitionList");
    const globalList = $("globalList");
    const eventList = $("eventList");
    stateList.innerHTML = "";
    transitionList.innerHTML = "";
    globalList.innerHTML = "";
    eventList.innerHTML = "";

    $("countStates").textContent = m ? String(m.states.length) : "0";
    $("countTransitions").textContent = m ? String((m.transitions || []).length) : "0";
    $("countGlobals").textContent = m ? String(m.globals.length) : "0";
    $("countEvents").textContent = m ? String(m.events.length) : "0";
    if (!m) return;

    const imp = state.impact;

    // States
    for (const st of m.states) {
      const li = document.createElement("li");
      const isSel = state.selectedType === "state" && state.selectedId === st.id;
      li.className = `item-row${isSel ? " selected" : ""}`;
      li.title = "Click to inspect · Double-click to edit Rust hooks";
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
        <span class="item-sub">${st.isInitial ? "INIT" : st.isFinal ? "FINAL" : ""}</span>
      `;
      li.addEventListener("click", () => {
        if (state.rightHidden) togglePane("right", false);
        selectStateForEditing(st.id);
      });
      li.addEventListener("dblclick", () => {
        openStateHookEditor(st.id, "entry");
      });
      stateList.appendChild(li);
    }

    const evStyles = StateMachineCanvas.buildEventStyles(m.events);

    // Transitions
    for (const tr of m.transitions || []) {
      const li = document.createElement("li");
      const isSel = state.selectedType === "transition" && state.selectedId === tr.id;
      li.className = `item-row${isSel ? " selected" : ""}`;
      const isSelf = tr.srcId === tr.dstId || tr.srcName === tr.dstName;
      const routeText = isSelf ? `${tr.srcName} ↺` : `${tr.srcName} → ${tr.dstName}`;
      const styleInfo = evStyles.get(tr.event) || { glyph: "?", color: "#94a3b8", dash: "" };
      const trImpact = imp && imp.byTransitionId ? imp.byTransitionId[tr.id] : null;
      const impactBadge = trImpact
        ? `<span class="impact-dot${trImpact.errors > 0 ? " err" : ""}" title="${escapeHtml(trImpact.reasons.map((r) => r.message).join("; "))}">⚠${trImpact.errors + trImpact.warnings}</span>`
        : "";
      const guardTxt = tr.guard && tr.guard.trim() ? `[${tr.guard.trim()}]` : (tr.name || "");
      const subText = `${tr.event}${guardTxt ? ` · ${guardTxt}` : ""}`;

      li.title = `${routeText} (${tr.event}) · Click to inspect · Double-click to edit action hook`;
      li.innerHTML = `
        <div class="trans-list-main">
          <div class="trans-list-route">
            <span class="event-glyph-pill" style="color:${styleInfo.color}">${escapeHtml(styleInfo.glyph)}</span>
            <span class="item-name">${escapeHtml(routeText)}</span>
          </div>
          <span class="trans-list-sub">${escapeHtml(subText)}</span>
        </div>
        ${impactBadge}
        <button class="btn btn-xs btn-edit-trans" title="Edit Action Hook in Central Editor">✎</button>
        <button class="btn btn-xs btn-del-trans" title="Delete Transition">✕</button>
      `;
      li.addEventListener("click", () => {
        if (state.rightHidden) togglePane("right", false);
        selectTransitionForEditing(tr.id);
      });
      li.addEventListener("dblclick", () => {
        openTransitionActionEditor(tr.id);
      });
      li.querySelector(".btn-edit-trans").addEventListener("click", (e) => {
        e.stopPropagation();
        openTransitionActionEditor(tr.id);
      });
      li.querySelector(".btn-del-trans").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteTransitionWithConfirm(tr);
      });
      transitionList.appendChild(li);
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
        <button class="btn btn-xs btn-edit-global" title="Edit GlobalVar &amp; Bounds">✎</button>
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
            const nextName = vals.name.trim() || g.name;
            const oldSnake = RustyContract.toSnakeCase(g.name);
            const newSnake = RustyContract.toSnakeCase(nextName);
            bridge.updateNodeAttributes(
              g.id,
              {
                name: nextName,
                rustType: vals.rustType,
                initialValue: vals.initialValue.trim(),
                minValue: (vals.minValue || "").trim(),
                maxValue: (vals.maxValue || "").trim(),
              },
              `Update GlobalVar ${g.name}`,
            );

            if (oldSnake && newSnake && oldSnake !== newSnake) {
              offerGlobalRenameRefactoring(oldSnake, newSnake);
            }
            const nextM = activeMachine();
            if (nextM) syncMachineArtifactsToWorkspace(nextM);
            toast(`Updated global ${nextName}`, "ok");
          },
        });
      });
      li.querySelector(".btn-del-global").addEventListener("click", (e) => {
        e.stopPropagation();
        bridge.deleteNode(g.id, g.name);
        const nextM = activeMachine();
        if (nextM) syncMachineArtifactsToWorkspace(nextM);
      });
      globalList.appendChild(li);
    }

    // Events
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
            const nextName = vals.name.trim() || ev.name;
            const oldPascal = RustyContract.toPascalCase(ev.name);
            const newPascal = RustyContract.toPascalCase(nextName);
            bridge.updateNodeAttributes(
              ev.id,
              {
                name: nextName,
                payloadType: vals.payloadType,
              },
              `Update EventDef ${ev.name}`,
            );
            if (oldPascal && newPascal && oldPascal !== newPascal) {
              offerEventRenameRefactoring(oldPascal, nextName);
            }
            const nextM = activeMachine();
            if (nextM) syncMachineArtifactsToWorkspace(nextM);
            toast(`Updated event ${nextName}`, "ok");
          },
        });
      });
      li.querySelector(".btn-del-event").addEventListener("click", (e) => {
        e.stopPropagation();
        bridge.deleteNode(ev.id, ev.name);
        const nextM = activeMachine();
        if (nextM) syncMachineArtifactsToWorkspace(nextM);
      });
      eventList.appendChild(li);
    }
  }

  function renderPickModeBanner() {
    const m = activeMachine();
    const active = Boolean(state.connectMode && !state.codeEditorSession);
    $("canvasHost").classList.toggle("pick-transition-mode", active);
    $("pickModeBanner").classList.toggle("hidden", !active);
    if (!active) return;

    if (!state.connectSourceId) {
      $("pickModeStepBadge").textContent = "STEP 1 / 2";
      $("pickModeMessage").textContent = "Click the SOURCE state on the diagram";
      $("btnPickModeBack").classList.add("hidden");
    } else {
      const srcSt = m && m.states.find((s) => s.id === state.connectSourceId);
      $("pickModeStepBadge").textContent = "STEP 2 / 2";
      $("pickModeMessage").textContent = `Source: ${srcSt ? srcSt.name : "?"} — Click TARGET state (or same state for self-transition)`;
      $("btnPickModeBack").classList.remove("hidden");
    }
  }

  function renderMinimap() {
    const m = activeMachine();
    const sess = state.codeEditorSession;
    if (!m || !sess) return;

    let label = "";
    if (sess.mode === "state-hook") {
      const st = m.states.find((s) => s.id === sess.stateId);
      label = st ? `${st.name} :: on_${sess.hookKind}` : "";
    } else {
      const tr = m.transitions.find((t) => t.id === sess.transitionId);
      label = tr ? `${tr.srcName} → ${tr.dstName}` : "";
    }
    $("minimapFocusLabel").textContent = label;

    const snap = state.sim ? state.sim.getSnapshot() : null;
    minimapCanvas.setState({
      model: m,
      minimap: true,
      selectedType: null,
      selectedId: null,
      focusStateId: sess.stateId || null,
      focusTransitionId: sess.mode === "transition-action" ? sess.transitionId : null,
      connectMode: false,
      connectSourceId: null,
      simActiveStateName: snap ? snap.currentState : null,
      simLastTransitionId: state.simLastTransitionId,
      dirtyStateIds: state.dirtyStateIds,
      layoutDirection: state.layoutDirection,
      compactLabels: true,
      highlightEventName: null,
      impact: state.impact,
    });
  }

  function renderCanvas() {
    const m = activeMachine();
    const snap = state.sim ? state.sim.getSnapshot() : null;
    canvas.setState({
      model: m,
      minimap: false,
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

    renderPickModeBanner();
    renderMinimap();
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

  function renderPreviewSnippet(preEl, body) {
    const text = String(body || "").replace(/^\n+|\s+$/g, "");
    if (!text) {
      preEl.textContent = "// empty (click Edit to write Rust code)";
      preEl.classList.add("empty");
    } else {
      preEl.textContent = text;
      preEl.classList.remove("empty");
    }
  }

  function renderStateOutgoingTransitions(m, st) {
    const hooks = RustyContract.resolveStateTransitionHooks(m, st);
    $("stateTransCount").textContent = String(hooks.length);
    const list = $("stateOutgoingList");
    list.innerHTML = "";
    if (hooks.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:14px;">No outgoing transitions from <strong>${escapeHtml(st.name)}</strong>. Click <strong>+ Transition</strong> to add one.</div>`;
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
      card.title = "Click to inspect · Double-click to edit action hook";
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
      card.addEventListener("dblclick", () => {
        openTransitionActionEditor(tr.id);
      });
      list.appendChild(card);
    }
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
      $("inpStateDesc").value = st.description || "";
      $("inpStateInitial").checked = Boolean(st.isInitial);
      $("inpStateFinal").checked = Boolean(st.isFinal);

      $("stateGitEffective").textContent = isConnected
        ? `${eff.gitOwner}/${eff.gitRepo}@${eff.gitBranch}:${eff.gitPath}`
        : eff.gitPath;
      $("stateShaDisplay").textContent = st.gitBaseCommitSha ? st.gitBaseCommitSha.slice(0, 12) : "none";
      $("btnPullState").classList.toggle("hidden", !isConnected);

      if (state.dirtyStateIds.has(st.id)) {
        setBadge("stateSyncBadge", "Editing (unsaved)", "badge-warn");
      } else if (st.gitBaseCommitSha) {
        setBadge("stateSyncBadge", "Synced with GitHub", "badge-ok");
      } else if (isConnected) {
        setBadge("stateSyncBadge", "Connected Dir", "badge-muted");
      } else {
        setBadge("stateSyncBadge", "Local Draft", "badge-muted");
      }

      renderImpactBox($("stateImpactBox"), imp && imp.byStateId[st.id]);
      renderDependsOnChips($("stateDependsOnList"), st.dependsOn, m);
      renderPreviewSnippet($("stateEntryPreview"), getLiveStateHookBody(st, "entry"));
      renderPreviewSnippet($("stateExitPreview"), getLiveStateHookBody(st, "exit"));
      renderStateOutgoingTransitions(m, st);
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

      const srcSibs = (m.transitions || []).filter(
        (t) => t.srcId === tr.srcId || t.srcName === tr.srcName,
      );
      const fnName = RustyContract.resolveTransitionFnName(tr, srcSibs, tr.srcName);
      $("transActionFnLabel").textContent = `fn ${fnName}(...)`;
      renderPreviewSnippet($("transActionPreview"), getLiveTransitionAction(tr));
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
            state.dirtyTransIds.delete(tr.id);
          }
        }
      });

      state.fetchedStateIds.add(st.id);
      state.dirtyStateIds.delete(st.id);

      const sess = state.codeEditorSession;
      if (sess && !sess.dirty) {
        if (sess.mode === "state-hook" && sess.stateId === st.id) {
          sess.draftEntry = parsed.entryCode || "";
          sess.draftExit = parsed.exitCode || "";
          loadCenterEditorFromSession();
        } else if (sess.mode === "transition-action" && sess.stateId === st.id) {
          for (const h of hooks) {
            if (
              h.transition &&
              h.transition.id === sess.transitionId &&
              Object.prototype.hasOwnProperty.call(parsed.actionsByFnName, h.fnName)
            ) {
              sess.draftAction = parsed.actionsByFnName[h.fnName];
              loadCenterEditorFromSession();
              break;
            }
          }
        }
      }

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

  function deleteTransitionWithConfirm(tr) {
    const m = activeMachine();
    if (!m || !tr) return;
    if (tr.action && tr.action.trim()) {
      const ok = window.confirm(
        `Delete transition "${tr.srcName} → ${tr.dstName}" (${tr.event})? Its custom action hook will be removed from ${tr.srcName}.`,
      );
      if (!ok) return;
    }
    if (state.codeEditorSession && state.codeEditorSession.transitionId === tr.id) {
      closeCodeEditorSession(false);
    }
    const srcId = tr.srcId;
    bridge.deleteNode(tr.id, tr.name || tr.event);
    if (state.selectedType === "transition" && state.selectedId === tr.id) {
      state.selectedType = null;
      state.selectedId = null;
    }
    const nextM = activeMachine();
    if (nextM) {
      const nextSrc = nextM.states.find((s) => s.id === srcId);
      if (nextSrc) {
        const composed = RustyContract.composeStateModuleRs(nextM, nextSrc).code;
        bridge.updateNodeAttributes(nextSrc.id, { codeCache: composed }, `Recompose ${nextSrc.name} after transition delete`);
      }
      syncMachineArtifactsToWorkspace(activeMachine());
    }
  }

  function offerGlobalRenameRefactoring(oldSnake, newSnake) {
    const m = activeMachine();
    if (!m || !oldSnake || !newSnake || oldSnake === newSnake) return;
    const stateUpdates = [];
    const transUpdates = [];
    let totalReplacements = 0;

    for (const st of m.states || []) {
      const rEntry = RustyAnalyzer.renameGlobalIdentifierInCode(st.entryCode || "", oldSnake, newSnake);
      const rExit = RustyAnalyzer.renameGlobalIdentifierInCode(st.exitCode || "", oldSnake, newSnake);
      const count = rEntry.replacements + rExit.replacements;
      if (count > 0) {
        totalReplacements += count;
        stateUpdates.push({ st, entryCode: rEntry.code, exitCode: rExit.code });
      }
    }

    for (const tr of m.transitions || []) {
      const rGuard = RustyAnalyzer.renameGlobalIdentifierInGuard(tr.guard || "", oldSnake, newSnake);
      const rAction = RustyAnalyzer.renameGlobalIdentifierInCode(tr.action || "", oldSnake, newSnake);
      const count = rGuard.replacements + rAction.replacements;
      if (count > 0) {
        totalReplacements += count;
        transUpdates.push({ tr, guard: rGuard.guard, action: rAction.code });
      }
    }

    if (totalReplacements === 0) return;
    if (
      !window.confirm(
        `Found ${totalReplacements} code/guard reference(s) to "${oldSnake}". Update them to "${newSnake}" automatically?`,
      )
    ) {
      return;
    }

    const updatedTransMap = new Map(transUpdates.map((u) => [u.tr.id, u]));
    const updatedStateMap = new Map(stateUpdates.map((u) => [u.st.id, u]));
    const nextModel = {
      ...m,
      states: (m.states || []).map((s) => {
        const u = updatedStateMap.get(s.id);
        return u ? { ...s, entryCode: u.entryCode, exitCode: u.exitCode } : s;
      }),
      transitions: (m.transitions || []).map((t) => {
        const u = updatedTransMap.get(t.id);
        return u ? { ...t, guard: u.guard, action: u.action } : t;
      }),
    };

    bridge.runTransaction(`Refactor globals.${oldSnake} → globals.${newSnake}`, () => {
      for (const u of stateUpdates) {
        bridge.client.setAttribute(u.st.id, "entryCode", u.entryCode);
        bridge.client.setAttribute(u.st.id, "exitCode", u.exitCode);
        const updatedSt = nextModel.states.find((s) => s.id === u.st.id);
        const composed = RustyContract.composeStateModuleRs(nextModel, updatedSt).code;
        bridge.client.setAttribute(u.st.id, "codeCache", composed);
        const deps = RustyAnalyzer.extractDependencies(`${u.entryCode}\n${u.exitCode}`, nextModel);
        bridge._applyDepsInsideTx(u.st.id, deps.memberIds, RustyAnalyzer.serializeDepsSnapshot(deps.snapshot));
      }
      for (const u of transUpdates) {
        bridge.client.setAttribute(u.tr.id, "guard", u.guard);
        bridge.client.setAttribute(u.tr.id, "action", u.action);
        const deps = RustyAnalyzer.extractDependencies("", nextModel, {
          triggerEvent: u.tr.event,
          guardText: u.guard,
          actionText: u.action,
        });
        bridge._applyDepsInsideTx(u.tr.id, deps.memberIds, RustyAnalyzer.serializeDepsSnapshot(deps.snapshot));
      }
    });
    toast(`Updated ${totalReplacements} reference(s) to ${newSnake}`, "ok");
  }

  function offerEventRenameRefactoring(oldPascal, newEventName) {
    const m = activeMachine();
    if (!m || !oldPascal || !newEventName) return;
    const matches = (m.transitions || []).filter(
      (t) => RustyContract.toPascalCase(t.event || "") === oldPascal,
    );
    if (matches.length === 0) return;
    if (
      !window.confirm(
        `Update ${matches.length} transition(s) using event "${oldPascal}" to "${newEventName}"?`,
      )
    ) {
      return;
    }
    bridge.runTransaction(`Rename transition events ${oldPascal} → ${newEventName}`, () => {
      for (const tr of matches) {
        bridge.client.setAttribute(tr.id, "event", newEventName);
        const deps = RustyAnalyzer.extractDependencies("", m, {
          triggerEvent: newEventName,
          guardText: tr.guard || "",
          actionText: tr.action || "",
        });
        bridge._applyDepsInsideTx(tr.id, deps.memberIds, RustyAnalyzer.serializeDepsSnapshot(deps.snapshot));
      }
    });
    toast(`Updated ${matches.length} transition event(s) to ${newEventName}`, "ok");
  }

  async function openCommitModal() {
    const m = activeMachine();
    if (!m || !m.gitOwner || !m.gitRepo) {
      toast("Connect a Git repository first to commit & push", "warn");
      return;
    }
    await state.workspaceQueue.catch(() => {});
    const params = workspaceParamsForMachine(m);
    $("commitRepoSummary").value = `${m.gitOwner}/${m.gitRepo} @ ${m.gitBaseCommitSha ? m.gitBaseCommitSha.slice(0, 12) : "HEAD"}`;
    $("commitTargetBranch").value = m.gitBranch || "main";
    $("chkCreateTargetBranch").checked = false;
    $("commitModalStatus").textContent = "Loading workspace delta & running validation gate…";
    $("commitValidationBox").className = "commit-validation-box";
    $("commitValidationBox").textContent = "Running design checks & cargo check against live workspace…";
    $("commitFilesList").innerHTML = "";
    $("commitDiffPreview").textContent = "";
    $("commitDiffPath").textContent = "-";
    $("commitChangeCount").textContent = "0";
    $("btnForceCommitWorkspace").classList.add("hidden");
    $("btnConfirmCommitWorkspace").disabled = true;
    $("commitModal").classList.remove("hidden");

    const branchDl = $("commitBranchSuggestions");
    if (branchDl) branchDl.innerHTML = "";

    const [wsRes, refsRes, filesForCheck] = await Promise.all([
      gitClient.getWorkspaceStatus(params, { checkRemote: true, includeDiff: true }).catch((err) => ({ error: err.message, files: [] })),
      state.gitStatus.hasGithubToken
        ? gitClient.listRefs(m.gitOwner, m.gitRepo, bridge.projectId).catch(() => [])
        : Promise.resolve([]),
      readVirtualCrateFilesForCheck(m),
    ]);

    if (branchDl && Array.isArray(refsRes)) {
      for (const rf of refsRes) {
        if (rf.ref && rf.ref.startsWith("refs/heads/")) {
          const opt = document.createElement("option");
          opt.value = rf.ref.slice("refs/heads/".length);
          branchDl.appendChild(opt);
        }
      }
    }

    const statusFiles = (wsRes && wsRes.files) || [];
    state.commitReviewStatus = wsRes;
    $("commitChangeCount").textContent = String(statusFiles.length);
    $("commitMessageInput").value = `rusty: update ${m.name} (${statusFiles.length} file${statusFiles.length === 1 ? "" : "s"})`;

    const listEl = $("commitFilesList");
    if (statusFiles.length === 0) {
      listEl.innerHTML = '<li class="muted-mono" style="padding:10px;">No uncommitted workspace deltas vs pinned base commit.</li>';
      $("commitDiffPreview").textContent = "Workspace is clean.";
    } else {
      statusFiles.forEach((f, idx) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `commit-file-row${idx === 0 ? " active" : ""}`;
        const label = f.renamedFrom ? `${f.path} ← ${f.renamedFrom}` : f.path;
        btn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</span><span class="commit-badge commit-badge-${escapeHtml(f.status)}">${escapeHtml(f.status)}</span>`;
        btn.addEventListener("click", () => {
          listEl.querySelectorAll(".commit-file-row").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          $("commitDiffPath").textContent = f.path;
          if (f.status === "deleted") {
            $("commitDiffPreview").textContent = `--- DELETED (${f.path}) ---\n${f.baseContent || ""}`;
          } else if (f.status === "modified" && f.baseContent) {
            $("commitDiffPreview").textContent = `=== NEW (${f.path}) ===\n${f.content || ""}\n\n=== PINNED BASE ===\n${f.baseContent}`;
          } else {
            $("commitDiffPreview").textContent = f.content || "";
          }
        });
        li.appendChild(btn);
        listEl.appendChild(li);
      });
      const first = statusFiles[0];
      $("commitDiffPath").textContent = first.path;
      $("commitDiffPreview").textContent =
        first.status === "deleted"
          ? `--- DELETED (${first.path}) ---\n${first.baseContent || ""}`
          : first.content || "";
    }

    // Run pre-push validation gate: RustyAnalyzer design errors + real cargo check on virtual tree
    const validationErrors = [];
    const imp = RustyAnalyzer.computeDesignImpact(m);
    for (const item of (imp && imp.items) || []) {
      for (const r of item.reasons || []) {
        if (r.severity === "error") {
          validationErrors.push(`${item.name} [${r.code}]: ${r.message}`);
        }
      }
    }

    try {
      const checkRes = await fetch("/routers/rustsim/check", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: filesForCheck }),
      });
      const checkData = await checkRes.json();
      if (!checkData.ok) {
        const diags = (checkData.diagnostics || [])
          .filter((d) => d.level === "error")
          .slice(0, 5)
          .map((d) => d.message || d.rendered);
        if (diags.length > 0) validationErrors.push(...diags);
        else validationErrors.push(checkData.error || checkData.rawStderr || "cargo check failed");
      }
    } catch (err) {
      validationErrors.push(`rustsim check unavailable: ${err.message}`);
    }

    state.commitValidationErrors = validationErrors;
    const valBox = $("commitValidationBox");
    if (validationErrors.length === 0) {
      valBox.className = "commit-validation-box ok";
      valBox.textContent = "✓ Model impact checks & cargo check passed cleanly.";
      $("btnConfirmCommitWorkspace").disabled = statusFiles.length === 0;
      $("btnForceCommitWorkspace").classList.add("hidden");
    } else {
      valBox.className = "commit-validation-box err";
      valBox.innerHTML =
        `<strong>✕ Push blocked (${validationErrors.length} error${validationErrors.length === 1 ? "" : "s"}):</strong>` +
        validationErrors.slice(0, 4).map((e) => `<div>• ${escapeHtml(e)}</div>`).join("");
      $("btnConfirmCommitWorkspace").disabled = true;
      if (statusFiles.length > 0) {
        $("btnForceCommitWorkspace").classList.remove("hidden");
      }
    }
    $("commitModalStatus").textContent = wsRes && wsRes.error ? `Status warning: ${wsRes.error}` : "";
  }

  async function submitWorkspaceCommit(force = false) {
    const m = activeMachine();
    if (!m) return;
    if (force && !window.confirm("Push uncommitted changes even though validation/compilation failed?")) {
      return;
    }
    const params = workspaceParamsForMachine(m);
    const branch = $("commitTargetBranch").value.trim() || m.gitBranch || "main";
    const createBranch = Boolean($("chkCreateTargetBranch").checked);
    const message = $("commitMessageInput").value.trim() || `rusty: update ${m.name}`;
    const validationErrors = state.commitValidationErrors || [];

    $("commitModalStatus").textContent = "Pushing atomic commit to GitHub…";
    $("btnConfirmCommitWorkspace").disabled = true;
    $("btnForceCommitWorkspace").disabled = true;

    try {
      const res = await gitClient.commitWorkspace(params, {
        branch,
        message,
        force,
        validationErrors,
        createBranch,
      });

      if (res.blocked) {
        $("commitModalStatus").textContent = res.body.error || "Commit blocked by validation gate.";
        $("btnForceCommitWorkspace").classList.remove("hidden");
        return;
      }

      if (res.conflict) {
        $("commitModal").classList.add("hidden");
        openConflictModal(res.body, {
          owner: m.gitOwner,
          repo: m.gitRepo,
          branch,
          machineId: m.id,
          stateIds: m.states.map((s) => s.id),
          message,
          force,
          validationErrors,
          params,
        });
        return;
      }

      bridge.runTransaction(`Pin commit ${res.newCommitSha.slice(0, 7)}`, () => {
        bridge.client.setAttribute(m.id, "gitBranch", res.targetBranch || branch);
        bridge.client.setAttribute(m.id, "gitBaseCommitSha", res.newCommitSha);
        for (const st of m.states) {
          bridge.client.setAttribute(st.id, "gitBaseCommitSha", res.newCommitSha);
          state.dirtyStateIds.delete(st.id);
        }
      });

      $("commitModal").classList.add("hidden");
      await refreshWorkspaceStatus(activeMachine(), false);
      toast(
        `Committed ${res.committedCount} file(s) → ${res.newCommitSha.slice(0, 7)}${res.forced ? " (forced)" : ""}`,
        res.rebased || res.forced ? "warn" : "ok",
      );
      renderAll();
    } catch (err) {
      $("commitModalStatus").textContent = `Commit failed: ${err.message}`;
      toast(`Commit failed: ${err.message}`, "err");
    } finally {
      $("btnConfirmCommitWorkspace").disabled = state.commitValidationErrors.length > 0;
      $("btnForceCommitWorkspace").disabled = false;
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
    $("diagTitle").textContent = `Running cargo check on ${m.name} workspace…`;
    $("diagOutput").textContent = "Compiling virtual crate from webgme-git workspace…";

    try {
      const files = await readVirtualCrateFilesForCheck(m);
      const res = await fetch("/routers/rustsim/check", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = await res.json();
      const mFocus = activeMachine();
      const sess = state.codeEditorSession;
      if (centerCodeEditor && sess && mFocus) {
        const focusSt = mFocus.states.find((s) => s.id === sess.stateId);
        if (focusSt) {
          const expectedPath = `src/states/${RustyContract.toSnakeCase(focusSt.name)}.rs`;
          centerCodeEditor.setRustcMarkers(data.diagnostics || [], expectedPath);
        }
      }
      if (data.ok) {
        $("diagTitle").textContent = `✓ cargo check passed (${data.durationMs}ms · ${data.fileCount} files)`;
        const warnings = (data.diagnostics || []).map((d) => d.rendered).join("\n");
        $("diagOutput").textContent = warnings || "Zero errors, zero warnings. Workspace Rust crate compiles cleanly!";
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
      const files = await readVirtualCrateFilesForCheck(m);
      const res = await fetch("/routers/rustsim/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, events }),
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
        const tab = btn.dataset.centerTab;
        if (state.codeEditorSession) {
          if (!confirmDiscardCodeEditorIfDirty()) return;
          closeCodeEditorSession(false);
        }
        state.centerTab = tab;
        if (tab !== "canvas") {
          cancelTransitionCreation();
        }
        renderCenterMode();
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

    // Central Code Editor controls
    document.querySelectorAll("[data-editor-hook]").forEach((btn) => {
      btn.addEventListener("click", () => switchCodeEditorStateHook(btn.dataset.editorHook));
    });
    $("btnSaveCodeEditor").addEventListener("click", () => saveCodeEditorSession(false));
    $("btnCancelCodeEditor").addEventListener("click", () => {
      if (confirmDiscardCodeEditorIfDirty()) cancelCodeEditorSession();
    });
    $("btnPullCodeEditor").addEventListener("click", () => {
      const m = activeMachine();
      const sess = state.codeEditorSession;
      const st = m && sess && m.states.find((s) => s.id === sess.stateId);
      if (st) pullStateFromGitHub(st);
    });
    $("btnToggleMinimap").addEventListener("click", () => {
      state.minimapCollapsed = !state.minimapCollapsed;
      renderCenterMode();
    });
    $("btnMinimapReturn").addEventListener("click", () => {
      if (confirmDiscardCodeEditorIfDirty()) closeCodeEditorSession(true);
    });

    // State & Transition Inspector "Edit Code" launch buttons
    $("btnEditStateEntry").addEventListener("click", () => {
      const st = selectedStateObj();
      if (st) openStateHookEditor(st.id, "entry");
    });
    $("btnEditStateExit").addEventListener("click", () => {
      const st = selectedStateObj();
      if (st) openStateHookEditor(st.id, "exit");
    });
    $("btnEditTransAction").addEventListener("click", () => {
      const tr = selectedTransitionObj();
      if (tr) openTransitionActionEditor(tr.id);
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
    $("projectSelect").addEventListener("change", (e) => {
      closeCodeEditorSession(false);
      cancelTransitionCreation();
      openSelectedProject(e.target.value);
    });
    $("machineSelect").addEventListener("change", (e) => {
      if (state.codeEditorSession && !confirmDiscardCodeEditorIfDirty()) {
        e.target.value = state.activeMachineId || "";
        return;
      }
      closeCodeEditorSession(false);
      state.connectMode = false;
      state.connectSourceId = null;
      state.activeMachineId = e.target.value;
      state.selectedType = null;
      state.selectedId = null;
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
        ],
        onConfirm(vals) {
          const name = (vals.name || "").trim();
          if (!name) return false;
          const idx = m.states.length;
          const id = bridge.createState(m.id, {
            name,
            description: vals.description || "",
            isInitial: idx === 0,
            position: { x: 120 + (idx % 3) * 230, y: 100 + Math.floor(idx / 3) * 140 },
          });
          selectStateForEditing(id);
          const nextM = activeMachine();
          if (nextM) syncMachineArtifactsToWorkspace(nextM);
        },
      });
    });

    $("btnAddTransition").addEventListener("click", () => {
      state.pendingTransitionDraft = null;
      openTransitionCreateModal(null, null);
    });
    $("btnAddStateOutgoingTrans").addEventListener("click", () => {
      const st = selectedStateObj();
      state.pendingTransitionDraft = null;
      openTransitionCreateModal(st ? st.id : null, null);
    });
    $("btnPickModeBack").addEventListener("click", () => {
      state.connectSourceId = null;
      renderCanvas();
    });
    $("btnPickModeForm").addEventListener("click", () => {
      const srcId = state.connectSourceId;
      const draft = state.pendingTransitionDraft;
      state.pendingTransitionDraft = null;
      state.connectMode = false;
      state.connectSourceId = null;
      renderCanvas();
      openTransitionCreateModal(srcId, null, draft);
    });
    $("btnPickModeCancel").addEventListener("click", cancelTransitionCreation);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.connectMode && $("elementModal").classList.contains("hidden")) {
        cancelTransitionCreation();
      }
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
          const nextM = activeMachine();
          if (nextM) syncMachineArtifactsToWorkspace(nextM);
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
          const nextM = activeMachine();
          if (nextM) syncMachineArtifactsToWorkspace(nextM);
        },
      });
    });

    // Canvas fixed-layout & badge controls
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
      const m = activeMachine();
      const st = selectedStateObj();
      if (!m || !st) return;
      const oldPath = RustyContract.resolveStateGitLink(m, st).gitPath;
      const nextName = $("inpStateName").value.trim() || st.name;
      bridge.updateNodeAttributes(
        st.id,
        {
          name: nextName,
          description: $("inpStateDesc").value,
          isInitial: $("inpStateInitial").checked,
          isFinal: $("inpStateFinal").checked,
        },
        `Update State ${st.name}`,
      );
      const nextM = activeMachine();
      const nextSt = nextM && nextM.states.find((s) => s.id === st.id);
      if (nextM && nextSt) {
        const newPath = RustyContract.resolveStateGitLink(nextM, nextSt).gitPath;
        const extraOps = [];
        if (oldPath && newPath && oldPath !== newPath) {
          const recomposed = RustyContract.composeStateModuleRs(nextM, nextSt).code;
          bridge.updateNodeAttributes(nextSt.id, { codeCache: recomposed }, `Recompose renamed state ${nextName}`);
          extraOps.push({ op: "rename", from: oldPath, to: newPath, content: recomposed, mode: "100644" });
        }
        syncMachineArtifactsToWorkspace(activeMachine(), extraOps);
      }
      toast(`Saved ${nextName} design attributes to workspace`, "ok");
    });

    $("btnDeleteState").addEventListener("click", () => {
      const m = activeMachine();
      const st = selectedStateObj();
      if (!m || !st) return;
      const connected = (m.transitions || []).filter((t) => t.srcId === st.id || t.dstId === st.id);
      const customHooks = connected.filter((t) => t.action && t.action.trim()).length;
      const msg = connected.length > 0
        ? `Delete state "${st.name}" and its ${connected.length} connected transition(s)${customHooks ? ` (${customHooks} with custom action hooks)` : ""}?`
        : `Delete state "${st.name}"?`;
      if (!window.confirm(msg)) return;
      if (state.codeEditorSession && state.codeEditorSession.stateId === st.id) {
        closeCodeEditorSession(false);
      }
      const deletedPath = RustyContract.resolveStateGitLink(m, st).gitPath;
      const incomingSrcIds = Array.from(
        new Set(connected.filter((t) => t.dstId === st.id && t.srcId !== st.id).map((t) => t.srcId)),
      );
      bridge.deleteStateCascade(m.id, st.id, st.name);
      state.selectedType = null;
      state.selectedId = null;
      const nextM = activeMachine();
      if (nextM) {
        for (const sid of incomingSrcIds) {
          const srcSt = nextM.states.find((s) => s.id === sid);
          if (srcSt) {
            const composed = RustyContract.composeStateModuleRs(nextM, srcSt).code;
            bridge.updateNodeAttributes(srcSt.id, { codeCache: composed }, `Recompose ${srcSt.name} after state delete`);
          }
        }
        syncMachineArtifactsToWorkspace(activeMachine(), deletedPath ? [{ op: "delete", path: deletedPath }] : []);
        if (nextM.states.length > 0 && !nextM.states.some((s) => s.isInitial)) {
          toast("Initial state deleted — mark another state as Initial before verifying/simulating", "warn");
        }
      }
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
      const nextM = activeMachine();
      if (nextM) syncMachineArtifactsToWorkspace(nextM);
      toast("Saved transition guard & metadata to workspace", "ok");
    });

    $("btnDeleteTransition").addEventListener("click", () => {
      deleteTransitionWithConfirm(selectedTransitionObj());
    });

    // GitBar, Workspace Review, Commit & ZIP Archive actions
    $("btnConnectRepo").addEventListener("click", openRepoModal);
    $("btnConfirmRepoBind").addEventListener("click", confirmRepoBind);
    document.querySelectorAll('input[name="repoConnectMode"]').forEach((radio) => {
      radio.addEventListener("change", updateRepoModalModeUI);
    });

    $("workspaceStatusPill").addEventListener("click", () => {
      const m = activeMachine();
      if (!m) return;
      if (m.gitOwner && m.gitRepo) openCommitModal();
      else toast("Hybrid Local Workspace automatically stores your crate in webgme-git. Connect a GitHub repo or click ↓ Download .zip.", "ok");
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
      const nextM = activeMachine();
      if (nextM) refreshWorkspaceStatus(nextM, true);
    });
    $("btnPushCrate").addEventListener("click", openCommitModal);
    $("btnConfirmCommitWorkspace").addEventListener("click", () => submitWorkspaceCommit(false));
    $("btnForceCommitWorkspace").addEventListener("click", () => submitWorkspaceCommit(true));
    $("btnDiscardWorkspace").addEventListener("click", async () => {
      const m = activeMachine();
      if (!m) return;
      if (!window.confirm(`Discard all uncommitted Git workspace deltas for ${m.name}?`)) return;
      try {
        await gitClient.discardWorkspace(workspaceParamsForMachine(m));
        $("commitModal").classList.add("hidden");
        await refreshWorkspaceStatus(m, true);
        toast("Discarded uncommitted workspace changes", "ok");
      } catch (err) {
        toast(`Discard failed: ${err.message}`, "err");
      }
    });

    $("btnDownloadZip").addEventListener("click", async () => {
      if (!state.machines.length) return;
      await state.workspaceQueue.catch(() => {});
      await Promise.all(state.machines.map((machine) => ensureMachineWorkspaceReady(machine)));
      const workspaces = state.machines.map(workspaceParamsForMachine);
      const rawName = (bridge.projectId || "rusty-artifacts").replace(/\+/g, "-");
      try {
        const count = await gitClient.downloadArchiveZip({
          projectId: bridge.projectId || "default",
          workspaces,
          filename: rawName,
        });
        toast(`Downloaded ${rawName}.zip (${count} file(s))`, "ok");
      } catch (err) {
        toast(`ZIP download failed: ${err.message}`, "err");
      }
    });

    window.addEventListener("beforeunload", (e) => {
      const m = activeMachine();
      const ws = m && (state.workspaceStatusByMachineId.get(m.id) || state.workspaceStatus);
      if (m && m.gitOwner && m.gitRepo && ws && ws.dirtyCount > 0) {
        e.preventDefault();
        e.returnValue = "";
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
        let res;
        if (ctx.params) {
          await gitClient.patchWorkspaceOps(ctx.params, [
            { op: "write", path: conflict.path, content: resolved, mode: "100644" },
          ]);
          await gitClient.rebaseWorkspaceBase(ctx.params, body.currentHeadSha, ctx.branch);
          res = await gitClient.commitWorkspace(ctx.params, {
            branch: ctx.branch,
            message: `${ctx.message} (resolved merge conflict)`,
            force: Boolean(ctx.force),
            validationErrors: ctx.validationErrors || [],
          });
        } else {
          res = await gitClient.commit({
            owner: ctx.owner,
            repo: ctx.repo,
            branch: ctx.branch,
            expectedParentSha: body.currentHeadSha,
            message: `${ctx.message} (resolved merge conflict)`,
            changes: [{ path: conflict.path, content: resolved, mode: "100644" }],
            projectId: bridge.projectId,
          });
        }
        if (res.conflict) {
          toast("Upstream moved again; please review new conflict", "warn");
          openConflictModal(res.body, ctx);
          return;
        }
        $("conflictModal").classList.add("hidden");
        state.pendingConflict = null;
        const m = activeMachine();
        if (m && res.newCommitSha) {
          bridge.setMachineBaseCommitSha(m.id, res.newCommitSha, m.states.map((s) => s.id));
          await refreshWorkspaceStatus(activeMachine(), false);
        }
        toast(`Conflict resolved & committed → ${res.newCommitSha.slice(0, 7)}`, "ok");
        if (state.codeEditorSession) {
          closeCodeEditorSession(true);
        }
      } catch (err) {
        toast(`Failed to commit resolution: ${err.message}`, "err");
      }
    });

    // Generic modal close buttons
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.closeModal;
        $(id).classList.add("hidden");
        if (id === "elementModal") {
          state.elementModalConfirm = null;
          state.pendingTransitionDraft = null;
        }
      });
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
      dropdown.innerHTML = '<option value="">(Connect GitHub in User Profile to browse repositories)</option>';
      $("repoPickerStatus").textContent = err.message;
    }
  }

  async function resolveBranchHeadSha(owner, repo, branch) {
    try {
      const refs = await gitClient.listRefs(owner, repo, bridge.projectId);
      const exact = (refs || []).find((r) => r.ref === `refs/heads/${branch}`);
      return exact && exact.sha ? exact.sha : "";
    } catch (_err) {
      return "";
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
    const baseCommitSha = state.gitStatus.hasGithubToken
      ? await resolveBranchHeadSha(gitOwner, gitRepo, gitBranch)
      : "";

    if (mode === "bind") {
      bridge.bindMachineRepo(m.id, {
        gitOwner,
        gitRepo,
        gitBranch,
        gitPath,
        gitBaseCommitSha: baseCommitSha,
        clearStateOverrides: true,
        stateIds: m.states.map((s) => s.id),
      });
      $("repoModal").classList.add("hidden");
      const nextM = activeMachine();
      if (nextM) {
        await syncMachineArtifactsToWorkspace(nextM);
      }
      toast(
        `Connected ${gitOwner}/${gitRepo}${baseCommitSha ? `@${baseCommitSha.slice(0, 7)}` : ""} (${gitPath})`,
        "ok",
      );
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
        ref: baseCommitSha || gitBranch,
        projectId: bridge.projectId,
      });
      const { model, summary } = RustyImporter.parseCrateFilesToModel(filesMap, {
        owner: gitOwner,
        repo: gitRepo,
        branch: gitBranch,
        dirPath: gitPath,
        machineName,
      });
      model.gitBaseCommitSha = baseCommitSha;
      bridge.populateMachineFromImport(m.id, model);
      state.selectedType = null;
      state.selectedId = null;
      state.dirtyStateIds.clear();
      state.dirtyTransIds.clear();
      state.fetchedStateIds.clear();
      state.codeEditorSession = null;
      state.connectMode = false;
      state.connectSourceId = null;
      $("repoModal").classList.add("hidden");
      const nextM = activeMachine();
      if (nextM) await refreshWorkspaceStatus(nextM, true);
      toast(
        `Connected & imported ${model.name}${baseCommitSha ? ` @ ${baseCommitSha.slice(0, 7)}` : ""} (${summary.states} states, ${summary.transitions} transitions)`,
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
