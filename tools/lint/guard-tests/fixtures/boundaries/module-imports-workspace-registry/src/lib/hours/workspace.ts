// ILLEGAL (spec 311 EARS-456, EARS-457, D-3): a module reading the composition
// root can read its neighbours, and closes an import cycle on itself.
import { WORKSPACE_REGISTRY } from '../workspace/registry'

export const hours = WORKSPACE_REGISTRY
