import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FACETS,
  checkUxRecord,
  extractRecords,
  ghIssueArgs,
  ghPrArgs,
  isLeadCertified,
  parseArgs,
  runUxRecordLint,
  severityFromArgv,
} from '../ux-record-lint.mjs'

/**
 * `pnpm lint:ux-record` (#433) turns the owner ruling of 2026-09-02 — «UX
 * composition, control choice, grouping, states, feedback and post-submit
 * behaviour are the AGENT's decision, recorded in the PR» — into a
 * deterministic pre-merge check.
 *
 * Why the guard exists: `build-ui-from-design-system` step 4 has listed the
 * states since #138 as an UNSIGNED checklist — nobody had to sign it and
 * nothing read it. The observed cost is in #433's body: spec 339's request form
 * shipped as eleven ungrouped fields because no one was licensed to group them,
 * and PR #430 hand-rolled a select next to `src/ui/select.tsx`. The inputs were
 * all present; the RECORD was absent.
 *
 * Surface under test: the pure `checkUxRecord(pr, issueComments)` seam and the
 * thin `runUxRecordLint({ prNumber, gh })` driver with an INJECTED gh runner —
 * no live GitHub, no network. The synthetic payloads are the exact shapes
 * `gh pr view --json number,body,files` and `gh issue view --json comments`
 * return. The UI-diff definition itself is `stage-b`'s, imported rather than
 * restated, so the two guards can never disagree about what a UI diff is.
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

/** Fake `gh` runner: PR payloads by number, issue comment lists by number. */
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

const UI_PR_FILES = [
  'src/app/(platform)/p/finance/page.tsx',
  'src/modules/finance/RequestsBoard.tsx',
]

/** A complete record, in the shape the PR template renders. */
const FULL_RECORD = [
  'UX-record:',
  '',
  '- Composition: one dominant summary card over a muted account grid',
  '- Controls: `@/ui/select` for the account picker; no hand-rolled select',
  '- Grouping: eleven fields folded into three fieldsets (who / what / when)',
  '- States: empty, loading skeleton, error banner, permission-denied notice',
  '- Feedback: inline field errors plus a toast on the submit result',
  '- Post-submit: redirect to the board with the new row highlighted',
].join('\n')

describe('ux-record-lint: a UI PR with no UX-record block does not pass (AC2 of #433)', () => {
  const result = checkUxRecord(
    pr({ number: 500, body: '## What\n\nNew finance board.\n\nCloses #499', files: UI_PR_FILES }),
  )

  it('classifies the PR as a UI diff and reports a violation', () => {
    expect(result.userFacing).toBe(true)
    expect(result.verdict).toBe('violation')
  })

  it('names the render files that triggered the gate', () => {
    expect(result.renderFiles).toEqual(UI_PR_FILES)
  })

  it('spells out every required facet in the message', () => {
    for (const facet of FACETS) expect(result.message.toLowerCase()).toContain(facet)
  })

  it('points at the owning canon rather than restating it', () => {
    expect(result.message).toContain('build-ui-from-design-system')
  })

  it('exits 1 under BLOCK severity and 0 (same violation) under WARN', () => {
    const gh = makeGh({
      prs: { 500: pr({ number: 500, body: 'Closes #499', files: UI_PR_FILES }) },
    })
    const warn = runUxRecordLint({ prNumber: 500, severity: 'warn', gh: gh.gh })
    expect(warn.verdict).toBe('violation')
    expect(warn.exitCode).toBe(0)
    expect(warn.lines.join('\n')).toContain('WARN')

    const block = runUxRecordLint({ prNumber: 500, severity: 'block', gh: gh.gh })
    expect(block.verdict).toBe('violation')
    expect(block.exitCode).toBe(1)
  })
})

