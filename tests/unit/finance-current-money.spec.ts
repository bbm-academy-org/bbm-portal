import { describe, expect, it } from 'vitest'

import {
  evaluateCurrentMoney,
  type CurrentMoneyAccount,
  type CurrentMoneyOperationFact,
  type CurrentMoneyPostingFact,
} from '@/lib/finance/current-money'

type AccountDef = Omit<CurrentMoneyAccount, 'balance'>

const BANK_RUB: AccountDef = {
  accountId: 1,
  name: 'Банк RUB',
  kind: 'bank',
  currency: 'RUB',
}
const CASH_RUB: AccountDef = {
  accountId: 2,
  name: 'Наличные RUB',
  kind: 'cash',
  currency: 'RUB',
}
const CARD_USD: AccountDef = {
  accountId: 3,
  name: 'Карта USD',
  kind: 'card',
  currency: 'USD',
}
const CARD_THB: AccountDef = {
  accountId: 4,
  name: 'Карта THB',
  kind: 'card',
  currency: 'THB',
}
const CASH_EUR: AccountDef = {
  accountId: 5,
  name: 'Касса EUR',
  kind: 'cash',
  currency: 'EUR',
}

function money(
  account: AccountDef,
  amount: bigint,
  conversionStepNo: number | null = null,
): CurrentMoneyPostingFact {
  return {
    accountId: account.accountId,
    accountKind: account.kind,
    isSystem: false,
    currency: account.currency,
    amount,
    conversionStepNo,
  }
}

function system(
  accountId: number,
  kind: 'income' | 'expense' | 'conversion' | 'fx_result',
  currency: string,
  amount: bigint,
  conversionStepNo: number | null = null,
): CurrentMoneyPostingFact {
  return { accountId, accountKind: kind, isSystem: true, currency, amount, conversionStepNo }
}

function ordinary(
  operationId: number,
  occurredOn: string,
  movements: Array<{ account: AccountDef; amount: bigint }>,
): CurrentMoneyOperationFact {
  return {
    operationId,
    occurredOn,
    reverses: null,
    steps: [],
    postings: movements.flatMap(({ account, amount }, index) => [
      money(account, amount),
      system(
        -10_000 - operationId * 10 - index,
        amount > 0n ? 'income' : 'expense',
        account.currency,
        -amount,
      ),
    ]),
  }
}

function conversion(
  operationId: number,
  occurredOn: string,
  input: {
    source: AccountDef
    destination: AccountDef
    fromAmount: bigint
    toAmount: bigint
    fee?: { account: AccountDef; amount: bigint }
  },
): CurrentMoneyOperationFact {
  const stepNo = 1
  return {
    operationId,
    occurredOn,
    reverses: null,
    steps: [
      {
        stepNo,
        fromCurrency: input.source.currency,
        toCurrency: input.destination.currency,
      },
    ],
    postings: [
      money(input.source, -input.fromAmount),
      money(input.destination, input.toAmount),
      system(
        -20_000 - operationId * 10,
        'conversion',
        input.source.currency,
        input.fromAmount,
        stepNo,
      ),
      system(
        -20_001 - operationId * 10,
        'conversion',
        input.destination.currency,
        -input.toAmount,
        stepNo,
      ),
      ...(input.fee === undefined
        ? []
        : [
            system(
              -20_002 - operationId * 10,
              'expense',
              input.fee.account.currency,
              input.fee.amount,
              stepNo,
            ),
            money(input.fee.account, -input.fee.amount, stepNo),
          ]),
    ],
  }
}

function chain(
  operationId: number,
  occurredOn: string,
  input: {
    source: AccountDef
    destination: AccountDef
    steps: Array<{ fromCurrency: string; toCurrency: string; fromAmount: bigint; toAmount: bigint }>
  },
): CurrentMoneyOperationFact {
  const first = input.steps[0]
  const last = input.steps.at(-1)
  if (first === undefined || last === undefined) throw new Error('chain requires steps')
  return {
    operationId,
    occurredOn,
    reverses: null,
    steps: input.steps.map((step, index) => ({
      stepNo: index + 1,
      fromCurrency: step.fromCurrency,
      toCurrency: step.toCurrency,
    })),
    postings: [
      money(input.source, -first.fromAmount),
      money(input.destination, last.toAmount),
      ...input.steps.flatMap((step, index) => [
        system(
          -30_000 - operationId * 100 - index * 2,
          'conversion',
          step.fromCurrency,
          step.fromAmount,
          index + 1,
        ),
        system(
          -30_001 - operationId * 100 - index * 2,
          'conversion',
          step.toCurrency,
          -step.toAmount,
          index + 1,
        ),
      ]),
    ],
  }
}

function reverse(
  operationId: number,
  occurredOn: string,
  original: CurrentMoneyOperationFact,
): CurrentMoneyOperationFact {
  return {
    operationId,
    occurredOn,
    reverses: original.operationId,
    steps: [],
    postings: original.postings.map((posting) => ({ ...posting, amount: -posting.amount })),
  }
}

