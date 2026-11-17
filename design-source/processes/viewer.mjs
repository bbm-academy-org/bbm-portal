// IDEF0 viewer for the DS content-production model (content/processes/ds-content-production/model/
// index.yaml + diagram YAMLs; format: model/FORMAT-ru.md). Browser-only module: the KB page loads it
// through next/dynamic with ssr: false (client.tsx); the model and the registry explanations are read
// and parsed at build time on the server (index.tsx) and arrive as the `model` prop — no fetch here.
// React Flow renders; the layout below is the IDEF0 staircase: boxes A1 … An on a diagonal from
// top-left to bottom-right in number order, ICOM sides fixed (I = west, C = north, O = east,
// M = south), arrows routed orthogonally by IDEF0 convention, labels placed where they cross
// nothing. ELK's layered placer was dropped: with partitions and forced model order it still keeps
// the columns but lifts boxes that feed back (A5, A6 rose above A4 on A0) — it has no notion of a
// staircase, so boxes are placed here and only the routing follows from that placement.
import React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
} from "@xyflow/react";
import htm from "htm";

// Lowest zoom at which box names and arrow labels stay legible; the initial view never goes below it.
const READABLE_ZOOM = 0.65;
const html = htm.bind(React.createElement);
const { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } =
  React;

const KIND_NAME = { I: "вход", C: "управление", O: "выход", M: "механизм" };

// Diagram units equal CSS px at zoom 1. Fonts are sized so that at zoom 0.87 arrow labels render
// ≥ 11 px and box titles ≥ 13 px. The initial view fits the whole diagram (it may start smaller
// than that on a small window); zoom in to read.
const U = {
  label: 13,
  line: 16,
  title: 15,
  titleLine: 19,
  lane: 12,
  pad: 16,
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Box title width: the narrowest width (step 10 px) at which the title takes ≤ 2 lines, else ≤ 3.
const TITLE_MIN = 170;
const TITLE_TWO_LINES_MAX = 300;
const TITLE_MAX = 360;
// Least horizontal step between neighbouring boxes of the staircase.
const STEP_X = 120;
const WEST_MARGIN = 230;
function titleWidth(name) {
  for (const maxLines of [2, 3])
    for (
      let w = TITLE_MIN;
      w <= (maxLines === 2 ? TITLE_TWO_LINES_MAX : TITLE_MAX);
      w += 10
    )
      if (wrapTo(name, w - 22, U.title, 600).length <= maxLines) return w;
  return TITLE_MAX;
}

const asList = (end) => (Array.isArray(end) ? end : end ? [end] : []);
const codeNumber = (code) => Number(String(code).slice(1)) || 0;

const measureCtx = document.createElement("canvas").getContext("2d");
function textWidth(text, size, weight = 400) {
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}
function wrapTo(text, maxWidth, size, weight) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, weight) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
/** Label block size; matches `.arrow-label` (13 px / 16 px lines, 2 px + 4 px padding, 3 px rule). */
function labelBlock(text, maxWidth) {
  const lines = wrapTo(text, maxWidth - 10, U.label);
  // An unlabelled arrow has no block: Math.max() of no widths would be -Infinity → NaN geometry.
  if (!lines.length) return { text: "", lines: 0, width: 0, height: 0 };
  return {
    text: lines.join("\n"),
    lines: lines.length,
    width: Math.ceil(Math.max(...lines.map((l) => textWidth(l, U.label)))) + 11,
    height: lines.length * U.line + 4,
  };
}

/** Arrow kind for colouring: the ICOM role at its target (boundary outputs are O). */
function arrowKind(arrow) {
  const target = asList(arrow.to)[0] ?? {};
  if (target.boundary) return "O";
  return target.side ?? "I";
}

// ---------- Staircase layout ----------

/**
 * Branch kinds. Boundary: `in` (I code → west), `drop` (C code → north), `rise` (M code → south),
 * `out` (east → O code). Between boxes: `fwd` to a later box, `back` to the same or an earlier box
 * (IDEF0 feedback: to a control above all boxes, to an input or mechanism below the source box).
 */
function classify(diagram) {
  const boxes = diagram.boxes ?? [];
  const col = new Map(boxes.map((b, i) => [b.id, i]));
  const routes = [];
  for (const arrow of diagram.arrows ?? []) {
    const from = asList(arrow.from);
    const to = asList(arrow.to);
    if (from.length !== 1)
      throw new Error(
        `стрелка ${arrow.id}: источников ${from.length}, нужен один (ветвление — только в to)`,
      );
    const src = from[0];
    if (!src.boundary && !col.has(src.box))
      throw new Error(`стрелка ${arrow.id}: неизвестный блок ${src.box}`);
    const branches = to.map((end) => {
      if (end.boundary) {
        if (src.boundary)
          throw new Error(
            `стрелка ${arrow.id}: идёт с границы ${src.boundary} на границу ${end.boundary}, минуя блоки`,
          );
        return { end, kind: "out" };
      }
      if (!col.has(end.box))
        throw new Error(`стрелка ${arrow.id}: неизвестный блок ${end.box}`);
      if (src.boundary) {
        const side = src.boundary[0];
        if (end.side !== side)
          throw new Error(
            `стрелка ${arrow.id}: граничная ${src.boundary} входит в ${end.box} со стороны ${end.side}, а должна — со стороны ${side}`,
          );
        return { end, kind: { I: "in", C: "drop", M: "rise" }[side] };
      }
      return {
        end,
        kind: col.get(end.box) > col.get(src.box) ? "fwd" : "back",
      };
    });
    // Boundary drops and rises are drawn left to right; the leftmost carries the label.
    if (src.boundary)
      branches.sort((a, b) => col.get(a.end.box) - col.get(b.end.box));
    routes.push({ arrow, src, branches });
  }
  return { boxes, col, routes };
}

/** Ports on one side, ordered by (group, key, model order) so that routed lines do not cross. */
class Side {
  constructor() {
    this.items = [];
  }
  add(id, group, key) {
    if (!this.items.some((p) => p.id === id))
      this.items.push({ id, group, key, n: this.items.length });
  }
  sort() {
    this.items.sort((a, b) => a.group - b.group || a.key - b.key || a.n - b.n);
    this.items.forEach((p, i) => (p.index = i));
  }
  get length() {
    return this.items.length;
  }
  index(id) {
    return this.items.find((p) => p.id === id).index;
  }
}

/** Drops repeated points and interior points on a straight run: a bend is drawn only where the
 * route turns. Ports share their coordinate with the line feeding them, so no jog is left. */
function straighten(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    const before = out[out.length - 2];
    if (
      before &&
      ((before.x === prev.x && prev.x === p.x) ||
        (before.y === prev.y && prev.y === p.y))
    )
      out.pop();
    out.push(p);
  }
  return out;
}

