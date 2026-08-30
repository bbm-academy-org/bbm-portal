import { z } from 'zod'

import { financeReferenceRecordSchema, type FinanceReferenceRecord } from '@/lib/finance'
import { adminRoute } from '@/lib/platform/api'

import {
  deleteFinanceReference,
  getFinanceReference,
  updateFinanceReference,
} from '../../references'

export const GET = adminRoute<undefined, FinanceReferenceRecord>({
  output: financeReferenceRecordSchema,
  handler: getFinanceReference,
})

export const PATCH = adminRoute<unknown, FinanceReferenceRecord>({
  input: z.unknown(),
  output: financeReferenceRecordSchema,
  handler: updateFinanceReference,
})

export const DELETE = adminRoute<undefined, FinanceReferenceRecord>({
  output: financeReferenceRecordSchema,
  handler: deleteFinanceReference,
})
