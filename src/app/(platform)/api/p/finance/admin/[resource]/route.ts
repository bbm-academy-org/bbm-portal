import { z } from 'zod'

import { financeReferenceRecordSchema, type FinanceReferenceRecord } from '@/lib/finance'
import { adminRoute } from '@/lib/platform/api'

import { createFinanceReference, listFinanceReferences } from '../references'

export const GET = adminRoute<undefined, FinanceReferenceRecord>({
  output: financeReferenceRecordSchema,
  handler: listFinanceReferences,
})

export const POST = adminRoute<unknown, FinanceReferenceRecord>({
  input: z.unknown(),
  output: financeReferenceRecordSchema,
  handler: createFinanceReference,
})
