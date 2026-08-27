import type { WorkspaceModule } from '@/lib/workspace/contract'

import { getOkrTree } from './cache'

/**
 * The OKR module's own workspace declaration (spec 311 EARS-401).
 *
 * Same shape and same boundary as `src/lib/hours/workspace.ts`: types from
 * `@/lib/workspace/contract`, never the registry (D-3).
 */

/**
 * The module's pulse (EARS-406): how much of the quarter's tree actually has a
 * number behind it.
 *
 * `pct === null` is the OKR module's own «честная пустота» (FR-4): an objective
 * with no metric and no execution data is not 0%, it is undefined. So the line
 * counts objectives that HAVE an assessment against all of them in the period —
 * the one fact a member can act on from the home, and one that is true whether
 * or not Plane answered this second (a stale snapshot still carries it).
 *
 * The launcher's 1-second deadline (EARS-406) is what keeps this safe: reading
 * the tree can mean a live Plane fetch on a cold cache, and the home is not
 * allowed to wait for it (EARS-407).
 */
export async function okrStatusLine(): Promise<string | null> {
  const tree = await getOkrTree()
  const inPeriod = tree.objectives.filter((objective) => !objective.q4)
  if (inPeriod.length === 0) return null
  const assessed = inPeriod.filter((objective) => objective.pct !== null).length
  return `Цели квартала: ${assessed} из ${inPeriod.length} с оценкой`
}

export const okrWorkspaceEntry: WorkspaceModule = {
  kind: 'internal',
  slug: 'okr',
  name: 'OKR',
  description: 'Цели квартала',
  href: '/p/okr',
  icon: 'okr',
  status: okrStatusLine,
  // The OKR cabinet section (EARS-453, one read-only item) is #315's, declared
  // here when that shell exists. Until then: no presence under /p/admin
  // (EARS-410).
}
