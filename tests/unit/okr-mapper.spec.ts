import { describe, expect, it } from 'vitest'
import { OKR_PERIOD, OKR_PROJECTS } from '@/lib/okr/config'
import { deriveKrId, mapOkrTree, stripObjectivePrefix } from '@/lib/okr/mapper'
import type { OkrSource } from '@/lib/okr/planeClient'
import type { PlaneIssue, PlaneModule, PlaneProjectSlice, PlaneState } from '@/lib/okr/types'

const NOW = new Date('2026-08-01T00:00:00Z') // after grace, expected = 50%

const STATES: PlaneState[] = [
  { id: 's-backlog', name: 'Backlog', group: 'backlog' },
  { id: 's-todo', name: 'Todo', group: 'unstarted' },
  { id: 's-progress', name: 'In Progress', group: 'started' },
  { id: 's-done', name: 'Done', group: 'completed' },
  { id: 's-cancelled', name: 'Cancelled', group: 'cancelled' },
]

let seq = 0
function issue(over: Partial<PlaneIssue> & { name: string }): PlaneIssue {
  seq += 1
  return { id: `i-${seq}`, parent: null, state: 's-todo', target_date: null, sequence_id: seq, ...over }
}

function module_(over: Partial<PlaneModule> & { name: string }): PlaneModule {
  return { id: `m-${over.name}`, lead: null, start_date: '2026-07-24', target_date: OKR_PERIOD.end, ...over }
}

const [DSG1, DSG2, DSG3, DSG4, DSG5] = OKR_PROJECTS

function slice(
  cfg: (typeof OKR_PROJECTS)[number],
  name: string,
  modules: PlaneModule[],
  issuesByModule: Record<string, PlaneIssue[]>,
): PlaneProjectSlice {
  return {
    projectId: cfg.projectId,
    project: { id: cfg.projectId, name, identifier: cfg.ident },
    modules,
    issuesByModule,
    states: STATES,
  }
}

function sourceOf(slices: PlaneProjectSlice[]): OkrSource {
  return { slices: new Map(slices.map((s) => [s.projectId, s])), missingProjects: [] }
}

describe('deriveKrId (stable kr_id rule, FR-3)', () => {
  it('derives kr<maj>-<min> from the module-name convention', () => {
    expect(deriveKrId('KR 1.2 · Готовый 1 урок')).toEqual({ krId: 'kr1-2', conventional: true })
    expect(deriveKrId('kr 12.3 whatever')).toEqual({ krId: 'kr12-3', conventional: true })
  })
  it('falls back (non-matchable) for unconventional names', () => {
    expect(deriveKrId('Готовая серия уроков').conventional).toBe(false)
  })
})

describe('stripObjectivePrefix', () => {
  it('strips the «<emoji> O1 ·» prefix from Plane project names', () => {
    expect(stripObjectivePrefix('🎓 O1 · Врачи получают новые знания')).toBe('Врачи получают новые знания')
    expect(stripObjectivePrefix('No prefix at all')).toBe('No prefix at all')
  })
})

