// ILLEGAL (spec 311 EARS-457): the CMS side is not the frame. This fixture is
// what EARS-457 catches that EARS-456 does not — the caller is no module.
import { WORKSPACE_REGISTRY } from '../lib/workspace/registry'

export const Team = WORKSPACE_REGISTRY
