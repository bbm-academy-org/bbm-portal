// LEGAL: a module owns the tables under its own schema directory, and the shared
// `core` schema handle is importable by everyone.
import { core } from '../platform/db/schema/core'
import { periods } from '../platform/db/schema/hours/tables'

export const owned = [core, periods]
