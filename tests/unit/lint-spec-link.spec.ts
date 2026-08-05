import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SPEC_STATUSES,
  evaluateSpecLink,
  exitCodeFor,
  extractClosedIssues,
  extractSpecPaths,
  isRelatedSpec,
  parseFrontmatter,
  severityFromEnv,
  specExemptReason,
  specRefsFromIssueBody,
  specRefsFromPrBody,
  specRequired,
  specStatus,
  stripCodeFences,
} from '../../tools/lint/spec-link-lint.mjs'

/**
 * The gate exists because a feature PR with no spec is a feature the owner
 * never approved (task-cycle stage 1a/2). The guard is deliberately narrow: it
 * fires only where the task-cycle actually demands a spec — a `Feature` issue
 * (or a `feat:` PR) that changes production module code under `src/`.
 */

/** A tree stub: only the listed spec files exist. */
function tree(files: Record<string, string>) {
  return {
    exists: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    read: (p: string) => files[p],
    listSpecs: () => Object.keys(files),
  }
}

const SHIPPED = '---\nstatus: Shipped\nissue: 81\n---\n\n# Spec\n'
const DRAFT = '---\nstatus: Draft\nissue: 81\n---\n\n# Spec\n'

describe('parseFrontmatter / specStatus', () => {
  it('reads the frontmatter block of a spec', () => {
    expect(parseFrontmatter(SHIPPED)).toEqual({ status: 'Shipped', issue: '81' })
    expect(specStatus(SHIPPED)).toBe('Shipped')
  })

  it('returns null for a spec with no frontmatter at all', () => {
    expect(specStatus('# Spec\n\n## Why\n')).toBe(null)
    expect(parseFrontmatter('# Spec\n')).toEqual({})
  })

  it('keeps the multi-word ladder value intact', () => {
    expect(specStatus('---\nstatus: In dev\n---\n')).toBe('In dev')
    expect(SPEC_STATUSES).toEqual(['Draft', 'In dev', 'Shipped', 'Superseded', 'Retired'])
  })
})

describe('extractClosedIssues', () => {
  it('takes every GitHub auto-close keyword, deduplicated', () => {
    const body = 'Closes #135\n\nAlso fixes #12 and Resolved #135.'
    expect(extractClosedIssues(body)).toEqual([135, 12])
  })

  it('is empty for a body with no link', () => {
    expect(extractClosedIssues('## What\n\nSome change.')).toEqual([])
    expect(extractClosedIssues('')).toEqual([])
  })
})

describe('specExemptReason', () => {
  it('reads the escape hatch and its reason at a real line start', () => {
    expect(specExemptReason('spec-exempt: CMS-contract upkeep, contract lives in schemas.ts')).toBe(
      'CMS-contract upkeep, contract lives in schemas.ts',
    )
    expect(specExemptReason('## Why\n\nspec-exempt: chore inside an approved scope\n')).toBe(
      'chore inside an approved scope',
    )
  })

  it('accepts the backticked form the docs show — doc and tool must agree', () => {
    expect(specExemptReason('`spec-exempt: CMS-contract upkeep`')).toBe('CMS-contract upkeep')
  })

  /**
   * The hatch turns the gate off, so a body that merely TALKS about it must not
   * trip it: a quoted review comment or a PR documenting the guard would
   * otherwise exempt itself with pure boilerplate.
   */
  it('refuses a merely quoted mention — blockquote, list item, indent, code fence', () => {
    expect(specExemptReason('> spec-exempt: <reason> in the PR body')).toBe(null)
    expect(specExemptReason('- spec-exempt: like this')).toBe(null)
    expect(specExemptReason('* spec-exempt: like this')).toBe(null)
    expect(specExemptReason('    spec-exempt: indented, i.e. a code block')).toBe(null)
    expect(specExemptReason('The hatch:\n\n```\nspec-exempt: <reason>\n```\n')).toBe(null)
  })

  it('returns an empty string for a bare marker — a reasonless exemption is not an exemption', () => {
    expect(specExemptReason('spec-exempt:')).toBe('')
    expect(specExemptReason('spec-exempt:    ')).toBe('')
    expect(specExemptReason('`spec-exempt:`')).toBe('')
  })

  it('returns null when the marker is absent', () => {
    expect(specExemptReason('Closes #1')).toBe(null)
  })
})

describe('stripCodeFences', () => {
  it('removes fenced blocks so quoted markers and paths cannot be mined from them', () => {
    expect(stripCodeFences('a\n```\nspec-exempt: x\n```\nb')).toBe('a\n\nb')
  })

  it('leaves inline backticks alone', () => {
    expect(stripCodeFences('use `spec-exempt: x` here')).toBe('use `spec-exempt: x` here')
  })
})

