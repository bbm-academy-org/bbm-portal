import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkStageB,
  extractClosedIssues,
  extractMarkerValues,
  ghIssueArgs,
  ghPrArgs,
  isEvidence,
  parseArgs,
  renderFiles,
  runStageBLint,
  severityFromArgv,
} from '../stage-b-lint.mjs'

/**
 * MOVED from tests/unit/ in #136: a guard's spec lives next to the guard, at
 * `tools/lint/guard-tests/<name>-lint.spec.ts` (canon docs/ci-guardrails.md §8).
 * The pairing is not a preference — `guard-test-coverage` BLOCKS a guard whose
 * spec is not there, so this file's location is what makes the stage-b guard
 * merge-able at all. Nothing about the assertions changed.
 *
 * `pnpm lint:stage-b` (#138) turns the prose rule «a UI diff records the owner's
 * live Stage-B verdict before merge» (task-cycle stage 5) into a deterministic
 * pre-merge check.
 *
 * The whole surface under test is the pure `checkStageB(pr)` seam plus the thin
 * `runStageBLint({ prNumber, gh })` driver with an INJECTED gh runner — no live
 * GitHub, no network. The synthetic PRs below are the fixtures: each is the
 * exact shape `gh pr view --json number,body,files` / `gh issue view --json
 * comments` return.
 *
 * AC3 of #138: «a synthetic UI PR without the marker does not pass». That is the
 * `red: UI diff, no marker` case — verdict `violation`, and exit 1 whenever the
 * caller asks for a real signal (`--severity block`, which is how the CI step
 * invokes it — docs/ci-guardrails.md §5).
 */

/** A synthetic `gh pr view --json number,body,files` payload. */
function pr({
  number = 1,
  body = '',
  files = [] as string[],
}: {
  number?: number
  body?: string
  files?: string[]
}) {
  return { number, body, files: files.map((path) => ({ path })) }
}

/**
 * Fake `gh` runner. `prs` maps a PR number to its view payload, `issues` maps an
 * issue number to its comment list — exactly what the real script reads.
 */
function makeGh({
  prs = {} as Record<number, ReturnType<typeof pr>>,
  issues = {} as Record<number, { body: string }[]>,
} = {}) {
  const calls: string[][] = []
  return {
    calls,
    gh(args: string[]) {
      calls.push(args)
      const n = Number(args[2])
      if (args[0] === 'pr') {
        const payload = prs[n]
        return payload
          ? { status: 0, stdout: JSON.stringify(payload), stderr: '' }
          : { status: 1, stdout: '', stderr: 'no such PR' }
      }
      const comments = issues[n]
      return comments
        ? { status: 0, stdout: JSON.stringify({ number: n, comments }), stderr: '' }
        : { status: 1, stdout: '', stderr: 'no such issue' }
    },
  }
}

const UI_PR_FILES = ['src/app/(platform)/p/hours/page.tsx', 'src/app/(platform)/p/hours/hours.css']

describe('stage-b-lint: a UI PR without the marker does not pass (AC3 of #138)', () => {
  // The regression this guard exists for: an owner-visible surface reaching
  // merge with no recorded live verdict — the 2026-07-27 «сборку приняли за
  // оригинал» class, one layer later in the cycle.
  const result = checkStageB(
    pr({ number: 200, body: '## What\n\nNew hours table.\n\nCloses #199', files: UI_PR_FILES }),
  )

  it('classifies the PR as a UI diff and reports a violation', () => {
    expect(result.userFacing).toBe(true)
    expect(result.verdict).toBe('violation')
  })

  it('names the render files that triggered the gate', () => {
    expect(result.renderFiles).toEqual(UI_PR_FILES)
  })

  it('spells out the three accepted marker shapes in the message', () => {
    expect(result.message).toContain('Stage-B: GO')
    expect(result.message).toContain('batched at #')
    expect(result.message).toContain('lead-certified')
  })

  it('exits 1 under BLOCK severity and 0 (with the same violation) under WARN', () => {
    const gh = makeGh({
      prs: { 200: pr({ number: 200, body: 'Closes #199', files: UI_PR_FILES }) },
    })
    const warn = runStageBLint({ prNumber: 200, severity: 'warn', gh: gh.gh })
    expect(warn.verdict).toBe('violation')
    expect(warn.exitCode).toBe(0)
    expect(warn.lines.join('\n')).toContain('WARN')

    const block = runStageBLint({ prNumber: 200, severity: 'block', gh: gh.gh })
    expect(block.verdict).toBe('violation')
    expect(block.exitCode).toBe(1)
  })
})

