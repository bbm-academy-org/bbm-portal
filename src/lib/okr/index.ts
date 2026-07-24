/**
 * OKR module — first dynamic module of the BBM Platform (ADR-002, BBMP-130).
 * Public surface of the module (unrouted until P3 — consumed by
 * src/modules/okr/view); nothing here may import CMS internals
 * (collections/globals/endpoints/payload config) — enforced by
 * dependency-cruiser in CI.
 */
export { getOkrTree, OkrUnavailableError } from './cache'
export { GRACE_DAYS, OKR_PERIOD, TEAM } from './config'
export { expectedShare, inGracePeriod } from './rollup'
export type { Health, OkrAction, OkrKr, OkrObjective, OkrTask, OkrTree } from './types'
