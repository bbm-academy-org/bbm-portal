import { ZodError } from 'zod'

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
  financeAccountRecordSchema,
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
  updateReferenceRow,
  type FinanceActor,
  type FinanceReferenceRecord,
  type FinanceReferenceResource,
} from '@/lib/finance'
import { moduleListResult, ModuleApiError, type ModuleRouteContext } from '@/lib/platform/api'
import { sessionRoles } from '@/lib/platform/authGate'

type ResourceContext = ModuleRouteContext<unknown>

function actor(ctx: ResourceContext): FinanceActor {
  if (!ctx.audit.actorEmail) {
    throw new ModuleApiError('forbidden', 'Не удалось определить автора изменения.')
  }
  return { email: ctx.audit.actorEmail, roles: sessionRoles(ctx.session) }
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
  return financeAccountRecordSchema.parse({ ...row, retiredAt: iso(row.retiredAt) })
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

/**
 * One admin act — the rename and the retirement it carries — is ONE module call
 * and therefore ONE transaction (EARS-326). See `updateReferenceRow` in
 * `src/lib/finance/references.ts`: a refused retirement must take the rename
 * down with it instead of leaving a durable half-act behind a 409.
 */
async function update(
  resource: FinanceReferenceResource,
  id: string | number,
  ctx: ResourceContext,
): Promise<FinanceReferenceRecord> {
  const by = actor(ctx)
  // The route's input schema is `z.unknown()`, so a `null`, a number or an array
  // reaches here; every branch below reads the body as an object.
  if (typeof ctx.body !== 'object' || ctx.body === null || Array.isArray(ctx.body)) {
    throw new ModuleApiError(
      'bad-request',
      'Тело запроса должно быть объектом с изменениями справочника.',
    )
  }
  switch (resource) {
    case 'currencies': {
      const { retire, ...patch } = financeCurrencyUpdateSchema.parse(ctx.body)
      return serializeCurrency(
        (await updateReferenceRow(by, {
          table: 'currency',
          id,
          patch,
          retire,
        })) as Awaited<ReturnType<typeof listCurrencies>>[number],
      )
    }
    case 'accounts': {
      const { retire, ...patch } = financeAccountUpdateSchema.parse(ctx.body)
      return serializeAccount(
        (await updateReferenceRow(by, { table: 'account', id, patch, retire })) as Awaited<
          ReturnType<typeof listAccounts>
        >[number],
      )
    }
    case 'projects': {
      const { retire, ...patch } = financeProjectUpdateSchema.parse(ctx.body)
      return serializeProject(
        (await updateReferenceRow(by, { table: 'project', id, patch, retire })) as Awaited<
          ReturnType<typeof listProjects>
        >[number],
      )
    }
    case 'products': {
      const { retire, salePrice, ...changes } = financeProductUpdateSchema.parse(ctx.body)
      const patch = {
        ...changes,
        ...(salePrice === undefined
          ? {}
          : { salePrice: salePrice === null ? null : BigInt(salePrice) }),
      }
      return serializeProduct(
        (await updateReferenceRow(by, { table: 'product', id, patch, retire })) as Awaited<
          ReturnType<typeof listProducts>
        >[number],
      )
    }
    case 'purposes': {
      const { retire, ...patch } = financePurposeUpdateSchema.parse(ctx.body)
      return serializePurpose(
        (await updateReferenceRow(by, { table: 'purpose', id, patch, retire })) as Awaited<
          ReturnType<typeof listPurposes>
        >[number],
      )
    }
    case 'categories': {
      const { retire, ...patch } = financeCategoryUpdateSchema.parse(ctx.body)
      return serializeCategory(
        (await updateReferenceRow(by, { table: 'category', id, patch, retire })) as Awaited<
          ReturnType<typeof listCategories>
        >[number],
      )
    }
  }
}

/**
 * A single-row read served from the full list.
 *
 * Deliberate at reference-table cardinality: six tables of tens of rows, one
 * serializer per resource, and the alternative is six more per-id module reads
 * for no measurable gain. If a reference table ever grows into the thousands
 * this is the line to revisit.
 */
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
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((issue) => `${issue.path.join('.') || 'запись'}: ${issue.message}`)
        .join('; ')
      throw new ModuleApiError('bad-request', `Проверьте поля справочника: ${issues}`)
    }
    if (error instanceof FinanceAccessRefusal) throw new ModuleApiError('forbidden', error.message)
    if (error instanceof FinanceRefusal) throw new ModuleApiError('conflict', error.message)
    throw error
  }
}

function contextResource(ctx: ResourceContext): FinanceReferenceResource {
  const resource = String(ctx.params.resource ?? '')
  if (!isFinanceReferenceResource(resource)) {
    throw new ModuleApiError('not-found', `Справочник «${resource}» не найден.`)
  }
  return resource
}

/**
 * The fields the search box searches — the ones an admin can actually SEE.
 *
 * Matching `JSON.stringify(row)` matched field NAMES and serialized internals
 * too, so `q=id`, `q=name` or `q=true` returned the whole table as if every row
 * were a hit.
 */
const SEARCHABLE_FIELDS: Record<FinanceReferenceResource, readonly string[]> = {
  currencies: ['code', 'name'],
  accounts: ['name', 'kind', 'currency'],
  projects: ['name'],
  products: ['name'],
  purposes: ['name'],
  categories: ['name'],
}

function matchesQuery(
  resource: FinanceReferenceResource,
  row: FinanceReferenceRecord,
  q: string,
): boolean {
  return SEARCHABLE_FIELDS[resource].some((field) => {
    const value = (row as Record<string, unknown>)[field]
    return typeof value === 'string' && value.toLocaleLowerCase('ru').includes(q)
  })
}

export async function listFinanceReferences(ctx: ModuleRouteContext<undefined>) {
  const resource = contextResource(ctx)
  const all = await readable(() => list(resource))
  const q = ctx.query.q?.trim().toLocaleLowerCase('ru')
  const filtered = q ? all.filter((row) => matchesQuery(resource, row, q)) : all
  const start = (ctx.query.page - 1) * ctx.query.pageSize
  return moduleListResult({
    items: filtered.slice(start, start + ctx.query.pageSize),
    total: filtered.length,
  })
}

export async function createFinanceReference(ctx: ResourceContext) {
  const resource = contextResource(ctx)
  return readable(() => create(resource, ctx))
}

export async function getFinanceReference(ctx: ModuleRouteContext<undefined>) {
  const resource = contextResource(ctx)
  const id = referenceId(resource, String(ctx.params.id ?? ''))
  const found = await readable(() => get(resource, id))
  if (!found) throw new ModuleApiError('not-found', 'Запись справочника не найдена.')
  return found
}

export async function updateFinanceReference(ctx: ResourceContext) {
  const resource = contextResource(ctx)
  const id = referenceId(resource, String(ctx.params.id ?? ''))
  return readable(() => update(resource, id, ctx))
}

export async function deleteFinanceReference(ctx: ModuleRouteContext<undefined>) {
  const resource = contextResource(ctx)
  const id = referenceId(resource, String(ctx.params.id ?? ''))
  return readable(() => remove(resource, id, ctx))
}
