import type { z } from 'zod'

import {
  createAccount,
  createCategory,
  createCurrency,
  createProduct,
  createProject,
  createPurpose,
  deleteReferenceRow,
  FinanceAccessRefusal,
  FinanceRefusal,
  financeAccountCreateSchema,
  financeAccountUpdateSchema,
  financeCategoryCreateSchema,
  financeCategoryUpdateSchema,
  financeCurrencyCreateSchema,
  financeCurrencyUpdateSchema,
  financeProductCreateSchema,
  financeProductUpdateSchema,
  financeProjectCreateSchema,
  financeProjectUpdateSchema,
  financePurposeCreateSchema,
  financePurposeUpdateSchema,
  financeReferenceContracts,
  isFinanceReferenceResource,
  listAccounts,
  listCategories,
  listCurrencies,
  listProducts,
  listProjects,
  listPurposes,
  retireReferenceRow,
  updateAccount,
  updateCategory,
  updateCurrency,
  updateProduct,
  updateProject,
  updatePurpose,
  type FinanceActor,
  type FinanceReferenceRecord,
  type FinanceReferenceResource,
} from '@/lib/finance'
import {
  adminRoute,
  moduleListResult,
  ModuleApiError,
  type ModuleRouteContext,
  type ModuleRouteHandler,
  type RouteSegment,
} from '@/lib/platform/api'

type ResourceContext = ModuleRouteContext<unknown>

function actor(ctx: ResourceContext): FinanceActor {
  return { email: ctx.audit.actorEmail, roles: ctx.session.user?.roles ?? [] }
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function referenceId(resource: FinanceReferenceResource, raw: string): string | number {
  if (resource === 'currencies') {
    if (!raw.trim()) throw new ModuleApiError('bad-request', 'Укажите код валюты.')
    return raw.trim().toUpperCase()
  }
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModuleApiError('bad-request', 'Укажите положительный целочисленный id.')
  }
  return id
}

function serializeCurrency(row: Awaited<ReturnType<typeof listCurrencies>>[number]) {
  return { ...row, id: row.code, retiredAt: iso(row.retiredAt) }
}
function serializeAccount(row: Awaited<ReturnType<typeof listAccounts>>[number]) {
  return { ...row, retiredAt: iso(row.retiredAt) }
}
function serializeProject(row: Awaited<ReturnType<typeof listProjects>>[number]) {
  return { ...row, retiredAt: iso(row.retiredAt) }
}
function serializeProduct(row: Awaited<ReturnType<typeof listProducts>>[number]) {
  return { ...row, salePrice: row.salePrice?.toString() ?? null, retiredAt: iso(row.retiredAt) }
}
function serializePurpose(row: Awaited<ReturnType<typeof listPurposes>>[number]) {
  return { ...row, retiredAt: iso(row.retiredAt) }
}
function serializeCategory(row: Awaited<ReturnType<typeof listCategories>>[number]) {
  return { ...row, retiredAt: iso(row.retiredAt) }
}

async function list(resource: FinanceReferenceResource): Promise<FinanceReferenceRecord[]> {
  switch (resource) {
    case 'currencies':
      return (await listCurrencies({ includeRetired: true })).map(serializeCurrency)
    case 'accounts':
      return (await listAccounts({ includeRetired: true })).map(serializeAccount)
    case 'projects':
      return (await listProjects({ includeRetired: true })).map(serializeProject)
    case 'products':
      return (await listProducts({ includeRetired: true })).map(serializeProduct)
    case 'purposes':
      return (await listPurposes({ includeRetired: true })).map(serializePurpose)
    case 'categories':
      return (await listCategories({ includeRetired: true })).map(serializeCategory)
  }
}

async function create(
  resource: FinanceReferenceResource,
  ctx: ResourceContext,
): Promise<FinanceReferenceRecord> {
  const by = actor(ctx)
  switch (resource) {
    case 'currencies':
      return serializeCurrency(
        await createCurrency(by, financeCurrencyCreateSchema.parse(ctx.body)),
      )
    case 'accounts':
      return serializeAccount(await createAccount(by, financeAccountCreateSchema.parse(ctx.body)))
    case 'projects':
      return serializeProject(await createProject(by, financeProjectCreateSchema.parse(ctx.body)))
    case 'products': {
      const input = financeProductCreateSchema.parse(ctx.body)
      return serializeProduct(
        await createProduct(by, {
          ...input,
          salePrice:
            input.salePrice === undefined || input.salePrice === null
              ? null
              : BigInt(input.salePrice),
          salePriceCurrency: input.salePriceCurrency ?? null,
        }),
      )
    }
    case 'purposes':
      return serializePurpose(await createPurpose(by, financePurposeCreateSchema.parse(ctx.body)))
    case 'categories':
      return serializeCategory(
        await createCategory(by, financeCategoryCreateSchema.parse(ctx.body)),
      )
  }
}

