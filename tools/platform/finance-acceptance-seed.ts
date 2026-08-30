#!/usr/bin/env node
/**
 * Representative finance data for a dev/live-acceptance stand (#357).
 *
 * The command is deliberately unavailable by default and always refuses a
 * production environment. Run it only with an explicit opt-in:
 *
 *   FINANCE_ACCEPTANCE_SEED=1 FINANCE_ACCEPTANCE_ACTOR_EMAIL=owner@example.com \
 *     pnpm platform:finance:acceptance-seed
 *
 * Every finance read and write goes through `@/lib/finance`. Stable names and
 * source references make a rerun a no-op: references are reused, and each
 * representative ledger operation is recorded at most once.
 */
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createAccount,
  createCategory,
  createCurrency,
  createProduct,
  createProject,
  createPurpose,
  FINANCE_APPROVE_ROLE,
  listAccounts,
  listCategories,
  listCurrencies,
  listProducts,
  listProjects,
  listPurposes,
  listRegister,
  recordConversion,
  recordOperation,
  systemAccount,
  type FinanceActor,
} from '@/lib/finance'
import { closePlatformDb } from '@/lib/platform/db/client'
import { PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'

import { loadPlatformToolEnv } from './load-env.mjs'

const TAG = 'platform:finance:acceptance-seed'

export type FinanceAcceptanceSeedApi = {
  listCurrencies: typeof listCurrencies
  createCurrency: typeof createCurrency
  listAccounts: typeof listAccounts
  createAccount: typeof createAccount
  listProjects: typeof listProjects
  createProject: typeof createProject
  listProducts: typeof listProducts
  createProduct: typeof createProduct
  listPurposes: typeof listPurposes
  createPurpose: typeof createPurpose
  listCategories: typeof listCategories
  createCategory: typeof createCategory
  systemAccount: typeof systemAccount
  listRegister: typeof listRegister
  recordOperation: typeof recordOperation
  recordConversion: typeof recordConversion
}

const PUBLIC_FINANCE_API: FinanceAcceptanceSeedApi = {
  listCurrencies,
  createCurrency,
  listAccounts,
  createAccount,
  listProjects,
  createProject,
  listProducts,
  createProduct,
  listPurposes,
  createPurpose,
  listCategories,
  createCategory,
  systemAccount,
  listRegister,
  recordOperation,
  recordConversion,
}

type SeedEnvironment = Record<string, string | undefined>

export class FinanceAcceptanceSeedRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinanceAcceptanceSeedRefusal'
  }
}

/** Two independent locks: environment classification and a conscious opt-in. */
export function assertFinanceAcceptanceSeedAllowed(env: SeedEnvironment): void {
  const productionMarker = [env.NODE_ENV, env.VERCEL_ENV, env.APP_ENV, env.DEPLOY_ENV].find(
    (value) => value?.trim().toLowerCase() === 'production',
  )
  if (productionMarker !== undefined) {
    throw new FinanceAcceptanceSeedRefusal(
      `${TAG} refuses production. Representative acceptance data belongs only on dev/acceptance stands.`,
    )
  }
  if (env.FINANCE_ACCEPTANCE_SEED !== '1') {
    throw new FinanceAcceptanceSeedRefusal(
      `${TAG} is opt-in. Set FINANCE_ACCEPTANCE_SEED=1 only for the intended dev/acceptance database.`,
    )
  }
}

export type FinanceAcceptanceSeedSummary = {
  referencesCreated: number
  referencesReused: number
  operationsCreated: number
  operationsReused: number
}

function active<T extends { retiredAt: Date | null }>(row: T, identity: string): T {
  if (row.retiredAt !== null) {
    throw new FinanceAcceptanceSeedRefusal(
      `${identity} exists but is retired. Restore or rename it deliberately before seeding acceptance data.`,
    )
  }
  return row
}

function same(value: unknown, expected: unknown, identity: string, field: string): void {
  if (value !== expected) {
    throw new FinanceAcceptanceSeedRefusal(
      `${identity} already exists with ${field}=${String(value)}; expected ${String(expected)}. ` +
        'The seed will not silently rewrite existing finance data.',
    )
  }
}

