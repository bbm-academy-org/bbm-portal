'use server'

import { z } from 'zod'

import { auth } from '@/auth'
import { memberAliasSchema } from '@/lib/member'
import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'

export type AliasValidationResult =
  { success: true; data: unknown } | { success: false; issues: string }

const listSchema = z.object({ data: z.array(memberAliasSchema), total: z.number().int().min(0) })
const oneSchema = z.object({ data: memberAliasSchema })

/** Parse nested alias responses on the server, where the member public API is safe to load. */
export async function validateAliasResponse(
  envelope: 'list' | 'one',
  payload: unknown,
): Promise<AliasValidationResult> {
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
  return { success: true, data: parsed.data.data }
}
