import { OKR_PERIOD, OKR_PROJECTS, OKR_WORKSPACE, Q4_OVERRIDE, planeWebBaseUrl } from './config'
import type { OkrSource } from './planeClient'
import { avg, executionPct, health, metricPct } from './rollup'
import type {
  Health,
  KrMetric,
  OkrAction,
  OkrKr,
  OkrObjective,
  OkrTask,
  PlaneIssue,
  StateGroup,
} from './types'

/**
 * Maps raw Plane slices into the OKR tree (FR-1). The taxonomy is structural
 * (okr-structure.md §4): project = Objective, module = KR, parent-issue =
 * Action, sub-issue = Task. Task→Action grouping is strictly by `parent` id —
 * never by name.
 */

/**
 * The kr_id rule (FR-3): KR modules are recreated each OKR period, so their
 * UUIDs are unstable. The stable id is derived from the module-name prefix
 * «KR <major>.<minor> · …» → `kr<major>-<minor>` — the key used in
 * metrics.yaml. A module that violates the naming convention gets a
 * module-id-based key and a warning (it can never match a manual metric).
 */
export function deriveKrId(moduleName: string): { krId: string; conventional: boolean } {
  const m = moduleName.match(/^\s*KR\s*(\d+)[.\-](\d+)/i)
  if (m) return { krId: `kr${m[1]}-${m[2]}`, conventional: true }
  return { krId: `module-${moduleName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`, conventional: false }
}

/** Plane project names look like «🎓 O1 · Врачи получают…» — the board title is the part after «O<n> ·». */
export function stripObjectivePrefix(projectName: string): string {
  const m = projectName.match(/O\d+\s*·\s*(.+)$/)
  return m ? m[1].trim() : projectName.trim()
}

/** A node dated past the period end is «Цель на IV квартал» (FR-2: q4 is read from Plane dates). */
function isQ4(targetDate: string | null, periodEnd: string): boolean {
  return targetDate != null && targetDate > periodEnd
}

interface BuildInput {
  source: OkrSource
  metrics: Record<string, KrMetric>
  now: Date
}

export interface MappedTree {
  objectives: OkrObjective[]
  pct: number | null
  warnings: string[]
}