function layoutDiagram(diagram) {
  const { boxes, col, routes } = classify(diagram);
  const single = boxes.length === 1;
  const last = boxes.length - 1;
  const sides = new Map(
    boxes.map((b) => [
      b.id,
      { I: new Side(), C: new Side(), O: new Side(), M: new Side() },
    ]),
  );

  // 1. Ports. East: feedback up, boundary outputs, forward (farthest first), feedback down.
  // West: from earlier boxes, boundary inputs, feedback. North: from earlier boxes (later source
  // leftmost), boundary controls, feedback. South: from earlier boxes, boundary mechanisms, feedback.
  for (const { arrow, src, branches } of routes) {
    if (!src.boundary) {
      const kinds = branches.map((b) =>
        b.kind === "back" ? (b.end.side === "C" ? "up" : "down") : b.kind,
      );
      const far = Math.max(
        ...branches.map((b) => (b.end.box ? col.get(b.end.box) : 0)),
      );
      const group = kinds.includes("up")
        ? 0
        : kinds.includes("out")
          ? 1
          : kinds.includes("fwd")
            ? 2
            : 3;
      sides.get(src.box).O.add(arrow.id, group, group === 2 ? -far : 0);
    }
    for (const { end, kind } of branches) {
      if (!end.box) continue;
      const srcCol = src.boundary ? -1 : col.get(src.box);
      const group = kind === "fwd" ? 0 : kind === "back" ? 2 : 1;
      const key =
        kind === "fwd"
          ? end.side === "C"
            ? -srcCol
            : srcCol
          : kind === "back"
            ? -srcCol
            : codeNumber(src.boundary);
      sides.get(end.box)[end.side].add(arrow.id, group, key);
    }
  }
  for (const s of sides.values())
    for (const side of Object.values(s)) side.sort();

  // 2. Lanes: vertical tracks right of a source box (feedback leaving it) and left of a target
  // column (arrows coming down or up to a west input); horizontal tracks above all boxes (feedback
  // controls) and under a box (feedback inputs/mechanisms leaving it, forward mechanisms entering it).
  const xrUp = boxes.map(() => []);
  const xrDown = boxes.map(() => []);
  const laneDown = boxes.map(() => []);
  const laneUp = boxes.map(() => []);
  const laneMech = boxes.map(() => []);
  const top = [];
  const under = boxes.map(() => []);
  for (const { arrow, src, branches } of routes) {
    const s = src.box ? col.get(src.box) : -1;
    const westIn = branches.filter(
      (b) => (b.kind === "fwd" || b.kind === "in") && b.end.side === "I",
    );
    if (westIn.length && (src.box || westIn.length > 1)) {
      const first = westIn.reduce((a, b) =>
        col.get(b.end.box) < col.get(a.end.box) ? b : a,
      );
      laneDown[col.get(first.end.box)].push({
        id: arrow.id,
        order: sides.get(first.end.box).I.index(arrow.id),
      });
    }
    for (const { end, kind } of branches) {
      if (kind === "fwd" && end.side === "M") {
        laneMech[col.get(end.box)].push({ id: `${arrow.id}>${end.box}` });
        under[col.get(end.box)].push(`${arrow.id}>${end.box}`);
      }
      if (kind === "back" && end.side === "I")
        laneUp[col.get(end.box)].push({
          id: `${arrow.id}>${end.box}`,
          order: -sides.get(end.box).I.index(arrow.id),
        });
    }
    if (branches.some((b) => b.kind === "back" && b.end.side === "C")) {
      xrUp[s].push({
        id: arrow.id,
        order: sides.get(src.box).O.index(arrow.id),
      });
      top.push(arrow.id);
    }
    if (branches.some((b) => b.kind === "back" && b.end.side !== "C")) {
      xrDown[s].push({
        id: arrow.id,
        order: -sides.get(src.box).O.index(arrow.id),
      });
      under[s].push(arrow.id);
    }
  }
  const byOrder = (list) =>
    list.sort((a, b) => a.order - b.order).map((l) => l.id);
  const xrLanes = boxes.map((_, i) => ({
    up: byOrder(xrUp[i]),
    down: byOrder(xrDown[i]),
  }));
  const leftLanes = boxes.map((_, j) => {
    const down = byOrder(laneDown[j]);
    const up = byOrder(laneUp[j]);
    return { down, up, mech: laneMech[j].map((l) => l.id) };
  });
  // Right-side track per arrow. An arrow feeding back both up and down runs the full height, so it
  // owns a track no other arrow uses; an up-only and a down-only arrow may share a track, because
  // up ports sit above down ports on the east side and their spans never meet.
  const xrTrack = xrLanes.map(({ up, down }) => {
    const both = up.filter((id) => down.includes(id));
    const track = new Map(both.map((id, k) => [id, k]));
    up.filter((id) => !track.has(id)).forEach((id, k) =>
      track.set(id, both.length + k),
    );
    let k = both.length;
    for (const id of down) if (!track.has(id)) track.set(id, k++);
    return track;
  });
  const nXr = xrTrack.map((t) => (t.size ? Math.max(...t.values()) + 1 : 0));
  // Left side: a descending lane can run below its first target (a branching input to later
  // boxes), so feedback lanes rising from under the box take their own tracks after it.
  const nLeft = leftLanes.map(
    (l) => l.down.length + l.up.length + l.mech.length,
  );

  // 3. Box sizes (title measured in its rendered font) and staircase positions. Diagrams may be
  // wider than tall: a box is widened until its title takes ≤ 2 lines (≤ 3 for long titles), and
  // the staircase steps further right than down, which also leaves room for labels on the
  // horizontal runs between boxes.
  const margin = single ? 300 : 130;
  const sized = boxes.map((box) => {
    const s = sides.get(box.id);
    // A title wraps only between words: the longest word sets the floor.
    const longestWord = Math.max(
      ...String(box.name)
        .split(/\s+/)
        .map((w) => textWidth(w, U.title, 600)),
    );
    const width = Math.max(
      single ? 340 : titleWidth(box.name),
      Math.ceil(longestWord) + 26,
      (Math.max(s.C.length, s.M.length) + 1) * (single ? 34 : 15),
    );
    const titleLines = wrapTo(box.name, width - 22, U.title, 600).length;
    const height = Math.max(
      single ? 200 : 96,
      titleLines * U.titleLine + 46,
      (Math.max(s.I.length, s.O.length) + 1) * (single ? 56 : 30),
    );
    return { box, width, height };
  });
  const topBand = (single ? 170 : 130) + top.length * U.lane;
  // The west margin carries the boundary-input labels: wide enough for two-line labels.
  let x = (single ? margin : WEST_MARGIN) + nLeft[0] * U.lane;
  let y = topBand;
  const placed = sized.map((s, i) => {
    if (i) {
      x += Math.max(STEP_X, 2 * U.pad + (nXr[i - 1] + nLeft[i]) * U.lane + 48);
      y += Math.max(50, U.pad + under[i - 1].length * U.lane + 34);
    }
    const p = { ...s, x, y };
    x += s.width;
    y += s.height;
    return p;
  });
  const frameW = x + U.pad + nXr[last] * U.lane + (single ? margin : 110);
  const frameH = y + U.pad + under[last].length * U.lane + (single ? 170 : 130);

  // 4. Routes.
  const at = (id) => placed[col.get(id)];
  const port = (boxId, side, arrowId) => {
    const b = at(boxId);
    const list = sides.get(boxId)[side];
    const t = (list.index(arrowId) + 1) / (list.length + 1);
    if (side === "I") return { x: b.x, y: Math.round(b.y + b.height * t) };
    if (side === "O")
      return { x: b.x + b.width, y: Math.round(b.y + b.height * t) };
    if (side === "C") return { x: Math.round(b.x + b.width * t), y: b.y };
    return { x: Math.round(b.x + b.width * t), y: b.y + b.height };
  };
  const leftLaneX = (j, id) => {
    const l = leftLanes[j];
    let k = l.down.indexOf(id);
    if (k < 0 && l.up.includes(id)) k = l.down.length + l.up.indexOf(id);
    if (k < 0) k = l.down.length + l.up.length + l.mech.indexOf(id);
    return placed[j].x - U.pad - k * U.lane;
  };
  const xrX = (i, id) => {
    const k = xrTrack[i].get(id) ?? 0;
    return placed[i].x + placed[i].width + U.pad + k * U.lane;
  };
  const underY = (i, id) =>
    placed[i].y + placed[i].height + U.pad + under[i].indexOf(id) * U.lane;
  const topY = (id) => topBand - U.pad - top.indexOf(id) * U.lane;

  // Neighbouring ports sit closer than a code is wide: every second code moves one row out.
  const stagger = (boxId, side, arrowId) =>
    (sides.get(boxId)[side].index(arrowId) % 2) * 14;
  const edges = [];
  const codes = [];
  for (const { arrow, src, branches } of routes) {
    const s = src.box ? col.get(src.box) : -1;
    const S = src.box ? port(src.box, "O", arrow.id) : null;
    const westIn = branches.filter(
      (b) => (b.kind === "fwd" || b.kind === "in") && b.end.side === "I",
    );
    const firstWest = westIn.length
      ? Math.min(...westIn.map((b) => col.get(b.end.box)))
      : -1;
    let inY = null;
    branches.forEach(({ end, kind }, k) => {
      const T = end.box ? port(end.box, end.side, arrow.id) : null;
      const t = end.box ? col.get(end.box) : -1;
      let points;
      if (kind === "in") {
        // A branching boundary input enters at the height of its first (highest) target.
        inY ??= port(
          westIn.find((b) => col.get(b.end.box) === firstWest).end.box,
          "I",
          arrow.id,
        ).y;
        if (k === 0)
          codes.push({
            code: src.boundary,
            side: "I",
            x: 0,
            y: inY,
            key: `${arrow.id}`,
          });
        const lane = westIn.length > 1 ? leftLaneX(firstWest, arrow.id) : T.x;
        points = [
          { x: 0, y: inY },
          { x: lane, y: inY },
          { x: lane, y: T.y },
          T,
        ];
      } else if (kind === "drop") {
        codes.push({
          code: src.boundary,
          side: "C",
          x: T.x,
          y: -stagger(end.box, "C", arrow.id),
          key: `${arrow.id}>${end.box}`,
        });
        points = [{ x: T.x, y: 0 }, T];
      } else if (kind === "rise") {
        codes.push({
          code: src.boundary,
          side: "M",
          x: T.x,
          y: frameH + stagger(end.box, "M", arrow.id),
          key: `${arrow.id}>${end.box}`,
        });
        points = [{ x: T.x, y: frameH }, T];
      } else if (kind === "out") {
        codes.push({
          code: end.boundary,
          side: "O",
          x: frameW,
          y: S.y,
          key: arrow.id,
        });
        points = [S, { x: frameW, y: S.y }];
      } else if (kind === "fwd" && end.side === "C") {
        points = [S, { x: T.x, y: S.y }, T];
      } else if (kind === "fwd" && end.side === "I") {
        const lane = leftLaneX(firstWest, arrow.id);
        points = [S, { x: lane, y: S.y }, { x: lane, y: T.y }, T];
      } else if (kind === "fwd") {
        const lane = leftLaneX(t, `${arrow.id}>${end.box}`);
        const below = underY(t, `${arrow.id}>${end.box}`);
        points = [
          S,
          { x: lane, y: S.y },
          { x: lane, y: below },
          { x: T.x, y: below },
          T,
        ];
      } else if (end.side === "C") {
        const xr = xrX(s, arrow.id);
        const above = topY(arrow.id);
        points = [
          S,
          { x: xr, y: S.y },
          { x: xr, y: above },
          { x: T.x, y: above },
          T,
        ];
      } else {
        const xr = xrX(s, arrow.id);
        const below = underY(s, arrow.id);
        points =
          end.side === "I"
            ? [
                S,
                { x: xr, y: S.y },
                { x: xr, y: below },
                { x: leftLaneX(t, `${arrow.id}>${end.box}`), y: below },
                { x: leftLaneX(t, `${arrow.id}>${end.box}`), y: T.y },
                T,
              ]
            : [
                S,
                { x: xr, y: S.y },
                { x: xr, y: below },
                { x: T.x, y: below },
                T,
              ];
      }
      edges.push({
        id: `${arrow.id}#${k}`,
        arrow,
        // Each branch is drawn whole, from the shared source to its own end: the box at each end
        // decides which branches a focused box lights.
        from: src.box ?? null,
        to: end.box ?? null,
        kind:
          kind === "in" || kind === "drop" || kind === "rise"
            ? src.boundary[0]
            : arrowKind(arrow),
        prefer: kind === "drop" || kind === "rise" ? "end" : "start",
        points: straighten(points),
        host: k === 0,
      });
    });
  }

  // 5. Labels: one per arrow, on its first branch, at the cheapest free spot along it — never on a
  // box, a boundary or another label; crossing a line costs, distance from the anchor costs a little.
  const boxRects = placed.map((p) => ({
    x: p.x,
    y: p.y,
    w: p.width,
    h: p.height,
  }));
  const segments = edges.flatMap((e) =>
    e.points
      .slice(1)
      .map((p, i) => ({ a: e.points[i], b: p, arrow: e.arrow.id })),
  );
  const labels = [];
  const hits = (r, q, m) =>
    r.x < q.x + q.w + m &&
    q.x < r.x + r.w + m &&
    r.y < q.y + q.h + m &&
    q.y < r.y + r.h + m;
  const crossings = (r) =>
    segments.filter(({ a, b }) => {
      const sx = Math.min(a.x, b.x);
      const sy = Math.min(a.y, b.y);
      return hits(
        r,
        { x: sx, y: sy, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) },
        1,
      );
    }).length;
  const widths = single ? [320, 240, 160] : [300, 220, 160];
  // Shortest paths first: they have the fewest spots, long ones can still move along.
  const pathLength = (e) =>
    e.points
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.abs(p.x - e.points[i].x) + Math.abs(p.y - e.points[i].y),
        0,
      );
  const hosts = edges
    .filter((e) => e.host)
    .sort((a, b) => pathLength(a) - pathLength(b));
  for (const edge of hosts) {
    const pts =
      edge.prefer === "end" ? [...edge.points].reverse() : edge.points;
    let best = null;
    const consider = (spot, block, walkedSoFar) => {
      const r = { x: spot.x, y: spot.y, w: block.width, h: block.height };
      if (
        r.x < 4 ||
        r.y < 4 ||
        r.x + r.w > frameW - 4 ||
        r.y + r.h > frameH - 4
      )
        return;
      if (boxRects.some((q) => hits(r, q, 4))) return;
      const overlap = labels.filter((q) => hits(r, q, 3)).length;
      const cost =
        overlap * 1000 +
        crossings(r) * 40 +
        (walkedSoFar + spot.d) * 0.05 +
        // An extra line costs about half a crossing: a wide one- or two-line label wins where it fits.
        block.lines * 20;
      if (!best || cost < best.cost) best = { cost, r, block };
    };
    let walked = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const maxW of widths) {
        const block = labelBlock(edge.arrow.label ?? edge.arrow.id, maxW);
        const spots = [];
        if (a.y === b.y) {
          const x0 = Math.min(a.x, b.x);
          const room = len - block.width - 12;
          for (const f of room > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0]) {
            const along = 6 + f * Math.max(room, 0);
            const lx =
              a.x <= b.x
                ? x0 + along
                : Math.max(a.x, b.x) - along - block.width;
            spots.push(
              { x: lx, y: a.y - block.height - 3, d: along },
              { x: lx, y: a.y + 3, d: along + 4 },
            );
          }
        } else {
          const y0 = Math.min(a.y, b.y);
          const room = len - block.height - 12;
          for (const f of room > 0 ? [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1] : [0]) {
            const along = 6 + f * Math.max(room, 0);
            const ly =
              a.y <= b.y
                ? y0 + along
                : Math.max(a.y, b.y) - along - block.height;
            spots.push(
              { x: a.x + 5, y: ly, d: along },
              { x: a.x - 5 - block.width, y: ly, d: along + 4 },
            );
          }
        }
        for (const spot of spots) consider(spot, block, walked);
      }
      walked += len;
    }
    // Dense margins (many boundary arrows side by side) can leave no free spot on the path itself:
    // then search outward from the path's corners, so a label moves aside instead of covering
    // another label or disappearing.
    if (!best || best.cost >= 1000) {
      const block = labelBlock(
        edge.arrow.label ?? edge.arrow.id,
        widths[widths.length - 1],
      );
      for (let k = 1; k <= 16; k += 1) {
        const step = k * 8;
        for (const p of pts)
          for (const [dx, dy] of [
            [5, -block.height - step],
            [5, step],
            [-5 - block.width, -block.height - step],
            [-5 - block.width, step],
            [5 + step, -block.height / 2],
            [-5 - block.width - step, -block.height / 2],
          ])
            consider({ x: p.x + dx, y: p.y + dy, d: 200 + step * 4 }, block, 0);
        if (best && best.cost < 1000) break;
      }
    }
    if (!best) {
      // Never drop a label: clamp it into the frame next to the arrow's first point.
      const block = labelBlock(
        edge.arrow.label ?? edge.arrow.id,
        widths[widths.length - 1],
      );
      const p = pts[0];
      best = {
        block,
        r: {
          x: Math.min(Math.max(p.x + 5, 4), frameW - 4 - block.width),
          y: Math.min(Math.max(p.y + 3, 4), frameH - 4 - block.height),
          w: block.width,
          h: block.height,
        },
      };
    }
    labels.push(best.r);
    edge.label = { text: best.block.text, x: best.r.x, y: best.r.y };
  }

  // 6. React Flow nodes and edges. Every edge runs frame → frame through two hidden handles: the
  // path is drawn from the routed points, so React Flow only supplies events and markers.
  const nodes = [
    {
      id: "frame",
      type: "frame",
      position: { x: 0, y: 0 },
      data: { codes },
      // Explicit width/height: React Flow then never hides a rebuilt node while it re-measures it.
      width: frameW,
      height: frameH,
      style: { width: frameW, height: frameH },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    },
    ...placed.map((p) => ({
      id: p.box.id,
      type: "box",
      position: { x: p.x, y: p.y },
      data: { box: p.box },
      width: p.width,
      height: p.height,
      style: { width: p.width, height: p.height },
      draggable: false,
    })),
  ];
  // Drawn extent: boundary codes sit outside the frame (CODE_OFFSET: ≈ 32 px past a staggered C/M
  // code, ≈ 36 px beside an I/O code) and a label may be placed past the frame edge.
  const bounds = { x0: -36, y0: -34, x1: frameW + 36, y1: frameH + 34 };
  for (const r of labels) {
    bounds.x0 = Math.min(bounds.x0, r.x);
    bounds.y0 = Math.min(bounds.y0, r.y);
    bounds.x1 = Math.max(bounds.x1, r.x + r.w);
    bounds.y1 = Math.max(bounds.y1, r.y + r.h);
  }
  return {
    width: frameW,
    height: frameH,
    bounds,
    nodes,
    edges: edges.map((e) => ({
      id: e.id,
      type: "idef",
      source: "frame",
      sourceHandle: "s",
      target: "frame",
      targetHandle: "t",
      data: {
        arrow: e.arrow,
        from: e.from,
        to: e.to,
        kind: e.kind,
        points: e.points,
        label: e.label ?? null,
      },
    })),
  };
}

