/**
 * OKR module — first dynamic module of the BBM Platform (ADR-002, BBMP-130).
 * Public surface for the /okr route; nothing here may import CMS internals
 * (collections/globals/endpoints/payload config) — enforced by
 * dependency-cruiser in CI.
 */
export { getOkrTree, OkrUnavailableError } from './cache'
export { GRACE_DAYS, OKR_PERIOD, TEAM } from './config'
export { expectedShare, inGracePeriod } from './rollup'
export type { Health, OkrAction, OkrKr, OkrObjective, OkrTask, OkrTree } from './types'
