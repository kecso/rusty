(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RustyLayout = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_BOX_W = 180;
  const DEFAULT_BOX_H = 66;

  /**
   * Clip a ray starting at box center (cx, cy) toward (tx, ty) to the exact
   * perimeter of a rectangle of size (w, h).
   */
  function perimeterPoint(cx, cy, w, h, tx, ty, pad = 2) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
      return { x: cx + w / 2, y: cy };
    }
    const hw = w / 2 + pad;
    const hh = h / 2 + pad;
    const scaleX = Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity;
    const t = Math.min(scaleX, scaleY);
    return {
      x: cx + dx * t,
      y: cy + dy * t,
    };
  }

  /**
   * Deterministic, cycle-aware fixed layered layout (Sugiyama-style) for state machines.
   *
   * @param {object} model Normalized StateMachine model ({ states, transitions })
   * @param {object} [opts]
   * @param {"LR"|"TB"} [opts.direction="LR"] Flow direction
   * @returns {object} Layout coordinates and routed SVG geometry
   */
  function computeLayout(model, opts = {}) {
    const direction = opts.direction === "TB" ? "TB" : "LR";
    const W = opts.nodeWidth || DEFAULT_BOX_W;
    const H = opts.nodeHeight || DEFAULT_BOX_H;
    const margin = opts.margin || 64;

    const states = (model && model.states) || [];
    const transitions = (model && model.transitions) || [];

    if (states.length === 0) {
      return {
        direction,
        width: 720,
        height: 420,
        nodesById: {},
        edgesById: {},
      };
    }

    const stateById = new Map();
    const stateIndex = new Map();
    states.forEach((s, i) => {
      const key = s.id || s.name;
      stateById.set(key, s);
      stateIndex.set(key, i);
    });

    const keyOfState = (s) => s.id || s.name;
    const srcKeyOf = (t) => (t.srcId && stateById.has(t.srcId) ? t.srcId : t.srcName);
    const dstKeyOf = (t) => (t.dstId && stateById.has(t.dstId) ? t.dstId : t.dstName);

    const outAdj = new Map();
    const inAdj = new Map();
    for (const st of states) {
      const k = keyOfState(st);
      outAdj.set(k, []);
      inAdj.set(k, []);
    }

    const sortedTransitions = [...transitions].sort((a, b) => {
      const pa = Number(a.priority ?? 1);
      const pb = Number(b.priority ?? 1);
      if (pa !== pb) return pa - pb;
      return String(a.event || "").localeCompare(String(b.event || ""));
    });

    for (const tr of sortedTransitions) {
      const sk = srcKeyOf(tr);
      const dk = dstKeyOf(tr);
      if (!sk || !dk || !stateById.has(sk) || !stateById.has(dk) || sk === dk) continue;
      if (!outAdj.get(sk).includes(dk)) outAdj.get(sk).push(dk);
      if (!inAdj.get(dk).includes(sk)) inAdj.get(dk).push(sk);
    }

    // 1. BFS distance from initial states (cycle-safe)
    const rank = new Map();
    const queue = [];
    const initialStates = states.filter((s) => s.isInitial);
    const roots = initialStates.length > 0 ? initialStates : [states[0]];

    for (const r of roots) {
      const k = keyOfState(r);
      if (!rank.has(k)) {
        rank.set(k, 0);
        queue.push(k);
      }
    }

    while (queue.length > 0) {
      const cur = queue.shift();
      const r = rank.get(cur);
      for (const nxt of outAdj.get(cur) || []) {
        if (!rank.has(nxt)) {
          rank.set(nxt, r + 1);
          queue.push(nxt);
        }
      }
    }

    // Handle any disconnected states
    for (const st of states) {
      const k = keyOfState(st);
      if (!rank.has(k)) {
        const nextBase = rank.size > 0 ? Math.max(...rank.values()) + 1 : 0;
        rank.set(k, nextBase);
        queue.push(k);
        while (queue.length > 0) {
          const cur = queue.shift();
          const r = rank.get(cur);
          for (const nxt of outAdj.get(cur) || []) {
            if (!rank.has(nxt)) {
              rank.set(nxt, r + 1);
              queue.push(nxt);
            }
          }
        }
      }
    }

    // 2. Refine ranks along strictly forward BFS edges (acyclic longest-path stretch)
    const forwardPairs = [];
    for (const [u, list] of outAdj.entries()) {
      for (const v of list) {
        if (rank.get(u) < rank.get(v)) {
          forwardPairs.push([u, v]);
        }
      }
    }
    const orderedKeys = [...states.map(keyOfState)].sort((a, b) => rank.get(a) - rank.get(b));
    for (let pass = 0; pass < states.length; pass++) {
      let changed = false;
      for (const [u, v] of forwardPairs) {
        if (rank.get(v) <= rank.get(u)) {
          rank.set(v, rank.get(u) + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Group by rank
    const maxRank = Math.max(0, ...rank.values());
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    for (const k of orderedKeys) {
      layers[rank.get(k)].push(k);
    }

    // 3. Barycenter sweeps to minimize edge crossings within layers
    const orderPos = new Map();
    const refreshOrderPos = () => {
      layers.forEach((layer) => {
        layer.forEach((k, idx) => orderPos.set(k, idx));
      });
    };
    refreshOrderPos();

    for (let sweep = 0; sweep < 3; sweep++) {
      // Forward sweep
      for (let r = 1; r < layers.length; r++) {
        layers[r].sort((a, b) => {
          const predsA = (inAdj.get(a) || []).filter((p) => rank.get(p) < r);
          const predsB = (inAdj.get(b) || []).filter((p) => rank.get(p) < r);
          const avgA = predsA.length
            ? predsA.reduce((acc, p) => acc + orderPos.get(p), 0) / predsA.length
            : stateIndex.get(a);
          const avgB = predsB.length
            ? predsB.reduce((acc, p) => acc + orderPos.get(p), 0) / predsB.length
            : stateIndex.get(b);
          if (Math.abs(avgA - avgB) > 1e-4) return avgA - avgB;
          return stateIndex.get(a) - stateIndex.get(b);
        });
        refreshOrderPos();
      }
      // Backward sweep (skip rank 0 initial states stays sorted stably)
      for (let r = layers.length - 2; r >= 1; r--) {
        layers[r].sort((a, b) => {
          const succA = (outAdj.get(a) || []).filter((s) => rank.get(s) > r);
          const succB = (outAdj.get(b) || []).filter((s) => rank.get(s) > r);
          const avgA = succA.length
            ? succA.reduce((acc, s) => acc + orderPos.get(s), 0) / succA.length
            : orderPos.get(a);
          const avgB = succB.length
            ? succB.reduce((acc, s) => acc + orderPos.get(s), 0) / succB.length
            : orderPos.get(b);
          if (Math.abs(avgA - avgB) > 1e-4) return avgA - avgB;
          return orderPos.get(a) - orderPos.get(b);
        });
        refreshOrderPos();
      }
    }

    // 4. Assign coordinates cleanly centered per layer
    const rankStep = direction === "LR" ? W + 115 : H + 96;
    const nodeStep = direction === "LR" ? H + 62 : W + 76;
    const maxLayerLen = Math.max(1, ...layers.map((l) => l.length));
    const maxCrossSpan = (maxLayerLen - 1) * nodeStep;

    const nodesById = {};
    layers.forEach((layer, rIdx) => {
      const layerSpan = (layer.length - 1) * nodeStep;
      const crossOffset = (maxCrossSpan - layerSpan) / 2;
      layer.forEach((k, idx) => {
        const x =
          direction === "LR"
            ? Math.round(margin + rIdx * rankStep)
            : Math.round(margin + crossOffset + idx * nodeStep);
        const y =
          direction === "LR"
            ? Math.round(margin + crossOffset + idx * nodeStep)
            : Math.round(margin + rIdx * rankStep);
        nodesById[k] = { x, y, width: W, height: H, rank: rIdx, order: idx };
      });
    });

    // Track global bounding box including edge control points & labels
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const expandBounds = (px, py) => {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    };

    for (const box of Object.values(nodesById)) {
      expandBounds(box.x, box.y);
      expandBounds(box.x + box.width, box.y + box.height);
    }

    // 5. Route edges cleanly without collisions
    const edgesById = {};
    const undirectedGroups = new Map();
    for (const tr of sortedTransitions) {
      const sk = srcKeyOf(tr);
      const dk = dstKeyOf(tr);
      if (!sk || !dk || !nodesById[sk] || !nodesById[dk]) continue;
      const gKey = sk === dk ? `SELF|${sk}` : [sk, dk].sort().join("|");
      if (!undirectedGroups.has(gKey)) undirectedGroups.set(gKey, []);
      undirectedGroups.get(gKey).push(tr);
    }

    for (const group of undirectedGroups.values()) {
      const count = group.length;
      group.forEach((tr, idx) => {
        const eid = tr.id || tr.name || `${srcKeyOf(tr)}->${dstKeyOf(tr)}:${idx}`;
        const sk = srcKeyOf(tr);
        const dk = dstKeyOf(tr);
        const srcBox = nodesById[sk];
        const dstBox = nodesById[dk];

        if (sk === dk) {
          // Stacked self-loop arches above top perimeter
          const lift = 54 + idx * 32;
          const cx = srcBox.x + srcBox.width / 2;
          const topY = srcBox.y;
          const d = `M ${(cx - 24).toFixed(1)} ${topY} C ${(cx - 52).toFixed(1)} ${(topY - lift).toFixed(1)}, ${(cx + 52).toFixed(1)} ${(topY - lift).toFixed(1)}, ${(cx + 24).toFixed(1)} ${topY - 2}`;
          const lx = cx;
          const ly = topY - lift * 0.72;
          expandBounds(cx - 56, topY - lift);
          expandBounds(cx + 56, topY);
          edgesById[eid] = {
            d,
            labelX: lx,
            labelY: ly,
            isBackEdge: false,
            isSelfLoop: true,
          };
          return;
        }

        const scx = srcBox.x + srcBox.width / 2;
        const scy = srcBox.y + srcBox.height / 2;
        const dcx = dstBox.x + dstBox.width / 2;
        const dcy = dstBox.y + dstBox.height / 2;

        const vx = dcx - scx;
        const vy = dcy - scy;
        const dist = Math.hypot(vx, vy) || 1;
        const nx = -vy / dist;
        const ny = vx / dist;

        const isBackEdge = srcBox.rank > dstBox.rank || (srcBox.rank === dstBox.rank && srcBox.order > dstBox.order);
        const rankDelta = Math.abs(dstBox.rank - srcBox.rank);

        // Spread multiple edges cleanly on opposite normal sides
        const centeredIdx = idx - (count - 1) / 2;
        let curveMag;
        if (isBackEdge && rankDelta >= 2) {
          // Long back-edge arcs clear intermediate ranks below/right cleanly
          const sign = centeredIdx === 0 ? 1 : Math.sign(centeredIdx);
          curveMag = (direction === "LR" ? 92 : 96) + Math.abs(centeredIdx) * 34;
          const sideSign = direction === "LR" ? (vy >= 0 ? -1 : 1) * sign || -1 : 1;
          const bend = curveMag * (vy === 0 ? 1 : sideSign);
          const cx = (scx + dcx) / 2 + nx * bend;
          const cy = (scy + dcy) / 2 + ny * bend;
          const p1 = perimeterPoint(scx, scy, srcBox.width, srcBox.height, cx, cy, 1);
          const p2 = perimeterPoint(dcx, dcy, dstBox.width, dstBox.height, cx, cy, 5);
          const d = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
          const lx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
          const ly = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
          expandBounds(lx - 26, ly - 18);
          expandBounds(lx + 26, ly + 18);
          edgesById[eid] = { d, labelX: lx, labelY: ly, isBackEdge: true, isSelfLoop: false };
          return;
        }

        if (count === 1) {
          curveMag = isBackEdge ? 26 : rankDelta > 1 ? 36 : 0;
        } else {
          // Ensure symmetric offset including opposite-direction pairs (`a -> b` vs `b -> a`)
          const dirSign = sk < dk ? 1 : -1;
          curveMag = centeredIdx * 42 * dirSign;
          if (Math.abs(curveMag) < 16) {
            curveMag = (idx % 2 === 0 ? 1 : -1) * 24;
          }
        }

        const cx = (scx + dcx) / 2 + nx * curveMag;
        const cy = (scy + dcy) / 2 + ny * curveMag;
        const p1 = perimeterPoint(scx, scy, srcBox.width, srcBox.height, cx, cy, 1);
        const p2 = perimeterPoint(dcx, dcy, dstBox.width, dstBox.height, cx, cy, 5);

        const d =
          Math.abs(curveMag) < 2
            ? `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
            : `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;

        const tPos = count > 1 ? 0.44 + (idx % 2) * 0.12 : 0.5;
        const oneMinus = 1 - tPos;
        const lx = oneMinus * oneMinus * p1.x + 2 * oneMinus * tPos * cx + tPos * tPos * p2.x;
        const ly = oneMinus * oneMinus * p1.y + 2 * oneMinus * tPos * cy + tPos * tPos * p2.y;

        expandBounds(lx - 26, ly - 18);
        expandBounds(lx + 26, ly + 18);
        edgesById[eid] = { d, labelX: lx, labelY: ly, isBackEdge, isSelfLoop: false };
      });
    }

    // Shift everything so top-left fits comfortably inside [margin, ...]
    const shiftX = Math.max(0, Math.round(margin / 2 - minX));
    const shiftY = Math.max(0, Math.round(margin / 2 - minY));
    if (shiftX > 0 || shiftY > 0) {
      for (const box of Object.values(nodesById)) {
        box.x += shiftX;
        box.y += shiftY;
      }
      // Re-shift edge coordinates cleanly via path reconstruction only if shifted
      for (const edge of Object.values(edgesById)) {
        edge.labelX += shiftX;
        edge.labelY += shiftY;
        edge.d = edge.d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_m, xStr, yStr) => {
          return `${(Number(xStr) + shiftX).toFixed(1)} ${(Number(yStr) + shiftY).toFixed(1)}`;
        });
      }
      maxX += shiftX;
      maxY += shiftY;
      minX += shiftX;
      minY += shiftY;
    }

    return {
      direction,
      width: Math.max(680, Math.ceil(maxX + margin / 2)),
      height: Math.max(380, Math.ceil(maxY + margin / 2)),
      nodesById,
      edgesById,
    };
  }

  return {
    computeLayout,
    DEFAULT_BOX_W,
    DEFAULT_BOX_H,
  };
});
