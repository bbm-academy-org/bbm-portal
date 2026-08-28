import type { DataProvider, HttpError } from '@refinedev/core'
import { errorEnvelopeSchema } from '../api/contract'

/**
 * The cabinet's HAND-WRITTEN Refine data provider (spec 311 EARS-431,
 * EARS-436, EARS-472, EARS-473; consolidation §6, D-12).
 *
 * WHY HAND-WRITTEN. Consolidation §6 fixes Refine as a thin CRUD scaffold —
 * `@refinedev/core` plus a router binding, and none of Refine's own data
 * packages. A generic REST provider would still have to be bent onto this
 * repo's envelope (`{data, total}` / `{error:{code,message}}`) and its claim
 * split (`/api/p/<slug>/admin/<resource>`), and the bend would live in
 * configuration nobody reads. Roughly a hundred lines of explicit mapping is
 * the honest form of the same thing.
 *
 * THE RESOURCE NAME IS THE URL. Refine's resource `<slug>.<resource>` maps to
 * `/api/p/<slug>/admin/<resource>` — the cabinet always speaks to the admin
 * half of a module's API (D-12), which is what makes the required claim
 * readable from the URL. The `admin` segment is reserved for exactly this and
 * `pnpm lint:endpoint-authz` refuses it anywhere else.
 *
 * EVERY ANSWER IS PARSED (EARS-436). Not «typed as» — parsed, with the module's
 * OWN schema, the same object its handler validates with. The provider asks an
 * authenticated Server Function to run that parse against the one composition
 * root: Zod objects cannot cross React's serializable server/client boundary,
 * while importing the registry here would pull module status providers and PG
 * into the client graph. The extra round trip is deliberate and bounded to the
 * internal admin; it removes the shell-owned module list without weakening the
 * runtime parse.
 */

/** The module API root. Not the cabinet's route root — those are different things. */
export const MODULE_API_ROOT = '/api/p'

export type CabinetEnvelopeKind = 'list' | 'one'

export type CabinetValidationResult =
  { success: true; data: unknown } | { success: false; issues: string }

export type CabinetResponseValidator = (
  resource: string,
  envelope: CabinetEnvelopeKind,
  payload: unknown,
) => Promise<CabinetValidationResult>

export interface CabinetDataProviderOptions {
  /** Authenticated registry lookup + parse with the module's own schema. */
  validateResponse: CabinetResponseValidator
  /** Overridable for tests; defaults to the ambient `fetch`. */
  fetchImpl?: typeof fetch
  /** Overridable for a server-side call that needs an absolute origin. */
  apiRoot?: string
}

/**
 * Refine's error shape. Throwing this rather than a bare `Error` is what lets
 * a form show the refusal next to the field (EARS-472) instead of a toast
 * saying «ошибка».
 */
function httpError(statusCode: number, message: string): HttpError {
  return { statusCode, message }
}

/** `hours.periods` → `/api/p/hours/admin/periods`. */
function resourceUrl(apiRoot: string, resource: string): string {
  const [slug, ...rest] = resource.split('.')
  if (!slug || rest.length === 0) {
    throw httpError(
      500,
      `Ресурс кабинета «${resource}» назван не в форме <модуль>.<ресурс> — URL построить нельзя.`,
    )
  }
  return `${apiRoot}/${slug}/admin/${rest.join('/')}`
}

export function createCabinetDataProvider(options: CabinetDataProviderOptions): DataProvider {
  const apiRoot = options.apiRoot ?? MODULE_API_ROOT
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args))

  /** One request, one parse. Every non-2xx becomes a refusal that names itself. */
  async function call<T>(
    resource: string,
    url: string,
    init: RequestInit | undefined,
    envelope: CabinetEnvelopeKind,
  ): Promise<T> {
    const response = await doFetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    })

    if (!response.ok) {
      // EARS-472/473: the module's own message where there is one; a sentence
      // naming the status and the resource where the body is unreadable (a
      // proxy's HTML 502, or the bare-bodied 403 of EARS-462). What never
      // happens is an empty message or a swallowed refusal.
      let message = `Запрос к «${resource}» отклонён (HTTP ${response.status}).`
      try {
        const parsed = errorEnvelopeSchema.safeParse(await response.json())
        if (parsed.success) message = parsed.data.error.message
      } catch {
        /* body was not JSON — the default sentence above already says enough */
      }
      throw httpError(response.status, message)
    }

    const parsed = await options.validateResponse(resource, envelope, await response.json())
    if (!parsed.success) {
      throw httpError(500, `Ответ «${resource}» не соответствует схеме модуля: ${parsed.issues}`)
    }
    return parsed.data as T
  }

  return {
    getApiUrl: () => apiRoot,

    async getList({ resource, pagination, sorters, filters }) {
      const url = new URL(resourceUrl(apiRoot, resource), 'http://relative.invalid')
      url.searchParams.set('page', String(pagination?.currentPage ?? 1))
      url.searchParams.set('pageSize', String(pagination?.pageSize ?? 25))
      const sorter = sorters?.[0]
      if (sorter) {
        url.searchParams.set('sort', sorter.field)
        url.searchParams.set('order', sorter.order)
      }
      // v1 carries the one filter the cabinet's screens actually have — the
      // search box of the vendored wireframe. A general filter language over a
      // surface with one search input would be a guess about #316/#317.
      const search = filters?.find((f) => 'field' in f && f.field === 'q')
      if (search && 'value' in search && typeof search.value === 'string') {
        url.searchParams.set('q', search.value)
      }

      const body = await call<{ data: unknown[]; total: number }>(
        resource,
        `${url.pathname}${url.search}`,
        undefined,
        'list',
      )
      return { data: body.data as never, total: body.total }
    },

    async getOne({ resource, id }) {
      const body = await call<{ data: unknown }>(
        resource,
        `${resourceUrl(apiRoot, resource)}/${encodeURIComponent(String(id))}`,
        undefined,
        'one',
      )
      return { data: body.data as never }
    },

    async create({ resource, variables }) {
      const body = await call<{ data: unknown }>(
        resource,
        resourceUrl(apiRoot, resource),
        { method: 'POST', body: JSON.stringify(variables) },
        'one',
      )
      return { data: body.data as never }
    },

    async update({ resource, id, variables }) {
      const body = await call<{ data: unknown }>(
        resource,
        `${resourceUrl(apiRoot, resource)}/${encodeURIComponent(String(id))}`,
        { method: 'PATCH', body: JSON.stringify(variables) },
        'one',
      )
      return { data: body.data as never }
    },

    async deleteOne({ resource, id }) {
      const body = await call<{ data: unknown }>(
        resource,
        `${resourceUrl(apiRoot, resource)}/${encodeURIComponent(String(id))}`,
        { method: 'DELETE' },
        'one',
      )
      return { data: body.data as never }
    },
  }
}
