import { core } from '../core'

// A column object the guard reads as EMPTY — the shape a tokenizer gap leaves
// behind. Zero parsed columns must be a finding, never silence.
export const member = core.table('member', {})
