import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  BRANCH_PREFIXES,
  claimForRef,
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
  splitSegments,
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

const LOCAL_REPO = 'bbm-academy-org/bbm-portal'

type GhRepoData = {
  issues?: Record<number, GhState>
  prs?: Record<number, GhState>
  provenance?: Record<number, { body?: string; comments?: { body: string }[] }>
}

/**
 * Fake gh/git runner. `issues`/`prs` map a number to its state; `provenance`
 * maps an issue number to the `gh issue view --json body,comments` payload;
 * `refs` maps a git ref to a sha and `merged` maps a sha/branch to ancestry.
 */
function makeRunner({
  issues = {} as Record<number, GhState>,
  prs = {} as Record<number, GhState>,
  provenance = {} as Record<number, { body?: string; comments?: { body: string }[] }>,
  repositories = {} as Record<string, GhRepoData>,
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
      const repoAt = args.indexOf('--repo')
      const repo = repoAt === -1 ? LOCAL_REPO : args[repoAt + 1]
      const repoData: GhRepoData =
        repo === LOCAL_REPO ? { issues, prs, provenance } : (repositories[repo] ?? {})
      if (fields === 'body,comments') {
        const p = repoData.provenance?.[n]
        if (!p) return { status: 1, stdout: '', stderr: 'not found' }
        return { status: 0, stdout: JSON.stringify(p), stderr: '' }
      }
      const state = kind === 'pr' ? repoData.prs?.[n] : repoData.issues?.[n]
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
  // If a handoff says «merged / closed» and the world moves on, the inheriting
  // session builds on a stale premise. Legacy Russian inputs remain intentional
  // compatibility fixtures even though the agent-facing tool source is English.
  const STALE_HANDOFF = [
    '## Current task',
    'PR #92 смержен, ветка feat/92-hours удалена.',
    'Issue #91 закрыт, задача снята с борда.',
    'PR #77 ещё не влит — ждёт ревью.',
    'Ветка feat/92-hours ещё не влита.',
  ].join('\n')

  const runner = makeRunner({
    prs: { 92: 'open', 77: 'merged' },
    issues: { 91: 'open' },
    branches: {},
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
    // The legacy Russian «not merged» form must beat its own positive substring,
    // so a merged PR claimed
    // unmerged is caught too.
    expect(rows).toContain('STALE #77 claimed=unmerged actual=merged')
  })

  // Review PR #150, non-blocker 1: the old fixture RESOLVED the branch, so this
  // case tested a claim mismatch under a not-found title. It now uses a branch
  // that resolves nowhere — the actual `not-found → STALE` rule.
  it('treats an unresolvable branch as STALE — a premise about a vanished ref is stale by definition', () => {
    const row = result.rows.find((r) => r.ref === 'feat/92-hours')
    expect(row?.actual).toBe('not-found')
    expect(row?.verdict).toBe('STALE')
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

describe('handoff-verify: claims are attributed per SEGMENT, not per line', () => {
  // Review PR #150, blocker 1: with per-line attribution this very sentence —
  // the most natural shape a handoff takes — reported STALE #134 claimed=merged
  // and exited 1. The tool was inventing the stale premise, not catching one.
  const MIXED = 'PR #148 смержен, issue #134 ещё открыт.'

  it('an honest mixed line is PASS/PASS and exits 0', () => {
    const result = verifyHandoff(
      MIXED,
      makeRunner({ prs: { 148: 'merged' }, issues: { 134: 'open' } }),
    )
    expect(result.rows.map(renderRow)).toEqual([
      'PASS #148 claimed=merged actual=merged',
      'PASS #134 claimed=open actual=open',
    ])
    expect(result.exitCode).toBe(0)
  })

  it('still catches the genuinely stale half of a mixed line', () => {
    const result = verifyHandoff(
      'PR #148 смержен, issue #134 закрыт.',
      makeRunner({ prs: { 148: 'merged' }, issues: { 134: 'open' } }),
    )
    expect(stale(result.rows).map(renderRow)).toEqual(['STALE #134 claimed=closed actual=open'])
    expect(result.exitCode).toBe(1)
  })

  it('splits on list punctuation, dashes, parens and sentence ends — but not inside a version', () => {
    expect(splitSegments('a, b; c — d (e) f. g').map((s) => s.text.trim())).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ])
    expect(splitSegments('v1.2 смержен').map((s) => s.text)).toEqual(['v1.2 смержен'])
  })

  it('a segment naming two refs pins its claim on neither — INFO, never a false STALE', () => {
    const result = verifyHandoff(
      '#148 и #134 смержены',
      makeRunner({ issues: { 148: 'closed', 134: 'open' } }),
    )
    expect(result.rows.map((r) => r.verdict)).toEqual(['INFO', 'INFO'])
    expect(result.exitCode).toBe(0)
  })

  it('a single-ref line still reads a legacy Russian claim across punctuation', () => {
    expect(claimForRef(extractRefs('#92 — не влит')[0])).toBe('unmerged')
    const result = verifyHandoff('#92 — не влит', makeRunner({ prs: { 92: 'merged' } }))
    expect(renderRow(result.rows[0])).toBe('STALE #92 claimed=unmerged actual=merged')
  })
})

describe('handoff-verify: ref and file token text never becomes a claim', () => {
  it.each([
    '#149, docs/open.md',
    '#149; docs/closed.md',
    '#149 — docs/merged.md',
    '#149, docs/unmerged.md',
    '#149 docs/open.md',
  ])('does not infer issue state from a file token in %s', (input) => {
    const result = verifyHandoff(input, makeRunner({ issues: { 149: 'closed' } }))

    expect(result.rows.map(renderRow)).toEqual(['INFO #149 claimed=- actual=closed'])
    expect(result.exitCode).toBe(0)
  })

  it.each([
    ['owner/open', 'closed'],
    ['owner/closed', 'open'],
    ['owner/repo-merged', 'open'],
  ] as const)('does not infer issue state from qualified ref token %s#149', (repo, actual) => {
    const result = verifyHandoff(
      `${repo}#149`,
      makeRunner({ repositories: { [repo]: { issues: { 149: actual } } } }),
    )

    expect(result.rows.map(renderRow)).toEqual([`INFO ${repo}#149 claimed=- actual=${actual}`])
    expect(result.exitCode).toBe(0)
  })

  it('does not infer approval provenance from a qualified ref token', () => {
    expect(extractApprovalClaims('owner/approved#149')).toEqual([])

    const runner = makeRunner({
      repositories: { 'owner/approved': { issues: { 149: 'open' } } },
    })
    const result = verifyHandoff('owner/approved#149', runner)

    expect(result.rows.map(renderRow)).toEqual(['INFO owner/approved#149 claimed=- actual=open'])
    expect(result.warn).toBe(0)
    expect(runner.calls.filter((args) => args[args.length - 1] === 'body,comments')).toEqual([])
  })

  it.each(['feat/237-open', 'feat/237-owner-approved'])(
    'does not infer a claim from branch token %s',
    (branch) => {
      const runner = makeRunner({
        branches: { [`refs/remotes/origin/${branch}`]: 'abc1234' },
        merged: ['abc1234'],
      })
      const result = verifyHandoff(branch, runner)

      expect(result.rows.map(renderRow)).toEqual([`INFO ${branch} claimed=- actual=merged`])
      expect(result.warn).toBe(0)
      expect(extractOwnerDirectiveClaims(branch)).toEqual([])
    },
  )

  it('keeps explicit status prose next to masked file and qualified ref tokens', () => {
    expect(
      verifyHandoff(
        '#149 docs/closed.md is open',
        makeRunner({ issues: { 149: 'open' } }),
      ).rows.map(renderRow),
    ).toEqual(['PASS #149 claimed=open actual=open'])

    const input = 'owner/open#149 is closed'
    const result = verifyHandoff(
      input,
      makeRunner({ repositories: { 'owner/open': { issues: { 149: 'closed' } } } }),
    )
    expect(result.rows.map(renderRow)).toEqual(['PASS owner/open#149 claimed=closed actual=closed'])
    expect(extractRefs(input)[0]).toMatchObject({ line: input, segment: input })
  })

  it('keeps explicit owner approval next to a masked qualified ref token', () => {
    const runner = makeRunner({
      repositories: {
        'owner/open': {
          issues: { 149: 'open' },
          provenance: { 149: { body: 'Stage 2: GO', comments: [] } },
        },
      },
    })
    const result = verifyHandoff('Owner-approved owner/open#149', runner)

    expect(result.rows.map(renderRow)).toEqual([
      'INFO owner/open#149 claimed=- actual=open',
      'PASS owner/open#149 claimed=owner-approved actual=owner-quoted',
    ])
  })

  it('keeps a multi-ref segment ambiguous after masking tokens', () => {
    const result = verifyHandoff(
      '#148 #149 docs/open.md are closed',
      makeRunner({ issues: { 148: 'closed', 149: 'closed' } }),
    )

    expect(result.rows.map((row) => row.verdict)).toEqual(['INFO', 'INFO'])
    expect(result.exitCode).toBe(0)
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

  it('does not treat a documentation file path as a branch ref', () => {
    const runner = makeRunner()
    const result = verifyHandoff('Guardrail reference: docs/ci-guardrails.md', runner)

    expect(result.rows).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(runner.calls.filter((args) => args[0] === 'rev-parse')).toEqual([])
  })

  it('does not treat the canonical prefix of a nested documentation path as a branch ref', () => {
    const runner = makeRunner()
    const result = verifyHandoff(
      'ADR reference: docs/adr/002-repository-and-module-strategy.md',
      runner,
    )

    expect(result.rows).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(runner.calls.filter((args) => args[0] === 'rev-parse')).toEqual([])
  })

  it('does not overlap a qualified repo ref with a canonical-prefix branch candidate', () => {
    const runner = makeRunner({
      repositories: { 'docs/foo': { issues: { 149: 'open' } } },
    })
    const result = verifyHandoff('docs/foo#149 is open', runner)

    expect(result.rows.map(renderRow)).toEqual(['PASS docs/foo#149 claimed=open actual=open'])
    expect(
      runner.calls.filter((args) => ['rev-parse', 'cat-file', 'merge-base'].includes(args[0])),
    ).toEqual([])
  })

  it.each([
    ['foo/abc1234#1 is open', 'foo/abc1234'],
    ['abc1234/foo#1 is open', 'abc1234/foo'],
  ])('does not overlap qualified repo %s with a SHA candidate', (input, repo) => {
    const runner = makeRunner({
      repositories: { [repo]: { issues: { 1: 'open' } } },
    })
    const result = verifyHandoff(input, runner)

    expect(result.rows.map(renderRow)).toEqual([`PASS ${repo}#1 claimed=open actual=open`])
    expect(
      runner.calls.filter((args) => ['rev-parse', 'cat-file', 'merge-base'].includes(args[0])),
    ).toEqual([])
  })

  it.each([
    'docs/specs/abc1234.md',
    'docs/specs/file-abc1234.md',
    'fix/path/abc1234.ts',
    'docs\\specs\\abc1234.md',
    'abc1234.md',
  ])('does not extract refs from extension-bearing file token %s', (path) => {
    const runner = makeRunner()
    const result = verifyHandoff(`File reference: ${path}`, runner)

    expect(result.rows).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(runner.calls).toEqual([])
  })

  it.each([
    'docs/guide.md#149',
    'docs/guide#149.md',
    'https://example.test/docs/guide.md#149',
    'guide.md#149',
    'docs\\guide.md#149',
    'guide.md?issue=#149',
  ])('gives file-like token %s precedence over GitHub number parsing', (path) => {
    const runner = makeRunner()
    const result = verifyHandoff(`File reference: ${path}`, runner)

    expect(result.rows).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(runner.calls).toEqual([])
  })

  it('keeps file-like GitHub shapes out of approval-claim extraction', () => {
    for (const path of [
      'docs/guide.md#149',
      'docs/guide#149.md',
      'guide.md#149',
      'docs\\guide.md#149',
    ]) {
      expect(extractApprovalClaims(`Owner-approved ${path}`)).toEqual([])
    }

    const runner = makeRunner()
    verifyHandoff('Owner-approved docs/guide.md#149', runner)
    expect(runner.calls).toEqual([])
  })

  it('preserves refs separated from a file token by segment punctuation without whitespace', () => {
    for (const input of ['#149,docs/foo.md', 'docs/foo.md,#149']) {
      const issueRunner = makeRunner({ issues: { 149: 'open' } })
      expect(verifyHandoff(input, issueRunner).rows.map(renderRow)).toEqual([
        'INFO #149 claimed=- actual=open',
      ])
    }

    const foreignRunner = makeRunner({
      repositories: { 'sidorovanthon/bbm': { issues: { 149: 'open' } } },
    })
    expect(
      verifyHandoff('sidorovanthon/bbm#149;docs/foo.md', foreignRunner).rows.map(renderRow),
    ).toEqual(['INFO sidorovanthon/bbm#149 claimed=- actual=open'])

    for (const input of ['abc1234;docs/foo.md', 'abc1234—docs/foo.md', 'docs/foo.md;abc1234']) {
      const shaRunner = makeRunner({ merged: ['abc1234'] })
      expect(verifyHandoff(input, shaRunner).rows.map(renderRow)).toEqual([
        'INFO abc1234 claimed=- actual=merged',
      ])
    }
  })

  it('preserves extension-free repo refs and standalone refs adjacent to file paths', () => {
    const qualifiedRunner = makeRunner({
      repositories: { 'docs/guide': { issues: { 149: 'open' } } },
    })
    expect(verifyHandoff('docs/guide#149 is open', qualifiedRunner).rows.map(renderRow)).toEqual([
      'PASS docs/guide#149 claimed=open actual=open',
    ])

    const issueRunner = makeRunner({ issues: { 149: 'open' } })
    expect(
      verifyHandoff('File: docs/guide.md; issue #149 is open', issueRunner).rows.map(renderRow),
    ).toEqual(['PASS #149 claimed=open actual=open'])

    const shaRunner = makeRunner({ merged: ['abc1234'] })
    expect(
      verifyHandoff('File: docs/guide.md; commit abc1234 is merged', shaRunner).rows.map(renderRow),
    ).toEqual(['PASS abc1234 claimed=merged actual=merged'])
    expect(shaRunner.calls.some((args) => args[0] === 'cat-file')).toBe(true)
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
  it('resolves a foreign-repo approval claim only against that repository', () => {
    const runner = makeRunner({
      issues: { 149: 'closed' },
      provenance: { 149: { body: 'No owner decision here.', comments: [] } },
      repositories: {
        'sidorovanthon/bbm': {
          issues: { 149: 'open' },
          provenance: { 149: { body: 'Stage 2: GO', comments: [] } },
        },
      },
    })

    const result = verifyHandoff('Owner-approved: sidorovanthon/bbm#149', runner)
    const approval = result.rows.find((row) => row.claim === 'owner-approved')
    expect(approval).toMatchObject({
      verdict: 'PASS',
      ref: 'sidorovanthon/bbm#149',
      actual: 'owner-quoted',
    })
    expect(
      runner.calls
        .filter((args) => args[0] === 'issue' || args[0] === 'pr')
        .map((args) => args[args.indexOf('--repo') + 1]),
    ).toEqual(['sidorovanthon/bbm', 'sidorovanthon/bbm'])
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
  it('resolves a qualified issue in its named repo and labels the row with that repo', () => {
    const runner = makeRunner({
      issues: { 149: 'closed' },
      repositories: { 'sidorovanthon/bbm': { issues: { 149: 'open' } } },
    })
    const result = verifyHandoff('sidorovanthon/bbm#149 is open', runner)

    expect(result.rows.map(renderRow)).toEqual([
      'PASS sidorovanthon/bbm#149 claimed=open actual=open',
    ])
    expect(runner.calls[0]).toContain('sidorovanthon/bbm')
    expect(runner.calls.flat()).not.toContain(LOCAL_REPO)
  })

  it('keeps equal issue numbers from local and foreign repos as distinct lookups', () => {
    const runner = makeRunner({
      issues: { 149: 'closed' },
      repositories: { 'sidorovanthon/bbm': { issues: { 149: 'open' } } },
    })
    const result = verifyHandoff('#149 is closed; sidorovanthon/bbm#149 is open', runner)

    expect(result.rows.map(renderRow)).toEqual([
      'PASS #149 claimed=closed actual=closed',
      'PASS sidorovanthon/bbm#149 claimed=open actual=open',
    ])
    expect(
      runner.calls
        .filter((args) => args[0] === 'issue')
        .map((args) => args[args.indexOf('--repo') + 1]),
    ).toEqual([LOCAL_REPO, 'sidorovanthon/bbm'])
  })
})

/**
 * Severity contract (docs/ci-guardrails.md §2.3 + §6.1). `handoff-verify` is a
 * CLI guard, so its EXIT CODE is its severity — one per finding class, and the
 * canon row is only true if these hold. Pinned after the review of PR #154,
 * where the canon recorded this file as a flat "WARN" hook while the code exits
 * 1 on a STALE row.
 */
describe('handoff-verify: severity is the exit code (canon §2.3)', () => {
  it('BLOCK class — a STALE row exits 1', () => {
    const runner = makeRunner({ issues: { 134: 'open' } })
    const result = verifyHandoff('issue #134 закрыт', runner)
    expect(result.stale).toBe(1)
    expect(result.exitCode).toBe(1)
  })

  it('WARN class — qualitative rows never bump `stale`, so the run exits 0', () => {
    const result = verifyHandoff('Бэклог пуст, всё закрыто.', makeRunner({}))
    expect(result.warn).toBeGreaterThan(0)
    expect(result.stale).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('clean input exits 0 — a verdict, unlike exit 2', () => {
    const runner = makeRunner({ issues: { 134: 'closed' } })
    expect(verifyHandoff('issue #134 закрыт', runner).exitCode).toBe(0)
  })

  it('exit 2 is NOT a verdict — unreadable input, asserted on the real process', () => {
    const script = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../tools/gh/handoff-verify.mjs',
    )
    const res = spawnSync(process.execPath, [script, 'no-such-handoff-file.md'], {
      encoding: 'utf8',
    })
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('cannot read input')
  })
})
