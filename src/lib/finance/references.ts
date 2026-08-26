/**
 * The reference tables (справочники) — spec 338 EARS-301…309.
 *
 * Every write here runs through `platformTransaction` with the signed-in admin
 * as actor, so the who/when/what of a reference edit lands in `core.audit_event`
 * (spec 201, and Accounting policy ruling 2: F1 adds NO journal of its own on
 * top of it — a second log of the same fact drifts). Every write also passes the
 * `platform-admin` gate first (EARS-330), inside the module, so the refusal does
 * not depend on which surface the call arrived through.
 *
 * The two structural rules that shape this file:
 *
 *  - **Retire, never delete, anything that history refers to** (EARS-308). A
 *    hard delete is offered only for a row nothing points at; otherwise the
 *    refusal names retirement. A retired row stays valid on every posting
 *    already recorded and stops being offered for new ones (enforced where new
 *    ones are made — `./operations.ts`).
 *  - **A reference edit never rewrites a posting** (EARS-309/332). Renames and
 *    retirements change how rows READ going forward; nothing here touches
 *    `finance_posting`, and the database would refuse it anyway (EARS-313).
 */
import { and, eq, isNull, sql } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'
import { financeAccount } from '@/lib/platform/db/schema/finance/finance-account'
import type {
  FinanceMoneyAccountKind,
  FinanceSystemAccountKind,
} from '@/lib/platform/db/schema/finance/finance-account'
import { financeCategory } from '@/lib/platform/db/schema/finance/finance-category'
import { financeCurrency } from '@/lib/platform/db/schema/finance/finance-currency'
import { financePosting } from '@/lib/platform/db/schema/finance/finance-posting'
import { financeProduct } from '@/lib/platform/db/schema/finance/finance-product'
import { financeProject } from '@/lib/platform/db/schema/finance/finance-project'
import { financePurpose } from '@/lib/platform/db/schema/finance/finance-purpose'
import type { FinanceProductBinding } from '@/lib/platform/db/schema/finance/finance-purpose'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { assertFinanceWriteAccess, financeAuditContext, type FinanceActor } from './core/actor'
import { FinanceRefusal } from './core/errors'

export type FinanceCurrencyView = {
  code: string
  name: string
  precision: number
  retiredAt: Date | null
}
export type FinanceAccountView = {
  id: number
  name: string
  kind: string
  currency: string
  isSystem: boolean
  retiredAt: Date | null
}
export type FinanceProjectView = {
  id: number
  name: string
  isFund: boolean
  retiredAt: Date | null
}
export type FinanceProductView = {
  id: number
  projectId: number
  name: string
  salePrice: bigint | null
  salePriceCurrency: string | null
  retiredAt: Date | null
}
export type FinancePurposeView = {
  id: number
  name: string
  categoryId: number | null
  productBinding: FinanceProductBinding
  retiredAt: Date | null
}
export type FinanceCategoryView = {
  id: number
  name: string
  allocable: boolean
  retiredAt: Date | null
}

/** The six resources the cabinet maintains (spec 338, CRUD check). */
export const FINANCE_REFERENCE_TABLES = [
  'currency',
  'account',
  'project',
  'product',
  'purpose',
  'category',
] as const
export type FinanceReferenceTable = (typeof FINANCE_REFERENCE_TABLES)[number]

type ListOptions = { includeRetired?: boolean }

// ── reads ────────────────────────────────────────────────────────────────────
//
// Reading takes no actor: EARS-330 narrows WRITES, and EARS-325 opens reading to
// every platform member. The surface, not this module, decides who may look.

export async function listCurrencies(options: ListOptions = {}): Promise<FinanceCurrencyView[]> {
  const db = getPlatformDb()
  const rows = await db.select().from(financeCurrency)
  return rows
    .filter((row) => options.includeRetired === true || row.retiredAt === null)
    .sort((a, b) => a.code.localeCompare(b.code))
}

export async function listAccounts(options: ListOptions = {}): Promise<FinanceAccountView[]> {
  const db = getPlatformDb()
  const rows = await db.select().from(financeAccount)
  return rows
    .filter((row) => options.includeRetired === true || row.retiredAt === null)
    .sort((a, b) => a.id - b.id)
}

