import type { CabinetWorkspaceEntry } from '@/lib/workspace/contract'

import { memberAdminSection } from './contract'

/** The registry is an admin tenant, not a launcher app (spec 311 EARS-441). */
export const memberWorkspaceEntry: CabinetWorkspaceEntry = {
  kind: 'cabinet',
  slug: 'member',
  name: 'Участники',
  admin: memberAdminSection,
}
