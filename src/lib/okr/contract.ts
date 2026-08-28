import { z } from 'zod'

import type { WorkspaceAdminSection } from '@/lib/workspace/contract'

/**
 * The OKR module's WIRE CONTRACT and its cabinet section (spec 311 §G —
 * EARS-436, EARS-453, EARS-455, EARS-475, EARS-476).
 *
 * WHY THIS FILE IS SEPARATE FROM `workspace.ts`. It is deliberately
 * **client-safe**: pure zod plus labels, no `cache.ts`, no `pg`, no Plane
 * client. The cabinet's data provider runs in the BROWSER and has to parse
 * answers with the module's own schema (EARS-436), so the schema must be
 * reachable from a client bundle. `okrWorkspaceEntry` is not — it carries the
 * `status` provider, which reads the tree — and the whole registry is
 * server-only for the same reason. Splitting the contract out is what lets one
 * schema OBJECT be shared by the handler and the client rather than copied.
 */

/** One Plane project as the dashboard's configuration describes it (FR-1). */
export const okrProjectParameterSchema = z.object({
  ident: z.string(),
  projectId: z.string(),
  mission: z.string(),
  order: z.number().int(),
})

/**
 * The module's current snapshot state when the page asks (EARS-476).
 *
 * For a successful read, `at` is the successful Plane fetch that produced the
 * snapshot. `getOkrTree` preserves it across cache hits and stale fallbacks, so
 * the cabinet reports the age of the same data `/p/okr` is showing instead of
 * the time the cabinet happened to ask for it. No cache bypass is added.
 */
export const okrReadStateSchema = z.object({
  state: z.enum(['ok', 'error']),
  at: z.string(),
  message: z.string().optional(),
})

export const okrParametersSchema = z.object({
  /** Refine needs an id on every record; this resource is a singleton. */
  id: z.literal('parameters'),
  workspace: z.string(),
  planeWebBaseUrl: z.string(),
  period: z.object({ start: z.string(), end: z.string() }),
  projects: z.array(okrProjectParameterSchema),
  read: okrReadStateSchema,
})

export type OkrParametersRecord = z.infer<typeof okrParametersSchema>

/**
 * What EARS-476's «the error it reports» reads as on the screen.
 *
 * `OkrUnavailableError` carries a fixed, readable sentence and puts the real
 * failure in `cause` — the right split for a module, and the wrong thing to
 * show an admin on its own: «Plane недоступен и кэша ещё нет» does not say
 * whether the token expired or the host is down. So both are rendered, the
 * module's line first. Declared here, once, because the settings PAGE and the
 * `/api/p/okr/admin/parameters` handler must not answer differently.
 */
export function describeOkrReadError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Модуль OKR не смог прочитать данные, причина неизвестна.'
  }
  const cause = error.cause
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : null
  return detail ? `${error.message} (${detail})` : error.message
}

/**
 * The OKR cabinet section (EARS-453, owner amendment (b), 2026-08-25 — «источник
 * данных не аргумент для выноса из админки»).
 *
 * ONE resource, and it declares `list` and nothing else. EARS-455 makes create,
 * update and delete all unsupported: the OKR records are mastered in Plane, and
 * these parameters are deploy-time configuration with no settings store in
 * `core` to write to. Expressing that as an absent operation rather than as a
 * disabled button is EARS-437 — there is no control here that could fail on
 * click, because there is no route behind one.
 */
export const okrAdminSection: WorkspaceAdminSection = {
  label: 'OKR',
  resources: [
    {
      name: 'parameters',
      label: 'Источник и параметры',
      operations: ['list'],
      schema: okrParametersSchema,
    },
  ],
}