// ---------- React Flow node / edge renderers ----------

const CODE_OFFSET = {
  I: { transform: "translate(calc(-100% - 6px), -50%)" },
  O: { transform: "translate(6px, -50%)" },
  C: { transform: "translate(4px, calc(-100% - 2px))" },
  M: { transform: "translate(4px, 2px)" },
};

function FrameNode({ data }) {
  return html`<div class="frame">
    <${Handle}
      id="s"
      type="source"
      position=${Position.Left}
      isConnectable=${false}
    />
    <${Handle}
      id="t"
      type="target"
      position=${Position.Left}
      isConnectable=${false}
    />
    ${data.codes.map(
      (c) =>
        html`<span
          key=${c.key}
          class="code"
          style=${{ left: c.x, top: c.y, ...CODE_OFFSET[c.side] }}
        >
          ${c.code}
        </span>`,
    )}
  </div>`;
}

function BoxNode({ data }) {
  // Focus is drawn from data, not React Flow selection: selecting re-sorts nodes by z-index and
  // re-inserts the DOM node mid-click, which swallows the double-click that opens a child diagram.
  // No `title` attributes: a native tooltip would duplicate the hover card, or defeat its switch;
  // the note reaches assistive tech through aria-description.
  const { box, hasChild, onOpen, focused: selected } = data;
  const mechanisms = box.mechanisms ?? [];
  return html`<div
    class=${"box" + (selected ? " selected" : "")}
    aria-description=${box.note ?? undefined}
    onDoubleClick=${onOpen ?? undefined}
  >
    ${hasChild ? html`<span class="drill" aria-label="Двойной щелчок — декомпозиция">▼</span>` : null}
    <div class="name">${box.name}</div>
    <div class="mech">${mechanisms.join(" · ")}</div>
    <div class="num">${box.id}</div>
  </div>`;
}

