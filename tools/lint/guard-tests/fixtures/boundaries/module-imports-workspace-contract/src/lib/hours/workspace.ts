// LEGAL (spec 311 EARS-456): a module declares its entry against the TYPES.
import type { WorkspaceModule } from '../workspace/contract'

export const hoursWorkspaceEntry: WorkspaceModule = { kind: 'internal', slug: 'hours' }
