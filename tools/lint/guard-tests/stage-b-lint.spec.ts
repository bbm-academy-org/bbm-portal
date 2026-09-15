import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkStageB,
  SANITY_FACETS,
  extractClosedIssues,
  extractLinkedIssues,
  extractMarkerValues,
  extractSanityRecords,
  ghFilesArgs,
  ghIssueArgs,
  ghPrArgs,
  isEvidence,
  missingSanityFacetsOf,
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
 * caller asks for a real signal (`--severity block`, which is how the CI job
 * invokes it — docs/ci-guardrails.md §5).
 */

/**
 * A synthetic `gh pr view --json number,body,comments,files` payload. `comments`
 * is the PR's OWN conversation — the surface the `UX-sanity:` record lives on
 * (#485), since the lead posts it BEFORE inviting the owner to the stand.
 */
function pr({
  number = 1,
  body = '',
  files = [] as string[],
  comments = [] as string[],
}: {
  number?: number
  body?: string
  files?: string[]
  comments?: string[]
}) {
  return {
    number,
    body,
    comments: comments.map((c) => ({ body: c })),
    files: files.map((path) => ({ path })),
  }
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
      // `gh api .../pulls/<n>/files?per_page=&page=` — the PAGED file list
      // (canon §8). Sliced exactly like the endpoint, so a guard that never
      // asks for page 2 sees a short diff here too.
      if (args[0] === 'api') {
        const m = /pulls\/(\d+)\/files\?per_page=(\d+)&page=(\d+)/.exec(String(args[1]))
        const payload = m ? prs[Number(m[1])] : undefined
        if (!m || !payload) return { status: 1, stdout: '', stderr: 'no such PR' }
        const per = Number(m[2])
        const page = Number(m[3])
        return {
          status: 0,
          stdout: JSON.stringify(payload.files.slice((page - 1) * per, page * per)),
          stderr: '',
        }
      }
      const n = Number(args[2])
      if (args[0] === 'pr') {
        const payload = prs[n]
        // `gh pr view --json files` truncates at 100 entries WITHOUT saying so —
        // the very limit §8 names. Modelled, so a guard reading that array
        // instead of the paged endpoint fails this fake the way it fails GitHub.
        return payload
          ? {
              status: 0,
              stdout: JSON.stringify({ ...payload, files: payload.files.slice(0, 100) }),
              stderr: '',
            }
          : { status: 1, stdout: '', stderr: 'no such PR' }
      }
      const comments = issues[n]
      return comments
        ? { status: 0, stdout: JSON.stringify({ number: n, comments }), stderr: '' }
        : { status: 1, stdout: '', stderr: 'no such issue' }
    },
  }
}

