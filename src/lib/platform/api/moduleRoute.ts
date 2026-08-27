import type { z } from 'zod'

import { auth } from '@/auth'
import type { AuditContext } from '@/lib/platform/db/transaction'

import {
  claimGateResponse,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_USER_ROLE,
  sessionActorEmail,
  type SessionLike,
} from '../authGate'
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  listQuerySchema,
  ModuleApiError,
  type ListQuery,
} from './contract'

/**
 * The route-handler factory for `/api/p/<slug>/*` (spec 311 EARS-461,
 * EARS-462, EARS-436, EARS-472, EARS-473; consolidation §5, D-12).
 *
 * WHY A FACTORY AND NOT A CONVENTION. Consolidation §5 says «authorization
 * lives in every handler», and spec 311 ends both authorization clauses with
 * the same sentence: a handler that relies on the shell having checked is a
 * DEFECT. A convention written in prose is one that a handler can be written
 * without; here the gate runs before the caller's function is reachable at all,
 * so «I forgot to check the claim» is not a shape a handler built this way has.
 * `pnpm lint:endpoint-authz` then proves no handler is built any other way —
 * the deferred §11 row of the consolidation spec, falling due with the surface
 * that triggers it.
 *
 * THE TWO DOORS ARE THE URL (D-12). `memberRoute` serves
 * `/api/p/<slug>/<resource>` and asks for `platform-user` plus the entry's own
 * declared claim; `adminRoute` serves `/api/p/<slug>/admin/<resource>` and asks
 * for `platform-admin`. The split is not decoration: one claim for everything
 * would either lock plain members out of their own apps or leave the cabinet's
 * writes guarded by the shell alone.
 *
 * WHAT THIS FILE DOES NOT DO. It does not open a transaction and it does not
 * touch the database. It hands the handler an `audit` context carrying the
 * signed-in member (ADR-004 A1), and the module's own code passes that to
 * `platformTransaction` — the frame must not be the thing that knows which
 * tables a module owns (ADR-004 §6).
 */

/** What a handler is given. Everything session-shaped is resolved before it runs. */
export interface ModuleRouteContext<TBody> {
  /** The Auth.js session, already proven to carry the required claim. */
  session: SessionLike
  /**
   * The audit context for any write this handler makes (ADR-004 A1, spec 201).
   *
   * `source` is `portal`: the closed set of `app.source` is DB-enforced by spec
   * 201's trigger and has no `cabinet` member. Spec 311 EARS-439 asks for «a
   * cabinet source», which would be a change to that closed set and to the
   * trigger's regex — spec 201's business, not this frame's. An authenticated
   * request with a human behind it IS `portal`, which is what the value means.
   */
  audit: AuditContext
  /** Parsed and validated body, or `undefined` when the route declares no input. */
  body: TBody
  /** The dynamic route segment values Next resolved. */
  params: Record<string, string | string[]>
  /** The raw query string, for a handler that wants more than `query`. */
  searchParams: URLSearchParams
  /** The parsed standard list query (page/pageSize/sort/order/q). */
  query: ListQuery
}

export interface ModuleRouteSpec<TBody, TOut> {
  /**
   * The module's schema for the request body. Absent means «this method takes
   * no body», and a body sent anyway is ignored rather than trusted.
   */
  input?: z.ZodType<TBody>
  /**
   * The module's schema for ONE record of the answer (EARS-436). The same
   * schema types the cabinet's data provider, so a handler that returns
   * something else fails here, on the server, and not in the browser.
   */
  output: z.ZodType<TOut>
  handler: (ctx: ModuleRouteContext<TBody>) => Promise<TOut | TOut[]>
}

/** The Next 16 second argument of a route handler: dynamic segment values. */
export interface RouteSegment {
  params?: Promise<Record<string, string | string[]>>
}

export type ModuleRouteHandler = (request: Request, segment?: RouteSegment) => Promise<Response>

function fail(code: ApiErrorCode, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, details } }, { status: API_ERROR_STATUS[code] })
}

/**
 * A zod issue list, rendered as one line an admin can act on (EARS-472).
 *
 * The field path is the load-bearing half — «Некорректный запрос» with no field
 * name is the failure that does not name its reason, which is exactly what the
 * clause forbids.
 */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

