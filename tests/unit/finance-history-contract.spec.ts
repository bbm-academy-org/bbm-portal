// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { FinanceRefusal, parseFinanceHistoryMappings } from '@/lib/finance'

const validMapping = {
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
    documentKinds: { 'file-receipt': 'fiscal_receipt' },
  },
}

describe('the finance history operator JSON boundary', () => {
  it('EARS-517: accepts the exact private mapping shape', () => {
    expect(parseFinanceHistoryMappings([validMapping])).toEqual([validMapping])
  })

  it.each([
    [
      'unsupported operation kind',
      [{ ...validMapping, operation: { ...validMapping.operation, kind: 'refund' } }],
    ],
    ['non-array root', { mapping: validMapping }],
    ['missing operation', [{ sourcePostId: 'post-expense' }]],
    [
      'unknown nested field',
      [
        {
          ...validMapping,
          operation: { ...validMapping.operation, bankPassword: 'private-value' },
        },
      ],
    ],
    [
      'invalid document kind',
      [
        {
          ...validMapping,
          operation: {
            ...validMapping.operation,
            documentKinds: { 'file-receipt': 'spreadsheet' },
          },
        },
      ],
    ],
  ])('EARS-517: rejects %s before planning', (_case, input) => {
    expect(() => parseFinanceHistoryMappings(input)).toThrow(FinanceRefusal)
  })

  it('EARS-517: reports a safe boundary error without echoing private finance values', () => {
    const secret = 'PRIVATE-FINANCE-PAYLOAD-98273'

    expect(() =>
      parseFinanceHistoryMappings([
        {
          ...validMapping,
          operation: { ...validMapping.operation, kind: 'refund', note: secret },
        },
      ]),
    ).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(secret),
      }),
    )
  })
})
