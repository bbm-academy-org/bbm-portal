// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCurrency,
  currentMoneyOverview,
  recordConversion,
  recordOperation,
  systemAccount,
} from '@/lib/finance'
import { closePlatformDb } from '@/lib/platform/db/client'

import { ADMIN, APPROVER, fundProjectId, truncateFinanceTables } from './finance-helpers'

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

describe('EARS-325 current-money public read model', () => {
  it('reads immutable postings and steps into the exact complete RUB and incomplete THB views', async () => {
    for (const input of [
      { code: 'RUB', name: 'Рубль', precision: 2 },
      { code: 'USD', name: 'Доллар США', precision: 2 },
      { code: 'THB', name: 'Бат', precision: 2 },
    ]) {
      await createCurrency(ADMIN, input)
    }
    const bank = await createAccount(ADMIN, {
      name: 'Банк RUB',
      kind: 'bank',
      currency: 'RUB',
    })
    const cash = await createAccount(ADMIN, {
      name: 'Наличные RUB',
      kind: 'cash',
      currency: 'RUB',
    })
    const usd = await createAccount(ADMIN, {
      name: 'Карта USD',
      kind: 'card',
      currency: 'USD',
    })
    const thb = await createAccount(ADMIN, {
      name: 'Карта THB',
      kind: 'card',
      currency: 'THB',
    })
    const income = await systemAccount(ADMIN, 'income', 'RUB')
    await recordOperation(APPROVER, {
      occurredOn: '2026-08-20',
      source: 'manual',
      postings: [
        { accountId: bank.id, amount: 150_000_000n, currency: 'RUB' },
        { accountId: cash.id, amount: 50_000_000n, currency: 'RUB' },
        {
          accountId: income.id,
          amount: -200_000_000n,
          currency: 'RUB',
          projectId: await fundProjectId(),
        },
      ],
    })

    for (const input of [
      {
        occurredOn: '2026-08-21',
        sourceAccountId: bank.id,
        targetAccountId: usd.id,
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 60_000_000n,
        toAmount: 1_000_000n,
        rate: '60',
      },
      {
        occurredOn: '2026-08-22',
        sourceAccountId: usd.id,
        targetAccountId: thb.id,
        fromCurrency: 'USD',
        toCurrency: 'THB',
        fromAmount: 400_000n,
        toAmount: 14_000_000n,
        rate: '35',
      },
      {
        occurredOn: '2026-08-23',
        sourceAccountId: usd.id,
        targetAccountId: bank.id,
        fromCurrency: 'USD',
        toCurrency: 'RUB',
        fromAmount: 200_000n,
        toAmount: 13_000_000n,
        rate: '65',
      },
      {
        occurredOn: '2026-08-24',
        sourceAccountId: bank.id,
        targetAccountId: usd.id,
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 12_000_000n,
        toAmount: 150_000n,
        rate: '80',
      },
    ]) {
      await recordConversion(APPROVER, {
        occurredOn: input.occurredOn,
        sourceAccountId: input.sourceAccountId,
        targetAccountId: input.targetAccountId,
        steps: [input],
      })
    }

    const rub = await currentMoneyOverview()
    expect(rub).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 201_000_000n,
      missingCurrencies: [],
    })
    expect(
      rub.accounts.map(({ name, balance, currency }) => ({ name, balance, currency })),
    ).toEqual([
      { name: 'Банк RUB', balance: 91_000_000n, currency: 'RUB' },
      { name: 'Наличные RUB', balance: 50_000_000n, currency: 'RUB' },
      { name: 'Карта USD', balance: 550_000n, currency: 'USD' },
      { name: 'Карта THB', balance: 14_000_000n, currency: 'THB' },
    ])

    await expect(currentMoneyOverview('THB')).resolves.toMatchObject({
      reportingCurrency: 'THB',
      status: 'incomplete',
      total: null,
      missingCurrencies: ['RUB', 'USD'],
    })
  })
})
