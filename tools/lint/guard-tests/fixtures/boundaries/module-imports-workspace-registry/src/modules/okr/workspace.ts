// ILLEGAL by the barrel too — index.ts re-exports the root, so a rule that
// named only registry.ts would be one import specifier away from meaning nothing.
import type { WorkspaceModule } from '../../lib/workspace/index'

export type Entry = WorkspaceModule
