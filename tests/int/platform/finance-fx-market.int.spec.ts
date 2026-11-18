// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCurrency,
  createIntakeItem,
  createPurpose,
  postIntakeItem,
  recordConversion,
  recordOperation,
  reverseOperation,
} from '@/lib/finance'
import {
  loadMarketEntries,
  loadMarketValuation,
  marketEntryForItem,
} from '@/lib/finance/fx/market-valuation'
import { marketChainFacts, marketIntakeFacts } from '@/lib/finance/market-facts'
import { syncCbrRates } from '@/lib/finance/fx/store'
import { closePlatformDb } from '@/lib/platform/db/client'

import {
  ADMIN,
  APPROVER,
  ENTRY,
  fixtureWrite,
  fundProjectId,
  seedCounterparty,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'
import { asMigrator, truncateAsFixture } from './privilege-helpers'

/**
 * The §J market valuation against the really-migrated ledger (spec
 * `docs/specs/339-ledger-intake.md` §J, EARS-557/560/561; issue #558): which
 * rows the read model loads, and that a cross-currency payment and a
 * conversion chain are told apart by the ledger's own shape.
 */
const DAY = '2026-11-13'

beforeEach(async () => {
  await truncateAsFixture('truncate table core.finance_fx_rate restart identity')
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

/**
 * A CBR quote stored through its ONLY writer, the sync job (EARS-552) — a raw
 * insert would put a non-sync door into the rate table's audit trail, which
 * `finance-fx-rates.int.spec.ts` asserts never happens.
 */
async function seedRate(currency: string, rateDate: string, valueRub: string, nominal = 1) {
  await syncCbrRates({
    from: rateDate,
    to: rateDate,
    today: rateDate,
    fetchDaily: async () => ({
      effectiveDate: rateDate,
      rates: [{ currency, nominal, valueRub }],
    }),
  })
}

async function seedLedger() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  const approverMemberId = await seedMember(APPROVER.email, 'Approver Person')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'USD', name: 'Доллар', precision: 2 })
  await createCurrency(ADMIN, { code: 'USDT', name: 'Tether', precision: 6 })
  const rub = await createAccount(ADMIN, { name: 'Карта RUB', kind: 'card', currency: 'RUB' })
  const rub2 = await createAccount(ADMIN, { name: 'Счёт RUB', kind: 'bank', currency: 'RUB' })
  const usd = await createAccount(ADMIN, { name: 'Счёт USD', kind: 'bank', currency: 'USD' })
  const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
  const projectId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Anthropic', entryMemberId)
  await seedRate('USD', DAY, '92.0000')
  return {
    entryMemberId,
    approverMemberId,
    rubId: rub.id,
    rub2Id: rub2.id,
    usdId: usd.id,
    purposeId: purpose.id,
    projectId,
    counterpartyId,
  }
}

type Refs = Awaited<ReturnType<typeof seedLedger>>

/** Approve and attach a receipt RAW — the posting gate's preconditions, not under test here. */
async function readyToPost(itemId: number, refs: Refs): Promise<void> {
  await fixtureWrite(async (tx) => {
    await tx.execute(sql`
      update core.finance_intake_item
         set status = 'approved', decided_by = ${refs.approverMemberId}, decided_at = now()
       where id = ${itemId}
    `)
    const doc = await tx.execute(sql`
      insert into core.finance_document
        (storage_key, content_digest, filename, mime, size, kind, storage_state, uploaded_by)
      values (${`finance/documents/market-${itemId}.pdf`}, ${`sha256:${'0'.repeat(64)}`},
              'receipt.pdf', 'application/pdf', 10, 'fiscal_receipt', 'ready',
              ${refs.approverMemberId})
      returning id
    `)
    await tx.execute(sql`
      insert into core.finance_document_link (document_id, intake_item_id, linked_by)
      values (${Number((doc.rows[0] as { id: number }).id)}, ${itemId}, ${refs.approverMemberId})
    `)
  })
}

