// Fixture tree for `ears-test` — NOT repo content. A flat test covers both
// nested clauses of EARS-2 (dotted-prefix ancestry), EARS-1 has its own.
import { expect, it } from 'vitest'

it('EARS-1: shows the thing', () => {
  expect(true).toBe(true)
})

it('EARS-2: freezes the thing and emits the audit row', () => {
  expect(true).toBe(true)
})
