(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const BOX_W = 172;
  const BOX_H = 68;

  function el(tag, attrs = {}, text = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, String(v));
    }
    if (text !== null) node.textContent = text;
    return node;
  }

  /**
   * Interactive SVG State Machine Canvas & Live Simulation Renderer.
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

      this._drag = null;
      this._bindPointerEvents();
    }

    _bindPointerEvents() {
      this.svg.addEventListener("pointermove", (e) => {
        if (!this._drag) return;
        const pt = this._svgPoint(e);
        const nx = Math.max(20, pt.x - this._drag.offsetX);
        const ny = Math.max(20, pt.y - this._drag.offsetY);
        this._drag.state.position = { x: nx, y: ny };
        this._drag.moved = true;
        this.render();
      });

      window.addEventListener("pointerup", () => {
        if (!this._drag) return;
        const drag = this._drag;
        this._drag = null;
        if (drag.moved && this.handlers.onStateMoved) {
          this.handlers.onStateMoved(drag.state.id, drag.state.position);
        }
      });

      this.svg.addEventListener("click", (e) => {
        if (e.target === this.svg && this.handlers.onBackgroundClick) {
          this.handlers.onBackgroundClick();
        }
      });
    }

    _svgPoint(e) {
      const rect = this.svg.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    setState({
      model,
      selectedType,
      selectedId,
      connectMode,
      connectSourceId,
      simActiveStateName,
      simLastTransitionId,
      dirtyStateIds,
    }) {
      if (model !== undefined) this.model = model;
      if (selectedType !== undefined) this.selectedType = selectedType;
      if (selectedId !== undefined) this.selectedId = selectedId;
      if (connectMode !== undefined) this.connectMode = connectMode;
      if (connectSourceId !== undefined) this.connectSourceId = connectSourceId;
      if (simActiveStateName !== undefined) this.simActiveStateName = simActiveStateName;
      if (simLastTransitionId !== undefined) this.simLastTransitionId = simLastTransitionId;
      if (dirtyStateIds !== undefined) this.dirtyStateIds = dirtyStateIds;
      this.render();
    }

    render() {
      this.svg.innerHTML = "";
      if (!this.model) return;

      // Arrowhead defs
      const defs = el("defs");
      defs.appendChild(this._makeArrow("arrow-default", "#64748b"));
      defs.appendChild(this._makeArrow("arrow-selected", "#38bdf8"));
      defs.appendChild(this._makeArrow("arrow-fired", "#f97316"));
      this.svg.appendChild(defs);

      const statesById = new Map((this.model.states || []).map((s) => [s.id, s]));

      // Group transitions between same pair of states so parallel edges curve cleanly
      const pairCounts = new Map();
      const transitions = this.model.transitions || [];

      const transLayer = el("g", { class: "layer-transitions" });
      for (const tr of transitions) {
        const src = statesById.get(tr.srcId);
        const dst = statesById.get(tr.dstId);
        if (!src || !dst) continue;

        const pairKey = [src.id, dst.id].sort().join("|");
        const count = pairCounts.get(pairKey) || 0;
        pairCounts.set(pairKey, count + 1);

        transLayer.appendChild(this._renderTransition(tr, src, dst, count));
      }
      this.svg.appendChild(transLayer);

      const stateLayer = el("g", { class: "layer-states" });
      for (const st of this.model.states || []) {
        stateLayer.appendChild(this._renderState(st));
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

    _renderTransition(tr, src, dst, parallelIndex) {
      const isSelected = this.selectedType === "transition" && this.selectedId === tr.id;
      const isFired = this.simLastTransitionId && (this.simLastTransitionId === tr.id || this.simLastTransitionId === tr.name);

      const sx = src.position.x + BOX_W / 2;
      const sy = src.position.y + BOX_H / 2;
      const dx = dst.position.x + BOX_W / 2;
      const dy = dst.position.y + BOX_H / 2;

      let d;
      let labelX;
      let labelY;

      if (src.id === dst.id) {
        // Self-loop above state
        const topX = sx;
        const topY = src.position.y;
        d = `M ${topX - 24} ${topY} C ${topX - 48} ${topY - 58}, ${topX + 48} ${topY - 58}, ${topX + 24} ${topY}`;
        labelX = topX;
        labelY = topY - 46;
      } else {
        const vx = dx - sx;
        const vy = dy - sy;
        const dist = Math.hypot(vx, vy) || 1;
        const ux = vx / dist;
        const uy = vy / dist;

        // Trim start/end to box perimeter approximation
        const padX = BOX_W / 2 + 6;
        const padY = BOX_H / 2 + 6;
        const trimStart = Math.min(padX / Math.max(Math.abs(ux), 0.25), padY / Math.max(Math.abs(uy), 0.25));
        const trimEnd = trimStart + 4;

        const x1 = sx + ux * trimStart;
        const y1 = sy + uy * trimStart;
        const x2 = dx - ux * trimEnd;
        const y2 = dy - uy * trimEnd;

        // Curve offset perpendicular to edge
        const nx = -uy;
        const ny = ux;
        const curveSign = parallelIndex % 2 === 0 ? 1 : -1;
        const curveMag = 24 + Math.floor(parallelIndex / 2) * 28;
        const cx = (x1 + x2) / 2 + nx * curveSign * curveMag;
        const cy = (y1 + y2) / 2 + ny * curveSign * curveMag;

        d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        labelX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
        labelY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
      }

      const g = el("g", {
        class: `trans-group${isSelected ? " selected" : ""}${isFired ? " sim-fired" : ""}`,
      });

      const arrowId = isFired ? "arrow-fired" : isSelected ? "arrow-selected" : "arrow-default";
      const pathEl = el("path", {
        d,
        class: "trans-path",
        "marker-end": `url(#${arrowId})`,
      });
      g.appendChild(pathEl);

      // Animated traveling signal dot when fired during simulation
      if (isFired) {
        const pulse = el("circle", { r: 5, fill: "#fb923c" });
        const anim = el("animateMotion", { dur: "0.45s", repeatCount: "1", path: d });
        pulse.appendChild(anim);
        g.appendChild(pulse);
      }

      const labelText = tr.guard ? `${tr.event} [${tr.guard}]` : tr.event;
      const clipped = labelText.length > 34 ? labelText.slice(0, 33) + "…" : labelText;
      const pillW = Math.max(46, clipped.length * 6.5 + 12);
      g.appendChild(
        el("rect", {
          x: labelX - pillW / 2,
          y: labelY - 10,
          width: pillW,
          height: 18,
          class: "trans-label-bg",
        }),
      );
      g.appendChild(
        el(
          "text",
          {
            x: labelX,
            y: labelY + 3,
            "text-anchor": "middle",
            class: "trans-label",
          },
          clipped,
        ),
      );

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.handlers.onSelectTransition) {
          this.handlers.onSelectTransition(tr.id);
        }
      });

      return g;
    }

    _renderState(st) {
      const isSelected = this.selectedType === "state" && this.selectedId === st.id;
      const isSimActive = this.simActiveStateName && this.simActiveStateName === st.name;
      const isConnectSrc = this.connectMode && this.connectSourceId === st.id;
      const isDirty = this.dirtyStateIds.has(st.id);

      const g = el("g", {
        class: `state-node${isSelected ? " selected" : ""}${isSimActive ? " sim-active" : ""}`,
        transform: `translate(${st.position.x}, ${st.position.y})`,
      });

      // Header color bar + main rounded box
      g.appendChild(
        el("rect", {
          x: 0,
          y: 0,
          width: BOX_W,
          height: BOX_H,
          class: "state-box",
          stroke: isConnectSrc ? "#f97316" : st.color || "#38bdf8",
        }),
      );

      g.appendChild(
        el("rect", {
          x: 2,
          y: 2,
          width: 6,
          height: BOX_H - 4,
          rx: 4,
          fill: st.color || "#38bdf8",
        }),
      );

      // State title
      g.appendChild(el("text", { x: 18, y: 26, class: "state-title" }, st.name));

      // Init / Final tag
      if (st.isInitial) {
        g.appendChild(el("text", { x: BOX_W - 12, y: 18, "text-anchor": "end", class: "state-init-tag" }, "INIT"));
      } else if (st.isFinal) {
        g.appendChild(el("text", { x: BOX_W - 12, y: 18, "text-anchor": "end", class: "state-init-tag", fill: "#f59e0b" }, "FINAL"));
      }

      // Git sync indicator dot + gitPath subtitle
      const syncColor = isDirty ? "#f59e0b" : st.gitBaseCommitSha ? "#22c55e" : "#64748b";
      g.appendChild(el("circle", { cx: 22, cy: 48, r: 4, fill: syncColor }));
      const pathLabel = st.gitPath || `src/states/${global.RustyContract.toSnakeCase(st.name)}.rs`;
      const shortPath = pathLabel.length > 22 ? "…" + pathLabel.slice(-21) : pathLabel;
      g.appendChild(el("text", { x: 32, y: 52, class: "state-path" }, shortPath));

      g.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (this.connectMode) {
          if (this.handlers.onConnectClick) this.handlers.onConnectClick(st.id);
          return;
        }
        if (this.handlers.onSelectState) this.handlers.onSelectState(st.id);
        const pt = this._svgPoint(e);
        this._drag = {
          state: st,
          offsetX: pt.x - st.position.x,
          offsetY: pt.y - st.position.y,
          moved: false,
        };
      });

      return g;
    }
  }

  global.StateMachineCanvas = StateMachineCanvas;
})(window);
