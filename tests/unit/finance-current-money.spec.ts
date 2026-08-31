import { describe, expect, it } from 'vitest'

import {
  evaluateCurrentMoney,
  isCurrentMoneyAccount,
  selectCurrentMoneyAccounts,
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

describe('EARS-325: which accounts are «Деньги сейчас»', () => {
  /**
   * The clause is written over MONEY accounts. `!isSystem` coincides with that
   * today only because two other files happen to agree; the kind is the
   * predicate, so an `income`/`expense`/`liability` row never joins the tiles or
   * the total whatever its `is_system` flag says.
   */
  it('EARS-325: selects money kinds, not merely non-system rows', () => {
    for (const kind of ['bank', 'card', 'crypto', 'cash']) {
      expect(isCurrentMoneyAccount({ kind, isSystem: false })).toBe(true)
    }
    for (const kind of ['income', 'expense', 'liability', 'conversion', 'fx_result']) {
      expect(isCurrentMoneyAccount({ kind, isSystem: false })).toBe(false)
      expect(isCurrentMoneyAccount({ kind, isSystem: true })).toBe(false)
    }
    expect(isCurrentMoneyAccount({ kind: 'bank', isSystem: true })).toBe(false)
  })

  /**
   * Owner ruling by Антон, 2026-08-31 (#357): retirement is judged by the
   * BALANCE. A retired account holding nothing leaves the card; a retired
   * account still holding money keeps its tile, marked «архивный», and counts
   * in the total exactly like any other — retirement never moves a number.
   */
  it('EARS-325: hides a retired money account at zero and keeps a retired one that still holds money', () => {
    const rows = [
      {
        accountId: 1,
        name: 'Банк RUB',
        kind: 'bank',
        currency: 'RUB',
        isSystem: false,
        retiredAt: null,
        balance: 100_000n,
      },
      {
        accountId: 2,
        name: 'Закрытая карта RUB',
        kind: 'card',
        currency: 'RUB',
        isSystem: false,
        retiredAt: new Date('2026-08-01T00:00:00Z'),
        balance: 0n,
      },
      {
        accountId: 3,
        name: 'Архивный крипто-кошелёк RUB',
        kind: 'crypto',
        currency: 'RUB',
        isSystem: false,
        retiredAt: new Date('2026-08-02T00:00:00Z'),
        balance: 25_000n,
      },
      {
        accountId: 4,
        name: 'expense:RUB',
        kind: 'expense',
        currency: 'RUB',
        isSystem: true,
        retiredAt: null,
        balance: -125_000n,
      },
    ]

    const selected = selectCurrentMoneyAccounts(rows)
    expect(selected.map(({ accountId, retired }) => ({ accountId, retired }))).toEqual([
      { accountId: 1, retired: false },
      { accountId: 3, retired: true },
    ])

    // …and the retired holding is still money: it counts in the total.
    expect(evaluateCurrentMoney({ accounts: selected, operations: [] })).toMatchObject({
      status: 'complete',
      total: 125_000n,
    })
  })
})

describe('EARS-325: current-money recorded-cost replay', () => {
  function representativeOperations(): CurrentMoneyOperationFact[] {
    return [
      ordinary(1, '2026-01-01', [{ account: BANK_RUB, amount: 150_000_000n }]),
      ordinary(2, '2026-01-01', [{ account: CASH_RUB, amount: 50_000_000n }]),
      conversion(3, '2026-01-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 60_000_000n,
        toAmount: 1_000_000n,
      }),
      conversion(4, '2026-01-03', {
        source: CARD_USD,
        destination: CARD_THB,
        fromAmount: 400_000n,
        toAmount: 14_000_000n,
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
  }

  it('EARS-325: replays one canonical pool per unordered pair into the exact RUB representative total', () => {
    const operations = representativeOperations()
    const definitions = [BANK_RUB, CASH_RUB, CARD_USD, CARD_THB]

    const rub = value('RUB', definitions, [...operations].reverse())

    expect(rub).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 201_000_000n,
      missingCurrencies: [],
      availableReportingCurrencies: expect.arrayContaining(['RUB', 'USD', 'THB']),
    })
    expect(rub.accounts).toEqual([
      { ...BANK_RUB, balance: 91_000_000n },
      { ...CASH_RUB, balance: 50_000_000n },
      { ...CARD_USD, balance: 550_000n },
      { ...CARD_THB, balance: 14_000_000n },
    ])
  })

  it('EARS-325: switches the representative holdings to an exact numeric USD total', () => {
    expect(
      value('USD', [BANK_RUB, CASH_RUB, CARD_USD, CARD_THB], representativeOperations()),
    ).toMatchObject({
      reportingCurrency: 'USD',
      status: 'complete',
      total: 3_182_500n,
      missingCurrencies: [],
    })
  })

  it('EARS-325: switches the representative holdings to an exact numeric THB total', () => {
    expect(
      value('THB', [BANK_RUB, CASH_RUB, CARD_USD, CARD_THB], representativeOperations()),
    ).toMatchObject({
      reportingCurrency: 'THB',
      status: 'complete',
      total: 111_387_500n,
      missingCurrencies: [],
    })
  })

  it('EARS-325: crosses a pair pool through zero without leaving contradictory directions', () => {
    const operations = [
      ordinary(1, '2026-02-01', [{ account: BANK_RUB, amount: 6_000n }]),
      conversion(2, '2026-02-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 6_000n,
        toAmount: 100n,
      }),
      conversion(3, '2026-02-03', {
        source: CARD_USD,
        destination: BANK_RUB,
        fromAmount: 150n,
        toAmount: 9_750n,
      }),
    ]

    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      status: 'complete',
      total: 6_500n,
      missingCurrencies: [],
    })
    expect(value('USD', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      status: 'complete',
      total: 100n,
      missingCurrencies: [],
    })
  })

  it('EARS-325: rounds partial-disposal moving-average cost half away and creates no edge from a zero-cost remainder', () => {
    const operations = [
      ordinary(1, '2026-03-01', [{ account: BANK_RUB, amount: 1n }]),
      conversion(2, '2026-03-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 1n,
        toAmount: 2n,
      }),
      conversion(3, '2026-03-03', {
        source: CARD_USD,
        destination: BANK_RUB,
        fromAmount: 1n,
        toAmount: 1n,
      }),
    ]

    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'incomplete',
      total: null,
      missingCurrencies: ['USD'],
    })
  })

  it('EARS-325: keeps a malformed or half-empty pair unavailable after later valid steps', () => {
    const halfEmpty = [
      ordinary(1, '2026-04-01', [{ account: BANK_RUB, amount: 3n }]),
      conversion(2, '2026-04-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 1n,
        toAmount: 1n,
      }),
      conversion(3, '2026-04-03', {
        source: CARD_USD,
        destination: BANK_RUB,
        fromAmount: 2n,
        toAmount: 1n,
      }),
      conversion(4, '2026-04-04', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 2n,
        toAmount: 2n,
      }),
    ]
    expect(value('RUB', [BANK_RUB, CARD_USD], halfEmpty)).toMatchObject({
      status: 'incomplete',
      total: null,
      missingCurrencies: ['USD'],
    })

    const malformed = conversion(2, '2026-04-02', {
      source: BANK_RUB,
      destination: CARD_USD,
      fromAmount: 10n,
      toAmount: 10n,
    })
    malformed.postings.push(system(-99, 'conversion', 'EUR', 1n, 1))
    const malformedThenValid = [
      ordinary(1, '2026-04-01', [{ account: BANK_RUB, amount: 30n }]),
      malformed,
      conversion(3, '2026-04-03', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 10n,
        toAmount: 10n,
      }),
    ]
    expect(value('RUB', [BANK_RUB, CARD_USD], malformedThenValid)).toMatchObject({
      status: 'incomplete',
      total: null,
      missingCurrencies: ['USD'],
    })
  })

  it('EARS-325: multiplies exact graph ratios before rounding once per source aggregate', () => {
    const aaa: AccountDef = { accountId: 6, name: 'AAA', kind: 'crypto', currency: 'AAA' }
    const bbb: AccountDef = { accountId: 7, name: 'BBB', kind: 'crypto', currency: 'BBB' }
    const ccc: AccountDef = { accountId: 8, name: 'CCC', kind: 'crypto', currency: 'CCC' }
    const ddd: AccountDef = { accountId: 9, name: 'DDD', kind: 'crypto', currency: 'DDD' }
    const fullPath = [
      conversion(1, '2026-05-01', {
        source: aaa,
        destination: bbb,
        fromAmount: 2n,
        toAmount: 1n,
      }),
      conversion(2, '2026-05-02', {
        source: bbb,
        destination: ccc,
        fromAmount: 2n,
        toAmount: 1n,
      }),
    ]
    expect(
      value('CCC', [aaa, bbb, ccc], fullPath, [
        { ...aaa, balance: 1n },
        { ...bbb, balance: 0n },
        { ...ccc, balance: 0n },
      ]),
    ).toMatchObject({ status: 'complete', total: 0n, missingCurrencies: [] })

    const separateSources = [
      conversion(1, '2026-05-01', {
        source: aaa,
        destination: ccc,
        fromAmount: 2n,
        toAmount: 1n,
      }),
      conversion(2, '2026-05-02', {
        source: ddd,
        destination: ccc,
        fromAmount: 2n,
        toAmount: 1n,
      }),
    ]
    expect(
      value('CCC', [aaa, ddd, ccc], separateSources, [
        { ...aaa, balance: 1n },
        { ...ddd, balance: 1n },
        { ...ccc, balance: 0n },
      ]),
    ).toMatchObject({ status: 'complete', total: 2n, missingCurrencies: [] })
  })

  it('EARS-325: chooses shortest paths first and lexicographically smallest complete sequences on a tie', () => {
    const aaa: AccountDef = { accountId: 6, name: 'AAA', kind: 'crypto', currency: 'AAA' }
    const zzz: AccountDef = { accountId: 7, name: 'ZZZ', kind: 'crypto', currency: 'ZZZ' }

    const directWins = [
      conversion(1, '2026-06-01', {
        source: CARD_USD,
        destination: BANK_RUB,
        fromAmount: 1n,
        toAmount: 10n,
      }),
      conversion(2, '2026-06-02', {
        source: CARD_USD,
        destination: CARD_THB,
        fromAmount: 1n,
        toAmount: 100n,
      }),
      conversion(3, '2026-06-03', {
        source: CARD_THB,
        destination: BANK_RUB,
        fromAmount: 100n,
        toAmount: 2_000n,
      }),
    ]
    expect(
      value('RUB', [BANK_RUB, CARD_USD, CARD_THB], directWins, [
        { ...BANK_RUB, balance: 0n },
        { ...CARD_USD, balance: 1n },
        { ...CARD_THB, balance: 0n },
      ]),
    ).toMatchObject({ status: 'complete', total: 10n })

    const lexicographicTie = [
      conversion(1, '2026-06-01', {
        source: CARD_USD,
        destination: zzz,
        fromAmount: 1n,
        toAmount: 2n,
      }),
      conversion(2, '2026-06-02', {
        source: zzz,
        destination: BANK_RUB,
        fromAmount: 2n,
        toAmount: 10n,
      }),
      conversion(3, '2026-06-03', {
        source: CARD_USD,
        destination: aaa,
        fromAmount: 1n,
        toAmount: 2n,
      }),
      conversion(4, '2026-06-04', {
        source: aaa,
        destination: BANK_RUB,
        fromAmount: 2n,
        toAmount: 6n,
      }),
    ]
    const valuationAccounts = [
      { ...BANK_RUB, balance: 0n },
      { ...CARD_USD, balance: 1n },
      { ...aaa, balance: 0n },
      { ...zzz, balance: 0n },
    ]
    expect(
      value(
        'RUB',
        [BANK_RUB, CARD_USD, aaa, zzz],
        [...lexicographicTie].reverse(),
        valuationAccounts,
      ),
    ).toMatchObject({ status: 'complete', total: 6n })
  })

  it('EARS-325: excludes a fully reversed conversion before replay even with an intervening operation', () => {
    const original = conversion(2, '2026-07-02', {
      source: BANK_RUB,
      destination: CARD_USD,
      fromAmount: 60_000n,
      toAmount: 1_000n,
    })
    const operations = [
      ordinary(1, '2026-07-01', [{ account: BANK_RUB, amount: 100_000n }]),
      original,
      ordinary(3, '2026-07-03', [{ account: BANK_RUB, amount: 5_000n }]),
      reverse(4, '2026-07-04', original),
    ]

    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      status: 'complete',
      total: 105_000n,
    })
  })

  /**
   * The spec's rule is a property of the reversal CHAIN, not of dates: cancel
   * from the reversal nobody has reversed, downward in pairs. An even number of
   * reversals therefore restores the original conversion into the replay.
   */
  it('EARS-325: restores a conversion whose reversal was itself reversed', () => {
    const original = conversion(2, '2026-07-02', {
      source: BANK_RUB,
      destination: CARD_USD,
      fromAmount: 60_000n,
      toAmount: 1_000n,
    })
    const undo = reverse(3, '2026-07-03', original)
    const operations = [
      ordinary(1, '2026-07-01', [{ account: BANK_RUB, amount: 100_000n }]),
      original,
      undo,
      reverse(4, '2026-07-04', undo),
    ]

    // The conversion is back in the replay, so the RUB/USD rate exists again.
    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      status: 'complete',
      total: 100_000n,
      missingCurrencies: [],
    })
  })

  it('EARS-325: resolves the chain by its reverses pointer, not by the order the reversals are dated', () => {
    const original = conversion(2, '2026-07-02', {
      source: BANK_RUB,
      destination: CARD_USD,
      fromAmount: 60_000n,
      toAmount: 1_000n,
    })
    const undo = reverse(3, '2026-07-04', original)
    // Recorded later, dated EARLIER than the reversal it undoes: date order and
    // chain order disagree, and only the chain is normative.
    const redo = reverse(4, '2026-07-03', undo)
    const operations = [
      ordinary(1, '2026-07-01', [{ account: BANK_RUB, amount: 100_000n }]),
      original,
      undo,
      redo,
    ]

    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      status: 'complete',
      total: 100_000n,
      missingCurrencies: [],
    })
  })

  it('EARS-325: offers RUB plus reachable account currencies, falls stale queries back to RUB, and offers all candidates at zero', () => {
    const representative = representativeOperations()
    const stale = value('EUR', [BANK_RUB, CASH_RUB, CARD_USD, CARD_THB, CASH_EUR], representative)
    expect(stale).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 201_000_000n,
      availableReportingCurrencies: expect.arrayContaining(['RUB', 'USD', 'THB']),
    })
    expect(stale).not.toMatchObject({
      availableReportingCurrencies: expect.arrayContaining(['EUR']),
    })

    expect(value('RUB', [CARD_USD, CASH_EUR], [])).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 0n,
      availableReportingCurrencies: expect.arrayContaining(['RUB', 'USD', 'EUR']),
    })
  })

  it('EARS-325: keeps an unreachable default RUB total withheld while preserving native balances and sorted missing codes', () => {
    const operations = [
      ordinary(1, '2026-08-01', [{ account: CARD_USD, amount: 10_000n }]),
      ordinary(2, '2026-08-02', [{ account: CASH_EUR, amount: 5_000n }]),
    ]

    expect(value('RUB', [CARD_USD, CASH_EUR], operations)).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'incomplete',
      total: null,
      missingCurrencies: ['EUR', 'USD'],
      accounts: [
        { ...CARD_USD, balance: 10_000n },
        { ...CASH_EUR, balance: 5_000n },
      ],
      availableReportingCurrencies: ['RUB'],
    })
  })

  it('EARS-325: ignores fees and endpoint postings when deriving pair rates', () => {
    const operations = [
      ordinary(1, '2026-09-01', [{ account: BANK_RUB, amount: 40_000n }]),
      conversion(2, '2026-09-02', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 20_000n,
        toAmount: 10_000n,
      }),
      conversion(3, '2026-09-03', {
        source: BANK_RUB,
        destination: CARD_USD,
        fromAmount: 10_000n,
        toAmount: 10_000n,
        fee: { account: CARD_USD, amount: 5_000n },
      }),
    ]

    expect(value('RUB', [BANK_RUB, CARD_USD], operations)).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 32_500n,
      missingCurrencies: [],
    })
  })
})
