import { z } from 'zod'

/**
 * The wire contract of the workspace modules' HTTP surface, `/api/p/<slug>/*`
 * (consolidation §5; spec 311 EARS-436, D-11, D-12).
 *
 * TWO LAYERS, AND KEEPING THEM APART IS THE POINT. The RESOURCE schema is the
 * module's own (`src/lib/<module>/contract.ts`) — the frame never knows what a
 * period or a member looks like. The ENVELOPE around it is the frame's, and it
 * is declared here once so that the cabinet's data provider can parse ANY
 * module's answer without a per-module client.
 *
 * This file is pure zod and types: no Auth.js, no Next, no database. It is
 * imported by the route factory on the server and by the data provider in the
 * browser, which is exactly EARS-436's «one schema typing the client and
 * validating the handler».
 */

/**
 * The closed set of failure codes a module may answer with.
 *
 * `internal` is deliberately in the set and deliberately NOT raisable by a
 * module: it is what the frame answers when a handler throws something it did
 * not name, and its message is generic on purpose (EARS-473 — a raw constraint
 * error is never shown to an admin as prose).
 */
export const API_ERROR_CODES = [
  'bad-request',
  'forbidden',
  'not-found',
  'conflict',
  'unavailable',
  'internal',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** Code → HTTP status. One table, so a module cannot invent a status. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  'bad-request': 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
}

/**
 * A refusal a MODULE raises on purpose, with the message the admin should read
 * (spec 311 EARS-472, EARS-473; spec 124 EARS-20).
 *
 * The distinction this class exists to draw: a thrown `ModuleApiError` is an
 * answer — the module knows what went wrong and has said so in words. Anything
 * else thrown out of a handler is a bug, and the frame answers 500 with a
 * generic line while the real error goes to the server log.
 */
export class ModuleApiError extends Error {
  constructor(
    readonly code: Exclude<ApiErrorCode, 'internal'>,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ModuleApiError'
  }
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

const MODULE_LIST_RESULT = Symbol('module-list-result')

/**
 * A module list handler's page, including the count before pagination.
 * Construct it through `moduleListResult` so it cannot collide with a record.
 */
export interface ModuleListResult<T> {
  readonly [MODULE_LIST_RESULT]: true
  items: T[]
  total: number
}

/** Brand a page result without putting the internal discriminant on the wire. */
export function moduleListResult<T>(result: { items: T[]; total: number }): ModuleListResult<T> {
  return { [MODULE_LIST_RESULT]: true, ...result }
}

/** Distinguish an intentional page from an arbitrary record with the same keys. */
export function isModuleListResult(value: unknown): value is ModuleListResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    MODULE_LIST_RESULT in value &&
    value[MODULE_LIST_RESULT] === true
  )
}

/** Runtime validation for the page a module list handler returns. */
export function moduleListResultSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int().min(0) })
}

/**
 * The envelope of a LIST answer. `total` is the unpaginated count — Refine's
 * data provider needs it to render a pager at all, and a provider that has to
 * infer it from `data.length` silently caps every list at one page.
 */
export function listEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), total: z.number().int().min(0) })
}

/** The envelope of a SINGLE-record answer. */
export function oneEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: item })
}

/**
 * The list query every module list handler understands, parsed and never
 * trusted (consolidation §5: authorization AND validation live in the handler).
 *
 * `pageSize` is CLAMPED rather than defaulted-on-overflow: a caller asking for
 * 100000 rows is told no, instead of quietly getting 200 and believing it got
 * everything. `.max()` refusing is the honest answer to a request the surface
 * will not serve.
 */
export const MODULE_LIST_MAX_PAGE_SIZE = 200

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MODULE_LIST_MAX_PAGE_SIZE).default(25),
  /** Field name; which fields are sortable is the module's business. */
  sort: z.string().min(1).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  /** Free-text search, where the resource supports one. */
  q: z.string().optional(),
})

export type ListQuery = z.infer<typeof listQuerySchema>

// The operations a cabinet resource supports (EARS-437) are NOT declared here.
// They are a property of a module's registry declaration, so they live with it:
// `RESOURCE_OPERATIONS` in `src/lib/workspace/contract.ts`. Declaring them in
// both places would be the second source of truth this file exists to avoid.
