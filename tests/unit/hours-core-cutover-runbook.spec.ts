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
 * these clauses were deferred in `tools/lint/ears-test-lint.mjs`; the list is
 * EMPTY since PR-2 of #256, whose EARS-15 test is
 * `tests/unit/hours-json-store-removed.spec.ts`.
 *
 * **The window has RUN** (2026-08-18, accepted the same day), so the document
 * these tests read is now a RECORD. That changes what may be pinned: the
 * procedure's live parts — the banner, the preconditions, the rollback bound,
 * the ops steps that are still ahead — yes; the exact spelling of commands that
 * no longer exist — no, or the next honest edit of the historical section reads
 * as a regression.
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

  it('EARS-13: says up front that the window RAN and is not re-runnable', () => {
    // Since #256 this document is a record, not a procedure to execute: the
    // import command it drives no longer exists. The banner is what a reader
    // meets first, so it is what this test pins — not the retired command text
    // further down, which is history and may be reworded freely.
    const banner = RUNBOOK.slice(0, RUNBOOK.indexOf('## Preconditions'))
    expect(banner).toMatch(/STATUS: EXECUTED/)
    expect(banner).toMatch(/2026-08-18/)
    expect(banner).toMatch(/not re-runnable/i)
    expect(banner).toMatch(/no rollback/i)
  })

  it('EARS-13: keeps the window ordering explicit — hold, seed, verify, traffic', () => {
    // The ordering constraint of the clause, stated with the steps that still
    // NAME live commands. The import sat between seed and verify and is asserted
    // by the case above instead: pinning a deleted command's spelling would make
    // the next honest edit of the historical section look like a regression.
    const order = ['--hold-before-up', 'platform:member:seed', 'platform:hours:verify']
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

// ── #260 review follow-ups ───────────────────────────────────────────────────

describe('docs/runbooks/hours-core-cutover.md — operating hazards', () => {
  it('forbids `docker compose up -d` of any service during the hold', () => {
    expect(RUNBOOK).toMatch(/no `docker compose up -d`/i)
    // The two services that drag `app` up with them via `depends_on`.
    expect(RUNBOOK).toMatch(/preview/)
    expect(RUNBOOK).toMatch(/caddy/)
  })

  it('EARS-25: the rollback section points at truncate-and-retry and names the form', () => {
    // Historical reasoning, kept because the section is: `platform:hours:import`
    // refused non-empty `hours_*` tables, so a rolled-back window left the NEXT
    // attempt dying at the import — inside the second window, not before it. The
    // command was deleted with the JSON store (#256); this asserts the record.
    const from = RUNBOOK.indexOf('## Rollback')
    const to = RUNBOOK.indexOf('## After the GO')
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const section = RUNBOOK.slice(from, to)
    expect(section).toMatch(/truncate/i)
    expect(section).toMatch(/#re-run-inside-the-window-truncate-and-retry/)
    expect(section).toMatch(/hours-only/i)
  })

  it('says which of the two SQL forms the box-side truncate block is', () => {
    const at = RUNBOOK.indexOf('psql -U payload -d platform -c')
    expect(at).toBeGreaterThan(-1)
    // The prose introducing the block must disambiguate, because the document
    // offers two statements a few lines above it.
    expect(RUNBOOK.slice(Math.max(0, at - 700), at)).toMatch(/hours-only form/i)
  })

  it('every `box$` block that uses a shell variable also defines it — reconnect safety', () => {
    // A dropped SSH session over a 20-30 minute window empties `$COMPOSE` and
    // `$TS`, and the failure is quiet: `$COMPOSE exec …` becomes bare `exec …`,
    // and `platform-pre-import-.dump` "confirms" a file nobody wrote.
    const blocks = [...RUNBOOK.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
    const boxBlocks = blocks.filter((b) => b.includes('box$'))
    expect(boxBlocks.length).toBeGreaterThan(3)
    for (const block of boxBlocks) {
      for (const name of ['COMPOSE', 'TS']) {
        if (!block.includes(`$${name}`)) continue
        const defines = block
          .split('\n')
          .some((l) => l.startsWith(`box$ ${name}=`) || l.startsWith(`box$ export ${name}=`))
        expect(defines, `a box$ block uses $${name} without defining it`).toBe(true)
      }
    }
  })

  it('EARS-26: the rehearsal precondition row itself carries the record link', () => {
    // Anchored on the ROW, not on the document: a future edit that guts the
    // precondition table must break this, which a bare /rehearsal/i would not.
    const row = RUNBOOK.split(/\r?\n/).find((l) => l.startsWith('|') && /rehearsal/i.test(l))
    expect(row, 'no precondition table row mentions the rehearsal').toBeTruthy()
    expect(row).toContain('issuecomment-5322531565')
    expect(row).toMatch(/#255/)
    expect(row).toMatch(/VERDICT: identical/)
  })
})
