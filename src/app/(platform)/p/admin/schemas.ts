import { okrAdminSection } from '@/lib/okr/contract'
import type { WorkspaceAdminSection } from '@/lib/workspace/contract'

import { resourceName } from './resources'

/**
 * The CLIENT-SAFE half of the cabinet's registration (spec 311 EARS-436, D-2).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SECOND LIST. The cabinet's data provider
 * runs in the browser and parses every answer with the module's own zod schema.
 * `WORKSPACE_REGISTRY` cannot reach the browser: a module's declaration carries
 * its `status` provider, which reads the module's data layer, which reaches
 * `pg`. So the schemas have to arrive through an import that stays client-safe.
 *
 * They are the SAME OBJECTS. Each module declares its admin section once, in
 * its own client-safe `contract.ts`, and both its registry entry and this map
 * import that one object — there is nothing here to fall out of step with the
 * composition root. `tests/unit/cabinet-shell.spec.ts` asserts identity, not
 * equality, so a copy would fail by name.
 *
 * Adding a module costs the same one line here it costs in the composition
 * root, and the cabinet's screens still hold zero lines naming an app.
 */
const CABINET_SECTIONS: Record<string, WorkspaceAdminSection> = {
  okr: okrAdminSection,
}

export const CABINET_SCHEMAS = Object.fromEntries(
  Object.entries(CABINET_SECTIONS).flatMap(([slug, section]) =>
    section.resources.map((resource) => [resourceName(slug, resource.name), resource.schema]),
  ),
)