export async function listProjects(options: ListOptions = {}): Promise<FinanceProjectView[]> {
  const db = getPlatformDb()
  const rows = await db.select().from(financeProject)
  return rows
    .filter((row) => options.includeRetired === true || row.retiredAt === null)
    .sort((a, b) => a.id - b.id)
}

export async function listProducts(options: ListOptions = {}): Promise<FinanceProductView[]> {
  const db = getPlatformDb()
  const rows = await db.select().from(financeProduct)
  return rows
    .filter((row) => options.includeRetired === true || row.retiredAt === null)
    .sort((a, b) => a.id - b.id)
}

export async function listPurposes(options: ListOptions = {}): Promise<FinancePurposeView[]> {
  const db = getPlatformDb()
  const rows = await db.select().from(financePurpose)
  return rows
    .filter((row) => options.includeRetired === true || row.retiredAt === null)
    .map((row) => ({ ...row, productBinding: row.productBinding as FinanceProductBinding }))
    .sort((a, b) => a.id - b.id)
}

export async function listCategories(options: ListOptions = {}): Promise<FinanceCategoryView[]> {
  const db = getPlatformDb()
  const rows = await db.select().from(financeCategory)
  return rows
    .filter((row) => options.includeRetired === true || row.retiredAt === null)
    .sort((a, b) => a.id - b.id)
}

// ── writes ───────────────────────────────────────────────────────────────────

function requireName(name: unknown, what: string): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new FinanceRefusal(`${what} без названия не создать: название обязательно.`)
  }
  return name.trim()
}

/** EARS-302 — a currency added with its precision accepts postings immediately. */
export async function createCurrency(
  actor: FinanceActor,
  input: { code: string; name: string; precision: number },
): Promise<FinanceCurrencyView> {
  assertFinanceWriteAccess(actor)
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  if (code === '') throw new FinanceRefusal('Код валюты обязателен (например RUB, THB, USDT).')
  if (!Number.isInteger(input.precision) || input.precision < 0 || input.precision > 18) {
    throw new FinanceRefusal(
      `Точность «${input.precision}» недопустима: это целое число знаков после запятой ` +
        'у минимальной единицы, от 0 до 18 (RUB 2, THB 2, USDT 6).',
    )
  }
  const name = requireName(input.name, 'Валюту')
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const existing = await tx.select().from(financeCurrency).where(eq(financeCurrency.code, code))
    if (existing.length > 0) {
      throw new FinanceRefusal(`Валюта ${code} уже есть в справочнике.`)
    }
    const [row] = await tx
      .insert(financeCurrency)
      .values({ code, name, precision: input.precision })
      .returning()
    return row as FinanceCurrencyView
  })
}

/**
 * EARS-303 — the precision is FROZEN once a posting exists in the currency.
 *
 * Checked against `finance_posting`, not against «has anything ever referenced
 * this row»: an account denominated in the currency is not yet a recorded
 * amount, and until an amount exists there is nothing a precision change could
 * restate.
 */
export async function updateCurrency(
  actor: FinanceActor,
  code: string,
  patch: { name?: string; precision?: number },
): Promise<FinanceCurrencyView> {
  assertFinanceWriteAccess(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireCurrency(tx, code)
    const next: Partial<typeof financeCurrency.$inferInsert> = {}
    if (patch.name !== undefined) next.name = requireName(patch.name, 'Валюту')
    if (patch.precision !== undefined && patch.precision !== current.precision) {
      const used = await countPostingsInCurrency(tx, code)
      if (used > 0) {
        throw new FinanceRefusal(
          `Точность валюты ${code} изменить нельзя: в ней уже записано проводок — ${used} (EARS-303). ` +
            'Точность — это показатель степени, которым сохранённая сумма превращается в число; ' +
            'сменить её задним числом значит переписать каждую уже записанную сумму.',
        )
      }
      next.precision = patch.precision
    }
    if (Object.keys(next).length === 0) return current
    const [row] = await tx
      .update(financeCurrency)
      .set(next)
      .where(eq(financeCurrency.code, code))
      .returning()
    return row as FinanceCurrencyView
  })
}

