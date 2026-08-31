// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  buildFinanceHistoryPlan,
  verifyFinanceHistoryPlanDigest,
  type FinanceHistoryMapping,
  type FinanceHistorySnapshot,
} from '@/lib/finance'

const snapshot: FinanceHistorySnapshot = {
  version: 1,
  channel: { id: 'finance', name: 'BBM Finance' },
  posts: [
    {
      id: 'post-expense',
      rootId: null,
      createdAt: '2025-01-03T10:00:00.000Z',
      message: 'Hosting paid',
      fileIds: ['file-receipt'],
    },
    {
      id: 'post-transfer',
      rootId: null,
      createdAt: '2025-01-01T10:00:00.000Z',
      message: 'Transfer',
      fileIds: [],
    },
    {
      id: 'post-conversion',
      rootId: 'post-transfer',
      createdAt: '2025-01-02T10:00:00.000Z',
      message: 'Converted RUB to THB',
      fileIds: ['file-exchange'],
    },
  ],
  files: [
    {
      id: 'file-receipt',
      postId: 'post-expense',
      filename: 'receipt.pdf',
      mime: 'application/pdf',
      size: 128,
      contentDigest: 'sha256:receipt',
      sourcePath: 'finance/receipt.pdf',
    },
    {
      id: 'file-exchange',
      postId: 'post-conversion',
      filename: 'exchange.png',
      mime: 'image/png',
      size: 256,
      contentDigest: 'sha256:exchange',
      sourcePath: 'finance/exchange.png',
    },
  ],
}

const mappings: FinanceHistoryMapping[] = [
  {
    sourcePostId: 'post-expense',
    documentNumber: 'INV-42',
    operation: {
      kind: 'expense',
      occurredOn: '2025-01-03',
      amount: '3000',
      currency: 'RUB',
      accountId: 10,
      projectId: 20,
      purpose: { id: 30, name: 'Hosting', categoryId: null },
      documentFileIds: ['file-receipt'],
    },
  },
  {
    sourcePostId: 'post-transfer',
    operation: {
      kind: 'transfer',
      occurredOn: '2025-01-01',
      amount: '1000',
      currency: 'RUB',
      accountId: 10,
      counterAccountId: 11,
      projectId: 20,
      documentFileIds: [],
    },
  },
  {
    sourcePostId: 'post-conversion',
    operation: {
      kind: 'conversion',
      occurredOn: '2025-01-02',
      amount: '8750',
      currency: 'RUB',
      paidAmount: '3500',
      paidCurrency: 'THB',
      feeAmount: '50',
      feeCurrency: 'RUB',
      accountId: 10,
      counterAccountId: 12,
      projectId: 20,
      documentFileIds: ['file-exchange'],
    },
  },
]

describe('the one-time finance history plan', () => {
  it('EARS-517: is versioned, deterministic, source-bound and sorted by operation date plus source identity', () => {
    const first = buildFinanceHistoryPlan({
      snapshot,
      mappings: [...mappings].reverse(),
      existingOperations: [],
    })
    const second = buildFinanceHistoryPlan({ snapshot, mappings, existingOperations: [] })

    expect(first).toEqual(second)
    expect(first.version).toBe(1)
    expect(first.sourceSnapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.operations.map((row) => row.sourcePostId)).toEqual([
      'post-transfer',
      'post-conversion',
      'post-expense',
    ])
    expect(first.operations.map((row) => row.sourceRef)).toEqual([
      'post-transfer',
      'post-conversion',
      'INV-42',
    ])
    expect(verifyFinanceHistoryPlanDigest(first, first.planDigest)).toBe(first)
    expect(() => verifyFinanceHistoryPlanDigest(first, `sha256:${'0'.repeat(64)}`)).toThrow(
      /digest/i,
    )
  })

  it('EARS-517: reports existing operations as duplicates and invalid source rows with reasons', () => {
    const plan = buildFinanceHistoryPlan({
      snapshot,
      mappings: [
        ...mappings,
        {
          sourcePostId: 'missing-post',
          operation: {
            kind: 'expense',
            occurredOn: 'not-a-date',
            amount: '0',
            currency: 'RUB',
            accountId: 10,
            projectId: 20,
            purpose: { id: 30, name: 'Hosting', categoryId: null },
            documentFileIds: ['missing-file'],
          },
        },
      ],
      existingOperations: [{ id: 77, source: 'backfill', sourceRef: 'INV-42' }],
    })

    expect(plan.duplicates).toEqual([
      expect.objectContaining({ sourceRef: 'INV-42', existingOperationId: 77 }),
    ])
    expect(plan.invalidRows).toEqual([
      expect.objectContaining({ sourcePostId: 'missing-post', reasons: expect.any(Array) }),
    ])
    expect(plan.summary).toMatchObject({
      firstOccurredOn: '2025-01-01',
      lastOccurredOn: '2025-01-03',
      candidateCount: 4,
      validCount: 2,
      duplicateCount: 1,
      invalidCount: 1,
      sourcePostCount: 3,
      sourceDocumentCount: 2,
      operationsWithDocuments: 2,
      operationsWithoutDocuments: 2,
    })
  })

  it('EARS-518: validates actual conversion amounts and separate fees without inventing an opening balance', () => {
    const plan = buildFinanceHistoryPlan({ snapshot, mappings, existingOperations: [] })
    const conversion = plan.operations.find((row) => row.kind === 'conversion')

    expect(conversion).toMatchObject({
      amount: '8750',
      currency: 'RUB',
      paidAmount: '3500',
      paidCurrency: 'THB',
      feeAmount: '50',
      feeCurrency: 'RUB',
      validation: { valid: true, reasons: [] },
    })
    expect(plan.operations.some((row) => row.kind === ('opening_balance' as 'expense'))).toBe(false)
  })

  it('EARS-519: groups recorded spend by purpose and names uncategorised expense rows', () => {
    const plan = buildFinanceHistoryPlan({ snapshot, mappings, existingOperations: [] })

    expect(plan.purposeGroups).toEqual([
      {
        purposeId: 30,
        purposeName: 'Hosting',
        operationCount: 1,
        totals: [{ currency: 'RUB', amount: '3000' }],
        uncategorizedSourceRefs: ['INV-42'],
      },
    ])
    expect(plan.summary.uncategorizedCount).toBe(1)
  })
})
