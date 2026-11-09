import type {
  ContractorProcess,
  ProcessEdge,
  ProcessLane,
  ProcessStage,
  ProcessStep,
} from '@/lib/contractor-process'

/**
 * The geometry of «Как работаем с исполнителями» (#545) — a pure port of the
 * renderer in the approved visual
 * (`design-source/finance/contractor-process.visual.html`, its `drawDiagram`):
 * a «column × lane» grid in SVG user units, steps sized by their wrapped
 * titles, orthogonal edge routes that avoid other steps, edge labels placed
 * off the steps and off the other edges. The numbers and the order of every
 * choice are the visual's, so the same data lands on the same coordinates.
 *
 * Text width is the one browser dependency (the visual measures with a canvas
 * 2D context), so it is a parameter: the view passes a canvas `measureText`,
 * the tests a deterministic stub.
 *
 * One deliberate addition (recorded in the PR): an edge for which the visual
 * has NO candidate route — a step pointing back to an earlier column, which
 * the visual's `cands()` never offers — crashes the visual (`pick` is
 * undefined). Here such an edge gets fallback routes (an L through the
 * target's top or bottom, or a run along a lane gutter), tried only after
 * every one of the visual's own candidates, so where the visual draws an edge
 * this draws the same one.
 */

/** Width of `text` set in `font` (a CSS font shorthand), in px. */
export type MeasureText = (text: string, font: string) => number

export type Point = readonly [number, number]

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The fonts the visual measures with — the SVG text must be set in the same ones. */
export const FONTS = {
  step: '14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  decision: '13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  stage: '700 13px system-ui',
  lane: '600 13px system-ui',
  chip: '600 11px system-ui',
  autoTag: '600 10px system-ui',
  edgeLabel: 'italic 12px system-ui',
} as const

export const OPEN_LABEL = 'вопрос открыт'
export const AUTO_LABEL = 'авто'

/** Lane-label column width; also where the stage grid starts. */
export const LANE_WIDTH = 150
const NODE_WIDTH = 130
const LINE = 17
const PADX = 13
const PADY = 16
const DECISION_WIDTH = 140
const MIN_NODE_HEIGHT = 76
/** A step's title is never cut: the box grows to the longest one, at least 4 lines. */
const MIN_LINES = 4
/** Clearance an edge keeps from a step it does not connect. */
const MARGIN = 3
/** Fallback routes run this far inside a lane from its edge (below/above the steps). */
const GUTTER = 5

/** The two grids of the visual: the main diagram under a stage header, the subprocess without one. */
export const MAIN_GRID = { columnWidth: 156, top: 48 } as const
export const SUB_GRID = { columnWidth: 240, top: 6 } as const

type Side = 'L' | 'R' | 'T' | 'B'

export interface StepLayout extends Box {
  step: ProcessStep
  laneIndex: number
  decision: boolean
  cx: number
  cy: number
  /** The wrapped title, one entry per line. */
  lines: string[]
  /** Baseline of the first title line, relative to the box. */
  textY: number
  /** «вопрос открыт» chip, relative to the box. */
  chip?: Box
  /** «авто» tag, relative to the box. */
  autoTag?: Box
}

export interface LaneLayout {
  lane: ProcessLane
  index: number
  y: number
  height: number
  lines: string[]
  /** Baseline of the first title line (absolute). */
  textY: number
  /** «вопрос открыт» chip (absolute). */
  chip?: Box
}

export interface StageLayout {
  stage: ProcessStage
  x: number
  width: number
  lines: string[]
  textY: number
  /** A dashed column separator at `x` — every stage but the first. */
  separator: boolean
}

export interface EdgeLayout {
  edge: ProcessEdge
  points: Point[]
  label?: Box
}

export interface DiagramLayout {
  width: number
  height: number
  top: number
  columnWidth: number
  laneWidth: number
  laneHeight: number
  lanes: LaneLayout[]
  stages: StageLayout[]
  steps: StepLayout[]
  edges: EdgeLayout[]
}

export interface ProcessLayout {
  main: DiagramLayout
  sub: DiagramLayout | null
  /** Height of a plain step box — one size for both diagrams. */
  nodeHeight: number
}