describe('stage-b-lint: the three sanctioned marker shapes are evidence', () => {
  it('`Stage-B: GO — owner, date` in the PR body passes', () => {
    const result = checkStageB(pr({ body: 'Stage-B: GO — Антон, 2026-08-05', files: UI_PR_FILES }))
    expect(result.verdict).toBe('pass')
    expect(result.evidence).toContain('GO')
  })

  it('`Stage-B: batched at #N` (a batched acceptance gate) passes', () => {
    expect(checkStageB(pr({ body: 'Stage-B: batched at #117', files: UI_PR_FILES })).verdict).toBe(
      'pass',
    )
  })

  it('`Stage-B: N/A — lead-certified` passes with either dash', () => {
    expect(
      checkStageB(
        pr({ body: 'Stage-B: N/A (no visual surface) — lead-certified', files: UI_PR_FILES }),
      ).verdict,
    ).toBe('pass')
    expect(
      checkStageB(pr({ body: 'Stage-B: N/A - lead-certified', files: UI_PR_FILES })).verdict,
    ).toBe('pass')
  })

  it('a bare `N/A` without the lead-certification is NOT evidence — the self-cert must be claimed', () => {
    expect(checkStageB(pr({ body: 'Stage-B: N/A', files: UI_PR_FILES })).verdict).toBe('violation')
  })

  it('the unfilled template placeholder fails, and says so distinctly', () => {
    const result = checkStageB(
      pr({
        body: 'Stage-B: <GO — owner, date | batched at #N | N/A — lead-certified>',
        files: UI_PR_FILES,
      }),
    )
    expect(result.verdict).toBe('violation')
    expect(result.message).toContain('placeholder')
  })

  it('reads the marker through blockquote / list decoration and `StageB` casing', () => {
    expect(extractMarkerValues('- **Stage-B:** GO — Антон')).toEqual(['GO — Антон'])
    expect(extractMarkerValues('> stageb: batched at #7')).toEqual(['batched at #7'])
    expect(isEvidence('GO — Антон, 2026-08-05')).toBe(true)
    expect(isEvidence('TBD')).toBe(false)
    expect(isEvidence('pending owner')).toBe(false)
  })

  // Review PR #151, minor 4: a bare `GO` was evidence while a bare `N/A` was
  // not — and the GO is the record that most needs attribution, since it stands
  // in for a live-stand «принято» by a named person on a named day.
  it('a bare `Stage-B: GO` is NOT evidence — the verdict names its owner', () => {
    expect(checkStageB(pr({ body: 'Stage-B: GO', files: UI_PR_FILES })).verdict).toBe('violation')
    expect(isEvidence('GO')).toBe(false)
    expect(isEvidence('GO — Антон')).toBe(true)
    expect(isEvidence('GO (Антон, 2026-08-05)')).toBe(true)
  })
})

describe('stage-b-lint: instructions are not evidence (review PR #151, blocker 1)', () => {
  // The realistic failure this guard would otherwise wave through: an author
  // opens a UI PR, fills What/Why, never touches the Stage B section — and the
  // template's own `<!-- … -->` instruction block, which spells out all three
  // sanctioned shapes verbatim, reads as a recorded verdict.
  // The real artifact, read from disk: the fixture and the shipped template can
  // never drift apart, which is the whole point of this block.
  const TEMPLATE = readFileSync(resolve(process.cwd(), '.github/pull_request_template.md'), 'utf8')

  it('the repo PR template, shipped unfilled on a UI PR, does NOT pass', () => {
    const result = checkStageB(pr({ number: 300, body: TEMPLATE, files: UI_PR_FILES }))
    expect(result.verdict).toBe('violation')
    expect(result.message).toContain('placeholder')
  })

  it('the same template with the placeholder line actually filled in passes', () => {
    const filled = TEMPLATE.replace(/^Stage-B: <.*>$/m, 'Stage-B: GO — Антон, 2026-08-05')
    expect(filled).not.toEqual(TEMPLATE)
    expect(checkStageB(pr({ body: filled, files: UI_PR_FILES })).verdict).toBe('pass')
  })

  it('strips HTML comments and fenced code blocks before reading markers', () => {
    expect(extractMarkerValues('<!--\nStage-B: GO — owner, date\n-->')).toEqual([])
    expect(extractMarkerValues('```\nStage-B: GO — owner, date\n```')).toEqual([])
    expect(extractMarkerValues('~~~md\nStage-B: batched at #7\n~~~')).toEqual([])
    // …and still reads the real line sitting next to them.
    expect(
      extractMarkerValues('<!-- Stage-B: GO — example -->\nStage-B: GO — Антон, 2026-08-05'),
    ).toEqual(['GO — Антон, 2026-08-05'])
  })

  it('a linked-issue comment that merely QUOTES the shapes is not a verdict', () => {
    const quoting = [
      'Напоминание по конвенции — в теле PR должно быть одно из:',
      '```',
      'Stage-B: GO — <owner, date>',
      'Stage-B: batched at #<gate>',
      '```',
    ].join('\n')
    expect(checkStageB(pr({ body: 'Closes #199', files: UI_PR_FILES }), [quoting]).verdict).toBe(
      'violation',
    )
  })
})