export function mapOkrTree({ source, metrics, now }: BuildInput): MappedTree {
  const warnings: string[] = []
  const web = planeWebBaseUrl()

  const objectives = OKR_PROJECTS.map((cfg): OkrObjective => {
    const slice = source.slices.get(cfg.projectId)
    const objectiveUrl = `${web}/${OKR_WORKSPACE}/projects/${cfg.projectId}/issues`
    if (!slice) {
      warnings.push(`Проект ${cfg.ident} не прочитан из Plane — objective показан как «не определено»`)
      return {
        id: `o${cfg.order}`,
        ident: cfg.ident,
        projectId: cfg.projectId,
        title: cfg.ident,
        mission: cfg.mission,
        order: cfg.order,
        q4: false,
        krs: [],
        pct: null,
        health: 'undef',
        note: 'данные Plane недоступны',
        planeUrl: objectiveUrl,
      }
    }

    const stateGroupById = new Map(slice.states.map((s) => [s.id, s.group]))
    const groupOf = (issue: PlaneIssue): StateGroup => {
      const group = stateGroupById.get(issue.state)
      if (!group) {
        warnings.push(`Неизвестный state у ${cfg.ident}-${issue.sequence_id} — учтён как незакрытый`)
        return 'unstarted'
      }
      return group
    }

    const krs = slice.modules
      .map((mod): OkrKr => {
        const { krId, conventional } = deriveKrId(mod.name)
        if (!conventional) {
          warnings.push(
            `Модуль «${mod.name}» (${cfg.ident}) нарушает конвенцию имени «KR x.y · …» — ручная метрика по нему не подберётся`,
          )
        }

        const issues = slice.issuesByModule[mod.id] ?? []
        // §3 p.1 + OQ-5: flat set of ALL module issues; cancelled leave the denominator.
        const active = issues.filter((i) => groupOf(i) !== 'cancelled')
        const counts = active.length > 0 ? { done: active.filter((i) => groupOf(i) === 'completed').length, total: active.length } : null

        const issueUrl = (i: PlaneIssue) => `${web}/${OKR_WORKSPACE}/browse/${cfg.ident}-${i.sequence_id}/`
        const toTask = (i: PlaneIssue): OkrTask => ({
          id: i.id,
          title: i.name,
          stateGroup: groupOf(i),
          planeUrl: issueUrl(i),
        })
        const actions = active
          .filter((i) => i.parent == null || !active.some((p) => p.id === i.parent))
          .sort((a, b) => a.sequence_id - b.sequence_id)
          .map((parent): OkrAction => {
            const subs = active.filter((i) => i.parent === parent.id).sort((a, b) => a.sequence_id - b.sequence_id)
            return {
              id: parent.id,
              title: parent.name,
              stateGroup: groupOf(parent),
              done: subs.filter((s) => groupOf(s) === 'completed').length,
              total: subs.length,
              planeUrl: issueUrl(parent),
              tasks: subs.map(toTask),
            }
          })

        const metric = metrics[krId] ?? null
        const mPct = metricPct(metric)
        const ePct = executionPct(counts)
        const pct = mPct ?? ePct
        const pctSource: OkrKr['pctSource'] = mPct != null ? 'metric' : ePct != null ? 'execution' : null

        // Honest qualifiers (FR-4): why a metric-KR runs in execution mode, or why the node is undefined.
        let note: string | null = null
        if (metric && mPct == null) {
          note =
            metric.target == null
              ? 'метрика не задана'
              : `цель ${formatTarget(metric.target)}${metric.unit ? ` ${metric.unit}` : ''} · измерение не подключено`
        } else if (!metric && counts == null) {
          note = 'декомпозиция не расписана'
        }

        const q4 = Q4_OVERRIDE[krId] ?? isQ4(mod.target_date, OKR_PERIOD.end)
        const krHealth: Health = q4 ? 'q4' : health(pct, OKR_PERIOD, now)

        return {
          krId,
          moduleId: mod.id,
          title: mod.name.replace(/^\s*KR\s*\d+[.\-]\d+\s*·\s*/i, ''),
          q4,
          counts,
          metric,
          pct,
          pctSource,
          health: krHealth,
          note,
          leadId: mod.lead,
          planeUrl: `${web}/${OKR_WORKSPACE}/projects/${cfg.projectId}/modules/${mod.id}`,
          actions,
        }
      })
      .sort((a, b) => compareKrIds(a.krId, b.krId))

    // Objective is q4 when every KR is q4 (DSG4: all modules are dated Q4). Config can override point-wise.
    const q4 = Q4_OVERRIDE[cfg.ident] ?? (krs.length > 0 && krs.every((k) => k.q4))
    // §3 p.3–4: unweighted mean of KR%, q4 KRs excluded from the period rollup.
    const pct = q4 ? null : avg(krs.filter((k) => !k.q4).map((k) => k.pct))
    const objHealth: Health = q4 ? 'q4' : health(pct, OKR_PERIOD, now)

    return {
      id: `o${cfg.order}`,
      ident: cfg.ident,
      projectId: cfg.projectId,
      title: stripObjectivePrefix(slice.project.name),
      mission: cfg.mission,
      order: cfg.order,
      q4,
      krs,
      pct,
      health: objHealth,
      note: krs.length === 0 ? 'Key Results ещё не сформулированы' : null,
      planeUrl: objectiveUrl,
    }
  }).sort((a, b) => a.order - b.order)

  // Goal% (§3 p.4): unweighted mean of in-period objectives; q4 and undefined objectives stay out.
  const pct = avg(objectives.filter((o) => !o.q4).map((o) => o.pct))

  return { objectives, pct, warnings }
}

function compareKrIds(a: string, b: string): number {
  const pa = a.match(/^kr(\d+)-(\d+)$/)
  const pb = b.match(/^kr(\d+)-(\d+)$/)
  if (pa && pb) {
    return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2])
  }
  if (pa) return -1
  if (pb) return 1
  return a.localeCompare(b)
}

function formatTarget(target: number): string {
  return new Intl.NumberFormat('ru-RU').format(target)
}
