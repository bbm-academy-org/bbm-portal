/**
 * Internal TS contract of the OKR module (PRD FR-5).
 * Tree: goal → objectives → krs → actions → tasks. Every node carries a
 * clickable Plane URL. Progress semantics follow okr-structure.md §3.
 */

export type Mission = 'social' | 'business' | 'both'

/** Plane workflow state groups (states are per-project, groups are fixed). */
export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

/**
 * Health per the 70% rule (§3 p.5): fact vs linear time expectation.
 * 'undef' — честная пустота (FR-4), 'q4' — «Цель на IV квартал», outside
 * the period rollup (§3 p.4).
 */
export type Health = 'on' | 'risk' | 'behind' | 'undef' | 'q4'

export interface OkrTask {
  id: string
  title: string
  stateGroup: StateGroup
  planeUrl: string
}

export interface OkrAction {
  id: string
  title: string
  /** The action's own state — every row names it, with or without sub-tasks (spec 077 req.1). */
  stateGroup: StateGroup
  /**
   * Counters over «the action itself + its sub-tasks» (cancelled excluded), so
   * a started parent with one closed sub reads 1/2, not 1/1 (spec 077 req.3).
   * `total` is therefore never 0 — use `tasks.length` to ask about sub-tasks.
   * Display-only; the KR% is computed flat over the same set (§3 p.1).
   */
  done: number
  total: number
  planeUrl: string
  tasks: OkrTask[]
}

/** Manual metric value from metrics.yaml (FR-3). */
export interface KrMetric {
  current: number | null
  target: number | null
  unit?: string
  asOf?: string
}

export interface OkrKr {
  /** Stable id per the kr_id rule (see deriveKrId in mapper.ts) — metrics.yaml key. */
  krId: string
  moduleId: string
  title: string
  q4: boolean
  /** Flat task counters over ALL module issues, parents + subs one set, cancelled excluded (§3 p.1, OQ-5). */
  counts: { done: number; total: number } | null
  metric: KrMetric | null
  /** null → «не определено» (FR-4), never coerced to 0. */
  pct: number | null
  pctSource: 'metric' | 'execution' | null
  health: Health
  /** Short qualifier shown on the row (e.g. «метрика не задана», «цель 500 · измерение не подключено»). */
  note: string | null
  /** Module lead UUID (Plane), resolved to a team member at render time. */
  leadId: string | null
  planeUrl: string
  actions: OkrAction[]
}

export interface OkrObjective {
  /** Display id: 'o1'…'o5' (derived from config order). */
  id: string
  /** Plane project identifier: DSG1…DSG5. */
  ident: string
  projectId: string
  title: string
  mission: Mission
  order: number
  q4: boolean
  krs: OkrKr[]
  pct: number | null
  health: Health
  note: string | null
  planeUrl: string
}

export interface OkrPeriod {
  /** ISO dates, machine-readable (FR-5). */
  start: string
  end: string
}

export interface OkrTree {
  goalTitle: string
  period: OkrPeriod
  /** ISO timestamp of the successful Plane fetch this snapshot is built from. */
  asOf: string
  /** True when served from an expired cache because Plane is unreachable (FR-7). */
  stale: boolean
  /** Goal% — unweighted mean of in-period objectives (§3 p.4); null when nothing is defined. */
  pct: number | null
  objectives: OkrObjective[]
  offTreeNotes: string[]
  /** FR-7: non-fatal data problems (missing project/module, unparseable module name…). */
  warnings: string[]
}

/** Raw Plane API slices the mapper consumes (shape verified against Plane v1). */
export interface PlaneModule {
  id: string
  name: string
  lead: string | null
  start_date: string | null
  target_date: string | null
}

export interface PlaneIssue {
  id: string
  name: string
  parent: string | null
  state: string
  target_date: string | null
  sequence_id: number
}

export interface PlaneState {
  id: string
  name: string
  group: StateGroup
}

export interface PlaneProject {
  id: string
  name: string
  identifier: string
}

export interface PlaneProjectSlice {
  projectId: string
  project: PlaneProject
  modules: PlaneModule[]
  /** All issues of every KR module, keyed by module id (subs live in the module too). */
  issuesByModule: Record<string, PlaneIssue[]>
  states: PlaneState[]
}