// Bend radius of an arrow: straight runs stay orthogonal (IDEF0), only the corners are rounded.
const BEND_RADIUS = 7;

/** SVG path through orthogonal points with every bend drawn as a quarter arc; the radius shrinks
 * to half the shorter adjacent run, so two close bends never overlap. */
function roundedPath(points, radius = BEND_RADIUS) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const inLen = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const outLen = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ux = Math.sign(b.x - a.x);
    const uy = Math.sign(b.y - a.y);
    const vx = Math.sign(c.x - b.x);
    const vy = Math.sign(c.y - b.y);
    // y grows downwards: a positive cross product is a clockwise turn, SVG sweep-flag 1.
    const sweep = ux * vy - uy * vx > 0 ? 1 : 0;
    d += ` L ${b.x - ux * r} ${b.y - uy * r} A ${r} ${r} 0 0 ${sweep} ${b.x + vx * r} ${b.y + vy * r}`;
  }
  const end = points[points.length - 1];
  return `${d} L ${end.x} ${end.y}`;
}

function IdefEdge({ id, data, markerEnd }) {
  const points = data.points;
  if (!points.length) return null;
  const path = roundedPath(points);
  const color = `var(--${data.kind.toLowerCase()})`;
  return html`<${React.Fragment}>
    <${BaseEdge}
      id=${id}
      path=${path}
      markerEnd=${markerEnd}
      style=${{ stroke: color, strokeWidth: 1 }}
      interactionWidth=${12}
    />
    ${
      data.label
        ? html`<${EdgeLabelRenderer}>
            <div
              class=${"arrow-label nodrag nopan" + (data.active ? " active" : data.lit ? " lit" : data.dim ? " dim" : "")}
              style=${{ transform: `translate(${data.label.x}px, ${data.label.y}px)`, borderLeft: `3px solid ${color}`, outlineColor: data.lit ? color : undefined }}
              onClick=${() => data.onSelect?.(data.arrow.id)}
              onMouseEnter=${(event) => data.onHover?.(data.arrow.id, event.currentTarget.getBoundingClientRect())}
              onMouseLeave=${() => data.onHover?.(null)}
            >
              ${data.label.text}
            </div>
          <//>`
        : null
    }
  <//>`;
}