async function readBody<TBody>(
  request: Request,
  input: z.ZodType<TBody> | undefined,
): Promise<{ ok: true; body: TBody } | { ok: false; response: Response }> {
  if (!input) return { ok: true, body: undefined as TBody }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: fail('bad-request', 'Тело запроса не является корректным JSON') }
  }

  const parsed = input.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: fail('bad-request', describeIssues(parsed.error)) }
  }
  return { ok: true, body: parsed.data }
}

function moduleRoute<TBody, TOut>(
  requiredClaim: string,
  extraClaim: string | undefined,
  spec: ModuleRouteSpec<TBody, TOut>,
): ModuleRouteHandler {
  return async function handle(request: Request, segment?: RouteSegment): Promise<Response> {
    // ── the gate, before anything else can run (EARS-461, EARS-462) ─────────
    const session = (await auth()) as SessionLike | null
    const refusal = claimGateResponse(session, requiredClaim)
    if (refusal) return refusal
    if (extraClaim) {
      const extraRefusal = claimGateResponse(session, extraClaim)
      if (extraRefusal) return extraRefusal
    }

    const searchParams = new URL(request.url).searchParams
    const queryParsed = listQuerySchema.safeParse(Object.fromEntries(searchParams))
    if (!queryParsed.success) {
      return fail('bad-request', describeIssues(queryParsed.error))
    }

    const body = await readBody(request, spec.input)
    if (!body.ok) return body.response

    const actorEmail = sessionActorEmail(session)

    let result: TOut | TOut[]
    try {
      result = await spec.handler({
        session: session as SessionLike,
        audit: { actorEmail, source: 'portal' },
        body: body.body,
        params: (await segment?.params) ?? {},
        searchParams,
        query: queryParsed.data,
      })
    } catch (error) {
      if (error instanceof ModuleApiError) {
        return fail(error.code, error.message, error.details)
      }
      // EARS-473's other half: an unexpected throw is a bug, not a message. The
      // raw text (a constraint name, a connection string) stays server-side.
      console.error('[api/p] unhandled error in a module handler', error)
      return fail('internal', 'Внутренняя ошибка. Повторите попытку или обратитесь к владельцу.')
    }

    // EARS-436: the answer is validated against the SAME schema the client
    // parses it with. A handler that drifts from the contract fails here.
    if (Array.isArray(result)) {
      const items: TOut[] = []
      for (const item of result) {
        const parsed = spec.output.safeParse(item)
        if (!parsed.success) {
          console.error('[api/p] handler answer violates its own schema', parsed.error.issues)
          return fail(
            'internal',
            'Внутренняя ошибка. Повторите попытку или обратитесь к владельцу.',
          )
        }
        items.push(parsed.data)
      }
      return Response.json({ data: items, total: items.length })
    }

    const parsed = spec.output.safeParse(result)
    if (!parsed.success) {
      console.error('[api/p] handler answer violates its own schema', parsed.error.issues)
      return fail('internal', 'Внутренняя ошибка. Повторите попытку или обратитесь к владельцу.')
    }
    return Response.json({ data: parsed.data })
  }
}

/**
 * A MEMBER-facing module handler at `/api/p/<slug>/<resource>` (EARS-461).
 *
 * `platform-user` always, plus the entry's declared `requiredClaim` where it
 * has one. A claim introduced later (EARS-466) is passed here as data and
 * enforced here — it costs no edit to the launcher, the top bar or the cabinet.
 */
export function memberRoute<TBody = undefined, TOut = unknown>(
  spec: ModuleRouteSpec<TBody, TOut> & { requiredClaim?: string },
): ModuleRouteHandler {
  return moduleRoute(PLATFORM_USER_ROLE, spec.requiredClaim, spec)
}

/**
 * A CABINET handler at `/api/p/<slug>/admin/<resource>` (EARS-462).
 *
 * `platform-admin`, re-checked here regardless of the shell that rendered the
 * link. The `admin` segment is reserved inside a module's API namespace (D-12)
 * so the required claim is readable from the URL and greppable in review;
 * `pnpm lint:endpoint-authz` refuses the segment anywhere else.
 */
export function adminRoute<TBody = undefined, TOut = unknown>(
  spec: ModuleRouteSpec<TBody, TOut>,
): ModuleRouteHandler {
  return moduleRoute(PLATFORM_ADMIN_ROLE, undefined, spec)
}