/** EARS-305 — the cabinet creates MONEY accounts only; system kinds are ours. */
export async function createAccount(
  actor: FinanceActor,
  input: { name: string; kind: FinanceMoneyAccountKind; currency: string },
): Promise<FinanceAccountView> {
  assertFinanceWriteAccess(actor)
  const name = requireName(input.name, 'Счёт')
  if (!(['bank', 'card', 'crypto', 'cash'] as string[]).includes(input.kind)) {
    throw new FinanceRefusal(
      `Счёт вида «${input.kind}» создать нельзя: системные счета (income, expense, conversion, ` +
        'fx_result, liability) модуль заводит сам, по одному на вид и валюту, при первой ' +
        'надобности (EARS-305). Вручную создаются только денежные: bank, card, crypto, cash.',
    )
  }
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    await requireCurrency(tx, input.currency)
    const [row] = await tx
      .insert(financeAccount)
      .values({ name, kind: input.kind, currency: input.currency, isSystem: false })
      .returning()
    return row as FinanceAccountView
  })
}

/** EARS-305 — a system account is never edited from the cabinet. */
export async function updateAccount(
  actor: FinanceActor,
  id: number,
  patch: { name?: string },
): Promise<FinanceAccountView> {
  assertFinanceWriteAccess(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireAccount(tx, id)
    if (current.isSystem) {
      throw new FinanceRefusal(
        `Счёт «${current.name}» системный: модуль ведёт его сам, и переименовать его из кабинета нельзя (EARS-305).`,
      )
    }
    if (patch.name === undefined) return current
    const [row] = await tx
      .update(financeAccount)
      .set({ name: requireName(patch.name, 'Счёт') })
      .where(eq(financeAccount.id, id))
      .returning()
    return row as FinanceAccountView
  })
}

/**
 * EARS-305 — the system account for a (kind, currency), created on first need.
 *
 * `ensureSystemAccount` is the in-transaction form the fact core calls; the
 * exported wrapper opens its own transaction for a caller that has none. The
 * `on conflict do nothing` + re-select shape is deliberate: the unique index on
 * (kind, currency) is what makes «one per kind and currency» true even when two
 * first-needs race, and this is how the loser of that race finds the winner's
 * row instead of failing.
 */
export async function ensureSystemAccount(
  tx: PlatformTx,
  kind: FinanceSystemAccountKind,
  currency: string,
): Promise<FinanceAccountView> {
  await requireCurrency(tx, currency)
  await tx
    .insert(financeAccount)
    .values({
      name: `${kind}:${currency}`,
      kind,
      currency,
      isSystem: true,
    })
    .onConflictDoNothing()
  const [row] = await tx
    .select()
    .from(financeAccount)
    .where(
      and(
        eq(financeAccount.kind, kind),
        eq(financeAccount.currency, currency),
        eq(financeAccount.isSystem, true),
      ),
    )
  if (row === undefined) {
    throw new FinanceRefusal(`Системный счёт ${kind}/${currency} не удалось создать.`)
  }
  return row as FinanceAccountView
}

export async function systemAccount(
  actor: FinanceActor,
  kind: FinanceSystemAccountKind,
  currency: string,
): Promise<FinanceAccountView> {
  assertFinanceWriteAccess(actor)
  return platformTransaction(financeAuditContext(actor), (tx) =>
    ensureSystemAccount(tx, kind, currency),
  )
}

/**
 * EARS-304 — a project is created; the fund row is not, it was seeded.
 *
 * `is_fund` is not a parameter and a caller that offers one is refused rather
 * than quietly ignored: exactly one fund row exists, the migration made it, and
 * a second one would silently split «всё, что не отнесено к проекту» in two.
 * The partial unique index behind this is the accident guard.
 */
export async function createProject(
  actor: FinanceActor,
  input: { name: string },
): Promise<FinanceProjectView> {
  assertFinanceWriteAccess(actor)
  if ('isFund' in input || 'is_fund' in input) {
    throw new FinanceRefusal(
      'Строка фонда в справочнике ровно одна — «Фонд BBM», её создаёт миграция (EARS-304). ' +
        'Второй фонд завести нельзя, и признак is_fund не принимается при создании проекта.',
    )
  }
  const name = requireName(input.name, 'Проект')
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const [row] = await tx.insert(financeProject).values({ name, isFund: false }).returning()
    return row as FinanceProjectView
  })
}