const nodeTypes = { frame: FrameNode, box: BoxNode };
const edgeTypes = { idef: IdefEdge };

// ---------- Explanations: registry names and definitions, TO-BE fate ----------

const blockRef = (knowledge, n) =>
  knowledge?.blocks.has(n)
    ? `блок ${n} «${knowledge.blocks.get(n)}»`
    : `блок ${n}`;
const missing = (knowledge) =>
  knowledge ? "нет в реестре" : "реестр не загружен — только ID";

/** One F-ID in plain words: the registry name, then the TO-BE step it became (or why it left). */
function FunctionLine({ knowledge, id }) {
  const f = knowledge?.functions.get(id);
  if (!f)
    return html`<li class="xp">
      <div class="xp-name">${id}</div>
      <div class="xp-id">${missing(knowledge)}</div>
    </li>`;
  const out = knowledge.outOfScope.get(id);
  const steps = knowledge.steps.get(id) ?? [];
  const cluster = f.cluster
    ? ` · ${f.cluster} ${knowledge.clusters.get(f.cluster) ?? ""}`
    : "";
  return html`<li class="xp">
    <div class="xp-name">${f.name}</div>
    ${
      out
        ? html`<div class="xp-fate">Не входит в TO-BE: ${out.reason}</div>`
        : steps.map(
            (step, i) =>
              html`<div class="xp-def" key=${i}>
                <b>В TO-BE (блок ${step.block}):</b> ${step.text}
              </div>`,
          )
    }
    <div class="xp-id">${id}${cluster}</div>
  </li>`;
}

/** One O-ID in plain words: name, definition, and what TO-BE or the registry made of it. */
function ObjectLine({ knowledge, id }) {
  const o = knowledge?.objects.get(id);
  if (!o)
    return html`<li class="xp">
      <div class="xp-name">${id}</div>
      <div class="xp-id">${missing(knowledge)}</div>
    </li>`;
  const out = knowledge.outOfScope.get(id);
  const regFate = /^(объединён|исключён)/.test(o.status) ? o.status : "";
  return html`<li class="xp">
    <div class="xp-name">${o.name}</div>
    ${
      out
        ? html`<div class="xp-fate">Не входит в TO-BE: ${out.reason}</div>`
        : regFate
          ? html`<div class="xp-fate">
              Реестр: ${regFate}${o.decision ? ` — ${o.decision}` : ""}
            </div>`
          : null
    }
    ${
      o.definition
        ? html`<div class="xp-def">
            ${out || regFate ? html`<b>Определение реестра (до TO-BE):</b> ` : null}${o.definition}
          </div>`
        : null
    }
    <div class="xp-id">${id}${o.type ? ` · ${o.type}` : ""}</div>
  </li>`;
}

const endName = (e) =>
  e.boundary ? `граница ${e.boundary}` : `${e.box}.${e.side ?? "O"}`;

/** Branches of a box: its outputs whole, and of every other arrow only the branch that enters it
 * (drawn from the source, so the shared trunk up to the fork lights with it) — never the sibling
 * branches that feed other boxes. */
function edgesOfBox(edges, boxId) {
  return edges.filter((e) => e.data.from === boxId || e.data.to === boxId);
}

const ICOM_SECTIONS = [
  ["I", "Входы"],
  ["C", "Управление"],
  ["O", "Выходы"],
  ["M", "Механизмы"],
];

/** The box's arrows by ICOM side, each with its other end: the source of an incoming branch, the
 * consumers of an output (a box code or a boundary code). */
function icomOfBox(diagram, boxId) {
  const code = (e) => e.boundary ?? e.box;
  const rows = { I: [], C: [], O: [], M: [] };
  for (const arrow of diagram.arrows ?? []) {
    const src = asList(arrow.from)[0];
    if (src?.box === boxId)
      rows.O.push({ arrow, other: asList(arrow.to).map(code).join(", ") });
    for (const end of asList(arrow.to))
      if (end.box === boxId && rows[end.side])
        rows[end.side].push({ arrow, other: code(src) });
  }
  return rows;
}

/** Arrows of a box in the panel; hovering a row traces that arrow's branch on the canvas. */
function IcomList({ diagram, boxId, onTrace }) {
  const rows = icomOfBox(diagram, boxId);
  return ICOM_SECTIONS.filter(([side]) => rows[side].length).map(
    ([side, title]) =>
      html`<${React.Fragment} key=${side}>
        <h3>${title}</h3>
        <ul class="icom-list">
          ${rows[side].map(
            ({ arrow, other }) =>
              html`<li
                key=${arrow.id}
                style=${{ borderLeftColor: `var(--${side.toLowerCase()})` }}
                onMouseEnter=${() => onTrace?.(arrow.id)}
                onMouseLeave=${() => onTrace?.(null)}
              >
                ${arrow.label ?? arrow.id}
                <span class="muted"
                  >${side === "O" ? ` → ${other}` : ` ← ${other}`}</span
                >
              </li>`,
          )}
        </ul>
      <//>`,
  );
}

