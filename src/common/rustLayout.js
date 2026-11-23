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
   * Signed edge-to-edge clearance between two axis-aligned rectangles
   * `{ cx, cy, w, h }`. Negative if overlapping (min penetration depth),
   * non-negative Euclidean separation otherwise.
   */
  function rectClearance(a, b) {
    const dx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2;
    const dy = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2;
    if (dx < 0 && dy < 0) {
      return -Math.min(-dx, -dy);
    }
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  }

  function pointInRect(px, py, rect, pad = 0) {
    return (
      px >= rect.x - pad &&
      px <= rect.x + rect.width + pad &&
      py >= rect.y - pad &&
      py <= rect.y + rect.height + pad
    );
  }

  function estimatePillSize(tr, compactLabels) {
    const hasGuard = Boolean(tr && tr.guard && String(tr.guard).trim());
    if (compactLabels) {
      return { w: hasGuard ? 42 : 28, h: 22 };
    }
    const guardPart = hasGuard ? ` [${String(tr.guard).trim()}]` : "";
    const text = `[X] ${String((tr && tr.event) || "Tick")}${guardPart}`;
    const clippedLen = Math.min(34, text.length);
    return { w: Math.max(58, Math.round(clippedLen * 6.5 + 16)), h: 22 };
  }

  function quadPoint(p1, c, p2, t) {
    const om = 1 - t;
    return {
      x: om * om * p1.x + 2 * om * t * c.x + t * t * p2.x,
      y: om * om * p1.y + 2 * om * t * c.y + t * t * p2.y,
    };
  }

  /**
   * Deterministic, cycle-aware fixed layered layout with:
   * - Elevated fanned self-transitions for clear leg/arrowhead visibility
   * - Label-distance-driven quadratic Bezier routing & 2-pass coordinate-descent refinement
   *
   * @param {object} model Normalized StateMachine model ({ states, transitions })
   * @param {object} [opts]
   * @param {"LR"|"TB"} [opts.direction="LR"] Flow direction
   * @param {boolean} [opts.compactLabels=true] Compact badge mode vs full pill labels
   * @returns {object} Layout coordinates and routed SVG geometry
   */
  function computeLayout(model, opts = {}) {
    const direction = opts.direction === "TB" ? "TB" : "LR";
    const compactLabels = opts.compactLabels !== false;
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
      const ea = String(a.event || "").localeCompare(String(b.event || ""));
      if (ea !== 0) return ea;
      const na = String(a.name || "").localeCompare(String(b.name || ""));
      if (na !== 0) return na;
      return String(a.dstName || "").localeCompare(String(b.dstName || ""));
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

    // 2. Refine ranks along strictly forward BFS edges
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

    // 4. Assign coordinates with clean corridors for elevated self-loops & multi-edge routing
    const maxSelfLoops = Math.max(
      0,
      ...states.map(
        (st) =>
          sortedTransitions.filter(
            (t) => srcKeyOf(t) === keyOfState(st) && dstKeyOf(t) === keyOfState(st),
          ).length,
      ),
    );
    const rankStep = direction === "LR" ? W + 165 : H + (maxSelfLoops > 0 ? 160 : 120);
    const nodeStep = direction === "LR" ? H + (maxSelfLoops > 0 ? 156 : 100) : W + (maxSelfLoops > 0 ? 130 : 100);
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

    const boxRects = Object.entries(nodesById).map(([id, b]) => ({
      id,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
      w: b.width,
      h: b.height,
    }));

    const edgesById = {};
    const selfGroups = new Map();
    const pairGroups = new Map();

    for (const tr of sortedTransitions) {
      const sk = srcKeyOf(tr);
      const dk = dstKeyOf(tr);
      if (!sk || !dk || !nodesById[sk] || !nodesById[dk]) continue;
      if (sk === dk) {
        if (!selfGroups.has(sk)) selfGroups.set(sk, []);
        selfGroups.get(sk).push(tr);
      } else {
        const pKey = [sk, dk].sort().join("|");
        if (!pairGroups.has(pKey)) pairGroups.set(pKey, []);
        pairGroups.get(pKey).push(tr);
      }
    }

    // Track placed label rects `{ eid, cx, cy, w, h }` so routing optimizes min clearance
    const placedLabels = new Map();

    // 5a. Route self-transitions first: push arcs further from the state box so loop legs
    //     and arrowheads are clearly visible below staggered apex badges.
    for (const [sk, group] of selfGroups.entries()) {
      const count = group.length;
      const srcBox = nodesById[sk];
      const topY = srcBox.y;

      group.forEach((tr, idx) => {
        const eid = tr.id || `${sk}->${sk}:${tr.event || ""}:${tr.name || idx}`;
        const footX =
          count === 1
            ? srcBox.x + srcBox.width / 2
            : srcBox.x + 24 + ((srcBox.width - 48) * idx) / (count - 1);
        const halfW =
          count === 1 ? 20 : Math.min(15, Math.max(11, (srcBox.width - 44) / (count * 2.4)));
        const fanSpan = compactLabels
          ? srcBox.width + (count >= 3 ? 34 : 10)
          : srcBox.width + Math.max(40, count * 28);
        const fanLeft = srcBox.x + srcBox.width / 2 - fanSpan / 2;
        const targetApexX =
          count === 1 ? footX : fanLeft + (fanSpan * idx) / (count - 1);
        const tier = idx % 2;
        const apexH =
          count === 1
            ? 58
            : (compactLabels ? 56 : 58) + tier * 28 + Math.floor(idx / 4) * 20;

        // Exact cubic Bezier apex at t = 0.5: B(0.5) == (targetApexX, topY - apexH)
        const ctrlCenterX = (4 * targetApexX - footX) / 3;
        const ctrlY = topY - (4 * apexH - 1.5) / 3;
        const ctrlSpread = Math.max(halfW * 1.9, 26);

        const p0x = footX - halfW;
        const p3x = footX + halfW;
        const p3y = topY - 3;
        const c1x = ctrlCenterX - ctrlSpread;
        const c2x = ctrlCenterX + ctrlSpread;

        const d = `M ${p0x.toFixed(1)} ${topY} C ${c1x.toFixed(1)} ${ctrlY.toFixed(1)}, ${c2x.toFixed(1)} ${ctrlY.toFixed(1)}, ${p3x.toFixed(1)} ${p3y}`;
        const lx = targetApexX;
        const ly = topY - apexH;
        const pill = estimatePillSize(tr, compactLabels);

        const edgeObj = {
          d,
          labelX: lx,
          labelY: ly,
          pillW: pill.w,
          pillH: pill.h,
          pts: [
            { x: p0x, y: topY },
            { x: c1x, y: ctrlY },
            { x: c2x, y: ctrlY },
            { x: p3x, y: p3y },
            { x: lx - pill.w / 2, y: ly - pill.h / 2 },
            { x: lx + pill.w / 2, y: ly + pill.h / 2 },
          ],
          isBackEdge: false,
          isSelfLoop: true,
        };
        edgesById[eid] = edgeObj;
        placedLabels.set(eid, { eid, cx: lx, cy: ly, w: pill.w, h: pill.h });
      });
    }

    // 5b. Prepare non-self edges with base geometry and candidate curves
    const nonSelfSpecs = [];
    for (const group of pairGroups.values()) {
      const count = group.length;
      group.forEach((tr, idx) => {
        const sk = srcKeyOf(tr);
        const dk = dstKeyOf(tr);
        const eid = tr.id || `${sk}->${dk}:${tr.event || ""}:${tr.name || idx}`;
        const srcBox = nodesById[sk];
        const dstBox = nodesById[dk];

        const scx = srcBox.x + srcBox.width / 2;
        const scy = srcBox.y + srcBox.height / 2;
        const dcx = dstBox.x + dstBox.width / 2;
        const dcy = dstBox.y + dstBox.height / 2;
        const vx = dcx - scx;
        const vy = dcy - scy;
        const dist = Math.hypot(vx, vy) || 1;
        const nx = -vy / dist;
        const ny = vx / dist;

        const isBackEdge =
          srcBox.rank > dstBox.rank || (srcBox.rank === dstBox.rank && srcBox.order > dstBox.order);
        const rankDelta = Math.abs(dstBox.rank - srcBox.rank);
        const sameRankSkip = srcBox.rank === dstBox.rank && Math.abs(srcBox.order - dstBox.order) >= 2;
        const otherBoxes = boxRects.filter((b) => b.id !== sk && b.id !== dk);

        let baseCurveMag = 0;
        const candidateCurves = [];
        const addCurve = (c) => {
          const r = Math.round(c);
          if (!candidateCurves.includes(r)) candidateCurves.push(r);
        };

        if (sameRankSkip) {
          const pref = idx % 2 === 0 ? -160 : 160;
          baseCurveMag = pref;
          [pref, -pref, pref * 0.8, -pref * 0.8, pref * 1.25, -pref * 1.25].forEach(addCurve);
        } else if (rankDelta >= 2) {
          const pref = direction === "LR" ? (vy >= 0 ? -135 : 135) : 135;
          const signIdx = idx % 2 === 0 ? 1 : -1;
          baseCurveMag = (pref + Math.floor(idx / 2) * 42) * signIdx;
          [
            baseCurveMag,
            -baseCurveMag,
            100,
            -100,
            145,
            -145,
            185,
            -185,
            65,
            -65,
          ].forEach(addCurve);
        } else if (count > 1) {
          const dirSign = sk < dk ? 1 : -1;
          const centeredIdx = idx - (count - 1) / 2;
          baseCurveMag = centeredIdx * 58 * dirSign;
          if (Math.abs(baseCurveMag) < 28) {
            baseCurveMag = (idx % 2 === 0 ? 1 : -1) * 32 * dirSign;
          }
          [
            baseCurveMag,
            baseCurveMag + 28 * Math.sign(baseCurveMag || 1),
            baseCurveMag - 28 * Math.sign(baseCurveMag || 1),
            baseCurveMag + 56 * Math.sign(baseCurveMag || 1),
            baseCurveMag - 56 * Math.sign(baseCurveMag || 1),
            -baseCurveMag,
          ].forEach(addCurve);
        } else {
          baseCurveMag = isBackEdge ? 38 : 0;
          [baseCurveMag, 38, -38, 72, -72, 108, -108, 145, -145].forEach(addCurve);
        }

        const pill = estimatePillSize(tr, compactLabels);
        nonSelfSpecs.push({
          eid,
          tr,
          sk,
          dk,
          srcBox,
          dstBox,
          scx,
          scy,
          dcx,
          dcy,
          nx,
          ny,
          isBackEdge,
          baseCurveMag,
          candidateCurves,
          otherBoxes,
          pill,
        });
      });
    }

    const CANDIDATE_T = [0.5, 0.41, 0.59, 0.33, 0.67, 0.26, 0.74];

    function buildGeometryForCandidate(spec, curveMag, tPos) {
      const cx = (spec.scx + spec.dcx) / 2 + spec.nx * curveMag;
      const cy = (spec.scy + spec.dcy) / 2 + spec.ny * curveMag;
      const p1 = perimeterPoint(spec.scx, spec.scy, spec.srcBox.width, spec.srcBox.height, cx, cy, 1);
      const p2 = perimeterPoint(spec.dcx, spec.dcy, spec.dstBox.width, spec.dstBox.height, cx, cy, 5);
      const pt = quadPoint(p1, { x: cx, y: cy }, p2, tPos);
      return { cx, cy, p1, p2, lx: pt.x, ly: pt.y, curveMag, tPos };
    }

    function scoreCandidate(spec, geom) {
      const labelRect = {
        cx: geom.lx,
        cy: geom.ly,
        w: spec.pill.w,
        h: spec.pill.h,
      };
      const ctrl = { x: geom.cx, y: geom.cy };

      // 1. Keep curve away from non-endpoint state boxes
      let boxCurveHits = 0;
      const samples = [];
      for (let s = 1; s <= 15; s++) {
        const pt = quadPoint(geom.p1, ctrl, geom.p2, s / 16);
        samples.push(pt);
        for (const ob of spec.otherBoxes) {
          if (pointInRect(pt.x, pt.y, ob, 10)) {
            boxCurveHits++;
          }
        }
      }

      // 2. Keep label pill away from ALL state boxes
      let minBoxClearance = Infinity;
      for (const br of boxRects) {
        const d = rectClearance(labelRect, br);
        if (d < minBoxClearance) minBoxClearance = d;
      }

      // 3. Driving force: maximize minimum edge-to-edge clearance against all other transition labels
      let minLabelDist = Infinity;
      let totalInvDist = 0;
      let curveThroughOtherLabel = 0;

      for (const [otherEid, otherRect] of placedLabels.entries()) {
        if (otherEid === spec.eid) continue;
        const clr = rectClearance(labelRect, otherRect);
        if (clr < minLabelDist) minLabelDist = clr;
        if (clr < 70) {
          const clamped = Math.max(1, clr + 20);
          totalInvDist += 120 / clamped;
        }
        // Check if this curve slices directly under an existing label pill
        for (let idx = 2; idx < samples.length - 2; idx++) {
          const pt = samples[idx];
          if (
            Math.abs(pt.x - otherRect.cx) < otherRect.w / 2 + 2 &&
            Math.abs(pt.y - otherRect.cy) < otherRect.h / 2 + 2
          ) {
            curveThroughOtherLabel++;
            break;
          }
        }
      }

      let score = 0;
      score -= boxCurveHits * 12000;
      if (minBoxClearance < 0) {
        score -= 10000 + (-minBoxClearance) * 200;
      } else if (minBoxClearance < 14) {
        score -= (14 - minBoxClearance) * 45;
      }

      if (minLabelDist < Infinity) {
        if (minLabelDist < 0) {
          score -= 6000 + (-minLabelDist) * 180;
        } else {
          // Strongly prioritize increasing the minimum pairwise distance up to ~48px,
          // then continue rewarding wider separation gently.
          score += Math.min(minLabelDist, 48) * 26 + Math.min(minLabelDist, 120) * 3;
        }
      }

      score -= totalInvDist;
      score -= curveThroughOtherLabel * 140;

      // Gentle aesthetic tie-breakers once clear of obstacles and sibling labels
      score -= Math.abs(geom.tPos - 0.5) * 22;
      score -= Math.abs(geom.curveMag - spec.baseCurveMag) * 0.08;

      return score;
    }

    function commitSpecGeom(spec, geom) {
      const d =
        Math.abs(geom.curveMag) < 2
          ? `M ${geom.p1.x.toFixed(1)} ${geom.p1.y.toFixed(1)} L ${geom.p2.x.toFixed(1)} ${geom.p2.y.toFixed(1)}`
          : `M ${geom.p1.x.toFixed(1)} ${geom.p1.y.toFixed(1)} Q ${geom.cx.toFixed(1)} ${geom.cy.toFixed(1)} ${geom.p2.x.toFixed(1)} ${geom.p2.y.toFixed(1)}`;
      const midPt = quadPoint(geom.p1, { x: geom.cx, y: geom.cy }, geom.p2, 0.5);
      const q1 = quadPoint(geom.p1, { x: geom.cx, y: geom.cy }, geom.p2, 0.25);
      const q3 = quadPoint(geom.p1, { x: geom.cx, y: geom.cy }, geom.p2, 0.75);

      edgesById[spec.eid] = {
        d,
        labelX: geom.lx,
        labelY: geom.ly,
        pillW: spec.pill.w,
        pillH: spec.pill.h,
        pts: [
          geom.p1,
          geom.p2,
          midPt,
          q1,
          q3,
          { x: geom.lx - spec.pill.w / 2, y: geom.ly - spec.pill.h / 2 },
          { x: geom.lx + spec.pill.w / 2, y: geom.ly + spec.pill.h / 2 },
        ],
        isBackEdge: spec.isBackEdge,
        isSelfLoop: false,
      };
      placedLabels.set(spec.eid, {
        eid: spec.eid,
        cx: geom.lx,
        cy: geom.ly,
        w: spec.pill.w,
        h: spec.pill.h,
      });
    }

    // Initial greedy pass + 2 coordinate-descent refinement passes over all non-self edges
    const bestChoiceByEid = new Map();
    for (let pass = 0; pass < 3; pass++) {
      for (const spec of nonSelfSpecs) {
        let bestScore = -Infinity;
        let bestGeom = null;

        for (const curveMag of spec.candidateCurves) {
          for (const tPos of CANDIDATE_T) {
            const geom = buildGeometryForCandidate(spec, curveMag, tPos);
            const sc = scoreCandidate(spec, geom);
            if (sc > bestScore) {
              bestScore = sc;
              bestGeom = geom;
            }
          }
        }

        if (bestGeom) {
          const prev = bestChoiceByEid.get(spec.eid);
          if (!prev || pass === 0 || bestScore > scoreCandidate(spec, prev) + 1e-3) {
            bestChoiceByEid.set(spec.eid, bestGeom);
            commitSpecGeom(spec, bestGeom);
          }
        }
      }
    }

    // 6. Compute global bounding box from all state boxes + routed curves + label rectangles
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
    for (const edge of Object.values(edgesById)) {
      for (const pt of edge.pts || []) {
        expandBounds(pt.x - 10, pt.y - 10);
        expandBounds(pt.x + 10, pt.y + 10);
      }
      delete edge.pts;
    }

    const shiftX = Math.max(0, Math.round(margin / 2 - minX));
    const shiftY = Math.max(0, Math.round(margin / 2 - minY));
    if (shiftX > 0 || shiftY > 0) {
      for (const box of Object.values(nodesById)) {
        box.x += shiftX;
        box.y += shiftY;
      }
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
