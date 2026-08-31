'use server'

import { auth } from '@/auth'
import { memberAliasSchema } from '@/lib/member'
import { listEnvelopeSchema, oneEnvelopeSchema } from '@/lib/platform/api'
import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'
import type { CabinetValidationResult } from '@/lib/platform/cabinet'

const listSchema = listEnvelopeSchema(memberAliasSchema)
const oneSchema = oneEnvelopeSchema(memberAliasSchema)

/** Parse nested alias responses on the server, where the member public API is safe to load. */
export async function validateAliasResponse(
  _resource: string,
  envelope: 'list' | 'one',
  payload: unknown,
): Promise<CabinetValidationResult> {
  if (claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)) throw new Error('Forbidden')
  const parsed = (envelope === 'list' ? listSchema : oneSchema).safeParse(payload)
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
        .join('; '),
    }
  }
  return { success: true, data: parsed.data }
}