/** Apply the fixed scenario through the finance module's public API. */
export async function seedFinanceAcceptance(
  actor: FinanceActor,
  api: FinanceAcceptanceSeedApi = PUBLIC_FINANCE_API,
): Promise<FinanceAcceptanceSeedSummary> {
  const summary: FinanceAcceptanceSeedSummary = {
    referencesCreated: 0,
    referencesReused: 0,
    operationsCreated: 0,
    operationsReused: 0,
  }

  const currencies = await api.listCurrencies({ includeRetired: true })
  async function ensureCurrency(input: { code: string; name: string; precision: number }) {
    const found = currencies.find((row) => row.code === input.code)
    if (found !== undefined) {
      active(found, `Currency ${input.code}`)
      same(found.precision, input.precision, `Currency ${input.code}`, 'precision')
      summary.referencesReused += 1
      return found
    }
    const created = await api.createCurrency(actor, input)
    summary.referencesCreated += 1
    return created
  }

  await ensureCurrency({ code: 'RUB', name: 'Российский рубль', precision: 2 })
  await ensureCurrency({ code: 'USD', name: 'Доллар США', precision: 2 })
  await ensureCurrency({ code: 'THB', name: 'Тайский бат', precision: 2 })

  const accounts = await api.listAccounts({ includeRetired: true })
  async function ensureAccount(input: {
    name: string
    kind: 'bank' | 'card' | 'crypto' | 'cash'
    currency: string
  }) {
    const found = accounts.find((row) => !row.isSystem && row.name === input.name)
    if (found !== undefined) {
      active(found, `Account «${input.name}»`)
      same(found.kind, input.kind, `Account «${input.name}»`, 'kind')
      same(found.currency, input.currency, `Account «${input.name}»`, 'currency')
      summary.referencesReused += 1
      return found
    }
    const created = await api.createAccount(actor, input)
    summary.referencesCreated += 1
    return created
  }

  const bank = await ensureAccount({ name: 'Основной банк', kind: 'bank', currency: 'RUB' })
  const rubCash = await ensureAccount({ name: 'Наличные RUB', kind: 'cash', currency: 'RUB' })
  const card = await ensureAccount({
    name: 'Корпоративная карта',
    kind: 'card',
    currency: 'USD',
  })
  const thbCard = await ensureAccount({ name: 'Карта THB', kind: 'card', currency: 'THB' })

  const projects = await api.listProjects({ includeRetired: true })
  async function ensureProject(name: string) {
    const found = projects.find((row) => row.name === name)
    if (found !== undefined) {
      active(found, `Project «${name}»`)
      same(found.isFund, false, `Project «${name}»`, 'isFund')
      summary.referencesReused += 1
      return found
    }
    const created = await api.createProject(actor, { name })
    summary.referencesCreated += 1
    return created
  }

  const doctorSchool = await ensureProject('Doctor School')
  const bbmAcademy = await ensureProject('BBM Academy')

  const products = await api.listProducts({ includeRetired: true })
  async function ensureProduct(input: {
    projectId: number
    name: string
    salePrice: bigint
    salePriceCurrency: string
  }) {
    const found = products.find((row) => row.name === input.name)
    if (found !== undefined) {
      active(found, `Product «${input.name}»`)
      same(found.projectId, input.projectId, `Product «${input.name}»`, 'projectId')
      same(found.salePrice, input.salePrice, `Product «${input.name}»`, 'salePrice')
      same(
        found.salePriceCurrency,
        input.salePriceCurrency,
        `Product «${input.name}»`,
        'salePriceCurrency',
      )
      summary.referencesReused += 1
      return found
    }
    const created = await api.createProduct(actor, input)
    summary.referencesCreated += 1
    return created
  }

  const course = await ensureProduct({
    projectId: doctorSchool.id,
    name: 'Курс «Основы нутрициологии»',
    salePrice: 4_990_000n,
    salePriceCurrency: 'RUB',
  })
  await ensureProduct({
    projectId: bbmAcademy.id,
    name: 'Клуб BBM',
    salePrice: 120_000n,
    salePriceCurrency: 'THB',
  })

  const categories = await api.listCategories({ includeRetired: true })
  async function ensureCategory(name: string, allocable: boolean) {
    const found = categories.find((row) => row.name === name)
    if (found !== undefined) {
      active(found, `Category «${name}»`)
      same(found.allocable, allocable, `Category «${name}»`, 'allocable')
      summary.referencesReused += 1
      return found
    }
    const created = await api.createCategory(actor, { name, allocable })
    summary.referencesCreated += 1
    return created
  }

  const marketing = await ensureCategory('Маркетинг', false)
  const fees = await ensureCategory('Комиссии', false)
  const operations = await ensureCategory('Операционные расходы', false)

  const purposes = await api.listPurposes({ includeRetired: true })
  async function ensurePurpose(input: {
    name: string
    productBinding: 'required' | 'optional' | 'forbidden'
    categoryId: number
  }) {
    const found = purposes.find((row) => row.name === input.name)
    if (found !== undefined) {
      active(found, `Purpose «${input.name}»`)
      same(found.productBinding, input.productBinding, `Purpose «${input.name}»`, 'productBinding')
      same(found.categoryId, input.categoryId, `Purpose «${input.name}»`, 'categoryId')
      summary.referencesReused += 1
      return found
    }
    const created = await api.createPurpose(actor, input)
    summary.referencesCreated += 1
    return created
  }

  const courseSales = await ensurePurpose({
    name: 'Продажи курса',
    productBinding: 'required',
    categoryId: marketing.id,
  })
  await ensurePurpose({
    name: 'Партнёрская программа',
    productBinding: 'required',
    categoryId: fees.id,
  })
  await ensurePurpose({
    name: 'Продажи встреч BBM',
    productBinding: 'required',
    categoryId: marketing.id,
  })
  await ensurePurpose({
    name: 'Операционные расходы',
    productBinding: 'forbidden',
    categoryId: operations.id,
  })

  const register = await api.listRegister({ limit: 50_000 })
  async function ensureOrigin() {
    const sourceRef = 'acceptance-seed:rub-origin'
    if (register.some((entry) => entry.sourceRef === sourceRef)) {
      summary.operationsReused += 1
      return
    }
    const income = await api.systemAccount(actor, 'income', 'RUB')
    await api.recordOperation(actor, {
      occurredOn: '2026-08-20',
      source: 'manual',
      purposeId: courseSales.id,
      sourceRef,
      postings: [
        {
          accountId: bank.id,
          amount: 150_000_000n,
          currency: 'RUB',
        },
        {
          accountId: rubCash.id,
          amount: 50_000_000n,
          currency: 'RUB',
        },
        {
          accountId: income.id,
          amount: -200_000_000n,
          currency: 'RUB',
          projectId: doctorSchool.id,
          productId: course.id,
        },
      ],
    })
    summary.operationsCreated += 1
  }

  async function ensureConversion(input: {
    sourceRef: string
    occurredOn: string
    sourceAccountId: number
    targetAccountId: number
    fromCurrency: string
    toCurrency: string
    fromAmount: bigint
    toAmount: bigint
    rate: string
  }) {
    if (register.some((entry) => entry.sourceRef === input.sourceRef)) {
      summary.operationsReused += 1
      return
    }
    await api.recordConversion(actor, {
      occurredOn: input.occurredOn,
      source: 'manual',
      sourceRef: input.sourceRef,
      sourceAccountId: input.sourceAccountId,
      targetAccountId: input.targetAccountId,
      steps: [
        {
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          fromAmount: input.fromAmount,
          toAmount: input.toAmount,
          rate: input.rate,
        },
      ],
    })
    summary.operationsCreated += 1
  }

  await ensureOrigin()
  await ensureConversion({
    sourceRef: 'acceptance-seed:rub-usd-acquisition',
    occurredOn: '2026-08-21',
    sourceAccountId: bank.id,
    targetAccountId: card.id,
    fromCurrency: 'RUB',
    toCurrency: 'USD',
    fromAmount: 60_000_000n,
    toAmount: 1_000_000n,
    rate: '60',
  })
  await ensureConversion({
    sourceRef: 'acceptance-seed:usd-thb-acquisition',
    occurredOn: '2026-08-22',
    sourceAccountId: card.id,
    targetAccountId: thbCard.id,
    fromCurrency: 'USD',
    toCurrency: 'THB',
    fromAmount: 400_000n,
    toAmount: 14_000_000n,
    rate: '35',
  })
  await ensureConversion({
    sourceRef: 'acceptance-seed:usd-rub-disposal',
    occurredOn: '2026-08-23',
    sourceAccountId: card.id,
    targetAccountId: bank.id,
    fromCurrency: 'USD',
    toCurrency: 'RUB',
    fromAmount: 200_000n,
    toAmount: 13_000_000n,
    rate: '65',
  })
  await ensureConversion({
    sourceRef: 'acceptance-seed:rub-usd-later-acquisition',
    occurredOn: '2026-08-24',
    sourceAccountId: bank.id,
    targetAccountId: card.id,
    fromCurrency: 'RUB',
    toCurrency: 'USD',
    fromAmount: 12_000_000n,
    toAmount: 150_000n,
    rate: '80',
  })

  return summary
}