async function postedExpense(refs: Refs, overrides: Record<string, unknown>) {
  const item = await createIntakeItem(ENTRY, {
    source: 'manual',
    kind: 'expense',
    occurredOn: DAY,
    accountId: refs.rubId,
    amount: 10_000n,
    currency: 'USD',
    paidAmount: 920_000n,
    paidCurrency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    ...overrides,
  })
  await readyToPost(item.id, refs)
  return postIntakeItem(APPROVER, item.id)
}

describe('the measured set, read from the ledger (EARS-557)', () => {
  it('EARS-557: a posted USD expense paid from a RUB account is measured with Факт 9 250 ₽; a same-currency item, a reversed item and the reversal are not', async () => {
    const refs = await seedLedger()
    // Posted in date order: the ledger refuses an FX-pair write dated before
    // one already posted (EARS-328's write order).
    const reversed = await postedExpense(refs, { paidAmount: 930_000n })
    await reverseOperation(APPROVER, reversed.operationId!)
    await postedExpense(refs, {
      amount: 120_000n,
      currency: 'RUB',
      paidAmount: null,
      paidCurrency: null,
    })
    const measuredItem = await postedExpense(refs, {
      feeAmount: 5_000n,
      feeCurrency: 'RUB',
      occurredOn: '2026-11-14', // a Saturday: Friday's rate
    })

    const entries = await loadMarketEntries()
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry).toMatchObject({ subject: 'payment', itemId: measuredItem.id, date: '2026-11-14' })
    expect(entry.valuation.status).toBe('measured')
    if (entry.valuation.status !== 'measured') return
    expect(entry.valuation.overpayment).toMatchObject({
      factRub: 925_000n,
      marketRub: 920_000n,
      amount: 5_000n,
    })
    expect(entry.valuation.rates.market.rateDate).toBe(DAY)
    expect(entry.payee).toBe('Anthropic')
    expect(entry.route).toBe('Карта RUB · RUB → USD')
  })

  it('EARS-557: a period filters by payment date, and one request reads the same entry the report does', async () => {
    const refs = await seedLedger()
    const item = await postedExpense(refs, {})
    expect(await loadMarketEntries({ from: '2026-11-14' })).toEqual([])
    expect(await loadMarketEntries({ from: DAY, to: DAY })).toHaveLength(1)
    const one = await marketEntryForItem(item.id)
    expect(one).toEqual((await loadMarketEntries())[0])
    const sameCurrency = await postedExpense(refs, {
      amount: 120_000n,
      currency: 'RUB',
      paidAmount: null,
      paidCurrency: null,
    })
    expect(await marketEntryForItem(sameCurrency.id)).toBe(null)
  })
})

