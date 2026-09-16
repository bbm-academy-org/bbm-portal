import type { CrudFilter, CrudSort, DataProvider, HttpError } from '@refinedev/core'

import { LIABILITIES_RESOURCE, REQUESTS_ENDPOINT, REQUESTS_RESOURCE } from './constants'
import type { RequestsSnapshot } from './request-board-contract'
import {
  selectLiabilityPage,
  selectRequestPage,
  type RequestAmountTotal,
} from './request-table-model'

/**
 * The board's data provider — `custom` for the acts, `getList` for the two
 * registers this surface reads through the whitelist's List block.
 *
 * WHY NOT THE CABINET'S. `src/lib/platform/cabinet/dataProvider.ts` speaks the
 * module API contract (`/p/api/<module>/admin/<resource>`, paged collections,
 * per-resource zod schemas). The requests surface is not a collection screen:
 * ONE authenticated GET answers with the board, its reference tables, the
 * reader's permissions and the liability view at once (`RequestsSnapshot`),
 * because a kanban that fetched five collections would render five different
 * moments of the same ledger. Reusing the cabinet provider would mean either
 * bending that endpoint into a paged resource it is not, or teaching the
 * cabinet provider a second base URL — a fork of the module-API contract for
 * one screen.
 *
 * What Refine still gives, and the reason this file exists at all rather than a
 * bare `fetch`: the query cache and its states behind `useCustom`, and the
 * notification provider behind `useCustomMutation`'s `successNotification` /
 * `errorNotification` — the SAME one feedback channel the cabinet's mutations
 * report through (#434), instead of this screen inventing its own toasts.
 *
 * WHAT CHANGED ON #388 (owner acceptance, Антон, 2026-09-15). `getList` used
 * to refuse outright, and the screen hand-built a `<Table>` out of `@/ui`
 * primitives — the whitelist violation `pnpm lint:whitelist-blocks` exists to
 * catch (`docs/design/ui-whitelist.md` → «List»). The justification recorded in
 * `RequestsTable.tsx` («the block wants a paged resource, this is one
 * snapshot») is WITHDRAWN: a register IS a paged resource, and answering
 * `getList` from the same snapshot read is four lines, not a fork of the module
 * API. `getOne` / `create` / `update` / `deleteOne` still refuse: a request is
 * written through its act endpoints, never through a CRUD verb.
 *
 * TWO READS, TWO QUESTIONS. `getList` answers «which rows, in which order, on
 * which page» — the block's question. The screen's own `useCustom` answers
 * «what may this reader do, what are the reference tables, what does BBM owe» —
 * the chrome's. Both reach the SAME address because the module answers one
 * (EARS-509), and react-query caches each by its own key.
 */

const NOT_A_COLLECTION =
  'Заявка пишется своими актами, а не CRUD-глаголом: используйте useCustom/useCustomMutation.'

const UNKNOWN_RESOURCE = 'Этот ресурс доска заявок не отдаёт.'

/** «Мои» arrives as a filter on the row's own `own` flag, and nothing else does. */
function wantsOwnOnly(filters: CrudFilter[] | undefined): boolean {
  return (filters ?? []).some(
    (filter) => 'field' in filter && filter.field === 'own' && filter.value === true,
  )
}

function sorterList(sorters: CrudSort[] | undefined): { field: string; order: 'asc' | 'desc' }[] {
  return (sorters ?? []).map((sorter) => ({ field: sorter.field, order: sorter.order }))
}

/** What the requests register answers with, beside the page itself. */
export type RequestsListResponse = {
  data: RequestsSnapshot['requests']
  total: number
  totals: RequestAmountTotal[]
  snapshot: RequestsSnapshot
}

function unsupported(): never {
  const error: HttpError = { statusCode: 501, message: NOT_A_COLLECTION }
  throw error
}

async function refusal(response: Response): Promise<HttpError> {
  const message = (await response.text().catch(() => '')).trim()
  return {
    statusCode: response.status,
    message: message === '' ? `Запрос отклонён (${response.status}).` : message,
  }
}

export function createRequestBoardDataProvider(fetchImpl: typeof fetch = fetch): DataProvider {
  return {
    getApiUrl: () => '/p/finance/api',

    async custom({ url, method, payload, headers }) {
      // Two body shapes, one channel. The act endpoints take JSON; the document
      // endpoint takes `multipart/form-data` (EARS-514) and must be handed the
      // FormData untouched — writing a `content-type` ourselves would replace
      // the boundary the runtime generates, and the server would then read an
      // empty form. Routing the upload through this provider rather than a bare
      // `fetch` is what keeps it on the ONE notification channel (#434).
      const multipart = payload instanceof FormData
      const response = await fetchImpl(url, {
        method: method.toUpperCase(),
        headers: {
          ...(method === 'get' || multipart ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(method === 'get' || payload === undefined
          ? {}
          : { body: multipart ? payload : JSON.stringify(payload) }),
        cache: 'no-store',
      })
      if (!response.ok) throw await refusal(response)
      const text = await response.text()
      return { data: (text === '' ? {} : JSON.parse(text)) as never }
    },

    async getList({ resource, pagination, filters, sorters }) {
      const response = await fetchImpl(REQUESTS_ENDPOINT, { method: 'GET', cache: 'no-store' })
      if (!response.ok) throw await refusal(response)
      const snapshot = (await response.json()) as RequestsSnapshot

      if (resource === LIABILITIES_RESOURCE) {
        // The debt register is read through the SAME List block, so it is asked
        // the same three questions and must answer all three — a sorter it
        // ignores is a control that lies, and a `total` that counts rows it has
        // already sent as `data` is a pager offering pages that do not exist.
        const page = selectLiabilityPage(snapshot.liabilities, {
          sorters: sorterList(sorters),
          currentPage: pagination?.currentPage,
          pageSize: pagination?.pageSize,
        })
        return { data: page.rows as never, total: page.total, snapshot } as never
      }

      if (resource !== REQUESTS_RESOURCE) {
        const error: HttpError = { statusCode: 404, message: UNKNOWN_RESOURCE }
        throw error
      }

      const page = selectRequestPage(snapshot.requests, {
        own: wantsOwnOnly(filters),
        sorters: sorterList(sorters),
        currentPage: pagination?.currentPage,
        pageSize: pagination?.pageSize,
      })
      return {
        data: page.rows as never,
        total: page.total,
        totals: page.totals,
        snapshot,
      } as never
    },

    getOne: unsupported,
    create: unsupported,
    update: unsupported,
    deleteOne: unsupported,
  }
}
