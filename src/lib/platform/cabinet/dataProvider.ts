import type { DataProvider, HttpError } from '@refinedev/core'

import { MODULE_LIST_MAX_PAGE_SIZE } from '../api/contract'
import {
  type CabinetResponseValidator,
  createModuleApiClient,
  MODULE_API_ROOT,
} from './moduleApiClient'

/** Refine stays responsible for collection CRUD/list calls only. */
export interface CabinetDataProviderOptions {
  validateResponse: CabinetResponseValidator
  fetchImpl?: typeof fetch
  apiRoot?: string
}

function httpError(statusCode: number, message: string): HttpError {
  return { statusCode, message }
}

function resourcePath(resource: string): string {
  const [slug, ...rest] = resource.split('.')
  if (!slug || rest.length === 0) {
    throw httpError(
      500,
      `Ресурс кабинета «${resource}» назван не в форме <модуль>.<ресурс> — URL построить нельзя.`,
    )
  }
  return `/${slug}/admin/${rest.join('/')}`
}

export function createCabinetDataProvider(options: CabinetDataProviderOptions): DataProvider {
  const apiRoot = options.apiRoot ?? MODULE_API_ROOT
  const client = createModuleApiClient({ ...options, apiRoot })

  return {
    getApiUrl: () => apiRoot,

    async getList({ resource, pagination, sorters, filters }) {
      const url = new URL(resourcePath(resource), 'http://relative.invalid')
      if ((sorters?.length ?? 0) > 1) {
        throw httpError(400, 'sort: кабинет поддерживает только одно поле сортировки.')
      }
      const sorter = sorters?.[0]
      if (sorter) {
        url.searchParams.set('sort', sorter.field)
        url.searchParams.set('order', sorter.order)
      }

      const unsupported = filters?.filter(
        (filter) =>
          !(
            'field' in filter &&
            filter.field === 'q' &&
            'value' in filter &&
            typeof filter.value === 'string'
          ),
      )
      if (unsupported?.length) {
        const fields = unsupported.map((filter) =>
          'field' in filter ? String(filter.field) : 'group',
        )
        throw httpError(400, `filters: поля ${fields.join(', ')} не поддерживаются.`)
      }
      const search = filters?.find((filter) => 'field' in filter && filter.field === 'q')
      if (search && 'value' in search && typeof search.value === 'string') {
        url.searchParams.set('q', search.value)
      }

      async function loadPage(page: number, pageSize: number) {
        url.searchParams.set('page', String(page))
        url.searchParams.set('pageSize', String(pageSize))
        return client.list<unknown>({ resource, path: `${url.pathname}${url.search}` })
      }

      if (pagination?.mode !== 'off') {
        const body = await loadPage(pagination?.currentPage ?? 1, pagination?.pageSize ?? 25)
        return { data: body.data as never, total: body.total }
      }

      const data: unknown[] = []
      let page = 1
      let expectedTotal = 0
      do {
        const body = await loadPage(page, MODULE_LIST_MAX_PAGE_SIZE)
        expectedTotal = Math.max(expectedTotal, body.total)
        data.push(...body.data)
        if (body.data.length === 0 && data.length < expectedTotal) {
          throw httpError(
            500,
            `Ответ «${resource}» завершился до загрузки всех ${expectedTotal} записей.`,
          )
        }
        page += 1
      } while (data.length < expectedTotal)

      return { data: data as never, total: data.length }
    },

    async getOne({ resource, id }) {
      const data = await client.one<unknown>({
        resource,
        path: `${resourcePath(resource)}/${encodeURIComponent(String(id))}`,
      })
      return { data: data as never }
    },

    async create({ resource, variables }) {
      const data = await client.one<unknown>({
        resource,
        path: resourcePath(resource),
        init: { method: 'POST', body: JSON.stringify(variables) },
      })
      return { data: data as never }
    },

    async update({ resource, id, variables }) {
      const data = await client.one<unknown>({
        resource,
        path: `${resourcePath(resource)}/${encodeURIComponent(String(id))}`,
        init: { method: 'PATCH', body: JSON.stringify(variables) },
      })
      return { data: data as never }
    },

    async deleteOne({ resource, id }) {
      const data = await client.one<unknown>({
        resource,
        path: `${resourcePath(resource)}/${encodeURIComponent(String(id))}`,
        init: { method: 'DELETE' },
      })
      return { data: data as never }
    },
  }
}