export async function updateProject(
  actor: FinanceActor,
  id: number,
  patch: { name?: string },
): Promise<FinanceProjectView> {
  assertFinanceWriteAccess(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireProject(tx, id)
    if (patch.name === undefined) return current
    const [row] = await tx
      .update(financeProject)
      .set({ name: requireName(patch.name, 'Проект') })
      .where(eq(financeProject.id, id))
      .returning()
    return row as FinanceProjectView
  })
}

export async function createProduct(
  actor: FinanceActor,
  input: {
    projectId: number
    name: string
    salePrice?: bigint | null
    salePriceCurrency?: string | null
  },
): Promise<FinanceProductView> {
  assertFinanceWriteAccess(actor)
  const name = requireName(input.name, 'Продукт')
  const salePrice = input.salePrice ?? null
  const salePriceCurrency = input.salePriceCurrency ?? null
  if ((salePrice === null) !== (salePriceCurrency === null)) {
    throw new FinanceRefusal('Цена продукта задаётся вместе с валютой: сумма без валюты — не цена.')
  }
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    await requireProject(tx, input.projectId)
    if (salePriceCurrency !== null) await requireCurrency(tx, salePriceCurrency)
    const [row] = await tx
      .insert(financeProduct)
      .values({ projectId: input.projectId, name, salePrice, salePriceCurrency })
      .returning()
    return row as FinanceProductView
  })
}

export async function updateProduct(
  actor: FinanceActor,
  id: number,
  patch: { name?: string; salePrice?: bigint | null; salePriceCurrency?: string | null },
): Promise<FinanceProductView> {
  assertFinanceWriteAccess(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireProduct(tx, id)
    const next: Partial<typeof financeProduct.$inferInsert> = {}
    if (patch.name !== undefined) next.name = requireName(patch.name, 'Продукт')
    const salePrice = patch.salePrice === undefined ? current.salePrice : patch.salePrice
    const salePriceCurrency =
      patch.salePriceCurrency === undefined ? current.salePriceCurrency : patch.salePriceCurrency
    if ((salePrice === null) !== (salePriceCurrency === null)) {
      throw new FinanceRefusal(
        'Цена продукта задаётся вместе с валютой: сумма без валюты — не цена.',
      )
    }
    if (patch.salePrice !== undefined) next.salePrice = salePrice
    if (patch.salePriceCurrency !== undefined) {
      if (salePriceCurrency !== null) await requireCurrency(tx, salePriceCurrency)
      next.salePriceCurrency = salePriceCurrency
    }
    if (Object.keys(next).length === 0) return current
    const [row] = await tx
      .update(financeProduct)
      .set(next)
      .where(eq(financeProduct.id, id))
      .returning()
    return row as FinanceProductView
  })
}

/**
 * EARS-306 — the binding is declared AT CREATION, and the category link is
 * required as soon as there is a category list to link to.
 */
export async function createPurpose(
  actor: FinanceActor,
  input: { name: string; productBinding: FinanceProductBinding; categoryId?: number | null },
): Promise<FinancePurposeView> {
  assertFinanceWriteAccess(actor)
  const name = requireName(input.name, 'Назначение')
  assertKnownBinding(input.productBinding)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const categoryId = await resolveRequiredCategory(tx, input.categoryId ?? null, name)
    const [row] = await tx
      .insert(financePurpose)
      .values({ name, productBinding: input.productBinding, categoryId })
      .returning()
    return { ...row, productBinding: row.productBinding as FinanceProductBinding }
  })
}

/**
 * EARS-331/332 — changing a binding is an edit of the PURPOSE (admin only), and
 * it leaves every already-recorded posting exactly as posted. Nothing in this
 * function reads or re-validates `finance_posting`; a reclassification path
 * arrives with F2.
 */
export async function updatePurpose(
  actor: FinanceActor,
  id: number,
  patch: { name?: string; categoryId?: number | null; productBinding?: FinanceProductBinding },
): Promise<FinancePurposeView> {
  assertFinanceWriteAccess(actor)
  if (patch.productBinding !== undefined) assertKnownBinding(patch.productBinding)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requirePurpose(tx, id)
    const next: Partial<typeof financePurpose.$inferInsert> = {}
    if (patch.name !== undefined) next.name = requireName(patch.name, 'Назначение')
    if (patch.productBinding !== undefined) next.productBinding = patch.productBinding
    if (patch.categoryId !== undefined) {
      next.categoryId = await resolveRequiredCategory(tx, patch.categoryId, current.name)
    }
    if (Object.keys(next).length === 0) return current
    const [row] = await tx
      .update(financePurpose)
      .set(next)
      .where(eq(financePurpose.id, id))
      .returning()
    return { ...row, productBinding: row.productBinding as FinanceProductBinding }
  })
}