function accounts(
  definitions: AccountDef[],
  operations: CurrentMoneyOperationFact[],
): CurrentMoneyAccount[] {
  return definitions.map((account) => ({
    ...account,
    balance: operations
      .flatMap((operation) => operation.postings)
      .filter((posting) => !posting.isSystem && posting.accountId === account.accountId)
      .reduce((sum, posting) => sum + posting.amount, 0n),
  }))
}

function value(
  reportingCurrency: string,
  definitions: AccountDef[],
  operations: CurrentMoneyOperationFact[],
  accountOverride?: CurrentMoneyAccount[],
) {
  return evaluateCurrentMoney({
    reportingCurrency,
    accounts: accountOverride ?? accounts(definitions, operations),
    operations,
  })
}

describe('EARS-325: current-money recorded-cost replay', () => {
  it('replays chronologically, aggregates two RUB accounts, and carries direct and multi-step basis', () => {
    const operations = [
      ordinary(1, '2026-01-01', [{ account: BANK_RUB, amount: 150_000_000n }]),
      ordinary(2, '2026-01-01', [{ account: CASH_RUB, amount: 50_000_000n }]),
      conversion(3, '2026-01-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 60_000_000n,
        toAmount: 1_000_000n,
      }),
      chain(4, '2026-01-03', {
        source: CARD_USD,
        destination: CARD_THB,
        steps: [
          { fromCurrency: 'USD', toCurrency: 'EUR', fromAmount: 400_000n, toAmount: 360_000n },
          { fromCurrency: 'EUR', toCurrency: 'THB', fromAmount: 360_000n, toAmount: 14_000_000n },
        ],
      }),
      conversion(5, '2026-01-04', {
        source: CARD_USD,
        destination: BANK_RUB,
        fromAmount: 200_000n,
        toAmount: 13_000_000n,
      }),
      conversion(6, '2026-01-05', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 12_000_000n,
        toAmount: 150_000n,
      }),
    ]

    const result = value('RUB', [BANK_RUB, CASH_RUB, CARD_USD, CARD_THB], [...operations].reverse())

    expect(result).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 201_000_000n,
      missingCurrencies: [],
    })
    expect(result.currencyPools).toMatchObject({
      USD: { quantity: 550_000n, cost: 36_000_000n, known: true },
      THB: { quantity: 14_000_000n, cost: 24_000_000n, known: true },
    })
  })

  it('nets a non-conversion transfer once per currency and applies conversion step before its fee without endpoint double count', () => {
    const operations = [
      ordinary(1, '2026-02-01', [{ account: BANK_RUB, amount: 40_000n }]),
      ordinary(2, '2026-02-02', [
        { account: BANK_RUB, amount: -5_000n },
        { account: CASH_RUB, amount: 5_000n },
      ]),
      conversion(3, '2026-02-03', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 20_000n,
        toAmount: 10_000n,
      }),
      conversion(4, '2026-02-04', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 10_000n,
        toAmount: 10_000n,
        fee: { account: CARD_USD, amount: 5_000n },
      }),
    ]

    const result = value('RUB', [BANK_RUB, CASH_RUB, CARD_USD], operations)

    expect(result).toMatchObject({ status: 'complete', total: 32_500n })
    expect(result.currencyPools.USD).toEqual({ quantity: 15_000n, cost: 22_500n, known: true })
  })

  it('uses remaining moving-average cost after partial disposal and a later acquisition', () => {
    const operations = [
      ordinary(1, '2026-03-01', [{ account: BANK_RUB, amount: 50_000n }]),
      conversion(2, '2026-03-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 20_000n,
        toAmount: 10_000n,
      }),
      ordinary(3, '2026-03-03', [{ account: CARD_USD, amount: -4_000n }]),
      conversion(4, '2026-03-04', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 9_000n,
        toAmount: 3_000n,
      }),
    ]

    const result = value('RUB', [BANK_RUB, CARD_USD], operations)
    expect(result.currencyPools.USD).toEqual({ quantity: 9_000n, cost: 21_000n, known: true })
    expect(result.total).toBe(42_000n)
  })

  it('excludes a fully reversed conversion before replay even with an intervening operation', () => {
    const original = conversion(2, '2026-04-02', {
      source: BANK_RUB,
      destination: CARD_USD,
      fromAmount: 60_000n,
      toAmount: 1_000n,
    })
    const operations = [
      ordinary(1, '2026-04-01', [{ account: BANK_RUB, amount: 100_000n }]),
      original,
      ordinary(3, '2026-04-03', [{ account: BANK_RUB, amount: 5_000n }]),
      reverse(4, '2026-04-04', original),
    ]

    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      status: 'complete',
      total: 105_000n,
      currencyPools: { USD: { quantity: 0n, cost: 0n, known: true } },
    })
  })

  it('rounds a proportional disposal tie half away from zero exactly once', () => {
    const aaa: AccountDef = { accountId: 6, name: 'AAA', kind: 'crypto', currency: 'AAA' }
    const bbb: AccountDef = { accountId: 7, name: 'BBB', kind: 'crypto', currency: 'BBB' }
    const operations = [
      ordinary(1, '2026-05-01', [{ account: BANK_RUB, amount: 1n }]),
      conversion(2, '2026-05-02', {
        source: BANK_RUB,
        destination: aaa,
        fromAmount: 1n,
        toAmount: 2n,
      }),
      conversion(3, '2026-05-03', {
        source: aaa,
        destination: bbb,
        fromAmount: 1n,
        toAmount: 1n,
      }),
    ]

    const result = value('RUB', [BANK_RUB, aaa, bbb], operations)
    expect(result.currencyPools).toMatchObject({
      AAA: { quantity: 1n, cost: 0n, known: true },
      BBB: { quantity: 1n, cost: 1n, known: true },
    })
    expect(result.total).toBe(1n)
  })

  it('keeps foreign ordinary basis unknown until quantity returns to zero', () => {
    const inflow = ordinary(1, '2026-06-01', [{ account: CARD_USD, amount: 10_000n }])
    const partial = ordinary(2, '2026-06-02', [{ account: CARD_USD, amount: -4_000n }])
    const empty = ordinary(3, '2026-06-03', [{ account: CARD_USD, amount: -6_000n }])

    expect(value('RUB', [CARD_USD], [inflow])).toMatchObject({
      status: 'incomplete',
      total: null,
      missingCurrencies: ['USD'],
    })
    expect(value('RUB', [CARD_USD], [inflow, partial])).toMatchObject({
      status: 'incomplete',
      missingCurrencies: ['USD'],
      currencyPools: { USD: { quantity: 6_000n, cost: null, known: false } },
    })
    expect(value('RUB', [CARD_USD], [inflow, partial, empty])).toMatchObject({
      status: 'complete',
      total: 0n,
      missingCurrencies: [],
    })
  })

  it('withholds all-or-nothing totals for negative, over-disposed, malformed and mismatched currencies', () => {
    const negative = ordinary(1, '2026-07-01', [{ account: CARD_USD, amount: -100n }])
    expect(value('RUB', [CARD_USD], [negative])).toMatchObject({
      status: 'incomplete',
      total: null,
      missingCurrencies: ['USD'],
    })

    const acquired = [
      ordinary(1, '2026-07-01', [{ account: BANK_RUB, amount: 1_000n }]),
      conversion(2, '2026-07-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 100n,
        toAmount: 100n,
      }),
    ]
    const overDisposed = conversion(3, '2026-07-03', {
      source: CARD_USD,
      destination: CARD_THB,
      fromAmount: 101n,
      toAmount: 500n,
    })
    expect(value('RUB', [BANK_RUB, CARD_USD, CARD_THB], [...acquired, overDisposed])).toMatchObject(
      {
        status: 'incomplete',
        total: null,
        missingCurrencies: ['THB', 'USD'],
      },
    )

    const malformed = conversion(4, '2026-07-04', {
      source: BANK_RUB,
      destination: CASH_EUR,
      fromAmount: 100n,
      toAmount: 200n,
    })
    malformed.postings = malformed.postings.filter(
      (posting) => !(posting.isSystem && posting.currency === 'EUR'),
    )
    expect(
      value(
        'RUB',
        [BANK_RUB, CASH_EUR],
        [ordinary(1, '2026-07-01', [{ account: BANK_RUB, amount: 500n }]), malformed],
      ),
    ).toMatchObject({
      status: 'incomplete',
      missingCurrencies: ['EUR'],
    })

    const known = value('RUB', [BANK_RUB, CARD_USD], acquired)
    expect(known.status).toBe('complete')
    const mismatched = accounts([BANK_RUB, CARD_USD], acquired).map((account) =>
      account.currency === 'USD' ? { ...account, balance: account.balance - 1n } : account,
    )
    expect(value('RUB', [BANK_RUB, CARD_USD], acquired, mismatched)).toMatchObject({
      status: 'incomplete',
      total: null,
      missingCurrencies: ['USD'],
    })
  })

  it('reevaluates a switched THB view and names every missing foreign currency', () => {
    const operations = [
      ordinary(1, '2026-08-01', [{ account: BANK_RUB, amount: 200_000_000n }]),
      conversion(2, '2026-08-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 60_000_000n,
        toAmount: 1_000_000n,
      }),
      conversion(3, '2026-08-03', {
        source: CARD_USD,
        destination: CARD_THB,
        fromAmount: 400_000n,
        toAmount: 14_000_000n,
      }),
    ]

    expect(value('THB', [BANK_RUB, CARD_USD, CARD_THB], operations)).toMatchObject({
      reportingCurrency: 'THB',
      status: 'incomplete',
      total: null,
      missingCurrencies: ['RUB', 'USD'],
    })
  })
})