describe('stage-b-lint: the changed-file list is PAGED (canon §8)', () => {
  // RED before the paging fix: `gh pr view --json files` stops at 100 entries,
  // so the 101st file — the only rendered surface in the PR — was invisible and
  // the guard reported «no UI diff». A BLOCK guard that reads part of the diff
  // has not read the diff.
  const files = [
    ...Array.from({ length: 100 }, (_, i) => `docs/notes/note-${i}.md`),
    'src/app/(platform)/p/hours/page.tsx',
  ]

  it('sees a render file that falls on the SECOND page of the file list', () => {
    const gh = makeGh({ prs: { 300: pr({ number: 300, body: '## What\n\nNo marker.', files }) } })
    const result = runStageBLint({ prNumber: 300, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('violation')
    expect(result.exitCode).toBe(1)
    expect(gh.calls.some((c) => c[0] === 'api' && String(c[1]).includes('page=2'))).toBe(true)
  })

  it('fails closed when a page cannot be read, instead of judging a partial set', () => {
    const gh = {
      calls: [] as string[][],
      gh(args: string[]) {
        gh.calls.push(args)
        if (args[0] === 'pr')
          return { status: 0, stdout: JSON.stringify({ number: 301, body: '' }), stderr: '' }
        return { status: 1, stdout: '', stderr: 'API rate limit exceeded' }
      },
    }
    const result = runStageBLint({ prNumber: 301, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('error')
    expect(result.exitCode).toBe(1)
  })
})

const UI_PR_FILES = ['src/app/(platform)/p/hours/page.tsx', 'src/app/(platform)/p/hours/hours.css']

/**
 * A FILLED `UX-sanity:` record (#485) — the lead's own pass over the captured
 * screenshots, posted before the owner is invited to the stand. Its four facets
 * are task-cycle stage 5 item 4; `Screenshots` names what was actually judged.
 */
const SANITY_BLOCK = [
  'UX-sanity: PASS',
  '- Screenshots: docs/evidence/388/overview-desktop-light.png, docs/evidence/388/overview-mobile-dark.png',
  '- Dominance: the period total card leads; the account tiles recede',
  '- Tiers: primary / secondary / archived differ by weight and ground, not only by label',
  '- Equal boxes: no — the total is a full-width band, the tiles a 3-up grid',
  '- Legible states: empty and degraded keep the heading and the explanatory line',
].join('\n')

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
  it('`Stage-B: GO — owner, date` passes when the UX-sanity record is there too', () => {
    const result = checkStageB(
      pr({ body: `Stage-B: GO — Антон, 2026-08-05\n\n${SANITY_BLOCK}`, files: UI_PR_FILES }),
    )
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
    expect(
      checkStageB(pr({ body: `Stage-B: GO\n\n${SANITY_BLOCK}`, files: UI_PR_FILES })).verdict,
    ).toBe('violation')
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
    // The GO alone is no longer enough (#485): the template ships the UX-sanity
    // block unfilled, so the sibling record of the SAME pass is still missing.
    expect(checkStageB(pr({ body: filled, files: UI_PR_FILES })).verdict).toBe('violation')
    expect(
      checkStageB(pr({ body: filled, files: UI_PR_FILES, comments: [SANITY_BLOCK] })).verdict,
    ).toBe('pass')
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
      `Stage-B: GO — Антон, 2026-08-05\n\n${SANITY_BLOCK}`,
    ])
    expect(result.verdict).toBe('pass')
  })

  it('extracts every GitHub close keyword, deduped', () => {
    expect(extractClosedIssues('Closes #12, fixes #12, resolved #34')).toEqual([12, 34])
    expect(extractClosedIssues('see #99')).toEqual([])
  })

  /**
   * A partial PR carries `Part of #<parent>` and no closing keyword (#299). Its
   * Stage-B verdict still lands as a comment on that parent, so resolving the
   * linked issue from `Closes #N` alone lost the evidence — review of PR #303, N1.
   */
  it('also resolves the partial linkage `Part of #N`', () => {
    expect(extractLinkedIssues('Part of #201')).toEqual([201])
    expect(extractLinkedIssues('Closes #12\n\nPart of #201')).toEqual([12, 201])
    expect(extractLinkedIssues('this is not part of #201')).toEqual([])
  })

  it('the driver reads the Stage-B GO off a `Part of #N` parent', () => {
    const gh = makeGh({
      prs: {
        202: pr({
          number: 202,
          body: 'Part of #201',
          files: UI_PR_FILES,
          comments: [SANITY_BLOCK],
        }),
      },
      issues: { 201: [{ body: 'Stage-B: GO — Антон' }] },
    })
    const result = runStageBLint({ prNumber: 202, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('pass')
    expect(gh.calls.filter((c) => c[0] !== 'api').map((c) => `${c[0]} ${c[2]}`)).toEqual([
      'pr 202',
      'issue 201',
    ])
  })

  it('the driver fetches the linked issue comments through gh', () => {
    const gh = makeGh({
      prs: {
        201: pr({ number: 201, body: 'Closes #199', files: UI_PR_FILES, comments: [SANITY_BLOCK] }),
      },
      issues: { 199: [{ body: 'Stage-B: GO — Антон' }] },
    })
    const result = runStageBLint({ prNumber: 201, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('pass')
    expect(result.exitCode).toBe(0)
    expect(gh.calls.filter((c) => c[0] !== 'api').map((c) => `${c[0]} ${c[2]}`)).toEqual([
      'pr 201',
      'issue 199',
    ])
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
      'number,body,comments',
    ])
    // The file list is NOT read off that view — it is paged (canon §8).
    expect(ghFilesArgs(92, 2, 100)).toEqual([
      'api',
      'repos/bbm-academy-org/bbm-portal/pulls/92/files?per_page=100&page=2',
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

describe('stage-b-lint: a GO on a UI diff needs the lead UX-sanity record (#485)', () => {
  // Owner rejection of PR #470’s live stand, Антон, 2026-09-15: the owner became the
  // FIRST reader of the screen. The 2026-08-31 rule already said «run an elementary
  // UX-sanity pass before showing a UI»; it left no artifact, so nothing told a lead
  // that did it from one that skipped it.

  const GO = 'Stage-B: GO — Антон, 2026-09-15'

  it('a UI diff with a GO and NO UX-sanity record anywhere is a violation', () => {
    const result = checkStageB(pr({ number: 470, body: GO, files: UI_PR_FILES }))
    expect(result.verdict).toBe('violation')
    expect(result.message).toContain('UX-sanity')
    expect(result.message).toContain('task-cycle stage 5')
  })

  it('the same PR passes once the filled record is posted as a PR comment', () => {
    const result = checkStageB(
      pr({ number: 470, body: GO, files: UI_PR_FILES, comments: [SANITY_BLOCK] }),
    )
    expect(result.verdict).toBe('pass')
  })

  it('a bare `UX-sanity: OK` is NOT a record — the tail is part of it', () => {
    const result = checkStageB(
      pr({ number: 470, body: GO, files: UI_PR_FILES, comments: ['UX-sanity: OK'] }),
    )
    expect(result.verdict).toBe('violation')
    expect(result.message).toContain('screenshots')
  })

  it('a record missing ONE facet names exactly that facet', () => {
    const partial = SANITY_BLOCK.split('\n')
      .filter((l) => !l.startsWith('- Tiers:'))
      .join('\n')
    const result = checkStageB(
      pr({ number: 470, body: GO, files: UI_PR_FILES, comments: [partial] }),
    )
    expect(result.verdict).toBe('violation')
    expect(result.message).toContain('tiers')
  })

  it('a placeholder facet counts as unrecorded, so the PR template is not a record', () => {
    const templated = [
      'UX-sanity: <PASS | the defect found>',
      '- Screenshots: <paths or URLs judged>',
      '- Dominance: <verdict>',
      '- Tiers: <verdict>',
      '- Equal boxes: <verdict>',
      '- Legible states: <verdict>',
    ].join('\n')
    expect(
      checkStageB(pr({ number: 470, body: `${GO}\n\n${templated}`, files: UI_PR_FILES })).verdict,
    ).toBe('violation')
  })

  it('a fenced or HTML-commented example is never the record', () => {
    for (const quoted of [`<!--\n${SANITY_BLOCK}\n-->`, `\`\`\`\n${SANITY_BLOCK}\n\`\`\``]) {
      expect(
        checkStageB(pr({ number: 470, body: GO, files: UI_PR_FILES, comments: [quoted] })).verdict,
      ).toBe('violation')
    }
  })

  it('`batched at #N` and the lead self-certification are unaffected', () => {
    expect(checkStageB(pr({ body: 'Stage-B: batched at #117', files: UI_PR_FILES })).verdict).toBe(
      'pass',
    )
    expect(
      checkStageB(
        pr({ body: 'Stage-B: N/A (no visual surface) — lead-certified', files: UI_PR_FILES }),
      ).verdict,
    ).toBe('pass')
  })

  it('a non-UI diff with a GO and no record is still skipped', () => {
    expect(checkStageB(pr({ body: GO, files: ['src/endpoints/leads.ts'] })).verdict).toBe('skip')
  })

  it('the record may also live on the linked issue, like the GO itself', () => {
    const result = checkStageB(pr({ body: `${GO}\n\nCloses #388`, files: UI_PR_FILES }), [
      SANITY_BLOCK,
    ])
    expect(result.verdict).toBe('pass')
  })

  it('exposes the four canon facets plus the screenshots the pass judged', () => {
    expect(SANITY_FACETS).toEqual([
      'screenshots',
      'dominance',
      'tiers',
      'equal boxes',
      'legible states',
    ])
  })

  it('reads the block through list / bold decoration and either spelling', () => {
    const decorated = [
      '- **UX-sanity:** PASS',
      '  - **Screenshots:** .playwright-mcp/overview.png',
      '  - **Dominance:** the total card leads',
      '  - **Tiers:** distinct',
      '  - **Equal-boxes:** no',
      '  - **Legible-states:** yes',
    ].join('\n')
    const [record] = extractSanityRecords(decorated)
    expect(record.value).toBe('PASS')
    expect(missingSanityFacetsOf(record)).toEqual([])
  })

  it('an empty verdict on the marker line is not a record either', () => {
    const [record] = extractSanityRecords(SANITY_BLOCK.replace('UX-sanity: PASS', 'UX-sanity:'))
    expect(record.value).toBe('')
    expect(
      checkStageB(
        pr({
          body: GO,
          files: UI_PR_FILES,
          comments: [SANITY_BLOCK.replace('UX-sanity: PASS', 'UX-sanity:')],
        }),
      ).verdict,
    ).toBe('violation')
  })

  it('the driver reads the record off the PR\u2019s own comments', () => {
    const gh = makeGh({
      prs: {
        470: pr({ number: 470, body: GO, files: UI_PR_FILES, comments: [SANITY_BLOCK] }),
      },
    })
    const result = runStageBLint({ prNumber: 470, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('pass')
    expect(result.exitCode).toBe(0)
  })

  it('the same PR without the comment exits 1 under BLOCK', () => {
    const gh = makeGh({ prs: { 470: pr({ number: 470, body: GO, files: UI_PR_FILES }) } })
    const result = runStageBLint({ prNumber: 470, severity: 'block', gh: gh.gh })
    expect(result.verdict).toBe('violation')
    expect(result.exitCode).toBe(1)
  })

  it('the repo PR template carries the UX-sanity marker, unfilled', () => {
    const template = readFileSync(
      resolve(process.cwd(), '.github/pull_request_template.md'),
      'utf8',
    )
    expect(template).toMatch(/^UX-sanity: </m)
  })
})
