// LEGAL: even the CMS side may import the kit. The kit is the one thing in
// src/ that has no owner to be walled off from.
//
// This is a statement about DEPENDENCY DIRECTION only, and not advice. The real
// `@/ui` barrel imports `tokens.css`, so a Payload collection that imported it
// would load a stylesheet inside the tsx config loader — legal by this rule and
// broken at runtime. See src/ui/README.md → «Using it».
import { AppTile } from '../ui/index'

export const Team = AppTile