describe('ux-record-lint: a complete record passes', () => {
  it('accepts the six-facet block in the PR body', () => {
    const result = checkUxRecord(pr({ body: `## UX record\n\n${FULL_RECORD}`, files: UI_PR_FILES }))
    expect(result.verdict).toBe('pass')
    expect(result.missingFacets).toEqual([])
  })

  it('accepts bold labels and `Post-submit behaviour` as the last facet', () => {
    const body = [
      'UX-record:',
      '- **Composition:** dominant total, muted tiles',
      '- **Controls:** kit select',
      '- **Grouping:** three fieldsets',
      '- **States:** empty / loading / error',
      '- **Feedback:** inline errors + toast',
      '- **Post-submit behaviour:** redirect to the board',
    ].join('\n')
    expect(checkUxRecord(pr({ body, files: UI_PR_FILES })).verdict).toBe('pass')
  })

  it('accepts the record when it lives in a linked issue comment, not the body', () => {
    const gh = makeGh({
      prs: { 501: pr({ number: 501, body: 'Closes #499', files: UI_PR_FILES }) },
      issues: { 499: [{ body: `Design notes.\n\n${FULL_RECORD}` }] },
    })
    const run = runUxRecordLint({ prNumber: 501, severity: 'block', gh: gh.gh })
    expect(run.verdict).toBe('pass')
    expect(run.exitCode).toBe(0)
  })
})

describe('ux-record-lint: an incomplete record is a violation, and says which facet is missing', () => {
  const partial = [
    'UX-record:',
    '- Composition: dominant total card',
    '- Controls: kit select',
    '- States: empty / loading / error',
  ].join('\n')
  const result = checkUxRecord(pr({ body: partial, files: UI_PR_FILES }))

  it('does not pass on three of six facets', () => {
    expect(result.verdict).toBe('violation')
  })

  it('names exactly the missing facets', () => {
    expect(result.missingFacets).toEqual(['grouping', 'feedback', 'post-submit'])
  })

  it('does not accept a facet whose value is an unfilled placeholder', () => {
    const placeholdered = FULL_RECORD.replace(
      '- Grouping: eleven fields folded into three fieldsets (who / what / when)',
      '- Grouping: <how the fields are grouped>',
    )
    const check = checkUxRecord(pr({ body: placeholdered, files: UI_PR_FILES }))
    expect(check.verdict).toBe('violation')
    expect(check.missingFacets).toEqual(['grouping'])
  })

  it('does not accept a facet whose value is TBD', () => {
    const tbd = FULL_RECORD.replace(
      '- Feedback: inline field errors plus a toast on the submit result',
      '- Feedback: TBD',
    )
    expect(checkUxRecord(pr({ body: tbd, files: UI_PR_FILES })).missingFacets).toEqual(['feedback'])
  })
})

describe('ux-record-lint: the lead self-certification is the only marker-level escape', () => {
  it('accepts `UX-record: N/A (no UX decisions) — lead-certified`', () => {
    expect(isLeadCertified('N/A (no UX decisions) — lead-certified')).toBe(true)
    expect(
      checkUxRecord(
        pr({ body: 'UX-record: N/A (no UX decisions) — lead-certified', files: UI_PR_FILES }),
      ).verdict,
    ).toBe('pass')
  })

  it('accepts a plain hyphen as the attribution separator', () => {
    expect(isLeadCertified('N/A (behavioural only) - lead-certified')).toBe(true)
  })

  it('rejects a BARE `N/A` — the certification has to be claimed', () => {
    expect(isLeadCertified('N/A')).toBe(false)
    expect(checkUxRecord(pr({ body: 'UX-record: N/A', files: UI_PR_FILES })).verdict).toBe(
      'violation',
    )
  })
})

describe('ux-record-lint: text that only TALKS ABOUT the block is never evidence', () => {
  it('ignores the PR template instructions inside an HTML comment', () => {
    const body = [
      '<!--',
      'UX-record:',
      '- Composition: <what dominates>',
      '- Controls: <which kit controls>',
      '- Grouping: <how fields group>',
      '- States: <empty / loading / error>',
      '- Feedback: <what the user sees>',
      '- Post-submit: <where the user lands>',
      '-->',
      '',
      'Closes #499',
    ].join('\n')
    expect(checkUxRecord(pr({ body, files: UI_PR_FILES })).verdict).toBe('violation')
  })

  it('ignores a quoted example inside a fenced code block', () => {
    const body = ['```', FULL_RECORD, '```'].join('\n')
    expect(checkUxRecord(pr({ body, files: UI_PR_FILES })).verdict).toBe('violation')
  })
})

describe('ux-record-lint: scope — only a UI diff needs the record', () => {
  it('skips a PR with no non-test *.tsx / *.css under src/', () => {
    const result = checkUxRecord(
      pr({ files: ['tools/lint/ux-record-lint.mjs', 'docs/ci-guardrails.md'] }),
    )
    expect(result.verdict).toBe('skip')
    expect(result.userFacing).toBe(false)
  })

  it('skips a PR whose only view files are tests', () => {
    expect(
      checkUxRecord(pr({ files: ['src/modules/finance/RequestsBoard.spec.tsx'] })).verdict,
    ).toBe('skip')
  })
})

