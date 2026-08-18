import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The cutover runbook as a tested artifact (#256, spec 124 EARS-25..27).
 *
 * Three of spec 124's clauses have no code to test, because their subject is the
 * RUN and not a function: the rehearsal that must precede the window (EARS-26),
 * the rollback that stays on offer until the owner accepts (EARS-25), and the
 * verdict line the owner reads instead of diffing two JSON files (EARS-27). What
 * a test CAN pin is that the procedure a human executes actually carries them —
 * that the runbook states the precondition with its evidence link, gates the
 * traffic step on `VERDICT: identical`, and spells out the rollback including
 * the archive-name restoration the clause names.
 *
 * That is deliberately a weaker claim than "the rehearsal happened", and the
 * tests below say so in their names: the rehearsal record itself is the #255
 * comment thread linked from #256, not this file. Until the runbook existed
 * these clauses were deferred in `tools/lint/ears-test-lint.mjs`; the deferral
 * that remains is EARS-15, whose subject (archiving the JSON and deleting its
 * code path) happens only AFTER the owner's acceptance and belongs to PR-2.
 */
const RUNBOOK = readFileSync(
  resolve(import.meta.dirname, '../../docs/runbooks/hours-core-cutover.md'),
  'utf8',
)

describe('docs/runbooks/hours-core-cutover.md', () => {
  it('EARS-26: makes the dev rehearsal a stated precondition with a link to its record', () => {
    expect(RUNBOOK).toMatch(/##\s*Preconditions/i)
    expect(RUNBOOK).toMatch(/rehearsal/i)
    // The record lives on the issues, not in the repo — the runbook must point
    // at it, otherwise "rehearsed" is a claim with nothing behind it.
    expect(RUNBOOK).toMatch(/#255/)
    expect(RUNBOOK).toMatch(/#256/)
  })

  it('EARS-26: names #125 in production as the other precondition', () => {
    expect(RUNBOOK).toMatch(/#125/)
  })

  it('EARS-27: gates the traffic step on the verify verdict, not on eyeballing JSON', () => {
    const verdictAt = RUNBOOK.indexOf('VERDICT: identical')
    expect(verdictAt).toBeGreaterThan(-1)
    expect(RUNBOOK).toContain('platform:hours:verify')
    // The re-run that brings traffic up comes AFTER the verdict in the document,
    // because it comes after it in the window.
    expect(RUNBOOK.lastIndexOf('pnpm deploy:prod\n')).toBeGreaterThan(verdictAt)
  })

  it('EARS-27: documents the differing verdict as a stop, with truncate-and-retry', () => {
    expect(RUNBOOK).toMatch(/VERDICT: differs/)
    expect(RUNBOOK).toMatch(/truncate table core\.hours_publication/)
  })

  it('EARS-25: writes the rollback procedure down — image, and the archive name', () => {
    expect(RUNBOOK).toContain('pnpm deploy:prod --rollback 07ceab2')
    // "Restore the name first if the rename already happened" is the half of
    // EARS-25 that is easy to forget and impossible to improvise at 2am.
    expect(RUNBOOK).toMatch(/hours\.json\./)
    expect(RUNBOOK).toMatch(/rename/i)
  })

  it('EARS-25: bounds the rollback at the owner’s acceptance — forward-fix after', () => {
    expect(RUNBOOK).toMatch(/forward[- ]fix/i)
    expect(RUNBOOK).toMatch(/until the owner/i)
  })

  it('EARS-13: keeps the window ordering explicit — hold, seed, import, verify, traffic', () => {
    const order = [
      '--hold-before-up',
      'platform:member:seed',
      'platform:hours:import',
      'platform:hours:verify',
    ]
    let at = -1
    for (const needle of order) {
      const i = RUNBOOK.indexOf(needle)
      expect(i, `${needle} missing or out of order`).toBeGreaterThan(at)
      at = i
    }
  })

  it('EARS-14: keeps the "dataset is never committed" rule and its shredding', () => {
    expect(RUNBOOK).toMatch(/NEVER committed/i)
    expect(RUNBOOK).toContain('shred -u')
  })

  it('names the real compose objects, not invented ones', () => {
    // Every one of these is verified against deploy/docker-compose.prod.yml and
    // tools/deploy/prod.mjs; a rename there must break this test rather than
    // strand an operator on a command that does not exist.
    expect(RUNBOOK).toContain('docker-compose.prod.yml')
    expect(RUNBOOK).toContain('bbm-portal_hoursdata')
    expect(RUNBOOK).toContain('--profile tools run --rm')
    expect(RUNBOOK).toContain('bbm-portal-app-1')
  })
})