describe('extractSpecPaths', () => {
  it('finds spec paths in prose, backticks and links; skips README', () => {
    const body =
      'Spec: `docs/specs/081-hours-calculator.md` and [design](docs/superpowers/specs/2026-08-04-x.md). See docs/specs/README.md.'
    expect(extractSpecPaths(body)).toEqual([
      'docs/specs/081-hours-calculator.md',
      'docs/superpowers/specs/2026-08-04-x.md',
    ])
  })

  it('normalizes Windows separators and deduplicates', () => {
    expect(extractSpecPaths('docs\\specs\\081-a.md docs/specs/081-a.md')).toEqual([
      'docs/specs/081-a.md',
    ])
  })
})

/**
 * A spec path mentioned anywhere in a body used to satisfy the gate, so a PR
 * that named a spec as background reading passed. The reference now has to sit
 * in a declared position.
 */
describe('specRefsFromPrBody — the anchored position in a PR body', () => {
  it('reads a `Spec:` line, bare, bolded, or with a section suffix', () => {
    expect(specRefsFromPrBody('Spec: docs/specs/102-x.md')).toEqual(['docs/specs/102-x.md'])
    expect(specRefsFromPrBody('**Spec:** `docs/specs/102-x.md` §3')).toEqual([
      'docs/specs/102-x.md',
    ])
    expect(specRefsFromPrBody('Spec reference: docs/specs/102-x.md')).toEqual([
      'docs/specs/102-x.md',
    ])
  })

  it('ignores a spec named anywhere else — background reading is not a declaration', () => {
    expect(
      specRefsFromPrBody('Closes #102\n\nFor context see docs/specs/081-hours-calculator.md.'),
    ).toEqual([])
    expect(specRefsFromPrBody('> Spec: docs/specs/102-x.md')).toEqual([])
  })
})

describe('specRefsFromIssueBody — the task-canon `Spec reference` section', () => {
  it('reads paths from the section body only', () => {
    const body =
      '## Context\n\nSee docs/specs/081-hours-calculator.md for history.\n\n' +
      '## Spec reference\n\nSpec `docs/specs/102-x.md` §3\n\n## Acceptance criteria\n\n- [ ] x\n'
    expect(specRefsFromIssueBody(body)).toEqual(['docs/specs/102-x.md'])
  })

  it('is empty when the issue has no such section', () => {
    expect(specRefsFromIssueBody('## Context\n\ndocs/specs/102-x.md\n')).toEqual([])
  })
})

describe('isRelatedSpec', () => {
  it('relates by the NNN- filename prefix of a linked issue', () => {
    expect(isRelatedSpec('docs/specs/102-x.md', {}, [102], [])).toBe(true)
    expect(isRelatedSpec('docs/specs/081-x.md', {}, [102], [])).toBe(false)
  })

  it("relates by the spec's own `issue:` frontmatter", () => {
    expect(
      isRelatedSpec('docs/superpowers/specs/2026-08-04-x.md', { issue: '102' }, [102], []),
    ).toBe(true)
  })

  it('relates a spec the PR itself edits — the shared-spec case', () => {
    expect(
      isRelatedSpec('docs/specs/081-x.md', {}, [200], ['src/a.tsx', 'docs/specs/081-x.md']),
    ).toBe(true)
  })
})

