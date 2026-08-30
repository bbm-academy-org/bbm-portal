import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  assertFinanceAcceptanceSeedAllowed,
  seedFinanceAcceptance,
  type FinanceAcceptanceSeedApi,
} from '../../tools/platform/finance-acceptance-seed'

const ACTOR = {
  email: 'acceptance-owner@bbm.academy',
  roles: ['platform-admin', 'finance-approve'],
}

function fakeFinanceApi() {
  let nextId = 10
  const currencies: Array<Record<string, unknown>> = []
  const accounts: Array<Record<string, unknown>> = []
  const projects: Array<Record<string, unknown>> = [
    { id: 1, name: 'Фонд BBM', isFund: true, retiredAt: null },
  ]
  const products: Array<Record<string, unknown>> = []
  const purposes: Array<Record<string, unknown>> = []
  const categories: Array<Record<string, unknown>> = []
  const register: Array<Record<string, unknown>> = []

  const api = {
    listCurrencies: vi.fn(async () => currencies),
    createCurrency: vi.fn(async (_actor, input) => {
      const row = { ...input, retiredAt: null }
      currencies.push(row)
      return row
    }),
    listAccounts: vi.fn(async () => accounts),
    createAccount: vi.fn(async (_actor, input) => {
      const row = { id: nextId++, ...input, isSystem: false, retiredAt: null }
      accounts.push(row)
      return row
    }),
    listProjects: vi.fn(async () => projects),
    createProject: vi.fn(async (_actor, input) => {
      const row = { id: nextId++, ...input, isFund: false, retiredAt: null }
      projects.push(row)
      return row
    }),
    listProducts: vi.fn(async () => products),
    createProduct: vi.fn(async (_actor, input) => {
      const row = {
        id: nextId++,
        ...input,
        salePrice: input.salePrice ?? null,
        salePriceCurrency: input.salePriceCurrency ?? null,
        retiredAt: null,
      }
      products.push(row)
      return row
    }),
    listPurposes: vi.fn(async () => purposes),
    createPurpose: vi.fn(async (_actor, input) => {
      const row = { id: nextId++, ...input, categoryId: input.categoryId ?? null, retiredAt: null }
      purposes.push(row)
      return row
    }),
    listCategories: vi.fn(async () => categories),
    createCategory: vi.fn(async (_actor, input) => {
      const row = { id: nextId++, ...input, retiredAt: null }
      categories.push(row)
      return row
    }),
    systemAccount: vi.fn(async (_actor, kind, currency) => {
      const present = accounts.find(
        (row) => row.kind === kind && row.currency === currency && row.isSystem === true,
      )
      if (present) return present
      const row = {
        id: nextId++,
        name: `${kind}:${currency}`,
        kind,
        currency,
        isSystem: true,
        retiredAt: null,
      }
      accounts.push(row)
      return row
    }),
    listRegister: vi.fn(async () => register),
    recordOperation: vi.fn(async (_actor, input) => {
      const row = {
        operationId: nextId++,
        occurredOn: input.occurredOn,
        source: input.source,
        purposeId: input.purposeId ?? null,
        purposeName:
          purposes.find((purpose) => purpose.id === input.purposeId)?.name?.toString() ?? null,
        sourceRef: input.sourceRef ?? null,
        postings: input.postings,
      }
      register.push(row)
      return row
    }),
  }

  return {
    api: api as unknown as FinanceAcceptanceSeedApi,
    state: { currencies, accounts, projects, products, purposes, categories, register },
  }
}

describe('finance acceptance seed (#357)', () => {
  it('refuses production even with opt-in and requires an explicit non-production opt-in', () => {
    expect(() =>
      assertFinanceAcceptanceSeedAllowed({ NODE_ENV: 'production', FINANCE_ACCEPTANCE_SEED: '1' }),
    ).toThrow(/production/i)
    expect(() => assertFinanceAcceptanceSeedAllowed({ NODE_ENV: 'development' })).toThrow(
      /FINANCE_ACCEPTANCE_SEED=1/,
    )
    expect(() =>
      assertFinanceAcceptanceSeedAllowed({
        NODE_ENV: 'development',
        FINANCE_ACCEPTANCE_SEED: '1',
      }),
    ).not.toThrow()
  })

  it('uses stable public-API identities so reruns add neither rows nor balances', async () => {
    const { api, state } = fakeFinanceApi()

    await seedFinanceAcceptance(ACTOR, api)
    await seedFinanceAcceptance(ACTOR, api)

    expect(state.currencies.map((row) => row.code)).toEqual(['RUB', 'USD', 'THB'])
    expect(state.accounts.filter((row) => row.isSystem === false)).toMatchObject([
      { name: 'Основной банк', kind: 'bank', currency: 'RUB' },
      { name: 'Корпоративная карта', kind: 'card', currency: 'USD' },
      { name: 'Операционная касса', kind: 'cash', currency: 'THB' },
    ])
    expect(state.projects.map((row) => row.name)).toEqual([
      'Фонд BBM',
      'Doctor School',
      'BBM Academy',
    ])
    expect(state.products).toHaveLength(2)
    expect(state.purposes.length).toBeGreaterThanOrEqual(4)
    expect(state.categories.length).toBeGreaterThanOrEqual(3)
    expect(state.register).toHaveLength(3)

    const moneyBalances = new Map<number, bigint>()
    for (const operation of state.register) {
      for (const posting of operation.postings as Array<{ accountId: number; amount: bigint }>) {
        moneyBalances.set(
          posting.accountId,
          (moneyBalances.get(posting.accountId) ?? 0n) + posting.amount,
        )
      }
    }
    const visibleBalances = state.accounts
      .filter((row) => row.isSystem === false)
      .map((row) => moneyBalances.get(Number(row.id)))
    expect(visibleBalances).toEqual([128_450_000n, 875_000n, 6_432_050n])
  })

  it('is wired as a Node-22 package command and writes finance data only through the public API', () => {
    const root = process.cwd()
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['preplatform:finance:acceptance-seed']).toBe('node scripts/require-node.mjs')
    expect(pkg.scripts['platform:finance:acceptance-seed']).toContain(
      'tsx tools/platform/finance-acceptance-seed.ts',
    )

    const source = readFileSync(resolve(root, 'tools/platform/finance-acceptance-seed.ts'), 'utf8')
    expect(source).toContain("from '@/lib/finance'")
    expect(source).not.toMatch(/platform\/db\/schema|drizzle|\bsql`/)
  })
})