function actorFromEnv(env: SeedEnvironment): FinanceActor {
  const email = (env.FINANCE_ACCEPTANCE_ACTOR_EMAIL ?? env.E2E_ADMIN_USERNAME)?.trim()
  if (!email) {
    throw new FinanceAcceptanceSeedRefusal(
      'Set FINANCE_ACCEPTANCE_ACTOR_EMAIL (or E2E_ADMIN_USERNAME) so every seeded write has a readable audit actor.',
    )
  }
  return { email, roles: [PLATFORM_ADMIN_ROLE, FINANCE_APPROVE_ROLE] }
}

async function main(): Promise<void> {
  loadPlatformToolEnv()
  assertFinanceAcceptanceSeedAllowed(process.env)
  const actor = actorFromEnv(process.env)
  const summary = await seedFinanceAcceptance(actor)
  console.log(`\n▶ ${TAG}`)
  console.log(
    `  references: ${summary.referencesCreated} created · ${summary.referencesReused} reused`,
  )
  console.log(
    `  ledger operations: ${summary.operationsCreated} created · ${summary.operationsReused} reused`,
  )
  console.log(
    '  representative balances: RUB 910 000,00 + 500 000,00 · USD 5 500,00 · THB 140 000,00',
  )
  console.log('  recorded-cost total: RUB 2 010 000,00\n')
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main()
    .then(() => closePlatformDb())
    .catch(async (error: unknown) => {
      console.error(`\n✗ ${TAG} FAILED: ${(error as Error)?.message ?? String(error)}`)
      await closePlatformDb().catch(() => undefined)
      process.exit(1)
    })
}
