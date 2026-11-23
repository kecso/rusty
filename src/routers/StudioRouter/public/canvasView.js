(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const BOX_W = 180;
  const BOX_H = 66;

  const EVENT_PALETTE = [
    { color: "#38bdf8", dash: "" },
    { color: "#22c55e", dash: "7 4" },
    { color: "#f97316", dash: "2 4" },
    { color: "#a855f7", dash: "10 4 2 4" },
    { color: "#eab308", dash: "12 4" },
    { color: "#ec4899", dash: "4 3 1.5 3" },
    { color: "#14b8a6", dash: "9 3 9 3 2 3" },
    { color: "#ef4444", dash: "2 6" },
    { color: "#84cc16", dash: "6 2 2 2" },
  ];

  function glyphForIndex(idx) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (idx < alphabet.length) return alphabet[idx];
    const q = Math.floor(idx / alphabet.length);
    return `${alphabet[idx % alphabet.length]}${q}`;
  }

  function buildEventStyles(events) {
    const byName = new Map();
    const list = Array.isArray(events) ? events : [];
    list.forEach((ev, idx) => {
      const style = EVENT_PALETTE[idx % EVENT_PALETTE.length];
      const info = {
        glyph: glyphForIndex(idx),
        color: style.color,
        dash: style.dash,
        name: ev.name,
        payloadType: ev.payloadType || "",
        index: idx,
      };
      byName.set(ev.name, info);
      if (global.RustyContract) {
        byName.set(global.RustyContract.toPascalCase(ev.name), info);
      }
    });
    return byName;
  }

  function el(tag, attrs = {}, text = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null && v !== "") {
        node.setAttribute(k, String(v));
      }
    }
    if (text !== null) node.textContent = text;
    return node;
  }

  /**
   * Interactive SVG State Machine Canvas with Deterministic Fixed Layered Layout,
   * Compact Event Glyphs & Line Styles, Full Hover Tooltips, and Impact Badges.
   */
  class StateMachineCanvas {
    constructor(svgEl, handlers) {
      this.svg = svgEl;
      this.handlers = handlers || {};
      this.model = null;
      this.selectedType = null;
      this.selectedId = null;
      this.connectMode = false;
      this.connectSourceId = null;
      this.simActiveStateName = null;
      this.simLastTransitionId = null;
      this.dirtyStateIds = new Set();
      this.layoutDirection = "LR";
      this.compactLabels = true;
      this.highlightEventName = null;
      this.impact = null;
      this._eventStyles = new Map();

      this._bindCanvasEvents();
    }

    static buildEventStyles(events) {
      return buildEventStyles(events);
    }

    _bindCanvasEvents() {
      this.svg.addEventListener("click", (e) => {
        if (e.target === this.svg && this.handlers.onBackgroundClick) {
          this.handlers.onBackgroundClick();
        }
      });
    }

    setState(next) {
      const keys = [
        "model",
        "selectedType",
        "selectedId",
        "connectMode",
        "connectSourceId",
        "simActiveStateName",
        "simLastTransitionId",
        "dirtyStateIds",
        "layoutDirection",
        "compactLabels",
        "highlightEventName",
        "impact",
      ];
      for (const k of keys) {
        if (next[k] !== undefined) this[k] = next[k];
      }
      this.render();
    }

    render() {
      this.svg.innerHTML = "";
      if (!this.model) return;

      this._eventStyles = buildEventStyles(this.model.events);

      const layout =
        global.RustyLayout && typeof global.RustyLayout.computeLayout === "function"
          ? global.RustyLayout.computeLayout(this.model, { direction: this.layoutDirection })
          : { width: 880, height: 480, nodesById: {}, edgesById: {} };

      this.svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
      this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

      // Arrowhead defs (base + per-event colors)
      const defs = el("defs");
      defs.appendChild(this._makeArrow("arrow-default", "#64748b"));
      defs.appendChild(this._makeArrow("arrow-selected", "#38bdf8"));
      defs.appendChild(this._makeArrow("arrow-fired", "#f97316"));
      defs.appendChild(this._makeArrow("arrow-impact", "#f59e0b"));
      for (const info of this._eventStyles.values()) {
        defs.appendChild(this._makeArrow(`arrow-ev-${info.index}`, info.color));
      }
      this.svg.appendChild(defs);

      const statesById = new Map((this.model.states || []).map((s) => [s.id, s]));
      const transitions = this.model.transitions || [];

      const transLayer = el("g", { class: "layer-transitions" });
      for (const tr of transitions) {
        const src = statesById.get(tr.srcId);
        const dst = statesById.get(tr.dstId);
        const edgeGeom = layout.edgesById[tr.id] || layout.edgesById[tr.name];
        if (!src || !dst || !edgeGeom) continue;
        transLayer.appendChild(this._renderTransition(tr, edgeGeom));
      }
      this.svg.appendChild(transLayer);

      const stateLayer = el("g", { class: "layer-states" });
      for (const st of this.model.states || []) {
        const box = layout.nodesById[st.id] || layout.nodesById[st.name] || {
          x: st.position ? st.position.x : 120,
          y: st.position ? st.position.y : 120,
          width: BOX_W,
          height: BOX_H,
        };
        stateLayer.appendChild(this._renderState(st, box));
      }
      this.svg.appendChild(stateLayer);
    }

    _makeArrow(id, color) {
      const marker = el("marker", {
        id,
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      });
      marker.appendChild(el("path", { d: "M 0 1 L 10 5 L 0 9 z", fill: color }));
      return marker;
    }

    _renderTransition(tr, edgeGeom) {
      const isSelected = this.selectedType === "transition" && this.selectedId === tr.id;
      const isFired =
        this.simLastTransitionId && (this.simLastTransitionId === tr.id || this.simLastTransitionId === tr.name);

      const evStyle = this._eventStyles.get(tr.event) || {
        glyph: "?",
        color: "#ef4444",
        dash: "3 3",
        index: -1,
      };
      const impactItem =
        this.impact && this.impact.byTransitionId ? this.impact.byTransitionId[tr.id] : null;
      const isImpacted = Boolean(impactItem);

      const isEventHighlight =
        this.highlightEventName &&
        (this.highlightEventName === tr.event ||
          (global.RustyContract &&
            global.RustyContract.toPascalCase(this.highlightEventName) ===
              global.RustyContract.toPascalCase(tr.event)));
      const isDimmed = Boolean(this.highlightEventName && !isEventHighlight);

      let cls = "trans-group";
      if (isSelected) cls += " selected";
      if (isFired) cls += " sim-fired";
      if (isImpacted) cls += " impacted";
      if (isEventHighlight) cls += " event-highlighted";
      if (isDimmed) cls += " dimmed";

      const g = el("g", { class: cls });

      const strokeColor = isFired
        ? "#f97316"
        : isSelected
          ? "#38bdf8"
          : isImpacted
            ? "#f59e0b"
            : evStyle.color;
      const arrowId = isFired
        ? "arrow-fired"
        : isSelected
          ? "arrow-selected"
          : isImpacted
            ? "arrow-impact"
            : evStyle.index >= 0
              ? `arrow-ev-${evStyle.index}`
              : "arrow-default";

      const pathAttrs = {
        d: edgeGeom.d,
        class: "trans-path",
        stroke: strokeColor,
        "marker-end": `url(#${arrowId})`,
      };
      if (evStyle.dash) {
        pathAttrs["stroke-dasharray"] = evStyle.dash;
      }
      g.appendChild(el("path", pathAttrs));

      // Wide invisible hit-target so hovering thin connectors feels effortless
      g.appendChild(
        el("path", {
          d: edgeGeom.d,
          fill: "none",
          stroke: "transparent",
          "stroke-width": 16,
          style: "cursor: pointer",
        }),
      );

      // Animated traveling signal dot when fired during simulation
      if (isFired) {
        const pulse = el("circle", { r: 5, fill: "#fb923c" });
        pulse.appendChild(el("animateMotion", { dur: "0.45s", repeatCount: "1", path: edgeGeom.d }));
        g.appendChild(pulse);
      }

      const hasGuard = Boolean(tr.guard && tr.guard.trim());
      const { labelX, labelY } = edgeGeom;

      if (this.compactLabels) {
        const suffix = `${hasGuard ? " ⚑" : ""}${isImpacted ? " ⚠" : ""}`;
        const pillText = `${evStyle.glyph}${suffix}`;
        const pillW = Math.max(24, pillText.length * 8.2 + 12);
        g.appendChild(
          el("rect", {
            x: labelX - pillW / 2,
            y: labelY - 10,
            width: pillW,
            height: 20,
            rx: 10,
            fill: "#0d1117",
            stroke: strokeColor,
            "stroke-width": isSelected || isFired ? 2 : 1.4,
          }),
        );
        g.appendChild(
          el(
            "text",
            {
              x: labelX,
              y: labelY + 3.5,
              "text-anchor": "middle",
              class: "trans-badge-text",
              fill: strokeColor,
            },
            pillText,
          ),
        );
      } else {
        const base = `[${evStyle.glyph}] ${tr.event}${hasGuard ? ` [${tr.guard}]` : ""}${isImpacted ? " ⚠" : ""}`;
        const clipped = base.length > 34 ? base.slice(0, 33) + "…" : base;
        const pillW = Math.max(54, clipped.length * 6.5 + 14);
        g.appendChild(
          el("rect", {
            x: labelX - pillW / 2,
            y: labelY - 10,
            width: pillW,
            height: 19,
            rx: 5,
            fill: "#0d1117",
            stroke: strokeColor,
            "stroke-width": 1.2,
          }),
        );
        g.appendChild(
          el(
            "text",
            {
              x: labelX,
              y: labelY + 3.5,
              "text-anchor": "middle",
              class: "trans-label",
              fill: "#e2e8f0",
            },
            clipped,
          ),
        );
      }

      const emitHover = (e) => {
        if (this.handlers.onHoverTransition) {
          this.handlers.onHoverTransition(tr, evStyle, impactItem, e);
        }
      };
      g.addEventListener("mouseenter", emitHover);
      g.addEventListener("mousemove", emitHover);
      g.addEventListener("mouseleave", () => {
        if (this.handlers.onHoverTransition) this.handlers.onHoverTransition(null);
      });

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.handlers.onSelectTransition) {
          this.handlers.onSelectTransition(tr.id);
        }
      });

      return g;
    }

    _renderState(st, box) {
      const w = box.width || BOX_W;
      const h = box.height || BOX_H;
      const isSelected = this.selectedType === "state" && this.selectedId === st.id;
      const isSimActive = this.simActiveStateName && this.simActiveStateName === st.name;
      const isConnectSrc = this.connectMode && this.connectSourceId === st.id;
      const isDirty = this.dirtyStateIds.has(st.id);
      const impactItem = this.impact && this.impact.byStateId ? this.impact.byStateId[st.id] : null;
      const isImpacted = Boolean(impactItem);

      let cls = "state-node";
      if (isSelected) cls += " selected";
      if (isSimActive) cls += " sim-active";
      if (isImpacted) cls += " impacted";

      const g = el("g", {
        class: cls,
        style: "cursor: pointer;",
        transform: `translate(${box.x}, ${box.y})`,
      });

      const borderStroke = isConnectSrc
        ? "#f97316"
        : isImpacted
          ? impactItem.errors > 0
            ? "#ef4444"
            : "#f59e0b"
          : st.color || "#38bdf8";

      g.appendChild(
        el("rect", {
          x: 0,
          y: 0,
          width: w,
          height: h,
          class: "state-box",
          stroke: borderStroke,
        }),
      );

      g.appendChild(
        el("rect", {
          x: 2,
          y: 2,
          width: 6,
          height: h - 4,
          rx: 4,
          fill: st.color || "#38bdf8",
        }),
      );

      // State title
      const displayName = st.name.length > 16 ? st.name.slice(0, 15) + "…" : st.name;
      g.appendChild(el("text", { x: 18, y: 26, class: "state-title" }, displayName));

      // Init / Final tag
      if (st.isInitial) {
        g.appendChild(el("text", { x: w - 12, y: 18, "text-anchor": "end", class: "state-init-tag" }, "INIT"));
      } else if (st.isFinal) {
        g.appendChild(
          el("text", { x: w - 12, y: 18, "text-anchor": "end", class: "state-init-tag", fill: "#f59e0b" }, "FINAL"),
        );
      }

      // Impact badge if design drift or code issue detected
      if (isImpacted) {
        const count = impactItem.errors + impactItem.warnings;
        const badgeFill = impactItem.errors > 0 ? "#991b1b" : "#92400e";
        const badgeStroke = impactItem.errors > 0 ? "#ef4444" : "#f59e0b";
        g.appendChild(
          el("rect", {
            x: w - 34,
            y: h - 24,
            width: 26,
            height: 16,
            rx: 8,
            fill: badgeFill,
            stroke: badgeStroke,
            "stroke-width": 1,
          }),
        );
        g.appendChild(
          el(
            "text",
            {
              x: w - 21,
              y: h - 12.5,
              "text-anchor": "middle",
              "font-size": 9.5,
              "font-weight": 700,
              fill: "#fef3c7",
            },
            `⚠${count}`,
          ),
        );
      }

      // Effective Git filename + sync indicator dot
      const effective = global.RustyContract
        ? global.RustyContract.resolveStateGitLink(this.model, st)
        : { gitPath: st.gitPath || `${st.name}.rs`, isOverridden: false };
      const syncColor = isDirty ? "#f59e0b" : st.gitBaseCommitSha ? "#22c55e" : "#64748b";
      g.appendChild(el("circle", { cx: 22, cy: 48, r: 4, fill: syncColor }));
      const filePart = effective.gitPath.split("/").pop() || effective.gitPath;
      const suffix = effective.isOverridden ? " *" : "";
      const maxLen = isImpacted ? 14 : 19;
      const shownPath = filePart.length > maxLen ? filePart.slice(0, maxLen - 1) + "…" : filePart;
      g.appendChild(el("text", { x: 32, y: 52, class: "state-path" }, `${shownPath}${suffix}`));

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.connectMode) {
          if (this.handlers.onConnectClick) this.handlers.onConnectClick(st.id);
          return;
        }
        if (this.handlers.onSelectState) this.handlers.onSelectState(st.id);
      });

      return g;
    }
  }

  global.StateMachineCanvas = StateMachineCanvas;
})(window);