describe('mapOkrTree', () => {
  it('counts flat (parents + subs one set) and drops cancelled from the denominator (§3 p.1, OQ-5)', () => {
    const mod = module_({ name: 'KR 1.2 · Готовый 1 урок' })
    const parent = issue({ name: 'Видео-контент' })
    const subDone = issue({ name: 'Собрать ОС', parent: parent.id, state: 's-done' })
    const subOpen = issue({ name: 'Доработать', parent: parent.id })
    const cancelled = issue({ name: 'Отменённая', state: 's-cancelled' })
    const src = sourceOf([slice(DSG1, '🎓 O1 · Врачи', [mod], { [mod.id]: [parent, subDone, subOpen, cancelled] })])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const kr = objectives[0].krs[0]
    // parent + 2 subs = 3 in the denominator; the cancelled issue is out entirely
    expect(kr.counts).toEqual({ done: 1, total: 3 })
    expect(kr.pct).toBeCloseTo((1 / 3) * 100, 5)
    expect(kr.pctSource).toBe('execution')
    // grouping is by parent id — the sub-issues land under their parent action
    expect(kr.actions).toHaveLength(1)
    expect(kr.actions[0].tasks.map((t) => t.title)).toEqual(['Собрать ОС', 'Доработать'])
    // spec 077 req.3: the row counts the parent itself as one unit of work
    expect(kr.actions[0].done).toBe(1)
    expect(kr.actions[0].total).toBe(3)
  })

  it('counts the action itself in its own row counter (spec 077 req.3)', () => {
    const mod = module_({ name: 'KR 2.2 · Регистрации' })
    const parent = issue({ name: 'Организовать сайт конгресса', state: 's-progress' })
    const sub = issue({ name: 'Разведать orthobio.ru', parent: parent.id, state: 's-done' })
    const src = sourceOf([slice(DSG2, 'O2 · Канал', [mod], { [mod.id]: [parent, sub] })])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const action = objectives.find((o) => o.ident === 'DSG2')!.krs[0].actions[0]
    // the real #77 case: 1 closed sub under a started parent must not read as 1/1
    expect(action.stateGroup).toBe('started')
    expect({ done: action.done, total: action.total }).toEqual({ done: 1, total: 2 })
  })

  it('counts a done parent with a done sub as fully closed (spec 077 req.3)', () => {
    const mod = module_({ name: 'KR 2.2 · Регистрации' })
    const parent = issue({ name: 'Закрытое действие', state: 's-done' })
    const sub = issue({ name: 'Закрытая подзадача', parent: parent.id, state: 's-done' })
    const src = sourceOf([slice(DSG2, 'O2 · Канал', [mod], { [mod.id]: [parent, sub] })])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const action = objectives.find((o) => o.ident === 'DSG2')!.krs[0].actions[0]
    expect({ done: action.done, total: action.total }).toEqual({ done: 2, total: 2 })
  })

  it('keeps a grandchild inside its top-level action row (spec 077 req.4)', () => {
    // Grouping by direct parent leaves a third-level issue in no row at all: it
    // is not a root, and its own parent is not a root either. The KR counts it
    // flat, so the rows stop adding up — and a closed grandchild disappears
    // from the screen, which is the #77 lie with the sign flipped.
    const mod = module_({ name: 'KR 1.2 · Готовый 1 урок' })
    const root = issue({ name: 'Родитель', state: 's-progress' })
    const sub = issue({ name: 'Суб', parent: root.id })
    const grand = issue({ name: 'Внук', parent: sub.id, state: 's-done' })
    const src = sourceOf([slice(DSG1, 'O1 · Врачи', [mod], { [mod.id]: [root, sub, grand] })])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const kr = objectives[0].krs[0]
    expect(kr.counts).toEqual({ done: 1, total: 3 })
    expect(kr.actions).toHaveLength(1)
    expect({ done: kr.actions[0].done, total: kr.actions[0].total }).toEqual({ done: 1, total: 3 })
    expect(kr.actions[0].tasks.map((t) => t.title)).toEqual(['Суб', 'Внук'])
  })

  it('survives a parent cycle: every issue still gets a row and a warning (FR-7)', () => {
    // Plane should not produce this, but an unguarded walk up the parent chain
    // would hang the render — and the pre-fix root filter dropped both issues,
    // leaving a KR counter with nothing under it.
    const mod = module_({ name: 'KR 1.2 · Готовый 1 урок' })
    const a = issue({ name: 'Задача A' })
    const b = issue({ name: 'Задача B', parent: a.id })
    a.parent = b.id
    const src = sourceOf([slice(DSG1, 'O1 · Врачи', [mod], { [mod.id]: [a, b] })])

    const { objectives, warnings } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const kr = objectives[0].krs[0]
    expect(kr.counts).toEqual({ done: 0, total: 2 })
    expect(kr.actions.map((x) => x.title).sort()).toEqual(['Задача A', 'Задача B'])
    expect(kr.actions.every((x) => x.total === 1)).toBe(true)
    expect(warnings.some((w) => w.includes('Циклическая'))).toBe(true)
  })

  it('makes the action rows add up to the KR counter (spec 077 req.4)', () => {
    // The dashboard case from #77: 4 parents + 2 subs, one sub closed → KR 1/6.
    const mod = module_({ name: 'KR 2.2 · Кол-во регистраций на вебинарах' })
    const links = issue({ name: 'Разместить ссылки на мероприятия' })
    const linksSub = issue({ name: 'Решить: размещать ли на новой платформе', parent: links.id })
    const migrate = issue({ name: 'Мигрировать мероприятия' })
    const congress = issue({ name: 'Организовать сайт конгресса', state: 's-progress' })
    const congressSub = issue({ name: 'Разведать orthobio.ru', parent: congress.id, state: 's-done' })
    const program = issue({ name: 'Подготовить программу ОртоБио 2027' })
    const src = sourceOf([
      slice(DSG2, 'O2 · Канал', [mod], {
        [mod.id]: [links, linksSub, migrate, congress, congressSub, program],
      }),
    ])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const kr = objectives.find((o) => o.ident === 'DSG2')!.krs[0]
    expect(kr.counts).toEqual({ done: 1, total: 6 })
    expect(kr.actions.map((a) => ({ done: a.done, total: a.total }))).toEqual([
      { done: 0, total: 2 },
      { done: 0, total: 1 },
      { done: 1, total: 2 },
      { done: 0, total: 1 },
    ])
    // the invariant the owner reads off the screen: rows sum to the KR counter
    const sum = kr.actions.reduce((acc, a) => ({ done: acc.done + a.done, total: acc.total + a.total }), {
      done: 0,
      total: 0,
    })
    expect(sum).toEqual(kr.counts)
  })

  it('promotes an orphaned sub (parent cancelled) to a top-level action instead of dropping it', () => {
    const mod = module_({ name: 'KR 2.2 · Регистрации' })
    const cancelledParent = issue({ name: 'Отменённый родитель', state: 's-cancelled' })
    const orphan = issue({ name: 'Живая подзадача', parent: cancelledParent.id })
    const src = sourceOf([slice(DSG1, 'O1 · X', [mod], { [mod.id]: [cancelledParent, orphan] })])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const kr = objectives[0].krs[0]
    expect(kr.counts).toEqual({ done: 0, total: 1 })
    expect(kr.actions.map((a) => a.title)).toEqual(['Живая подзадача'])
    // promoted to an action, it is its own single unit of work (spec 077 req.3)
    expect({ done: kr.actions[0].done, total: kr.actions[0].total }).toEqual({ done: 0, total: 1 })
  })

  it('marks q4 from Plane target_date past the period end and keeps q4 out of every rollup (§3 p.4)', () => {
    const active = module_({ name: 'KR 3.1 · Эксперты' })
    const q4mod = module_({ name: 'KR 3.2 · Деньги экспертам', target_date: '2026-12-31' })
    const a1 = issue({ name: 'Задача активная', state: 's-done' })
    const a2 = issue({ name: 'Задача q4' })
    const src = sourceOf([slice(DSG3, '💎 O3 · Эксперт', [active, q4mod], { [active.id]: [a1], [q4mod.id]: [a2] })])

    const { objectives, pct } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const [kr31, kr32] = objectives.find((o) => o.ident === 'DSG3')!.krs
    expect(kr31.q4).toBe(false)
    expect(kr32.q4).toBe(true)
    expect(kr32.health).toBe('q4')
    // objective average is computed over non-q4 KRs only: 100%, not (100+0)/2
    expect(objectives.find((o) => o.ident === 'DSG3')!.pct).toBe(100)
    // the other four objectives are missing → undefined; the goal average = the one defined objective
    expect(pct).toBe(100)
  })

  it('marks a whole objective q4 when every KR is q4 (DSG4) and excludes it from the goal', () => {
    const m1 = module_({ name: 'KR 4.1 · Фарма', target_date: '2026-12-31' })
    const active = module_({ name: 'KR 1.1 · НМО' })
    const doneIssue = issue({ name: 'Готово', state: 's-done' })
    const q4issue = issue({ name: 'Q4 задача' })
    const src = sourceOf([
      slice(DSG1, 'O1 · Врачи', [active], { [active.id]: [doneIssue] }),
      slice(DSG4, '💊 O4 · Фарма', [m1], { [m1.id]: [q4issue] }),
    ])

    const { objectives, pct } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const o4 = objectives.find((o) => o.ident === 'DSG4')!
    expect(o4.q4).toBe(true)
    expect(o4.health).toBe('q4')
    expect(o4.pct).toBeNull()
    expect(pct).toBe(100) // only O1 counts
  })

  it('joins manual metrics by kr_id: live metric wins over execution (§3 p.2)', () => {
    const mod = module_({ name: 'KR 3.1 · 10 экспертов' })
    const prep = issue({ name: 'Подготовка', state: 's-done' })
    const src = sourceOf([slice(DSG3, 'O3 · Эксперт', [mod], { [mod.id]: [prep] })])

    const { objectives } = mapOkrTree({
      source: src,
      metrics: { 'kr3-1': { current: 3, target: 10, unit: 'экспертов' } },
      now: NOW,
    })
    const kr = objectives.find((o) => o.ident === 'DSG3')!.krs[0]
    expect(kr.pct).toBe(30)
    expect(kr.pctSource).toBe('metric')
    expect(kr.note).toBeNull()
  })

  it('runs a not-connected metric-KR in execution mode with an honest note (FR-3/FR-4)', () => {
    const mod = module_({ name: 'KR 2.1 · MAU 500' })
    const done = issue({ name: 'Статика', state: 's-done' })
    const open = issue({ name: 'Трафик' })
    const src = sourceOf([slice(DSG2, 'O2 · Канал', [mod], { [mod.id]: [done, open] })])

    const { objectives } = mapOkrTree({
      source: src,
      metrics: { 'kr2-1': { current: null, target: 500, unit: 'MAU' } },
      now: NOW,
    })
    const kr = objectives.find((o) => o.ident === 'DSG2')!.krs[0]
    expect(kr.pct).toBe(50)
    expect(kr.pctSource).toBe('execution')
    expect(kr.note).toBe('цель 500 MAU · измерение не подключено')
  })

  it('renders honest emptiness: empty module → null + reason, never 0 (FR-4)', () => {
    const mod = module_({ name: 'KR 1.3 · Готовая серия уроков' })
    const src = sourceOf([slice(DSG1, 'O1 · Врачи', [mod], { [mod.id]: [] })])

    const { objectives } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    const kr = objectives[0].krs[0]
    expect(kr.pct).toBeNull()
    expect(kr.counts).toBeNull()
    expect(kr.note).toBe('декомпозиция не расписана')
    expect(kr.health).toBe('undef')
  })

  it('degrades a missing project to an undefined objective + warning (FR-7)', () => {
    const src = sourceOf([]) // Plane returned nothing readable for any project
    const { objectives, warnings, pct } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    expect(objectives).toHaveLength(5)
    expect(objectives.every((o) => o.pct === null && o.health === 'undef')).toBe(true)
    expect(pct).toBeNull()
    expect(warnings.length).toBeGreaterThanOrEqual(5)
  })

  it('warns about modules violating the kr_id naming convention', () => {
    const mod = module_({ name: 'Просто модуль без префикса' })
    const src = sourceOf([slice(DSG5, 'O5 · Частные лица', [mod], { [mod.id]: [] })])
    const { warnings } = mapOkrTree({ source: src, metrics: {}, now: NOW })
    expect(warnings.some((w) => w.includes('нарушает конвенцию'))).toBe(true)
  })
})
