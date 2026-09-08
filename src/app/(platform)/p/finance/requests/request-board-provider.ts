import type { DataProvider, HttpError } from '@refinedev/core'

/**
 * The board's data provider — deliberately `custom`-only.
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
 * The CRUD methods are not implemented and say so: an accidental `useList` on
 * this surface must fail loudly at the call, not answer with an empty list.
 */

const NOT_A_COLLECTION =
  'Заявки читаются одним снимком доски, а не коллекцией ресурса: используйте useCustom/useCustomMutation.'

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

    getList: unsupported,
    getOne: unsupported,
    create: unsupported,
    update: unsupported,
    deleteOne: unsupported,
  }
}