async function update(
  resource: FinanceReferenceResource,
  id: string | number,
  ctx: ResourceContext,
): Promise<FinanceReferenceRecord> {
  const by = actor(ctx)
  let result: FinanceReferenceRecord
  switch (resource) {
    case 'currencies': {
      const { retire, ...changes } = financeCurrencyUpdateSchema.parse(ctx.body)
      result = serializeCurrency(await updateCurrency(by, String(id), changes))
      if (retire) await retireReferenceRow(by, 'currency', id)
      break
    }
    case 'accounts': {
      const { retire, ...changes } = financeAccountUpdateSchema.parse(ctx.body)
      result = serializeAccount(await updateAccount(by, Number(id), changes))
      if (retire) await retireReferenceRow(by, 'account', id)
      break
    }
    case 'projects': {
      const { retire, ...changes } = financeProjectUpdateSchema.parse(ctx.body)
      result = serializeProject(await updateProject(by, Number(id), changes))
      if (retire) await retireReferenceRow(by, 'project', id)
      break
    }
    case 'products': {
      const { retire, salePrice, ...changes } = financeProductUpdateSchema.parse(ctx.body)
      result = serializeProduct(
        await updateProduct(by, Number(id), {
          ...changes,
          ...(salePrice === undefined
            ? {}
            : { salePrice: salePrice === null ? null : BigInt(salePrice) }),
        }),
      )
      if (retire) await retireReferenceRow(by, 'product', id)
      break
    }
    case 'purposes': {
      const { retire, ...changes } = financePurposeUpdateSchema.parse(ctx.body)
      result = serializePurpose(await updatePurpose(by, Number(id), changes))
      if (retire) await retireReferenceRow(by, 'purpose', id)
      break
    }
    case 'categories': {
      const { retire, ...changes } = financeCategoryUpdateSchema.parse(ctx.body)
      result = serializeCategory(await updateCategory(by, Number(id), changes))
      if (retire) await retireReferenceRow(by, 'category', id)
      break
    }
  }
  if (!('retire' in (ctx.body as object))) return result
  return (await get(resource, id)) ?? result
}

async function get(
  resource: FinanceReferenceResource,
  id: string | number,
): Promise<FinanceReferenceRecord | undefined> {
  return (await list(resource)).find((record) => String(record.id) === String(id))
}

async function remove(
  resource: FinanceReferenceResource,
  id: string | number,
  ctx: ResourceContext,
): Promise<FinanceReferenceRecord> {
  const current = await get(resource, id)
  if (!current) throw new ModuleApiError('not-found', 'Запись справочника не найдена.')
  await deleteReferenceRow(actor(ctx), financeReferenceContracts[resource].table, id)
  return current
}

async function readable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof FinanceAccessRefusal) throw new ModuleApiError('forbidden', error.message)
    if (error instanceof FinanceRefusal) throw new ModuleApiError('conflict', error.message)
    throw error
  }
}

function recordSchema(resource: FinanceReferenceResource): z.ZodType<FinanceReferenceRecord> {
  return financeReferenceContracts[resource].record as z.ZodType<FinanceReferenceRecord>
}

const collection = Object.fromEntries(
  (Object.keys(financeReferenceContracts) as FinanceReferenceResource[]).map((resource) => [
    resource,
    {
      GET: adminRoute<undefined, FinanceReferenceRecord>({
        output: recordSchema(resource),
        handler: async ({ query }) => {
          const all = await readable(() => list(resource))
          const q = query.q?.trim().toLocaleLowerCase('ru')
          const filtered = q
            ? all.filter((row) => JSON.stringify(row).toLocaleLowerCase('ru').includes(q))
            : all
          const start = (query.page - 1) * query.pageSize
          return moduleListResult({
            items: filtered.slice(start, start + query.pageSize),
            total: filtered.length,
          })
        },
      }),
      POST: adminRoute<unknown, FinanceReferenceRecord>({
        input: financeReferenceContracts[resource].create as z.ZodType<unknown>,
        output: recordSchema(resource),
        handler: async (ctx) => readable(() => create(resource, ctx)),
      }),
    },
  ]),
) as Record<FinanceReferenceResource, { GET: ModuleRouteHandler; POST: ModuleRouteHandler }>

const item = Object.fromEntries(
  (Object.keys(financeReferenceContracts) as FinanceReferenceResource[]).map((resource) => [
    resource,
    {
      GET: adminRoute<undefined, FinanceReferenceRecord>({
        output: recordSchema(resource),
        handler: async ({ params }) => {
          const id = referenceId(resource, String(params.id ?? ''))
          const found = await readable(() => get(resource, id))
          if (!found) throw new ModuleApiError('not-found', 'Запись справочника не найдена.')
          return found
        },
      }),
      PATCH: adminRoute<unknown, FinanceReferenceRecord>({
        input: financeReferenceContracts[resource].update as z.ZodType<unknown>,
        output: recordSchema(resource),
        handler: async (ctx) => {
          const id = referenceId(resource, String(ctx.params.id ?? ''))
          return readable(() => update(resource, id, ctx))
        },
      }),
      DELETE: adminRoute<undefined, FinanceReferenceRecord>({
        output: recordSchema(resource),
        handler: async (ctx) => {
          const id = referenceId(resource, String(ctx.params.id ?? ''))
          return readable(() => remove(resource, id, ctx))
        },
      }),
    },
  ]),
) as Record<
  FinanceReferenceResource,
  { GET: ModuleRouteHandler; PATCH: ModuleRouteHandler; DELETE: ModuleRouteHandler }
>

async function selected(
  segment: RouteSegment | undefined,
): Promise<FinanceReferenceResource | Response> {
  const resource = String((await segment?.params)?.resource ?? '')
  return isFinanceReferenceResource(resource)
    ? resource
    : Response.json(
        { error: { code: 'not-found', message: `Справочник «${resource}» не найден.` } },
        { status: 404 },
      )
}

export async function collectionRoute(
  method: 'GET' | 'POST',
  request: Request,
  segment?: RouteSegment,
): Promise<Response> {
  const resource = await selected(segment)
  return resource instanceof Response ? resource : collection[resource][method](request, segment)
}

export async function itemRoute(
  method: 'GET' | 'PATCH' | 'DELETE',
  request: Request,
  segment?: RouteSegment,
): Promise<Response> {
  const resource = await selected(segment)
  return resource instanceof Response ? resource : item[resource][method](request, segment)
}