/** The visual's `wrap()`: greedy word wrap; with `maxLines`, the last kept line ends in «…». */
export function wrapText(
  text: string,
  maxWidth: number,
  font: string,
  measure: MeasureText,
  maxLines?: number,
): string[] {
  const words = text.split(/\s+/)
  let lines: string[] = []
  let current = ''
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    if (measure(attempt, font) <= maxWidth || !current) current = attempt
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`
  }
  return lines
}

function chipBox(cx: number, y: number, measure: MeasureText): Box {
  const width = Math.ceil(measure(OPEN_LABEL, FONTS.chip)) + 16
  return { x: cx - width / 2, y, width, height: 16 }
}

function autoTagBox(right: number, y: number, measure: MeasureText): Box {
  const width = Math.ceil(measure(AUTO_LABEL, FONTS.autoTag)) + 12
  return { x: right - width, y, width, height: 14 }
}

interface Sizes {
  nodeHeight: number
  laneHeight: number
  decisionHeight: number
  lines: Map<ProcessStep, string[]>
}

/** Step titles of BOTH diagrams set the box height, as in the visual. */
function sizeSteps(steps: ProcessStep[], measure: MeasureText): Sizes {
  const lines = new Map<ProcessStep, string[]>()
  let maxLines = MIN_LINES
  for (const step of steps) {
    if (step.kind === 'decision') {
      lines.set(step, wrapText(step.title, DECISION_WIDTH * 0.72, FONTS.decision, measure))
    } else {
      const wrapped = wrapText(step.title, NODE_WIDTH - 20, FONTS.step, measure)
      lines.set(step, wrapped)
      maxLines = Math.max(maxLines, wrapped.length)
    }
  }
  const nodeHeight = Math.max(MIN_NODE_HEIGHT, maxLines * LINE + 24)
  return {
    nodeHeight,
    laneHeight: nodeHeight + 2 * PADY,
    decisionHeight: nodeHeight + 16,
    lines,
  }
}

export function layoutProcess(process: ContractorProcess, measure: MeasureText): ProcessLayout {
  const sub = process.subprocess
  const sizes = sizeSteps([...process.steps, ...(sub?.steps ?? [])], measure)
  return {
    main: layoutDiagram(
      { lanes: process.lanes, stages: process.stages, steps: process.steps, edges: process.edges },
      MAIN_GRID,
      sizes,
      measure,
    ),
    sub: sub
      ? layoutDiagram(
          { lanes: sub.lanes, stages: [], steps: sub.steps, edges: sub.edges },
          SUB_GRID,
          sizes,
          measure,
        )
      : null,
    nodeHeight: sizes.nodeHeight,
  }
}

interface DiagramInput {
  lanes: ProcessLane[]
  stages: ProcessStage[]
  steps: ProcessStep[]
  edges: ProcessEdge[]
}

function layoutDiagram(
  input: DiagramInput,
  grid: { columnWidth: number; top: number },
  sizes: Sizes,
  measure: MeasureText,
): DiagramLayout {
  const { columnWidth: CW, top: TOP } = grid
  const LH = sizes.laneHeight
  const laneIndex = new Map(input.lanes.map((lane, i) => [lane.id, i]))

  // The visual sizes the grid by the steps; a stage reaching past the last
  // step would overflow its viewBox, so its span counts too.
  let columns = 1
  for (const step of input.steps) columns = Math.max(columns, step.col + 1)
  for (const stage of input.stages) columns = Math.max(columns, stage.c1 + 1)
  const W = LANE_WIDTH + columns * CW + 10
  const H = TOP + input.lanes.length * LH + 6

  const steps: StepLayout[] = input.steps.map((step) => {
    const decision = step.kind === 'decision'
    const width = decision ? DECISION_WIDTH : NODE_WIDTH
    const height = decision ? sizes.decisionHeight : sizes.nodeHeight
    const li = laneIndex.get(step.lane) ?? 0
    const cx = LANE_WIDTH + step.col * CW + CW / 2
    const cy = TOP + li * LH + LH / 2
    const lines = sizes.lines.get(step) ?? [step.title]
    const shift = step.open && !decision ? 7 : 0
    return {
      step,
      laneIndex: li,
      decision,
      cx,
      cy,
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      lines,
      textY: height / 2 + 5 - ((lines.length - 1) * LINE) / 2 - shift,
      ...(step.open ? { chip: chipBox(width / 2, decision ? -8 : height - 22, measure) } : {}),
      ...(step.auto ? { autoTag: autoTagBox(width - 6, -7, measure) } : {}),
    }
  })

  const lanes: LaneLayout[] = input.lanes.map((lane, i) => {
    const y = TOP + i * LH
    const lines = wrapText(lane.title, LANE_WIDTH - 30, FONTS.lane, measure, 5)
    return {
      lane,
      index: i,
      y,
      height: LH,
      lines,
      textY: y + LH / 2 + 5 - (lines.length - 1) * 8 - (lane.open ? 8 : 0),
      ...(lane.open ? { chip: chipBox(LANE_WIDTH / 2 - 2, y + LH - 24, measure) } : {}),
    }
  })

  const stages: StageLayout[] = input.stages.map((stage, i) => {
    const x = LANE_WIDTH + stage.c0 * CW
    const width = (stage.c1 - stage.c0 + 1) * CW
    const lines = wrapText(stage.title, width - 14, FONTS.stage, measure, 2)
    return {
      stage,
      x,
      width,
      lines,
      textY: 4 + (TOP - 10) / 2 + 5 - (lines.length - 1) * 7.5,
      separator: i > 0,
    }
  })

  const byId = new Map(steps.map((s) => [s.step.id, s]))
  const routes = routeEdges(input.edges, byId, steps, { TOP, LH })
  const edges = placeLabels(input.edges, routes, steps, { W, H, TOP }, measure)

  return {
    width: W,
    height: H,
    top: TOP,
    columnWidth: CW,
    laneWidth: LANE_WIDTH,
    laneHeight: LH,
    lanes,
    stages,
    steps,
    edges,
  }
}

// ── edge routes ─────────────────────────────────────────────────────────────

function port(n: StepLayout, side: Side): Point {
  if (side === 'L') return [n.x, n.cy]
  if (side === 'R') return [n.x + n.width, n.cy]
  if (side === 'T') return [n.cx, n.y]
  return [n.cx, n.y + n.height]
}

interface Candidate {
  sp: Side
  dp: Side
  pts: Point[]
}

/** The visual's `cands()`, verbatim in order. */
function candidates(a: StepLayout, b: StepLayout): Candidate[] {
  const out: Candidate[] = []
  const aR = a.x + a.width
  const up = b.cy < a.cy
  const down = b.cy > a.cy
  const add = (sp: Side, dp: Side, pts: Point[]) => out.push({ sp, dp, pts })
  if (Math.abs(a.cy - b.cy) < 1 && b.x > aR) add('R', 'L', [port(a, 'R'), port(b, 'L')])
  if (Math.abs(a.cx - b.cx) < 1 && down) add('B', 'T', [port(a, 'B'), port(b, 'T')])
  if (Math.abs(a.cx - b.cx) < 1 && up) add('T', 'B', [port(a, 'T'), port(b, 'B')])
  if (b.x >= aR + PADX && Math.abs(a.cy - b.cy) >= 1) {
    const gx = b.x - PADX
    add('R', 'L', [port(a, 'R'), [gx, a.cy], [gx, b.cy], port(b, 'L')])
    add('R', down ? 'T' : 'B', [port(a, 'R'), [b.cx, a.cy], port(b, down ? 'T' : 'B')])
  }
  if (b.x > a.cx && Math.abs(a.cy - b.cy) >= 1) {
    add(down ? 'B' : 'T', 'L', [port(a, down ? 'B' : 'T'), [a.cx, b.cy], port(b, 'L')])
  }
  return out
}

/**
 * Routes the visual does not have, for an edge it offers no candidate for (a
 * step pointing back to an earlier column, or one stacked above another in a
 * column it does not share the centre of). Tried only after the visual's own.
 */
function fallbackCandidates(
  a: StepLayout,
  b: StepLayout,
  grid: { TOP: number; LH: number },
): Candidate[] {
  const out: Candidate[] = []
  const add = (sp: Side, dp: Side, pts: Point[]) => out.push({ sp, dp, pts })
  const laneTop = (n: StepLayout) => grid.TOP + n.laneIndex * grid.LH
  const lower = (n: StepLayout) => laneTop(n) + grid.LH - GUTTER
  const upper = (n: StepLayout) => laneTop(n) + GUTTER
  const sameLane = Math.abs(a.cy - b.cy) < 1
  const down = b.cy > a.cy

  if (sameLane) {
    add('B', 'B', [port(a, 'B'), [a.cx, lower(a)], [b.cx, lower(a)], port(b, 'B')])
    add('T', 'T', [port(a, 'T'), [a.cx, upper(a)], [b.cx, upper(a)], port(b, 'T')])
    return out
  }
  const vIn: Side = down ? 'T' : 'B'
  const vOut: Side = down ? 'B' : 'T'
  if (b.cx < a.x) add('L', vIn, [port(a, 'L'), [b.cx, a.cy], port(b, vIn)])
  if (b.x + b.width < a.cx) add(vOut, 'R', [port(a, vOut), [a.cx, b.cy], port(b, 'R')])
  const nearA = down ? lower(a) : upper(a)
  const nearB = down ? upper(b) : lower(b)
  add(vOut, vIn, [port(a, vOut), [a.cx, nearA], [b.cx, nearA], port(b, vIn)])
  add(vOut, vIn, [port(a, vOut), [a.cx, nearB], [b.cx, nearB], port(b, vIn)])
  return out
}

function segmentHitsStep(p: Point, q: Point, r: StepLayout): boolean {
  const x1 = Math.min(p[0], q[0])
  const x2 = Math.max(p[0], q[0])
  const y1 = Math.min(p[1], q[1])
  const y2 = Math.max(p[1], q[1])
  return (
    x2 > r.x - MARGIN &&
    x1 < r.x + r.width + MARGIN &&
    y2 > r.y - MARGIN &&
    y1 < r.y + r.height + MARGIN
  )
}

/** No segment of the route crosses a step other than its two ends. */
export function routeIsClear(
  pts: readonly Point[],
  a: StepLayout,
  b: StepLayout,
  steps: readonly StepLayout[],
): boolean {
  for (let i = 0; i < pts.length - 1; i++)
    for (const n of steps) {
      if (n === a || n === b) continue
      if (segmentHitsStep(pts[i], pts[i + 1], n)) return false
    }
  return true
}

function routeEdges(
  edges: ProcessEdge[],
  byId: Map<string, StepLayout>,
  steps: StepLayout[],
  grid: { TOP: number; LH: number },
): Point[][] {
  const usedOut = new Set<string>()
  const usedIn = new Set<string>()
  /** A port taken in EITHER direction — what a fallback route must also keep off. */
  const usedAny = new Set<string>()
  const taken = {
    // The visual's rule: a source's out-port, a target's in-port.
    own: (a: StepLayout, b: StepLayout, c: Candidate) =>
      usedOut.has(a.step.id + c.sp) || usedIn.has(b.step.id + c.dp),
    // A route back must not leave through the port another edge arrives at.
    fallback: (a: StepLayout, b: StepLayout, c: Candidate) =>
      usedAny.has(a.step.id + c.sp) || usedAny.has(b.step.id + c.dp),
  }
  // First a strict pass (no port already taken by another edge), then any clear one.
  const choose = (
    cs: Candidate[],
    a: StepLayout,
    b: StepLayout,
    isTaken: (a: StepLayout, b: StepLayout, c: Candidate) => boolean,
  ): Candidate | null => {
    for (let pass = 0; pass < 2; pass++)
      for (const c of cs) {
        if (!routeIsClear(c.pts, a, b, steps)) continue
        if (pass === 0 && isTaken(a, b, c)) continue
        return c
      }
    return null
  }
  return edges.map((edge) => {
    const a = byId.get(edge.from)!
    const b = byId.get(edge.to)!
    const own = candidates(a, b)
    const fallback = fallbackCandidates(a, b, grid)
    const pick =
      choose(own, a, b, taken.own) ??
      choose(fallback, a, b, taken.fallback) ??
      own[0] ??
      fallback[0]
    usedOut.add(a.step.id + pick.sp)
    usedIn.add(b.step.id + pick.dp)
    usedAny.add(a.step.id + pick.sp)
    usedAny.add(b.step.id + pick.dp)
    return pick.pts
  })
}

// ── edge labels ─────────────────────────────────────────────────────────────

type Segment = readonly [Point, Point]

function segmentsOf(pts: readonly Point[]): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]])
  return out
}

function boxHitsStep(r: Box, q: StepLayout, m: number): boolean {
  return (
    r.x + r.width > q.x - m &&
    r.x < q.x + q.width + m &&
    r.y + r.height > q.y - m &&
    r.y < q.y + q.height + m
  )
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height
}

function segmentHitsBox(s: Segment, r: Box): boolean {
  const x1 = Math.min(s[0][0], s[1][0])
  const x2 = Math.max(s[0][0], s[1][0])
  const y1 = Math.min(s[0][1], s[1][1])
  const y2 = Math.max(s[0][1], s[1][1])
  return x2 > r.x - 1 && x1 < r.x + r.width + 1 && y2 > r.y - 1 && y1 < r.y + r.height + 1
}

/** The visual's label placement: on the longest segment, off the steps, off placed labels, then off other edges. */
function placeLabels(
  edges: ProcessEdge[],
  routes: Point[][],
  steps: StepLayout[],
  frame: { W: number; H: number; TOP: number },
  measure: MeasureText,
): EdgeLayout[] {
  const segments = routes.map(segmentsOf)
  const placed: Box[] = []
  return edges.map((edge, ei) => {
    if (!edge.label) return { edge, points: routes[ei] }
    const tw = Math.ceil(measure(edge.label, FONTS.edgeLabel)) + 10
    const th = 18
    const ordered = segments[ei]
      .map((s) => ({ s, L: Math.abs(s[1][0] - s[0][0]) + Math.abs(s[1][1] - s[0][1]) }))
      .sort((p, q) => q.L - p.L)
    const list: { r: Box; host: Segment }[] = []
    for (const { s } of ordered) {
      const mx = (s[0][0] + s[1][0]) / 2
      const my = (s[0][1] + s[1][1]) / 2
      if (Math.abs(s[0][1] - s[1][1]) < 1) {
        list.push(
          { r: { x: mx - tw / 2, y: my - th - 3, width: tw, height: th }, host: s },
          { r: { x: mx - tw / 2, y: my + 3, width: tw, height: th }, host: s },
        )
      } else {
        list.push(
          { r: { x: s[0][0] + 6, y: my - th / 2, width: tw, height: th }, host: s },
          { r: { x: s[0][0] - 6 - tw, y: my - th / 2, width: tw, height: th }, host: s },
        )
      }
    }
    const ok = (c: { r: Box; host: Segment }, strict: boolean) => {
      const r = c.r
      if (r.x < LANE_WIDTH + 2 || r.x + r.width > frame.W - 2 || r.y < frame.TOP) return false
      if (r.y + r.height > frame.H) return false
      for (const n of steps) if (boxHitsStep(r, n, 2)) return false
      for (const p of placed) if (boxesOverlap(r, p)) return false
      if (strict)
        for (const sg of segments)
          for (const s of sg) {
            if (s === c.host) continue
            if (segmentHitsBox(s, r)) return false
          }
      return true
    }
    let pick: { r: Box; host: Segment } | null = null
    for (let pass = 0; pass < 2 && !pick; pass++)
      for (const c of list)
        if (ok(c, pass === 0)) {
          pick = c
          break
        }
    pick ??= list[0]
    placed.push(pick.r)
    return { edge, points: routes[ei], label: pick.r }
  })
}

/** The «lane · stage» line under a step's title in the details panel. */
export function stageOfColumn(stages: readonly ProcessStage[], col: number): ProcessStage | null {
  return stages.find((s) => col >= s.c0 && col <= s.c1) ?? null
}