describe('ux-record-lint: block extraction stops at the next heading', () => {
  it('does not borrow facets from a later, unrelated section', () => {
    const body = [
      'UX-record:',
      '- Composition: dominant total card',
      '- Controls: kit select',
      '- Grouping: three fieldsets',
      '',
      '## Notes',
      '',
      '- States: whatever',
      '- Feedback: whatever',
      '- Post-submit: whatever',
    ].join('\n')
    expect(checkUxRecord(pr({ body, files: UI_PR_FILES })).missingFacets).toEqual([
      'states',
      'feedback',
      'post-submit',
    ])
  })

  it('extracts one record per marker', () => {
    expect(extractRecords(FULL_RECORD)).toHaveLength(1)
  })
})

describe('ux-record-lint: gh access and CLI plumbing', () => {
  it('reads the PR through argv arrays, never a shell string', () => {
    expect(ghPrArgs(7)).toEqual([
      'pr',
      'view',
      '7',
      '--repo',
      'bbm-academy-org/bbm-portal',
      '--json',
      'number,body,files',
    ])
    expect(ghIssueArgs(7)).toContain('number,comments')
  })

  it('reports an unreadable PR as an ERROR that exits 1 under every severity', () => {
    const gh = makeGh({})
    for (const severity of ['warn', 'block'] as const) {
      const run = runUxRecordLint({ prNumber: 999, severity, gh: gh.gh })
      expect(run.verdict).toBe('error')
      expect(run.exitCode).toBe(1)
    }
  })

  it('combines the `PR_NUMBER` env form with `--severity block`', () => {
    expect(severityFromArgv(['--severity', 'block'])).toBe('block')
    expect(severityFromArgv([], { UX_RECORD_SEVERITY: 'block' })).toBe('block')
    expect(parseArgs(['--severity', 'block'], { PR_NUMBER: '433' })).toEqual({
      prNumber: '433',
      severity: 'block',
    })
  })
})

describe('ux-record-lint: the repo PR template, shipped unfilled, is not a record', () => {
  // The real artifact, read from disk — the fixture and the shipped template
  // can never drift apart, which is the whole point of reading it here.
  const TEMPLATE = readFileSync(resolve(process.cwd(), '.github/pull_request_template.md'), 'utf8')

  it('carries the `UX-record:` marker and all six facet labels', () => {
    expect(TEMPLATE).toMatch(/^UX-record:/m)
    for (const facet of FACETS) expect(TEMPLATE.toLowerCase()).toContain(`- ${facet}:`)
  })

  it('does NOT pass on a UI PR while its facet values are still placeholders', () => {
    const result = checkUxRecord(pr({ number: 600, body: TEMPLATE, files: UI_PR_FILES }))
    expect(result.verdict).toBe('violation')
    expect(result.missingFacets).toEqual([...FACETS])
  })

  it('passes once the facet values are actually filled in', () => {
    const filled = TEMPLATE.replace(/^(- [A-Za-z-]+:) <[^>]*>$/gm, '$1 decided, see above')
    expect(filled).not.toEqual(TEMPLATE)
    expect(checkUxRecord(pr({ body: filled, files: UI_PR_FILES })).verdict).toBe('pass')
  })
})

describe('ux-record-lint: the guard is wired the way the canon records it', () => {
  const root = process.cwd()

  it('has a `lint:ux-record` script in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['lint:ux-record']).toBe('node tools/lint/ux-record-lint.mjs')
  })

  it('runs in pr-body-guards.yml at WARN with a real signal (`--severity block`)', () => {
    const wf = readFileSync(resolve(root, '.github/workflows/pr-body-guards.yml'), 'utf8')
    const job = wf.slice(wf.indexOf('\n  ux-record:'))
    expect(job).toContain('continue-on-error: true')
    expect(job).toContain('pnpm lint:ux-record --severity block')
    expect(job).toContain('GH_TOKEN:')
    expect(job).toContain('PR_NUMBER:')
  })

  it('is registered in the §5 guard inventory', () => {
    const canon = readFileSync(resolve(root, 'docs/ci-guardrails.md'), 'utf8')
    expect(canon).toContain('**ux-record**')
  })
})
