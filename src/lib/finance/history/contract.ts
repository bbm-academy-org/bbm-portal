import { z } from 'zod'

import { FINANCE_DOCUMENT_KINDS } from '@/lib/platform/db/schema/finance/finance-document'
import { FINANCE_INTAKE_KINDS } from '@/lib/platform/db/schema/finance/finance-intake-item'

import { FinanceRefusal } from '../core/errors'
import type { FinanceHistoryMapping } from './plan'

const optionalNullableInteger = z.number().int().nullable().optional()

const financeHistoryPurposeSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    categoryId: z.number().int().nullable(),
  })
  .strict()

const financeHistoryOperationMappingSchema = z
  .object({
    kind: z.enum(FINANCE_INTAKE_KINDS),
    occurredOn: z.string(),
    amount: z.string(),
    currency: z.string(),
    projectId: z.number().int(),
    accountId: optionalNullableInteger,
    counterAccountId: optionalNullableInteger,
    paidAmount: z.string().nullable().optional(),
    paidCurrency: z.string().nullable().optional(),
    feeAmount: z.string().nullable().optional(),
    feeCurrency: z.string().nullable().optional(),
    purpose: financeHistoryPurposeSchema.nullable().optional(),
    productId: optionalNullableInteger,
    counterpartyId: optionalNullableInteger,
    memberId: optionalNullableInteger,
    note: z.string().nullable().optional(),
    alreadyPaid: z.boolean().optional(),
    personalFunds: z.boolean().optional(),
    documentFileIds: z.array(z.string()),
    documentKinds: z.record(z.string(), z.enum(FINANCE_DOCUMENT_KINDS)).optional(),
  })
  .strict()

const financeHistoryMappingSchema = z
  .object({
    sourcePostId: z.string().nullable(),
    documentNumber: z.string().nullable().optional(),
    operation: financeHistoryOperationMappingSchema,
  })
  .strict()

const financeHistoryMappingsSchema = z.array(financeHistoryMappingSchema)

/** Parse the private operator file without reflecting any finance values into errors. */
export function parseFinanceHistoryMappings(value: unknown): FinanceHistoryMapping[] {
  const result = financeHistoryMappingsSchema.safeParse(value)
  if (!result.success) {
    throw new FinanceRefusal(
      'Invalid finance history mapping JSON; expected a strict array of supported finance history mappings.',
    )
  }
  return result.data
}

export function parseFinanceHistoryMappingsJson(value: string): FinanceHistoryMapping[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new FinanceRefusal('Invalid finance history mapping JSON.')
  }
  return parseFinanceHistoryMappings(parsed)
}
