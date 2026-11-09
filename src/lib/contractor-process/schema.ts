import { z } from 'zod'

/**
 * The data contract of «Как работаем с исполнителями» (#545) — the shape of
 * `processes/contractors.json` in the private repo `bbm-academy-org/path-maps`,
 * and of its public example `content/finance/contractor-process.example.json`.
 *
 * The shape is the approved visual's `DATA` block
 * (`design-source/finance/contractor-process.visual.html`): a swimlane diagram
 * drawn on a «column × lane» grid. Objects are STRICT — the file is edited by
 * hand, and a misspelt key must be an error with its path, not a field that
 * silently disappears from the diagram. What a single field cannot know
 * (unique ids, an edge's ends, a step's lane, its column inside a stage) is
 * checked in `./parse.ts`, where the whole diagram is in view.
 */

const ID_HINT = 'id — только латиница, цифры, «_» и «-» (например, l1 или p_l2)'
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, ID_HINT)

const title = z.string().trim().min(1, 'пустое название')

/** Questions still open about a lane or a step — an absent list is no questions. */
const questions = z.array(z.string()).default([])

const column = z.number().int('колонка — целое число от 0').min(0, 'колонка — целое число от 0')

const lane = z.strictObject({
  id,
  title,
  /** The role itself is an open question: dashed border + «вопрос открыт». */
  open: z.boolean().optional(),
  /** «О роли» in the lane's detail panel. */
  about: z.string().optional(),
  q: questions,
})

/** A column span `c0..c1` (inclusive) headed by the stage's title. */
const stage = z.strictObject({
  title,
  c0: column,
  c1: column,
})

const step = z.strictObject({
  id,
  /** The id of the lane (role) the step sits on. */
  lane: id,
  col: column,
  title,
  /** `decision` is a branching step, drawn as a diamond; absent is a plain step. */
  kind: z
    .literal('decision', { error: 'kind может быть только «decision» (развилка) или не указан' })
    .optional(),
  /** «Сейчас» — how the step is done today; line breaks are kept. */
  now: z.string(),
  /** «Автоматизация» — non-empty means the step can be automated. */
  auto: z.string().default(''),
  /** The step itself is an open question. */
  open: z.boolean().optional(),
  q: questions,
})

const edge = z.strictObject({
  from: id,
  to: id,
  label: z.string().optional(),
  /** A detour / return path, drawn dashed. May carry a label too. */
  alt: z.boolean().optional(),
})

/** A second, smaller diagram under the main one — same engine, no stages. */
const subprocess = z.strictObject({
  title,
  about: z.string().optional(),
  lanes: z.array(lane),
  steps: z.array(step),
  edges: z.array(edge),
})

export const contractorProcessSchema = z.strictObject({
  lanes: z.array(lane).min(1, 'нужна хотя бы одна дорожка'),
  stages: z.array(stage).min(1, 'нужен хотя бы один этап'),
  steps: z.array(step),
  edges: z.array(edge),
  subprocess: subprocess.optional(),
})

export type ContractorProcess = z.infer<typeof contractorProcessSchema>
export type ProcessLane = ContractorProcess['lanes'][number]
export type ProcessStage = ContractorProcess['stages'][number]
export type ProcessStep = ContractorProcess['steps'][number]
export type ProcessEdge = ContractorProcess['edges'][number]
export type ProcessSubprocess = NonNullable<ContractorProcess['subprocess']>
