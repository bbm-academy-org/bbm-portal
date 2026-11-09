import { z } from 'zod'

import {
  contractorProcessSchema,
  type ContractorProcess,
  type ProcessEdge,
  type ProcessLane,
  type ProcessStep,
} from './schema'

/**
 * JSON text → a validated process, or the list of reasons it is not one (#545).
 *
 * Pure (no I/O), mirroring `src/lib/path-map/parse.ts`: the page, the tests
 * and the loader share one judgement. Every error is Russian and starts with
 * the path of the field it is about (`steps[2].lane: …`), so a person editing
 * the file in GitHub finds the place without reading the code. Schema errors
 * are reported first and alone; the cross-checks need a well-formed diagram.
 */

export type ContractorProcessParseResult =
  { ok: true; process: ContractorProcess } | { ok: false; errors: string[] }

function formatPath(path: PropertyKey[]): string {
  return path
    .map((segment, i) =>
      typeof segment === 'number' ? `[${segment}]` : `${i === 0 ? '' : '.'}${String(segment)}`,
    )
    .join('')
}

const TYPE_RU: Record<string, string> = {
  array: 'список',
  object: 'набор полей',
  string: 'текст',
  number: 'число',
  boolean: 'да/нет',
  null: 'пустое значение',
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Russian fallback for zod's built-in messages; the schema's own messages win. */
const ruErrors = z.locales.ru().localeError

function formatIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? formatPath(issue.path) : '(корень файла)'
  if (issue.code === 'invalid_type') {
    const input = (issue as { input?: unknown }).input
    if (input === undefined) return `${where}: обязательное поле не заполнено`
    // zod reports a fractional number against `.int()` as a type mismatch.
    if (issue.expected === 'int' && typeof input === 'number') {
      return `${where}: ожидается целое число от 0, а в файле — ${input}`
    }
    const expected = TYPE_RU[issue.expected] ?? issue.expected
    const got = TYPE_RU[typeOf(input)] ?? typeOf(input)
    return `${where}: ожидается ${expected}, а в файле — ${got}`
  }
  if (issue.code === 'unrecognized_keys') {
    return `${where}: неизвестное поле ${issue.keys.map((k) => `«${k}»`).join(', ')}`
  }
  return `${where}: ${issue.message}`
}

interface Diagram {
  /** Path prefix of this diagram's lists: `''` for the main one, `subprocess.` for the other. */
  prefix: string
  lanes: ProcessLane[]
  steps: ProcessStep[]
  edges: ProcessEdge[]
}

/** First occurrence wins; every later one is an error naming where the id was first used. */
function uniqueIds(items: { id: string }[], list: string, errors: string[]): Set<string> {
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    const first = seen.get(item.id)
    if (first === undefined) seen.set(item.id, i)
    else errors.push(`${list}[${i}].id: id «${item.id}» уже занят (${list}[${first}])`)
  })
  return new Set(seen.keys())
}

/** Ids are unique per diagram, and every reference stays inside its own diagram. */
function diagramChecks({ prefix, lanes, steps, edges }: Diagram): string[] {
  const errors: string[] = []
  const laneList = `${prefix}lanes`
  const stepList = `${prefix}steps`
  const laneIds = uniqueIds(lanes, laneList, errors)
  const stepIds = uniqueIds(steps, stepList, errors)

  const cells = new Map<string, number>()
  steps.forEach((step, i) => {
    if (!laneIds.has(step.lane)) {
      errors.push(`${stepList}[${i}].lane: дорожки «${step.lane}» нет в ${laneList}`)
      return
    }
    const cell = `${step.lane}\u0000${step.col}`
    const first = cells.get(cell)
    if (first === undefined) cells.set(cell, i)
    else {
      errors.push(
        `${stepList}[${i}]: шаг «${step.id}» стоит в той же клетке (${step.lane}, колонка ${step.col}), что и «${steps[first].id}» (${stepList}[${first}])`,
      )
    }
  })

  edges.forEach((edge, i) => {
    const where = `${prefix}edges[${i}]`
    for (const end of ['from', 'to'] as const) {
      if (!stepIds.has(edge[end])) {
        errors.push(`${where}.${end}: шага «${edge[end]}» нет в ${stepList}`)
      }
    }
    if (edge.from === edge.to) errors.push(`${where}: связь ведёт из шага «${edge.from}» в него же`)
  })

  return errors
}

/** Stage spans run forwards and do not overlap; every main-diagram step sits inside one. */
function stageChecks(process: ContractorProcess): string[] {
  const errors: string[] = []
  const spans: { c0: number; c1: number; i: number }[] = []
  process.stages.forEach((stage, i) => {
    if (stage.c0 > stage.c1) {
      errors.push(`stages[${i}]: начало этапа c0 = ${stage.c0} больше конца c1 = ${stage.c1}`)
      return
    }
    const clash = spans.find((s) => stage.c0 <= s.c1 && s.c0 <= stage.c1)
    if (clash) {
      errors.push(
        `stages[${i}]: колонки ${stage.c0}–${stage.c1} пересекаются с этапом stages[${clash.i}] (${clash.c0}–${clash.c1})`,
      )
    }
    spans.push({ c0: stage.c0, c1: stage.c1, i })
  })

  process.steps.forEach((step, i) => {
    if (!spans.some((s) => s.c0 <= step.col && step.col <= s.c1)) {
      errors.push(`steps[${i}].col: колонка ${step.col} не входит ни в один этап (stages)`)
    }
  })
  return errors
}

function crossChecks(process: ContractorProcess): string[] {
  const errors = [...stageChecks(process), ...diagramChecks({ prefix: '', ...process })]
  if (process.subprocess) {
    errors.push(...diagramChecks({ prefix: 'subprocess.', ...process.subprocess }))
  }
  return errors
}

export function parseContractorProcess(source: string): ContractorProcessParseResult {
  if (source.trim() === '') {
    return {
      ok: false,
      errors: [
        'файл пуст: нужны lanes, stages, steps и edges — пример в content/finance/contractor-process.example.json',
      ],
    }
  }

  let data: unknown
  try {
    data = JSON.parse(source)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, errors: [`JSON: файл не читается как JSON (${detail})`] }
  }

  const parsed = contractorProcessSchema.safeParse(data, { reportInput: true, error: ruErrors })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map(formatIssue) }
  }

  const errors = crossChecks(parsed.data)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, process: parsed.data }
}
