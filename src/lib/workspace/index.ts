/**
 * `src/lib/workspace` — the frame's own module: the plug-in contract, the
 * composition root and the view model the launcher and the top bar render.
 *
 * TWO DOORS, deliberately (D-3, EARS-456/457):
 *
 * - `@/lib/workspace/contract` — types only. ANY module may import it; that is
 *   how a module declares its own entry.
 * - `@/lib/workspace/registry` — the composition root. Only this directory and
 *   `src/app/(platform)` may import it. A module that could read the registry
 *   could read its neighbours, which is exactly the coupling ADR-002 §3 forbids,
 *   and it would close an import cycle on itself.
 *
 * This barrel re-exports both, so it is itself registry-grade: `pnpm boundaries`
 * treats a module importing `@/lib/workspace` the same as importing the registry
 * directly. A module imports `@/lib/workspace/contract` and nothing else.
 */

export type {
  CabinetWorkspaceEntry,
  ExternalWorkspaceEntry,
  InternalWorkspaceEntry,
  OpenableWorkspaceEntry,
  PlannedWorkspaceEntry,
  WorkspaceAdminResource,
  WorkspaceAdminSection,
  WorkspaceEntry,
  WorkspaceIconRef,
  WorkspaceModule,
  WorkspaceStatusProvider,
} from './contract'
export { entryTarget, isOpenable } from './contract'

export { PORTFOLIO_LATER, WORKSPACE_REGISTRY } from './registry'

export {
  buildLauncherView,
  currentEntry,
  resolveStatus,
  STATUS_DEADLINE_MS,
  switcherEntries,
  tileForm,
  visibleEntries,
} from './view'
export type { ClaimPredicate, LauncherTile, LauncherTileForm } from './view'