describe('specRequired', () => {
  const src = ['src/modules/hours/page.tsx']

  it('requires a spec for a Feature issue that changes src/', () => {
    expect(
      specRequired({ title: 'chore: x', files: src, issues: [{ number: 1, type: 'Feature' }] })
        .required,
    ).toBe(true)
  })

  it('requires a spec for a `feat:` PR touching src/, whatever the issue type', () => {
    expect(
      specRequired({
        title: 'feat(hours): rate table',
        files: src,
        issues: [{ number: 1, type: 'Task' }],
      }).required,
    ).toBe(true)
  })

  it('does NOT require a spec for a fix/chore PR', () => {
    expect(
      specRequired({
        title: 'fix(hours): off-by-one',
        files: src,
        issues: [{ number: 1, type: 'Bug' }],
      }).required,
    ).toBe(false)
  })

  it('does NOT require a spec for a feature PR that touches no production code', () => {
    // Tooling / docs / skills PRs carry no user-facing behavior — stage 1a does
    // not apply to them even under a `feat:` title.
    const r = specRequired({
      title: 'feat: SDD package',
      files: ['docs/specs/README.md', 'tools/lint/spec-link-lint.mjs'],
      issues: [{ number: 135, type: 'Feature' }],
    })
    expect(r.required).toBe(false)
    expect(r.reason).toMatch(/src\//)
  })
})

describe('evaluateSpecLink', () => {
  const featurePr = {
    number: 200,
    title: 'feat(hours): hourly rate table',
    body: 'Closes #102',
    files: ['src/modules/hours/table.tsx'],
  }
  const featureIssue = { number: 102, type: 'Feature', body: '## Spec reference\n\nnone yet' }

  it('FLAGS a feature PR with no spec link anywhere — the acceptance case', () => {
    const res = evaluateSpecLink({
      pr: featurePr,
      issues: [featureIssue],
      tree: tree({}),
    })
    expect(res.verdict).toBe('findings')
    expect(res.findings.join('\n')).toMatch(/no spec/i)
  })

  it('passes when the PR body names an existing spec with a valid status', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nSpec: `docs/specs/102-x.md`' },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/102-x.md': SHIPPED }),
    })
    expect(res.verdict).toBe('ok')
    expect(res.findings).toEqual([])
  })

  it('accepts a spec named in the linked ISSUE body, not only in the PR body', () => {
    const res = evaluateSpecLink({
      pr: featurePr,
      issues: [{ ...featureIssue, body: '## Spec reference\n\ndocs/specs/102-x.md §3' }],
      tree: tree({ 'docs/specs/102-x.md': SHIPPED }),
    })
    expect(res.verdict).toBe('ok')
  })

  it('accepts the issue-numbered spec that already exists in the tree', () => {
    const res = evaluateSpecLink({
      pr: featurePr,
      issues: [featureIssue],
      tree: tree({ 'docs/specs/102-hours-hourly-rate-table-cleanup.md': SHIPPED }),
    })
    expect(res.verdict).toBe('ok')
  })

  it('flags a named spec that does not exist in the tree', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nSpec: docs/specs/102-ghost.md' },
      issues: [featureIssue],
      tree: tree({}),
    })
    expect(res.verdict).toBe('findings')
    expect(res.findings.join('\n')).toMatch(/does not exist/i)
  })

  it('flags a spec with no status frontmatter and one with a bogus value', () => {
    const noStatus = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nSpec: docs/specs/102-x.md' },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/102-x.md': '# Spec\n' }),
    })
    expect(noStatus.findings.join('\n')).toMatch(/no `status:`/)

    const bogus = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nSpec: docs/specs/102-x.md' },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/102-x.md': '---\nstatus: Готово\n---\n' }),
    })
    expect(bogus.findings.join('\n')).toMatch(/not a ladder status/)
  })

  it('flags implementing a spec still on Draft — no owner "go" has moved it', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nSpec: docs/specs/102-x.md' },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/102-x.md': DRAFT }),
    })
    expect(res.verdict).toBe('findings')
    expect(res.findings.join('\n')).toMatch(/Draft/)
  })

  it('FLAGS a spec mentioned only as background reading — the anchoring hole', () => {
    // Reproduces the reviewer's case: a PR closing #102 that merely mentions an
    // unrelated spec somewhere in the prose used to PASS.
    const res = evaluateSpecLink({
      pr: {
        ...featurePr,
        body: 'Closes #102\n\nFor context see docs/specs/081-hours-calculator.md.',
      },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/081-hours-calculator.md': SHIPPED }),
    })
    expect(res.verdict).toBe('findings')
    expect(res.findings.join('\n')).toMatch(/names no spec/i)
  })

  it('FLAGS a declared spec unrelated to any linked issue, and says which', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nSpec: docs/specs/081-hours-calculator.md' },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/081-hours-calculator.md': SHIPPED }),
    })
    expect(res.verdict).toBe('findings')
    expect(res.findings.join('\n')).toMatch(/none of them references #102/i)
    // The unrelated mention is still reported — as a note, not silently dropped.
    expect(res.notes.join('\n')).toMatch(/does not reference #102 — read as background/i)
  })

  it('accepts a spec the PR edits even when its number differs from the issue', () => {
    const res = evaluateSpecLink({
      pr: {
        ...featurePr,
        body: 'Closes #102\n\nSpec: docs/specs/081-hours-calculator.md',
        files: ['src/modules/hours/table.tsx', 'docs/specs/081-hours-calculator.md'],
      },
      issues: [featureIssue],
      tree: tree({ 'docs/specs/081-hours-calculator.md': SHIPPED }),
    })
    expect(res.verdict).toBe('ok')
  })

  it('accepts a spec related by its own `issue:` frontmatter', () => {
    const res = evaluateSpecLink({
      pr: {
        ...featurePr,
        body: 'Closes #102\n\nSpec: docs/superpowers/specs/2026-08-04-rate.md',
      },
      issues: [featureIssue],
      tree: tree({
        'docs/superpowers/specs/2026-08-04-rate.md': '---\nstatus: In dev\nissue: 102\n---\n',
      }),
    })
    expect(res.verdict).toBe('ok')
  })

  it('does not let a quoted escape hatch turn the gate off', () => {
    const res = evaluateSpecLink({
      pr: {
        ...featurePr,
        body: 'Closes #102\n\nThe guard offers an escape hatch:\n\n> spec-exempt: <reason> in the PR body\n',
      },
      issues: [featureIssue],
      tree: tree({}),
    })
    expect(res.verdict).toBe('findings')
  })

  it('honours the backticked escape hatch the docs show', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\n`spec-exempt: CMS-contract upkeep`' },
      issues: [featureIssue],
      tree: tree({}),
    })
    expect(res.verdict).toBe('skip')
    expect(res.notes.join('\n')).toMatch(/CMS-contract upkeep/)
  })

  it('skips a PR with no auto-close link at all (a different guard owns that)', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, body: 'no link here' },
      issues: [],
      tree: tree({}),
    })
    expect(res.verdict).toBe('skip')
  })

  it('honours `spec-exempt:` with a reason, and refuses a reasonless one', () => {
    const exempt = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nspec-exempt: CMS-contract upkeep' },
      issues: [featureIssue],
      tree: tree({}),
    })
    expect(exempt.verdict).toBe('skip')
    expect(exempt.notes.join('\n')).toMatch(/CMS-contract upkeep/)

    const bare = evaluateSpecLink({
      pr: { ...featurePr, body: 'Closes #102\n\nspec-exempt:' },
      issues: [featureIssue],
      tree: tree({}),
    })
    expect(bare.verdict).toBe('findings')
    expect(bare.findings.join('\n')).toMatch(/reason/i)
  })

  it('skips a chore PR entirely', () => {
    const res = evaluateSpecLink({
      pr: { ...featurePr, title: 'chore(deps): bump', body: 'Closes #102' },
      issues: [{ number: 102, type: 'Task', body: '' }],
      tree: tree({}),
    })
    expect(res.verdict).toBe('skip')
  })
})

