import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  approveExpenseRequest,
  createAccount,
  createCurrency,
  createExpenseRequest,
  createPurpose,
  listExpenseRequests,
  markExpenseRequestPaid,
  operationDisplayFacts,
  submitExpenseRequest,
} from '@/lib/finance'
import { closePlatformDb } from '@/lib/platform/db/client'

import {
  ADMIN,
  APPROVER,
  MEMBER,
  fundProjectId,
  seedCounterparty,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * What the queue's display conversion reads of a POSTED request (spec 339 §I,
 * EARS-550; issue #550): the date money moved, the money-account amounts and
 * the recorded conversion steps by their amounts — the ledger's own record,
 * which the CBR rate never replaces where it covers the display currency.
 */
beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the posting facts the queue display reads (EARS-550)', () => {
  it('EARS-550: a USD request paid from a RUB account reads its rouble leg and its step amounts', async () => {
    const memberId = await seedMember(MEMBER.email, 'Plain Member')
    await seedMember(APPROVER.email, 'Approver Person')
    await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
    await createCurrency(ADMIN, { code: 'USD', name: 'Доллар', precision: 2 })
    const rub = await createAccount(ADMIN, { name: 'Карта RUB', kind: 'card', currency: 'RUB' })
    const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
    const draft = await createExpenseRequest(MEMBER, {
      occurredOn: null,
      accountId: null,
      amount: 10_000n,
      currency: 'USD',
      purposeId: purpose.id,
      projectId: await fundProjectId(),
      counterpartyId: await seedCounterparty('Vendor', memberId),
      alreadyPaid: false,
      personalFunds: false,
    })
    await submitExpenseRequest(MEMBER, draft.id)
    await approveExpenseRequest(APPROVER, draft.id)
    const row = (await listExpenseRequests(APPROVER)).find((r) => r.id === draft.id)!
    const posted = await markExpenseRequestPaid(APPROVER, draft.id, {
      snapshot: row.snapshot!,
      occurredOn: '2026-09-05',
      accountId: rub.id,
      paidAmount: 900_000n,
      paidCurrency: 'RUB',
    })

    const facts = await operationDisplayFacts([posted.operationId!])

    expect(facts.get(posted.operationId!)).toEqual({
      operationId: posted.operationId,
      occurredOn: '2026-09-05',
      moneyAmounts: [{ currency: 'RUB', amount: -900_000n }],
      conversionSteps: [
        { fromCurrency: 'RUB', toCurrency: 'USD', fromAmount: 900_000n, toAmount: 10_000n },
      ],
    })
  })

  it('EARS-550: answers nothing for no operations, without a query', async () => {
    expect((await operationDisplayFacts([])).size).toBe(0)
  })
})
