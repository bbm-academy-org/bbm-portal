import { z } from 'zod'

import {
  financeAdminSection,
  financeReferenceRecordSchema,
  type FinanceReferenceRecord,
} from '@/lib/finance'
import { adminRoute } from '@/lib/platform/api'

import {
  deleteFinanceReference,
  getFinanceReference,
  updateFinanceReference,
} from '../../references'

/**
 * WHO may reach these handlers is the finance SECTION's declaration, not a
 * literal (spec 339 EARS-529, owner decision 34, 2026-09-14):
 * `platform-admin` — prepended by `adminRoute` — plus `finance-entry`. The
 * module refuses the same set again in `assertFinanceReferenceAccess`, however
 * the URL was reached; these two enforcements cannot drift because both read
 * the role from `src/lib/finance/core/actor.ts`.
 */
const admittedClaims = financeAdminSection.additionalClaims

export const GET = adminRoute<undefined, FinanceReferenceRecord>({
  additionalClaims: admittedClaims,
  output: financeReferenceRecordSchema,
  handler: getFinanceReference,
})

export const PATCH = adminRoute<unknown, FinanceReferenceRecord>({
  additionalClaims: admittedClaims,
  input: z.unknown(),
  output: financeReferenceRecordSchema,
  handler: updateFinanceReference,
})

export const DELETE = adminRoute<undefined, FinanceReferenceRecord>({
  additionalClaims: admittedClaims,
  output: financeReferenceRecordSchema,
  handler: deleteFinanceReference,
})