describe('severity — WARN today, BLOCK on promotion (#136)', () => {
  it('defaults to WARN so findings do not fail the run yet', () => {
    expect(severityFromEnv({})).toBe('warn')
    expect(exitCodeFor({ verdict: 'findings' }, 'warn')).toBe(0)
  })

  it('exits non-zero on findings once promoted to block', () => {
    expect(severityFromEnv({ LINT_SEVERITY: 'block' })).toBe('block')
    expect(exitCodeFor({ verdict: 'findings' }, 'block')).toBe(1)
    expect(exitCodeFor({ verdict: 'ok' }, 'block')).toBe(0)
    expect(exitCodeFor({ verdict: 'skip' }, 'block')).toBe(0)
  })
})

describe('end-to-end guard run (the acceptance case, on the real script)', () => {
  /** A synthetic PR + issue served through the `gh` fixture seam. */
  function fixtureDirs(prBody: string, specFiles: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'spec-link-'))
    const ghDir = join(dir, 'gh')
    const root = join(dir, 'root')
    mkdirSync(ghDir, { recursive: true })
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    writeFileSync(
      join(ghDir, 'pr-view-999.json'),
      JSON.stringify({
        number: 999,
        title: 'feat(hours): payout summary',
        body: prBody,
        files: [{ path: 'src/modules/hours/summary.tsx' }],
      }),
    )
    writeFileSync(
      join(ghDir, 'issue-view-102.json'),
      JSON.stringify({
        number: 102,
        title: 'Payout summary',
        body: '',
        issueType: { name: 'Feature' },
      }),
    )
    for (const [name, text] of Object.entries(specFiles)) {
      writeFileSync(join(root, 'docs', 'specs', name), text)
    }
    return { ghDir, root }
  }

  function run(
    prBody: string,
    specFiles: Record<string, string>,
    env: Record<string, string> = {},
  ) {
    const { ghDir, root } = fixtureDirs(prBody, specFiles)
    return spawnSync(process.execPath, ['tools/lint/spec-link-lint.mjs', '--pr', '999'], {
      encoding: 'utf8',
      env: { ...process.env, LINT_GH_FIXTURE_DIR: ghDir, LINT_FIXTURE_ROOT: root, ...env },
    })
  }

  it('catches a synthetic feature PR that links no spec — and stays WARN (exit 0) today', () => {
    const res = run('Closes #102', {})
    expect(res.stderr).toMatch(/names no spec/)
    expect(res.stderr).toMatch(/WARN/)
    expect(res.status).toBe(0)
  })

  it('the same PR fails the run once the guard is promoted to block (#136)', () => {
    const res = run('Closes #102', {}, { LINT_SEVERITY: 'block' })
    expect(res.stderr).toMatch(/BLOCK/)
    expect(res.status).toBe(1)
  })

  it('passes the same PR once the spec exists with a valid status', () => {
    const res = run('Closes #102', {
      '102-payout-summary.md': '---\nstatus: In dev\n---\n\n# Spec\n',
    })
    expect(res.stdout).toMatch(/PASS/)
    expect(res.status).toBe(0)
  })
})