/**
 * EARS-307 — the table ships EMPTY; the first rows come from F2's derivation.
 * `allocable` is required at creation: «unit cost or period cost» is the whole
 * reason a category exists (ruling 1), and a nullable answer would let the
 * question be skipped forever.
 */
export async function createCategory(
  actor: FinanceActor,
  input: { name: string; allocable: boolean },
): Promise<FinanceCategoryView> {
  assertFinanceWriteAccess(actor)
  const name = requireName(input.name, 'Статью расходов')
  if (typeof input.allocable !== 'boolean') {
    throw new FinanceRefusal(
      'У статьи расходов обязателен признак allocable: попадает ли она в себестоимость продукта ' +
        'или это расход периода (EARS-307).',
    )
  }
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const [row] = await tx
      .insert(financeCategory)
      .values({ name, allocable: input.allocable })
      .returning()
    return row as FinanceCategoryView
  })
}

export async function updateCategory(
  actor: FinanceActor,
  id: number,
  patch: { name?: string; allocable?: boolean },
): Promise<FinanceCategoryView> {
  assertFinanceWriteAccess(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireCategory(tx, id)
    const next: Partial<typeof financeCategory.$inferInsert> = {}
    if (patch.name !== undefined) next.name = requireName(patch.name, 'Статью расходов')
    if (patch.allocable !== undefined) next.allocable = patch.allocable
    if (Object.keys(next).length === 0) return current
    const [row] = await tx
      .update(financeCategory)
      .set(next)
      .where(eq(financeCategory.id, id))
      .returning()
    return row as FinanceCategoryView
  })
}

// ── retirement and deletion (EARS-304, EARS-305, EARS-308, EARS-309) ─────────

/**
 * EARS-308 — retirement. A retired row stays valid on every existing posting and
 * stops being offered for new ones; NOTHING recorded changes (EARS-309).
 *
 * Two rows refuse it outright: «Фонд BBM» (EARS-304) and any system account
 * (EARS-305) — the module needs both to exist for as long as the ledger does.
 */
export async function retireReferenceRow(
  actor: FinanceActor,
  table: FinanceReferenceTable,
  id: string | number,
): Promise<void> {
  assertFinanceWriteAccess(actor)
  await platformTransaction(financeAuditContext(actor), async (tx) => {
    const retiredAt = new Date()
    switch (table) {
      case 'currency': {
        await requireCurrency(tx, String(id))
        await tx
          .update(financeCurrency)
          .set({ retiredAt })
          .where(eq(financeCurrency.code, String(id)))
        return
      }
      case 'account': {
        const account = await requireAccount(tx, Number(id))
        if (account.isSystem) {
          throw new FinanceRefusal(
            `Системный счёт «${account.name}» вывести из обращения нельзя: он нужен леджеру, ` +
              'пока в нём есть хоть одна операция в этой валюте (EARS-305).',
          )
        }
        await tx
          .update(financeAccount)
          .set({ retiredAt })
          .where(eq(financeAccount.id, Number(id)))
        return
      }
      case 'project': {
        const project = await requireProject(tx, Number(id))
        if (project.isFund) {
          throw new FinanceRefusal(
            `Проект «${project.name}» — это фонд BBM: единственная строка, на которую садится всё, ` +
              'что не отнесено к именованному проекту. Вывести её из обращения нельзя (EARS-304).',
          )
        }
        await tx
          .update(financeProject)
          .set({ retiredAt })
          .where(eq(financeProject.id, Number(id)))
        return
      }
      case 'product': {
        await requireProduct(tx, Number(id))
        await tx
          .update(financeProduct)
          .set({ retiredAt })
          .where(eq(financeProduct.id, Number(id)))
        return
      }
      case 'purpose': {
        await requirePurpose(tx, Number(id))
        await tx
          .update(financePurpose)
          .set({ retiredAt })
          .where(eq(financePurpose.id, Number(id)))
        return
      }
      case 'category': {
        await requireCategory(tx, Number(id))
        await tx
          .update(financeCategory)
          .set({ retiredAt })
          .where(eq(financeCategory.id, Number(id)))
        return
      }
    }
  })
}

