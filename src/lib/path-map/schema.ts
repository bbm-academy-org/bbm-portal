import { z } from 'zod'

/**
 * The path map's data contract (#530) — the shape of
 * `content/path-map/<map>.yaml`, one file per map.
 *
 * The file is edited by hand or by an agent, so the schema is STRICT: a
 * misspelt key (`becuase:`) is an error with its path rather than a field that
 * silently disappears from the map. What the schema deliberately does NOT
 * check is whether an `opens` target exists — a dangling `opens` is a «разрыв»
 * the map shows in «Проверить путь», which is the whole point of the check
 * mode (see `./derive.ts`). Duplicate ids and the reserved id are checked in
 * `./parse.ts`, where every node of every track is in view at once.
 *
 * Field reference for people: `content/path-map/README.md`.
 */

/** The id `opens` uses to mean «this leads straight to the beacon». */
export const BEACON_ID = 'beacon'

const id = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    'id: только латиница в нижнем регистре, цифры и дефис (например, first-lesson)',
  )

/** A YAML number (`title: 2026`) is read as the text it looks like. */
const title = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : v),
  z.string().trim().min(1, 'пустое название'),
)

/** A real calendar day: `2026-13-45` and `2026-02-30` match the pattern but are no dates. */
function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** `YYYY-MM-DD`. YAML's core schema keeps it a string, so no Date coercion is involved. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД, например 2026-10-21')
  .refine(isCalendarDate, 'такой даты нет в календаре — проверьте месяц и день')

/** A bare `nodes:` / `tracks:` is YAML null: read it as the empty list it means. */
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === null || v === undefined ? [] : v), z.array(item))

export const CONFIDENCE = ['known', 'hypothesis', 'unknown'] as const
export type Confidence = (typeof CONFIDENCE)[number]

const common = {
  id,
  title,
  /** A free-text label of who carries it («ДС», «ЕВ»). Not a user reference. */
  owner: z.string().trim().min(1).optional(),
  /** The id of the node this one opens, or `beacon`. Existence is NOT checked here. */
  opens: id.optional(),
}

const obstacleSchema = z.strictObject({
  ...common,
  type: z.literal('obstacle'),
  /** Set when the obstacle is removed: it moves to the passed path below «Мы здесь». */
  done: isoDate.optional(),
})

const stationSchema = z.strictObject({
  ...common,
  type: z.literal('station'),
  confidence: z.enum(CONFIDENCE).default('known'),
  /** Why reaching this station moves us toward the beacon. Without it the station is roadside. */
  because: z.string().trim().min(1).optional(),
})

const fogSchema = z.strictObject({
  ...common,
  type: z.literal('fog'),
})

export const nodeSchema = z.discriminatedUnion('type', [obstacleSchema, stationSchema, fogSchema])

export const TRACK_STATUS = ['focus', 'roadside'] as const

export const trackSchema = z.strictObject({
  id,
  title,
  /** A short label for the narrow-layout tabs («Контент»); falls back to `title`. */
  short: title.optional(),
  status: z.enum(TRACK_STATUS).default('focus'),
  /** Ordered bottom → top along the road: the first node is the nearest one. */
  nodes: listOf(nodeSchema),
})

export const limitsSchema = z.strictObject({
  focus_tracks: z.number().int().positive().default(3),
  visible_stations: z.number().int().positive().default(2),
  obstacles_per_station: z.number().int().positive().default(3),
})

export const pathMapSchema = z.strictObject({
  title,
  /** The day the map started; shown as «старт …» under the passed path. */
  started: isoDate.optional(),
  beacon: z.strictObject({
    title,
    why: z.string().trim().min(1).optional(),
  }),
  limits: limitsSchema.default({ focus_tracks: 3, visible_stations: 2, obstacles_per_station: 3 }),
  tracks: listOf(trackSchema),
})

export type PathMap = z.output<typeof pathMapSchema>
export type PathTrack = PathMap['tracks'][number]
export type PathNode = PathTrack['nodes'][number]
export type PathObstacle = Extract<PathNode, { type: 'obstacle' }>
export type PathStation = Extract<PathNode, { type: 'station' }>