describe('«факт не внесён», read from the intake (EARS-560)', () => {
  it("EARS-560: an already-paid, unposted USD request paid from the member's card with no paid currency stated is «факт не внесён», dated by occurred_on", async () => {
    const refs = await seedLedger()
    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'expense',
      alreadyPaid: true,
      occurredOn: '2026-11-02',
      accountId: refs.rubId,
      amount: 10_000n,
      currency: 'USD',
      purposeId: refs.purposeId,
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
    })
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item
           set status = 'submitted', account_id = null, personal_funds = true,
               member_id = ${refs.entryMemberId}
         where id = ${item.id}
      `),
    )
    const entry = await marketEntryForItem(item.id)
    expect(entry).toMatchObject({
      subject: 'payment',
      date: '2026-11-02',
      personalFunds: true,
      payee: 'Entry Clerk',
      route: 'свои средства → USD',
      fact: null,
      valuation: { status: 'not_posted', statedPaidAmount: null },
    })
    expect(await loadMarketEntries()).toHaveLength(1)
  })
})

describe('conversion chains, read from the ledger (EARS-561)', () => {
  it("EARS-561: a cross-currency expense's own conversion legs count once, as that payment, never as a chain", async () => {
    const refs = await seedLedger()
    await postedExpense(refs, {})
    const entries = await loadMarketEntries()
    expect(entries.map((e) => e.subject)).toEqual(['payment'])
  })

  it('EARS-561: RUB → USDT → USD of 100 000 ₽ arriving as 1 050 USD at 92,00 is Рынок 96 600 ₽, Переплата +3 400 ₽, «хуже рынка на 3,5%»', async () => {
    const refs = await seedLedger()
    const chain = await recordConversion(APPROVER, {
      occurredOn: DAY,
      sourceAccountId: refs.rubId,
      targetAccountId: refs.usdId,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USDT',
          fromAmount: 10_000_000n,
          toAmount: 1_060_000_000n,
          rate: '0.0106',
        },
        {
          fromCurrency: 'USDT',
          toCurrency: 'USD',
          fromAmount: 1_060_000_000n,
          toAmount: 105_000n,
          rate: '0.99',
        },
      ],
    })
    const entries = await loadMarketEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      subject: 'chain',
      operationId: chain.id,
      date: DAY,
      route: 'RUB → USDT → USD',
      valuation: {
        status: 'measured',
        overpayment: {
          factRub: 10_000_000n,
          marketRub: 9_660_000n,
          amount: 340_000n,
          percentTenths: 35n,
          wording: 'хуже рынка на 3,5%',
        },
      },
    })
  })

  it('EARS-561: a reversed conversion, its reversal and a same-currency transfer are not chains', async () => {
    const refs = await seedLedger()
    const conversion = await recordConversion(APPROVER, {
      occurredOn: DAY,
      sourceAccountId: refs.rubId,
      targetAccountId: refs.usdId,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 920_000n,
          toAmount: 10_000n,
          rate: '0.0108',
        },
      ],
    })
    await reverseOperation(APPROVER, conversion.id)
    await recordOperation(APPROVER, {
      occurredOn: DAY,
      source: 'manual',
      postings: [
        { accountId: refs.rubId, amount: -50_000n, currency: 'RUB' },
        { accountId: refs.rub2Id, amount: 50_000n, currency: 'RUB' },
      ],
    })
    expect(await loadMarketEntries()).toEqual([])
  })
})

describe('the report reads (#559)', () => {
  it('EARS-561: a chain whose exchange step carries a real fee on the source account has that fee inside Факт', async () => {
    const refs = await seedLedger()
    const chain = await recordConversion(APPROVER, {
      occurredOn: DAY,
      sourceAccountId: refs.rubId,
      targetAccountId: refs.usdId,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 930_000n,
          toAmount: 10_000n,
          rate: '0.0107526882',
          fee: { amount: 5_000n, currency: 'RUB' },
        },
      ],
    })
    const [entry] = await loadMarketEntries()
    expect(entry).toMatchObject({
      subject: 'chain',
      operationId: chain.id,
      route: 'RUB → USD',
      source: { amount: 935_000n, currency: 'RUB', fee: 5_000n, account: 'Карта RUB' },
      target: { amount: 10_000n, currency: 'USD', fee: 0n, account: 'Счёт USD' },
      valuation: {
        status: 'measured',
        // Факт 9 300 + 50 ₽ fee against Рынок 100 USD × 92,00 = 9 200 ₽.
        overpayment: {
          factRub: 935_000n,
          marketRub: 920_000n,
          amount: 15_000n,
          percentTenths: 16n,
        },
      },
    })
  })

  it('EARS-561: an intake item of kind = conversion, once posted, is measured as a chain', async () => {
    const refs = await seedLedger()
    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'conversion',
      occurredOn: DAY,
      accountId: refs.rubId,
      counterAccountId: refs.usdId,
      amount: 930_000n,
      currency: 'RUB',
      paidAmount: 10_000n,
      paidCurrency: 'USD',
      projectId: refs.projectId,
    })
    await readyToPost(item.id, refs)
    const posted = await postIntakeItem(APPROVER, item.id)
    const entries = await loadMarketEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      subject: 'chain',
      operationId: posted.operationId,
      route: 'RUB → USD',
      valuation: {
        status: 'measured',
        overpayment: {
          factRub: 930_000n,
          marketRub: 920_000n,
          amount: 10_000n,
          wording: 'хуже рынка на 1,1%',
        },
      },
    })
  })

  it('EARS-564: the period bounds both reads in SQL — a chain and a «факт не внесён» request outside it are not loaded', async () => {
    const refs = await seedLedger()
    await recordConversion(APPROVER, {
      occurredOn: DAY,
      sourceAccountId: refs.rubId,
      targetAccountId: refs.usdId,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 920_000n,
          toAmount: 10_000n,
          rate: '0.0108',
        },
      ],
    })
    const pending = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'expense',
      alreadyPaid: true,
      occurredOn: '2026-11-02',
      accountId: refs.rubId,
      amount: 10_000n,
      currency: 'USD',
      purposeId: refs.purposeId,
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
    })
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item
           set status = 'submitted', account_id = null, personal_funds = true,
               member_id = ${refs.entryMemberId}
         where id = ${pending.id}
      `),
    )
    expect(
      (await marketChainFacts({ period: { from: '2026-11-14' } })).map((f) => f.occurredOn),
    ).toEqual([])
    expect(await marketChainFacts({ period: { from: DAY, to: DAY } })).toHaveLength(1)
    expect(await marketIntakeFacts({ period: { to: '2026-11-01' } })).toEqual([])
    expect(
      (await marketIntakeFacts({ period: { from: '2026-11-02', to: '2026-11-02' } })).map(
        (f) => f.itemId,
      ),
    ).toEqual([pending.id])
    const { entries, excludedChains } = await loadMarketValuation({
      from: '2026-11-02',
      to: '2026-11-02',
    })
    expect(entries.map((e) => e.subject)).toEqual(['payment'])
    expect(excludedChains).toEqual([])
  })

  it('EARS-560: a «факт не внесён» request with no occurred_on is dated by its Moscow submission day — 22:30 UTC on 1 November is 2 November in the period, in the row and in the entry', async () => {
    const refs = await seedLedger()
    const pending = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'expense',
      alreadyPaid: true,
      occurredOn: '2026-11-02',
      accountId: refs.rubId,
      amount: 10_000n,
      currency: 'USD',
      purposeId: refs.purposeId,
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
    })
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item
           set status = 'submitted', account_id = null, personal_funds = true,
               member_id = ${refs.entryMemberId}, occurred_on = null
         where id = ${pending.id}
      `),
    )
    // `created_at` is immutable (`0016` §3), so the fixture claims its submission
    // moment through the migrating connection with user triggers off.
    await asMigrator(async (client) => {
      await client.query('alter table core.finance_intake_item disable trigger user')
      try {
        await client.query(
          `update core.finance_intake_item
              set created_at = timestamptz '2026-11-01 22:30:00+00'
            where id = $1`,
          [pending.id],
        )
      } finally {
        await client.query('alter table core.finance_intake_item enable trigger user')
      }
    })
    // The UTC date is 1 November; the Moscow date (UTC+3) is 2 November.
    expect(await marketIntakeFacts({ period: { from: '2026-11-01', to: '2026-11-01' } })).toEqual(
      [],
    )
    const [row] = await marketIntakeFacts({ period: { from: '2026-11-02', to: '2026-11-02' } })
    expect(row).toMatchObject({ itemId: pending.id, occurredOn: null, submittedOn: '2026-11-02' })
    const { entries } = await loadMarketValuation({ from: '2026-11-02', to: '2026-11-02' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      subject: 'payment',
      date: '2026-11-02',
      month: '2026-11',
      valuation: { status: 'not_posted' },
    })
  })
})