describe('stage-b-lint: the verdict may live on the linked issue', () => {
  it('a `Closes #N` issue comment carrying the GO is evidence', () => {
    const result = checkStageB(pr({ body: 'Closes #199', files: UI_PR_FILES }), [
      'Стенд поднят на 3002.',
      'Stage-B: GO — Антон, 2026-08-05',
    ])
    expect(result.verdict).toBe('pass')
  })

  it('extracts every GitHub close keyword, deduped', () => {
    expect(extractClosedIssues('Closes #12, fixes #12, resolved #34')).toEqual([12, 34])
    expect(extractClosedIssues('see #99')).toEqual([])
  })

  it('the driver fetches the linked issue comments through gh', () => {
    const gh = makeGh({
      prs: { 201: pr({ number: 201, body: 'Closes #199', files: UI_PR_FILES }) },
      issues: { 199: [{ body: 'Stage-B: GO — Антон' }] },
    })
    const result = runStageBLint({ prNumber: 201, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('pass')
    expect(result.exitCode).toBe(0)
    expect(gh.calls.map((c) => `${c[0]} ${c[2]}`)).toEqual(['pr 201', 'issue 199'])
  })
})

describe('stage-b-lint: what counts as a UI diff', () => {
  it('view-layer .tsx and .css under src/ trigger the gate — task-cycle stage 3 wording', () => {
    expect(renderFiles(['src/components/PublishPanel.tsx'])).toHaveLength(1)
    expect(renderFiles(['src/modules/okr/view.css'])).toHaveLength(1)
  })

  it('backend-only, docs, migrations, generated types and tests never trigger it', () => {
    expect(
      renderFiles([
        'src/endpoints/leads.ts',
        'src/collections/Pages.ts',
        'docs/specs/138-design.md',
        'design-source/README.md',
        'src/migrations/20260101_init.ts',
        'src/payload-types.ts',
        'tests/unit/hours-view-markup.spec.ts',
        'src/modules/hours/view.spec.tsx',
        'next.config.ts',
      ]),
    ).toEqual([])
  })

  it('a non-UI PR is skipped, never failed, even with no marker at all', () => {
    const result = checkStageB(pr({ body: 'Closes #1', files: ['src/endpoints/leads.ts'] }))
    expect(result.userFacing).toBe(false)
    expect(result.verdict).toBe('skip')
    expect(result.message).toContain('no UI diff')
  })
})

describe('stage-b-lint: runner contract', () => {
  it('severity defaults to WARN, and `--severity block` overrides', () => {
    expect(severityFromArgv([])).toBe('warn')
    expect(severityFromArgv(['--severity', 'block'])).toBe('block')
    expect(severityFromArgv(['--severity=block'])).toBe('block')
  })

  // Review PR #151, major 2: the positional split did not consume the value of
  // `--severity`, so the two documented invocation forms — a positional PR
  // number and the `PR_NUMBER` env fallback the CI job uses — could not
  // be combined with the flag.
  it('parses both invocation forms, with and without the flag', () => {
    expect(parseArgs(['151'], {})).toEqual({ prNumber: '151', severity: 'warn' })
    expect(parseArgs(['151', '--severity', 'block'], {})).toEqual({
      prNumber: '151',
      severity: 'block',
    })
    expect(parseArgs(['--severity', 'block', '151'], {})).toEqual({
      prNumber: '151',
      severity: 'block',
    })
    expect(parseArgs(['--severity=block'], { PR_NUMBER: '151' })).toEqual({
      prNumber: '151',
      severity: 'block',
    })
    // The exact command the PR body advertises for the CI job.
    expect(parseArgs(['--severity', 'block'], { PR_NUMBER: '151' })).toEqual({
      prNumber: '151',
      severity: 'block',
    })
    expect(parseArgs([], {})).toEqual({ prNumber: null, severity: 'warn' })
    expect(parseArgs(['not-a-number'], {})).toEqual({ prNumber: null, severity: 'warn' })
  })

  it('always names the repo explicitly, like the other gh tooling', () => {
    expect(ghPrArgs(92)).toEqual([
      'pr',
      'view',
      '92',
      '--repo',
      'bbm-academy-org/bbm-portal',
      '--json',
      'number,body,files',
    ])
    expect(ghIssueArgs(91)).toEqual([
      'issue',
      'view',
      '91',
      '--repo',
      'bbm-academy-org/bbm-portal',
      '--json',
      'number,comments',
    ])
  })

  // Review PR #151, major 3: `error` deliberately does NOT follow the severity
  // dial. A violation is a finding about the PR (WARN can absorb it); an
  // unreadable PR means the guard did not run at all, and a guard that exits 0
  // when it never ran is indistinguishable from a clean check. Masking that in
  // CI is the `continue-on-error` decision, made at the job level (canon §5).
  it('an unreadable PR is a fatal error under EVERY severity, never a silent pass', () => {
    for (const severity of ['warn', 'block'] as const) {
      const result = runStageBLint({ prNumber: 999, severity, gh: makeGh().gh })
      expect(result.verdict).toBe('error')
      expect(result.exitCode).toBe(1)
      expect(result.lines.join('\n')).toContain('#999')
    }
  })

  it('an unreachable linked issue does not count as evidence, and is reported', () => {
    const gh = makeGh({
      prs: { 202: pr({ number: 202, body: 'Closes #4242', files: UI_PR_FILES }) },
    })
    const result = runStageBLint({ prNumber: 202, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('violation')
    expect(result.lines.join('\n')).toContain('#4242')
  })
})
