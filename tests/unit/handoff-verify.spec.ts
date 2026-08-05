import { describe, expect, it } from 'vitest'

import {
  BRANCH_PREFIXES,
  dedupeRefs,
  extractApprovalClaims,
  extractCompletenessClaims,
  extractOwnerDirectiveClaims,
  extractRefs,
  ghViewArgs,
  hasOwnerQuoteEvidence,
  parseClaim,
  renderRow,
  renderSummary,
  verdictFor,
  verifyHandoff,
} from '../../tools/gh/handoff-verify.mjs'

/**
 * `pnpm handoff:verify` (#134) turns the prose rule «a handoff is a HYPOTHESIS»
 * (task-cycle stage 1) into a deterministic gate. The whole surface under test
 * is the pure `verifyHandoff(text, runner)` seam: no live `gh`, no live `git` —
 * the runner is injected, exactly as the script's own `defaultRunner()` is
 * replaced at the call site.
 */

type GhState = 'open' | 'closed' | 'merged'

/**
 * Fake gh/git runner. `issues`/`prs` map a number to its state; `provenance`
 * maps an issue number to the `gh issue view --json body,comments` payload;
 * `refs` maps a git ref to a sha and `merged` maps a sha/branch to ancestry.
 */
function makeRunner({
  issues = {} as Record<number, GhState>,
  prs = {} as Record<number, GhState>,
  provenance = {} as Record<number, { body?: string; comments?: { body: string }[] }>,
  branches = {} as Record<string, string>,
  merged = [] as string[],
} = {}) {
  const calls: string[][] = []
  return {
    calls,
    gh(args: string[]) {
      calls.push(args)
      const kind = args[0]
      const n = Number(args[2])
      const fields = args[args.length - 1]
      if (fields === 'body,comments') {
        const p = provenance[n]
        if (!p) return { status: 1, stdout: '', stderr: 'not found' }
        return { status: 0, stdout: JSON.stringify(p), stderr: '' }
      }
      const state = kind === 'pr' ? prs[n] : issues[n]
      if (!state) return { status: 1, stdout: '', stderr: 'not found' }
      return { status: 0, stdout: JSON.stringify({ state: state.toUpperCase() }), stderr: '' }
    },
    git(args: string[]) {
      calls.push(args)
      if (args[0] === 'rev-parse') {
        const ref = args[args.length - 1]
        const sha = branches[ref]
        return sha
          ? { status: 0, stdout: `${sha}\n`, stderr: '' }
          : { status: 1, stdout: '', stderr: '' }
      }
      if (args[0] === 'cat-file') {
        const sha = String(args[2]).replace(/\^\{commit\}$/, '')
        const known = merged.includes(sha) || Object.values(branches).includes(sha)
        return { status: known ? 0 : 1, stdout: '', stderr: '' }
      }
      if (args[0] === 'merge-base')
        return { status: merged.includes(args[2]) ? 0 : 1, stdout: '', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    },
  }
}

/** Generic so the row shape survives the filter — the rows carry ref/claim/actual too. */
const stale = <T extends { verdict: string }>(rows: T[]) =>
  rows.filter((r) => r.verdict === 'STALE')

describe('handoff-verify: a STALE handoff exits 1 and names every divergence', () => {
  // The recurring failure this gate exists for: the emitting session wrote
  // «смержен / закрыт», the world moved on, the inheriting session built on it.
  const STALE_HANDOFF = [
    '## Current task',
    'PR #92 смержен, ветка feat/92-hours удалена.',
    'Issue #91 закрыт, задача снята с борда.',
    'PR #77 ещё не влит — ждёт ревью.',
  ].join('\n')

  const runner = makeRunner({
    prs: { 92: 'open', 77: 'merged' },
    issues: { 91: 'open' },
    branches: { 'refs/remotes/origin/feat/92-hours': 'abc1234' },
    merged: [],
  })
  const result = verifyHandoff(STALE_HANDOFF, runner)

  it('exits 1 as soon as one premise diverges', () => {
    expect(result.exitCode).toBe(1)
    expect(result.stale).toBeGreaterThan(0)
  })

  it('lists each divergence with claim and actual side by side', () => {
    const rows = stale(result.rows).map(renderRow)
    expect(rows).toContain('STALE #92 claimed=merged actual=open')
    expect(rows).toContain('STALE #91 claimed=closed actual=open')
    // «не влит» must beat its own «влит» substring, so a merged PR claimed
    // unmerged is caught too.
    expect(rows).toContain('STALE #77 claimed=unmerged actual=merged')
  })

  it('treats an unresolvable branch as STALE — a premise about a vanished ref is stale by definition', () => {
    expect(stale(result.rows).map((r) => r.ref)).toContain('feat/92-hours')
    expect(result.rows.find((r) => r.ref === 'feat/92-hours')?.actual).toBe('unmerged')
  })

  it('summarises with the exact counts', () => {
    expect(renderSummary(result)).toContain('STALE premises found')
  })
})

describe('handoff-verify: an honest handoff exits 0', () => {
  const HONEST_HANDOFF = [
    '## Current task',
    'PR #92 смержен (squash), ветка feat/92-hours удалена.',
    'Issue #91 закрыт.',
    'PR #77 ещё не влит — открыт, ждёт ревью.',
    'Следующий шаг описан в #93.',
  ].join('\n')

  const runner = makeRunner({
    prs: { 92: 'merged', 77: 'open' },
    issues: { 91: 'closed', 93: 'open' },
    branches: { 'refs/remotes/origin/feat/92-hours': 'abc1234' },
    merged: ['abc1234'],
  })
  const result = verifyHandoff(HONEST_HANDOFF, runner)

  it('produces no STALE row and exit code 0', () => {
    expect(stale(result.rows)).toEqual([])
    expect(result.exitCode).toBe(0)
  })

  it('accepts a merged PR under a «closed» claim but never the reverse', () => {
    expect(verdictFor('closed', 'merged')).toBe('PASS')
    expect(verdictFor('merged', 'closed')).toBe('STALE')
  })

  it('reports a claim-less ref as INFO instead of guessing', () => {
    const info = result.rows.find((r) => r.ref === '#93')
    expect(info?.verdict).toBe('INFO')
    expect(info?.actual).toBe('open')
  })

  it('a handoff with nothing checkable is not an error', () => {
    const empty = verifyHandoff('Просто текст без ссылок и утверждений.', makeRunner())
    expect(empty.empty).toBe(true)
    expect(empty.exitCode).toBe(0)
  })
})

describe('handoff-verify: a ref that no longer resolves is STALE', () => {
  it('gh 404 on both issue and PR → not-found → STALE', () => {
    const result = verifyHandoff('Issue #4242 закрыт.', makeRunner())
    expect(renderRow(result.rows[0])).toBe('STALE #4242 claimed=closed actual=not-found')
    expect(result.exitCode).toBe(1)
  })
})

describe('handoff-verify: ref extraction', () => {
  it('takes #N, «PR N», «issue N» — and not a bare number', () => {
    const refs = extractRefs('PR 92 и issue 91, порт 3001, #77')
    expect(refs.map((r) => `${r.kind}:${r.value}`)).toEqual(['pr:92', 'issue:91', 'number:77'])
  })

  it('knows the canon branch prefixes', () => {
    expect(BRANCH_PREFIXES).toEqual(expect.arrayContaining(['feat', 'fix', 'chore', 'docs']))
    expect(extractRefs('ветка chore/134-handoff-verify').map((r) => r.value)).toEqual([
      'chore/134-handoff-verify',
    ])
  })

  it('takes a sha only when it looks like one, and never inside a branch token', () => {
    expect(extractRefs('коммит f3c5c18 в ветке feat/92-hours').map((r) => r.value)).toEqual([
      'feat/92-hours',
      'f3c5c18',
    ])
    expect(extractRefs('число 1234567 и слово decade').filter((r) => r.kind === 'sha')).toEqual([])
  })

  it('collapses repeated mentions, keeping every distinct claim', () => {
    const entry = dedupeRefs(extractRefs('#92 смержен\n#92 упомянут\n#92 закрыт'))[0]
    expect(entry.claims.sort()).toEqual(['closed', 'merged'])
  })

  it('reads the RU claim vocabulary the handoffs are actually written in', () => {
    expect(parseClaim('PR #92 смержен')).toBe('merged')
    expect(parseClaim('PR #92 ещё не влит')).toBe('unmerged')
    expect(parseClaim('issue #91 закрыт')).toBe('closed')
    expect(parseClaim('issue #91 открыт')).toBe('open')
    expect(parseClaim('issue #91 в работе')).toBeNull()
  })
})

describe('handoff-verify: owner-approval provenance', () => {
  const CLAIM = 'Владелец согласовал объём #77 — можно строить.'

  it('discovery-only provenance → STALE + a hint naming «handoff ≠ go»', () => {
    const runner = makeRunner({
      issues: { 77: 'open' },
      provenance: { 77: { body: 'Обсудили варианты, агент предложил A.', comments: [] } },
    })
    const result = verifyHandoff(CLAIM, runner)
    const row = result.rows.find((r) => r.claim === 'owner-approved')
    expect(row).toMatchObject({ verdict: 'STALE', ref: '#77', actual: 'no-owner-provenance' })
    expect(result.exitCode).toBe(1)
    expect(result.hints.join('\n')).toContain('handoff ≠ go')
  })

  it('a quotable owner turn (go-gate marker or a quoted span) → PASS', () => {
    const withMarker = makeRunner({
      issues: { 77: 'open' },
      provenance: { 77: { body: 'План на утверждение.', comments: [{ body: 'Stage 2: GO' }] } },
    })
    expect(
      verifyHandoff(CLAIM, withMarker).rows.find((r) => r.claim === 'owner-approved')?.verdict,
    ).toBe('PASS')

    const withQuote = makeRunner({
      issues: { 77: 'open' },
      provenance: { 77: { body: 'Владелец: «го, делай вариант A».', comments: [] } },
    })
    expect(
      verifyHandoff(CLAIM, withQuote).rows.find((r) => r.claim === 'owner-approved')?.verdict,
    ).toBe('PASS')
  })

  it('a review verdict is not an owner decision — no approval claim extracted', () => {
    expect(extractApprovalClaims('VERDICT: APPROVE по PR #92')).toEqual([])
    expect(extractApprovalClaims('Владелец одобрил #92').map((c) => c.issue)).toEqual([92])
  })
})

describe('handoff-verify: non-blocking WARN detectors', () => {
  it('a completeness claim warns and points at backlog:triage without failing the run', () => {
    const result = verifyHandoff('Бэклог пуст, все задачи закрыты.', makeRunner())
    expect(result.warn).toBeGreaterThan(0)
    expect(result.stale).toBe(0)
    expect(result.exitCode).toBe(0)
    expect(result.hints.join('\n')).toContain('pnpm backlog:triage')
    expect(extractCompletenessClaims('backlog is empty')).toHaveLength(1)
  })

  it('owner-directive framing without a verbatim quote warns; with a quote it passes', () => {
    const unquoted = verifyHandoff('Owner-directed: сначала процессы, потом продукт.', makeRunner())
    expect(unquoted.rows.map((r) => r.verdict)).toContain('WARN')
    expect(unquoted.exitCode).toBe(0)

    const quoted = verifyHandoff(
      'Owner-directed: сначала процессы.\nЦитата владельца: «сначала процессы, потом продукт».',
      makeRunner(),
    )
    expect(quoted.rows.filter((r) => r.claim === 'owner-directive').map((r) => r.verdict)).toEqual([
      'PASS',
    ])
    expect(hasOwnerQuoteEvidence('владелец сказал «го»')).toBe(true)
  })

  it('an issue-ref-tied approval claim fires once — in the provenance domain only', () => {
    expect(extractOwnerDirectiveClaims('Владелец одобрил #92')).toEqual([])
    expect(extractOwnerDirectiveClaims('Владелец дал го на объём').map((c) => c.lineNo)).toEqual([
      1,
    ])
  })
})

describe('handoff-verify: gh invocation convention', () => {
  it('always names the repo explicitly, like backlog:triage', () => {
    expect(ghViewArgs('pr', 92, 'state')).toEqual([
      'pr',
      'view',
      '92',
      '--repo',
      'bbm-academy-org/bbm-portal',
      '--json',
      'state',
    ])
  })

  it('an unhinted #N is looked up as an issue first, then as a PR', () => {
    const runner = makeRunner({ prs: { 92: 'merged' } })
    verifyHandoff('#92 смержен', runner)
    const views = runner.calls.filter((c) => c[1] === 'view').map((c) => c[0])
    expect(views).toEqual(['issue', 'pr'])
  })
})
