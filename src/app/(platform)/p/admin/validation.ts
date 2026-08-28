import { listEnvelopeSchema, oneEnvelopeSchema } from '@/lib/platform/api/contract'
import type {
  CabinetEnvelopeKind,
  CabinetResponseValidator,
  CabinetValidationResult,
} from '@/lib/platform/cabinet'
import type { WorkspaceEntry } from '@/lib/workspace/contract'

import { cabinetSchemas } from './resources'

/**
 * Build EARS-436 validation from the SAME entries that build the cabinet tree.
 *
 * There is deliberately no module import and no fallback path here. A resource
 * resolves only as `<slug>.<resource>` in the supplied composition root; adding
 * or removing a declaration changes navigation and validation together
 * (EARS-402/409/412). `cabinetSchemas` returns each declaration's exact Zod
 * object, so this is identity sharing rather than a copied schema.
 */
export function createCabinetResponseValidator(
  entries: readonly WorkspaceEntry[],
): CabinetResponseValidator {
  const schemas = cabinetSchemas(entries)

  return async function validateCabinetResponse(
    resource: string,
    envelope: CabinetEnvelopeKind,
    payload: unknown,
  ): Promise<CabinetValidationResult> {
    const schema = schemas[resource]
    if (!schema) {
      return {
        success: false,
        issues: `Для ресурса «${resource}» не объявлена схема модуля (EARS-436).`,
      }
    }

    const parsed = (
      envelope === 'list' ? listEnvelopeSchema(schema) : oneEnvelopeSchema(schema)
    ).safeParse(payload)
    if (parsed.success) return { success: true, data: parsed.data }

    return {
      success: false,
      issues: parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; '),
    }
  }
}