/**
 * EARS-308 — a hard delete, allowed ONLY for a row nothing refers to.
 *
 * Referenced by a posting, an operation or a purpose → a readable refusal that
 * names retirement, never a foreign-key violation (EARS-326). «Никогда не
 * использовалась» is asked of the data, not assumed from the row's age.
 */
export async function deleteReferenceRow(
  actor: FinanceActor,
  table: FinanceReferenceTable,
  id: string | number,
): Promise<void> {
  assertFinanceWriteAccess(actor)
  await platformTransaction(financeAuditContext(actor), async (tx) => {
    const { label, references } = await referenceUsage(tx, table, id)
    if (references > 0) {
      throw new FinanceRefusal(
        `${label} нельзя удалить: на неё ссылается записанное — ${references}. ` +
          'История не переписывается (EARS-309), поэтому вместо удаления её выводят из обращения ' +
          '(retire): она остаётся верной на всех уже записанных проводках и перестаёт предлагаться ' +
          'для новых (EARS-308).',
      )
    }
    switch (table) {
      case 'currency':
        await tx.delete(financeCurrency).where(eq(financeCurrency.code, String(id)))
        return
      case 'account': {
        const account = await requireAccount(tx, Number(id))
        if (account.isSystem) {
          throw new FinanceRefusal(
            `Системный счёт «${account.name}» удалить нельзя: модуль ведёт его сам (EARS-305).`,
          )
        }
        await tx.delete(financeAccount).where(eq(financeAccount.id, Number(id)))
        return
      }
      case 'project': {
        const project = await requireProject(tx, Number(id))
        if (project.isFund) {
          throw new FinanceRefusal(
            `Проект «${project.name}» — это фонд BBM, он не удаляется и не выводится из обращения (EARS-304).`,
          )
        }
        await tx.delete(financeProject).where(eq(financeProject.id, Number(id)))
        return
      }
      case 'product':
        await tx.delete(financeProduct).where(eq(financeProduct.id, Number(id)))
        return
      case 'purpose':
        await tx.delete(financePurpose).where(eq(financePurpose.id, Number(id)))
        return
      case 'category':
        await tx.delete(financeCategory).where(eq(financeCategory.id, Number(id)))
        return
    }
  })
}

// ── internals ────────────────────────────────────────────────────────────────

function assertKnownBinding(binding: unknown): asserts binding is FinanceProductBinding {
  if (binding !== 'required' && binding !== 'forbidden' && binding !== 'optional') {
    throw new FinanceRefusal(
      `product_binding «${String(binding)}» не существует: допустимы required, forbidden, optional (EARS-306).`,
    )
  }
}

/** EARS-306 — link to a category WHERE the category list is non-empty. */
async function resolveRequiredCategory(
  tx: PlatformTx,
  categoryId: number | null,
  purposeName: string,
): Promise<number | null> {
  if (categoryId !== null) {
    await requireCategory(tx, categoryId)
    return categoryId
  }
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(financeCategory)
    .where(isNull(financeCategory.retiredAt))
  if (count > 0) {
    throw new FinanceRefusal(
      `Назначение «${purposeName}» нужно привязать к статье расходов: список статей уже не пуст (EARS-306).`,
    )
  }
  return null
}

async function countPostingsInCurrency(tx: PlatformTx, code: string): Promise<number> {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(financePosting)
    .where(eq(financePosting.currency, code))
  return count
}

async function countWhere(tx: PlatformTx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  const row = (result.rows[0] ?? { count: 0 }) as { count: number | string }
  return Number(row.count)
}

