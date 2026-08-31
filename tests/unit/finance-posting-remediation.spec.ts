// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseRate } from '@/lib/finance'
import { createIntakePostingSnapshot, deriveRate } from '@/lib/finance/intake/posting'
import type { FinanceIntakeItemView } from '@/lib/finance/intake/items'

const ITEM: FinanceIntakeItemView = {
  id: 1,
  source: 'request',
  sourceRef: 'request:1',
  kind: 'expense',
  status: 'submitted',
  occurredOn: '2026-08-31',
  accountId: 1,
  counterAccountId: null,
  amount: 100n,
  currency: 'RUB',
  paidAmount: 3n,
  paidCurrency: 'THB',
  feeAmount: null,
  feeCurrency: null,
  purposeId: 1,
  projectId: 1,
  productId: null,
  counterpartyId: 1,
  memberId: null,
  note: 'fixture',
  alreadyPaid: true,
  personalFunds: false,
  createdBy: 1,
  decidedBy: null,
  decidedAt: null,
  refusalReason: null,
  postedBy: null,
  postedAt: null,
  operationId: null,
}

const DOCUMENT = {
  id: 4,
  filename: 'invoice.pdf',
  mime: 'application/pdf',
  size: 20,
  kind: 'ru_invoice',
  uploadedBy: 1,
  uploadedAt: new Date('2026-08-31T00:00:00Z'),
}

describe('finance posting remediation (#416)', () => {
  it('normalizes a derived trailing decimal point to the canonical rate parseRate accepts', () => {
    const fromAmount = 10n ** 49n
    const rate = deriveRate(fromAmount, 0, fromAmount + 1n, 0)

    expect(rate).toBe('1')
    expect(() => parseRate(rate)).not.toThrow()
  })

  it('hashes the same posting snapshot identically regardless of object insertion order', () => {
    const reversedItem = Object.fromEntries(Object.entries(ITEM).reverse()) as FinanceIntakeItemView
    const reversedDocument = Object.fromEntries(
      Object.entries(DOCUMENT).reverse(),
    ) as typeof DOCUMENT

    expect(createIntakePostingSnapshot(ITEM, [DOCUMENT])).toEqual(
      createIntakePostingSnapshot(reversedItem, [reversedDocument]),
    )
  })

  it('routes the cross-currency result through the existing operation input parser', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/finance/intake/posting.ts'), 'utf8')
    const crossCurrency = source.slice(
      source.indexOf('async function recordCrossCurrencyResult'),
      source.indexOf('async function resolveExpensePayer'),
    )

    expect(crossCurrency).toContain('parseRecordOperationInput(operationInput(item, postings))')
  })
})
