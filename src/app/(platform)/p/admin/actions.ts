'use server'

import { auth } from '@/auth'
import { claimGateResponse } from '@/lib/platform/authGate'
import type { CabinetEnvelopeKind, CabinetValidationResult } from '@/lib/platform/cabinet'
import { WORKSPACE_REGISTRY } from '@/lib/workspace'

import { cabinetSectionClaims, cabinetSectionSlugOf } from './resources'
import { createCabinetResponseValidator } from './validation'

const validateFromRegistry = createCabinetResponseValidator(WORKSPACE_REGISTRY)

/**
 * The serializable bridge between Refine's client-side provider and the one
 * server-only composition root (EARS-402/436).
 *
 * A caller supplies only Refine's resource name and JSON response, never an
 * import path or schema. The lookup is closed over `WORKSPACE_REGISTRY`, and
 * the Server Function re-checks the claim because its exported action endpoint
 * is a boundary of its own (EARS-462), independent of the layout.
 *
 * The claim is the one the NAMED RESOURCE's section declares, not a blanket
 * `platform-admin` (#479, owner decision 34): a `finance-entry` holder passing
 * `finance.purposes` is admitted and the same session passing `hours.periods`
 * is not. Deriving it from the resource name is what keeps this boundary as
 * narrow as the section's own — a single claim here would either lock the
 * widened section out of its own screens or open every other one to it.
 */
export async function validateCabinetResponse(
  resource: string,
  envelope: CabinetEnvelopeKind,
  payload: unknown,
): Promise<CabinetValidationResult> {
  const refusal = claimGateResponse(
    await auth(),
    cabinetSectionClaims(WORKSPACE_REGISTRY, cabinetSectionSlugOf(resource)),
  )
  if (refusal) throw new Error('Forbidden')
  return validateFromRegistry(resource, envelope, payload)
}