async function referenceUsage(
  tx: PlatformTx,
  table: FinanceReferenceTable,
  id: string | number,
): Promise<{ label: string; references: number }> {
  switch (table) {
    case 'currency': {
      const row = await requireCurrency(tx, String(id))
      return {
        label: `Валюту ${row.code}`,
        references: await countWhere(
          tx,
          sql`select (select count(*) from core.finance_posting where currency = ${row.code})
                   + (select count(*) from core.finance_account where currency = ${row.code})
                   + (select count(*) from core.finance_product where sale_price_currency = ${row.code})
                   + (select count(*) from core.finance_conversion_step
                        where from_currency = ${row.code} or to_currency = ${row.code}) as count`,
        ),
      }
    }
    case 'account': {
      const row = await requireAccount(tx, Number(id))
      return {
        label: `Счёт «${row.name}»`,
        references: await countWhere(
          tx,
          sql`select count(*) as count from core.finance_posting where account_id = ${row.id}`,
        ),
      }
    }
    case 'project': {
      const row = await requireProject(tx, Number(id))
      return {
        label: `Проект «${row.name}»`,
        references: await countWhere(
          tx,
          sql`select (select count(*) from core.finance_posting where project_id = ${row.id})
                   + (select count(*) from core.finance_product where project_id = ${row.id}) as count`,
        ),
      }
    }
    case 'product': {
      const row = await requireProduct(tx, Number(id))
      return {
        label: `Продукт «${row.name}»`,
        references: await countWhere(
          tx,
          sql`select count(*) as count from core.finance_posting where product_id = ${row.id}`,
        ),
      }
    }
    case 'purpose': {
      const row = await requirePurpose(tx, Number(id))
      return {
        label: `Назначение «${row.name}»`,
        references: await countWhere(
          tx,
          sql`select count(*) as count from core.finance_operation where purpose_id = ${row.id}`,
        ),
      }
    }
    case 'category': {
      const row = await requireCategory(tx, Number(id))
      return {
        label: `Статью расходов «${row.name}»`,
        references: await countWhere(
          tx,
          sql`select (select count(*) from core.finance_posting where category_id = ${row.id})
                   + (select count(*) from core.finance_purpose where category_id = ${row.id}) as count`,
        ),
      }
    }
  }
}

export async function requireCurrency(tx: PlatformTx, code: string): Promise<FinanceCurrencyView> {
  const [row] = await tx.select().from(financeCurrency).where(eq(financeCurrency.code, code))
  if (row === undefined) throw new FinanceRefusal(`Валюты «${code}» нет в справочнике.`)
  return row as FinanceCurrencyView
}

export async function requireAccount(tx: PlatformTx, id: number): Promise<FinanceAccountView> {
  const [row] = await tx.select().from(financeAccount).where(eq(financeAccount.id, id))
  if (row === undefined) throw new FinanceRefusal(`Счёта #${id} нет в плане счетов.`)
  return row as FinanceAccountView
}

export async function requireProject(tx: PlatformTx, id: number): Promise<FinanceProjectView> {
  const [row] = await tx.select().from(financeProject).where(eq(financeProject.id, id))
  if (row === undefined) throw new FinanceRefusal(`Проекта #${id} нет в справочнике.`)
  return row as FinanceProjectView
}

export async function requireProduct(tx: PlatformTx, id: number): Promise<FinanceProductView> {
  const [row] = await tx.select().from(financeProduct).where(eq(financeProduct.id, id))
  if (row === undefined) throw new FinanceRefusal(`Продукта #${id} нет в справочнике.`)
  return row as FinanceProductView
}

export async function requirePurpose(tx: PlatformTx, id: number): Promise<FinancePurposeView> {
  const [row] = await tx.select().from(financePurpose).where(eq(financePurpose.id, id))
  if (row === undefined) throw new FinanceRefusal(`Назначения #${id} нет в справочнике.`)
  return { ...row, productBinding: row.productBinding as FinanceProductBinding }
}

export async function requireCategory(tx: PlatformTx, id: number): Promise<FinanceCategoryView> {
  const [row] = await tx.select().from(financeCategory).where(eq(financeCategory.id, id))
  if (row === undefined) throw new FinanceRefusal(`Статьи расходов #${id} нет в справочнике.`)
  return row as FinanceCategoryView
}

/** The fund row (EARS-304) — the project every entity-level amount lands on. */
export async function requireFundProject(tx: PlatformTx): Promise<FinanceProjectView> {
  const [row] = await tx.select().from(financeProject).where(eq(financeProject.isFund, true))
  if (row === undefined) {
    throw new FinanceRefusal(
      'В справочнике нет строки фонда «Фонд BBM» — её создаёт миграция (EARS-304). ' +
        'Без неё леджер не может записать результат, не отнесённый к именованному проекту.',
    )
  }
  return row as FinanceProjectView
}
