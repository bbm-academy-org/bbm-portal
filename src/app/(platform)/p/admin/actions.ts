'use server'

import { auth } from '@/auth'
import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'
import type { CabinetEnvelopeKind, CabinetValidationResult } from '@/lib/platform/cabinet'
import { WORKSPACE_REGISTRY } from '@/lib/workspace'

import { createCabinetResponseValidator } from './validation'

const validateFromRegistry = createCabinetResponseValidator(WORKSPACE_REGISTRY)

/**
 * The serializable bridge between Refine's client-side provider and the one
 * server-only composition root (EARS-402/436).
 *
 * A caller supplies only Refine's resource name and JSON response, never an
 * import path or schema. The lookup is closed over `WORKSPACE_REGISTRY`, and
 * the Server Function re-checks `platform-admin` because its exported action
 * endpoint is a boundary of its own (EARS-462), independent of the layout.
 */
export async function validateCabinetResponse(
  resource: string,
  envelope: CabinetEnvelopeKind,
  payload: unknown,
): Promise<CabinetValidationResult> {
  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)
  if (refusal) throw new Error('Forbidden')
  return validateFromRegistry(resource, envelope, payload)
}