/** What a box or an arrow means. `brief` (the hover card) keeps only the title and the short
 * description; the arrows, roles, functions and objects stay in the panel. */
function Explanation({
  diagram,
  focus,
  knowledge,
  brief = false,
  onOpen,
  hasChild,
  onTrace,
}) {
  if (focus.type === "box") {
    const box = diagram.boxes.find((b) => b.id === focus.id);
    if (!box) return null;
    const functions = box.functions ?? [];
    return html`<div>
      <h2>${box.id} — ${box.name}</h2>
      ${
        box.process_blocks?.length
          ? html`<p class="muted">
              ${`Процесс TO-BE: ${box.process_blocks.map((n) => blockRef(knowledge, n)).join(", ")}`}
            </p>`
          : null
      }
      ${hasChild?.(box.id) ? html`<p><button onClick=${() => onOpen(box.id)}>Открыть декомпозицию ${box.id}</button></p>` : null}
      ${box.leaf ? html`<p class="muted">Операция — выполняет одна роль, часы измеримы.</p>` : null}
      ${
        box.decomposition === "pending"
          ? html`<p class="muted">Чёрный ящик — операции раскроются на следующем шаге декомпозиции.</p>`
          : null
      }
      ${box.note ? html`<p>${box.note}</p>` : null}
      ${
        brief
          ? null
          : html`<${React.Fragment}>
              ${box.effort ? html`<${Effort} effort=${box.effort} />` : null}
              <${IcomList}
                diagram=${diagram}
                boxId=${box.id}
                onTrace=${onTrace}
              />
              <h3>Механизмы — роли</h3>
              <ul>
                ${(box.mechanisms ?? []).map((m) => html`<li key=${m}>${m}</li>`)}
              </ul>
              <h3>Функции реестра (${functions.length})</h3>
              <ul class="xp-list">
                ${functions.map((id) => html`<${FunctionLine} key=${id} knowledge=${knowledge} id=${id} />`)}
              </ul>
            <//>`
      }
    </div>`;
  }
  const arrow = diagram.arrows.find((a) => a.id === focus.id);
  if (!arrow) return null;
  const objects = arrow.objects ?? [];
  return html`<div>
    <h2>${arrow.label}</h2>
    <p class="muted">
      ${`${arrow.id} · ${KIND_NAME[arrowKind(arrow)]} · ${asList(arrow.from).map(endName).join(", ")} → ${asList(arrow.to).map(endName).join(", ")}`}
    </p>
    ${
      brief
        ? null
        : html`<${React.Fragment}>
            <h3>Объекты реестра (${objects.length})</h3>
            <ul class="xp-list">
              ${objects.map((id) => html`<${ObjectLine} key=${id} knowledge=${knowledge} id=${id} />`)}
            </ul>
          <//>`
    }
  </div>`;
}

// Hover card: beside the hovered element (right, left, below, above — the first side where the
// whole card fits), never over it. Where no side fits the whole card, it narrows into the largest
// free side.
const CARD_GAP = 12;
const CARD_EDGE = 8;
const CARD_WIDTH = 400;
const CARD_MIN = { width: 200, height: 120 };

function HoverCard({ diagram, focus, anchor, knowledge }) {
  const ref = useRef(null);
  const [region, setRegion] = useState(null);
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const c = card.parentElement.getBoundingClientRect();
    const own = card.getBoundingClientRect();
    const w = own.width;
    const h = own.height;
    const a = {
      left: anchor.left - c.left,
      right: anchor.right - c.left,
      top: anchor.top - c.top,
      bottom: anchor.bottom - c.top,
    };
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    if (region) {
      const leftOf = region.left + region.width <= a.left;
      const above = region.top + region.height <= a.top;
      const sideways = region.height > region.width || leftOf;
      setPlace(
        sideways
          ? {
              left: leftOf ? region.left + region.width - w : region.left,
              top: clamp(a.top, region.top, region.top + region.height - h),
            }
          : {
              left: clamp(a.left, region.left, region.left + region.width - w),
              top: above ? region.top + region.height - h : region.top,
            },
      );
      return;
    }
    const maxX = c.width - CARD_EDGE;
    const maxY = c.height - CARD_EDGE;
    const atY = clamp(a.top, CARD_EDGE, maxY - h);
    const atX = clamp(a.left, CARD_EDGE, maxX - w);
    const fitting = [
      a.right + CARD_GAP + w <= maxX && { left: a.right + CARD_GAP, top: atY },
      a.left - CARD_GAP - w >= CARD_EDGE && {
        left: a.left - CARD_GAP - w,
        top: atY,
      },
      a.bottom + CARD_GAP + h <= maxY && {
        left: atX,
        top: a.bottom + CARD_GAP,
      },
      a.top - CARD_GAP - h >= CARD_EDGE && {
        left: atX,
        top: a.top - CARD_GAP - h,
      },
    ].find(Boolean);
    if (fitting) {
      setPlace(fitting);
      return;
    }
    const full = { top: CARD_EDGE, height: c.height - 2 * CARD_EDGE };
    const across = { left: CARD_EDGE, width: c.width - 2 * CARD_EDGE };
    const sides = [
      { ...full, left: a.right + CARD_GAP, width: maxX - a.right - CARD_GAP },
      { ...full, left: CARD_EDGE, width: a.left - CARD_GAP - CARD_EDGE },
      {
        ...across,
        top: a.bottom + CARD_GAP,
        height: maxY - a.bottom - CARD_GAP,
      },
      { ...across, top: CARD_EDGE, height: a.top - CARD_GAP - CARD_EDGE },
    ].filter((r) => r.width >= CARD_MIN.width && r.height >= CARD_MIN.height);
    if (sides.length) {
      const widest = sides.reduce((x, y) =>
        Math.min(y.width, CARD_WIDTH) * y.height >
        Math.min(x.width, CARD_WIDTH) * x.height
          ? y
          : x,
      );
      setRegion(widest);
      return;
    }
    // The element fills the canvas on every side: the card has to overlap it.
    setPlace({
      left: clamp(a.right + CARD_GAP, CARD_EDGE, maxX - w),
      top: atY,
    });
  }, [anchor, region]);
  const width = Math.min(CARD_WIDTH, region?.width ?? CARD_WIDTH);
  return html`<div
    ref=${ref}
    class="hover-card"
    role="tooltip"
    style=${place ? { ...place, width } : { left: 0, top: 0, width, visibility: "hidden" }}
  >
    <${Explanation}
      diagram=${diagram}
      focus=${focus}
      knowledge=${knowledge}
      brief
    />
  </div>`;
}

// ---------- Side panel ----------

/** Draft effort of a leaf (model/FORMAT-ru.md «Операция и черновая трудоёмкость»). */
function Effort({ effort }) {
  const hours = Array.isArray(effort.hours_draft)
    ? effort.hours_draft.join("–")
    : effort.hours_draft;
  return html`<div>
    <h3>Трудоёмкость операции — черновик</h3>
    <ul>
      <li><b>Роль:</b> ${effort.role}</li>
      <li><b>Часы на ${effort.unit}:</b> ${hours}</li>
      ${effort.iterations ? html`<li><b>× итерации:</b> ${effort.iterations}</li>` : null}
      <li><b>Драйвер:</b> ${effort.driver}</li>
      <li class="muted">${effort.basis}</li>
    </ul>
  </div>`;
}

function Details({
  diagram,
  focus,
  knowledge,
  knowledgeError,
  hasChild,
  onOpen,
  onTrace,
}) {
  if (!focus) {
    return html`<div>
      <h2>${diagram.id} — ${diagram.title}</h2>
      ${diagram.purpose ? html`<p>${diagram.purpose}</p>` : null}
      ${diagram.viewpoint ? html`<p><b>Точка зрения:</b> ${diagram.viewpoint}</p>` : null}
      <p class="muted">
        Наведение на блок или стрелку — подсказка: название и краткое описание
        (выключается в шапке); наведение на блок подсвечивает его стрелки.
        Щелчок закрепляет здесь полное пояснение: названия и определения из
        реестра и что с ними стало в TO-BE. Двойной щелчок по блоку с ▼ —
        декомпозиция.
      </p>
      ${knowledgeError ? html`<p class="err">Пояснения недоступны: ${knowledgeError}</p>` : null}
      <div class="legend">
        <span><b style=${{ background: "var(--i)" }}></b>вход</span>
        <span><b style=${{ background: "var(--c)" }}></b>управление</span>
        <span><b style=${{ background: "var(--o)" }}></b>выход</span>
        <span><b style=${{ background: "var(--m)" }}></b>механизм</span>
      </div>
    </div>`;
  }
  return html`<${Explanation}
    diagram=${diagram}
    focus=${focus}
    knowledge=${knowledge}
    hasChild=${hasChild}
    onOpen=${onOpen}
    onTrace=${onTrace}
  />`;
}

// ---------- App ----------

// Arrow animation: on by default unless the reader asked the system for reduced motion; the
// choice is remembered per browser (storage may be unavailable — then it is just not kept).
const ANIMATE_KEY = "idef0-viewer:animate";
function initialAnimate() {
  try {
    const kept = localStorage.getItem(ANIMATE_KEY);
    if (kept === "1" || kept === "0") return kept === "1";
  } catch {
    // no storage: fall through to the system preference
  }
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Hover card: on by default — it explains without a click; a reader whose diagram it covers turns
// it off (the panel still explains a clicked element). Remembered like the animation switch.
const HOVER_CARD_KEY = "idef0-viewer:hover-card";
function initialHoverCard() {
  try {
    return localStorage.getItem(HOVER_CARD_KEY) !== "0";
  } catch {
    return true;
  }
}

function readHash(fallback) {
  try {
    return decodeURIComponent(location.hash.replace(/^#/, "")) || fallback;
  } catch {
    // a malformed escape (#%E0) is no level of the model: open the root
    return fallback;
  }
}

function App({ model }) {
  const { index, diagrams, knowledge, knowledgeError } = model;
  const byId = useMemo(
    () => new Map(diagrams.map((d) => [d.id, d])),
    [diagrams],
  );
  const [current, setCurrent] = useState(() =>
    byId.has(readHash(index.root)) ? readHash(index.root) : index.root,
  );
  const [pinned, setPinned] = useState(null);
  const [hover, setHover] = useState(null);
  // Screen rectangle of the hovered element: the hover card is placed beside it.
  const [anchor, setAnchor] = useState(null);
  const [animate, setAnimate] = useState(initialAnimate);
  const [hoverCard, setHoverCard] = useState(initialHoverCard);
  const diagram = byId.get(current);
  useEffect(() => {
    try {
      localStorage.setItem(ANIMATE_KEY, animate ? "1" : "0");
    } catch {
      // storage unavailable: the switch still works for this page
    }
  }, [animate]);
  useEffect(() => {
    try {
      localStorage.setItem(HOVER_CARD_KEY, hoverCard ? "1" : "0");
    } catch {
      // storage unavailable: the switch still works for this page
    }
  }, [hoverCard]);
  const hoverOn = useCallback((type, id, rect) => {
    setHover(id ? { type, id } : null);
    setAnchor(id ? rect : null);
  }, []);

  useEffect(() => {
    const onHash = () =>
      byId.has(readHash(index.root)) && setCurrent(readHash(index.root));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [byId, index.root]);
  const [layout, layoutError] = useMemo(() => {
    try {
      return [layoutDiagram(diagram), null];
    } catch (error) {
      return [null, String(error?.message ?? error)];
    }
  }, [diagram]);
  // Initial view: a diagram whose whole drawn extent (frame, boundary codes, labels) fits the canvas
  // at a readable zoom opens fitted — width and height — and centred, zoomed in never past 1.3. A
  // large diagram (A0, A31) would fit only below READABLE_ZOOM, where labels are illegible: it opens
  // at the width fit but never below READABLE_ZOOM, anchored to the top (and to the left when wider
  // than the canvas), and the reader pans or zooms out for the rest.
  const fitWidth = useCallback(
    (instance) => {
      const canvas = document.querySelector(".canvas");
      if (!layout || !canvas) return;
      const { x0, y0, x1, y1 } = layout.bounds;
      const pad = 16;
      const w = x1 - x0 + 2 * pad;
      const h = y1 - y0 + 2 * pad;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const fit = Math.min(1.3, cw / w, ch / h);
      if (fit >= READABLE_ZOOM) {
        instance.setViewport({
          x: (cw - w * fit) / 2 + (pad - x0) * fit,
          y: (ch - h * fit) / 2 + (pad - y0) * fit,
          zoom: fit,
        });
        return;
      }
      const zoom = Math.max(READABLE_ZOOM, Math.min(1.3, cw / w));
      instance.setViewport({
        x: Math.max(0, (cw - w * zoom) / 2) + (pad - x0) * zoom,
        y: (pad - y0) * zoom,
        zoom,
      });
    },
    [layout],
  );

  const open = useCallback(
    (id) => {
      if (!byId.has(id)) return;
      setPinned(null);
      hoverOn(null);
      location.hash = id;
      setCurrent(id);
    },
    [byId, hoverOn],
  );
  const hasChild = useCallback(
    (boxId) => byId.has(boxId) && byId.get(boxId).parent === current,
    [byId, current],
  );
  const focus = hover ?? pinned;
  const activeArrow = focus?.type === "arrow" ? focus.id : null;
  // A focused box lights its own I/C/O/M branches and dims the rest.
  const litEdges = useMemo(
    () =>
      focus?.type === "box"
        ? new Set(edgesOfBox(layout?.edges ?? [], focus.id).map((e) => e.id))
        : null,
    [layout, focus?.type, focus?.id],
  );
  // An arrow row hovered in the panel traces, like an arrow hover, the branch of that arrow that
  // meets the panel's box; the panel and the hover card keep their focus.
  const [trace, setTrace] = useState(null);
  const panelBox = focus?.type === "box" ? focus.id : null;
  useEffect(() => setTrace(null), [panelBox, current]);
  const traced = useMemo(
    () =>
      trace && panelBox
        ? new Set(
            edgesOfBox(layout?.edges ?? [], panelBox)
              .filter((e) => e.data.arrow.id === trace)
              .map((e) => e.id),
          )
        : null,
    [layout, trace, panelBox],
  );
  // Boxes at the ends of the focused paths stay full, the rest dim: a focused box keeps the boxes its
  // lit branches reach, a focused arrow keeps its end boxes.
  const keptBoxes = useMemo(() => {
    if (!layout || !focus) return null;
    const focused =
      focus.type === "box"
        ? layout.edges.filter((e) => litEdges.has(e.id))
        : layout.edges.filter((e) => e.data.arrow.id === focus.id);
    const kept = new Set(focus.type === "box" ? [focus.id] : []);
    for (const e of focused) {
      if (e.data.from) kept.add(e.data.from);
      if (e.data.to) kept.add(e.data.to);
    }
    return kept;
  }, [layout, focus, litEdges]);
  // Box nodes depend on the pinned box only: a hover that rebuilt the node list would re-render the
  // nodes under the pointer between the two clicks of a double-click.
  const pinnedBox = pinned?.type === "box" ? pinned.id : null;

  const nodes = useMemo(
    () =>
      (layout?.nodes ?? []).map((node) =>
        node.type === "box"
          ? {
              ...node,
              data: {
                ...node.data,
                focused: pinnedBox === node.id,
                hasChild: hasChild(node.id),
                onOpen: hasChild(node.id) ? () => open(node.id) : null,
              },
            }
          : node,
      ),
    [layout, pinnedBox, hasChild, open],
  );
  // Dimming replaces only the dimmed node objects: the hovered box (never dimmed) keeps its identity,
  // so it is not re-rendered between the two clicks of a double-click.
  const shownNodes = useMemo(
    () =>
      keptBoxes
        ? nodes.map((node) =>
            node.type === "box" && !keptBoxes.has(node.id)
              ? { ...node, className: "dim" }
              : node,
          )
        : nodes,
    [nodes, keptBoxes],
  );
  const edges = useMemo(
    () =>
      (layout?.edges ?? []).map((edge) => {
        const active =
          edge.data.arrow.id === activeArrow || !!traced?.has(edge.id);
        const lit = !!litEdges?.has(edge.id);
        const dim = !!litEdges && !lit;
        const stroke = active
          ? "var(--hl)"
          : `var(--${edge.data.kind.toLowerCase()})`;
        return {
          ...edge,
          className: active ? "active" : lit ? "lit" : dim ? "dim" : "",
          // The focused arrows are drawn above the others so their whole routes stay visible.
          zIndex: active || lit ? 10 : 0,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: "#2b2b2e",
          },
          style: { stroke },
          data: {
            ...edge.data,
            active,
            lit,
            dim,
            onSelect: (id) => setPinned({ type: "arrow", id }),
            onHover: (id, rect) => hoverOn("arrow", id, rect),
          },
        };
      }),
    [layout, activeArrow, traced, litEdges, hoverOn],
  );

  const chain = [];
  for (let d = diagram; d; d = d.parent ? byId.get(d.parent) : null)
    chain.unshift(d);

  return html`<div class="app">
    <header>
      <nav class="crumbs" aria-label="Уровни модели">
        ${chain.map(
          (d, i) =>
            html`<${React.Fragment} key=${d.id}>
              ${i ? " › " : ""}
              <button
                aria-current=${d.id === current ? "page" : undefined}
                onClick=${() => open(d.id)}
              >
                ${d.id}
              </button>
            <//>`,
        )}
        <span class="muted"> ${diagram.title}</span>
      </nav>
      <div class="switches">
        <label class="switch">
          <input
            type="checkbox"
            checked=${hoverCard}
            onChange=${(event) => setHoverCard(event.target.checked)}
          />
          Подсказка при наведении
        </label>
        <label class="switch">
          <input
            type="checkbox"
            checked=${animate}
            onChange=${(event) => setAnimate(event.target.checked)}
          />
          Анимация стрелок
        </label>
      </div>
    </header>
    <main>
      <div class=${"canvas" + (animate ? " animate" : "")}>
        ${
          layoutError
            ? html`<p class="err" style=${{ padding: 16 }}>
                Ошибка раскладки: ${layoutError}
              </p>`
            : html`<${ReactFlow}
                key=${current}
                nodes=${shownNodes}
                edges=${edges}
                nodeTypes=${nodeTypes}
                edgeTypes=${edgeTypes}
                onInit=${fitWidth}
                minZoom=${0.3}
                panOnScroll
                nodesDraggable=${false}
                elevateNodesOnSelect=${false}
                elevateEdgesOnSelect=${false}
                nodesConnectable=${false}
                zoomOnDoubleClick=${false}
                proOptions=${{ hideAttribution: true }}
                onNodeClick=${(_, node) => node.type === "box" && setPinned({ type: "box", id: node.id })}
                onNodeMouseEnter=${(event, node) =>
                  node.type === "box" &&
                  hoverOn(
                    "box",
                    node.id,
                    event.target
                      .closest(".react-flow__node")
                      .getBoundingClientRect(),
                  )}
                onNodeMouseLeave=${() => hoverOn(null)}
                onEdgeClick=${(_, edge) => setPinned({ type: "arrow", id: edge.data.arrow.id })}
                onEdgeMouseEnter=${(event, edge) =>
                  hoverOn(
                    "arrow",
                    edge.data.arrow.id,
                    new DOMRect(event.clientX - 10, event.clientY - 10, 20, 20),
                  )}
                onEdgeMouseLeave=${() => hoverOn(null)}
                onMoveStart=${() => hoverOn(null)}
                onPaneClick=${() => setPinned(null)}
              >
                <${Background} gap=${24} size=${1} />
                <${Controls} showInteractive=${false} />
              <//>`
        }
        ${
          hoverCard && hover && anchor && !layoutError
            ? html`<${HoverCard}
                key=${`${hover.type}:${hover.id}`}
                diagram=${diagram}
                focus=${hover}
                anchor=${anchor}
                knowledge=${knowledge}
              />`
            : null
        }
      </div>
      <aside>
        <${Details}
          diagram=${diagram}
          focus=${focus}
          knowledge=${knowledge}
          knowledgeError=${knowledgeError}
          hasChild=${hasChild}
          onOpen=${open}
          onTrace=${setTrace}
        />
      </aside>
    </main>
  </div>`;
}

/** The viewer with its React Flow provider; `model` = { index, diagrams, knowledge, knowledgeError }. */
export default function Idef0Viewer({ model }) {
  return html`<${ReactFlowProvider}><${App} model=${model} /><//>`;
}
