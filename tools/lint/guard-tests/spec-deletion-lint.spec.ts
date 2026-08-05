import { describe, expect, it } from 'vitest'

import {
  RETIREABLE_PATH_RE,
  SPEC_STATUS_PATH_RE,
  VALID_STATUSES,
  evaluateSpecDeletion,
  frontmatterField,
  parseNameStatus,
  sweepSpecStatus,
} from '../spec-deletion-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * spec-deletion — the mechanical half of docs/specs/README.md's status model
 * (#157, guard tranche 2). Two finding classes in one guard, both WARN:
 *
 *   DELETION (PR-gated) — «A spec is never deleted — it is retired by changing
 *   its status». Until now that sentence was prose; `git rm` bundled into an
 *   unrelated PR is exactly how a decision record disappears without anyone
 *   deciding to drop it.
 *   STATUS SWEEP (tree, every run) — «Every spec file carries an explicit
 *   `status:`», from the ladder, and `Superseded` names its successor. A spec
 *   with no status is unreadable: nobody can tell a proposal from production
 *   truth.
 *
 * Ported from ds-platform `tools/lint/spec-deletion-lint.ts` + its
 * `spec-status-lint.ts`, merged: one rule, one register row, one exit code.
 */

describe('RETIREABLE_PATH_RE', () => {
  it('covers both spec trees and the ADRs', () => {
    expect(RETIREABLE_PATH_RE.test('docs/specs/081-hours-calculator.md')).toBe(true)
    expect(RETIREABLE_PATH_RE.test('docs/superpowers/specs/2026-08-04-x.md')).toBe(true)
    expect(RETIREABLE_PATH_RE.test('docs/adr/002-repository-and-module-strategy.md')).toBe(true)
  })

  it('does not cover ordinary docs or code', () => {
    expect(RETIREABLE_PATH_RE.test('docs/ci-guardrails.md')).toBe(false)
    expect(RETIREABLE_PATH_RE.test('src/lib/okr/rows.ts')).toBe(false)
  })
})

describe('SPEC_STATUS_PATH_RE', () => {
  it('sweeps the two spec trees and never a README or an ADR', () => {
    // ADRs carry their status as `**Status:** Accepted` body prose
    // (docs/adr/README.md), not the YAML ladder — a different convention, so
    // the sweep would report every ADR as statusless. Deletion still covers them.
    expect(SPEC_STATUS_PATH_RE.test('docs/specs/081-hours-calculator.md')).toBe(true)
    expect(SPEC_STATUS_PATH_RE.test('docs/superpowers/specs/2026-08-04-x.md')).toBe(true)
    expect(SPEC_STATUS_PATH_RE.test('docs/specs/README.md')).toBe(false)
    expect(SPEC_STATUS_PATH_RE.test('docs/adr/002-x.md')).toBe(false)
  })
})

describe('frontmatterField', () => {
  const spec = '---\nstatus: Superseded\nsuperseded_by: 011-next.md\n---\n\n# X\n\nstatus: Draft\n'

  it('reads a field out of the leading frontmatter block', () => {
    expect(frontmatterField(spec, 'status')).toBe('Superseded')
    expect(frontmatterField(spec, 'superseded_by')).toBe('011-next.md')
  })

  it('never reads a lookalike line from the body', () => {
    expect(frontmatterField('# X\n\nstatus: Draft\n', 'status')).toBeNull()
  })

  it('tolerates quotes around the value', () => {
    expect(frontmatterField('---\nstatus: "In dev"\n---\n', 'status')).toBe('In dev')
  })
})

describe('sweepSpecStatus', () => {
  const file = (path: string, text: string) => ({ path, text })

  it('passes a spec carrying a ladder status', () => {
    expect(sweepSpecStatus([file('docs/specs/010-x.md', '---\nstatus: Shipped\n---\n')])).toEqual(
      [],
    )
  })

  it('flags a spec with no frontmatter status at all', () => {
    const findings = sweepSpecStatus([file('docs/specs/010-x.md', '# X\n')])
    expect(findings).toHaveLength(1)
    expect(findings[0].reason).toBe('statusless')
  })

  it('flags a status outside the ladder', () => {
    const findings = sweepSpecStatus([file('docs/specs/010-x.md', '---\nstatus: Done\n---\n')])
    expect(findings[0].reason).toBe('unknown-status')
    expect(findings[0].detail).toContain('Done')
  })

  it('flags Superseded with no successor named', () => {
    const findings = sweepSpecStatus([
      file('docs/specs/010-x.md', '---\nstatus: Superseded\n---\n'),
    ])
    expect(findings[0].reason).toBe('superseded-without-successor')
  })

  it('flags Superseded naming a successor that does not exist', () => {
    const findings = sweepSpecStatus([
      file('docs/specs/010-x.md', '---\nstatus: Superseded\nsuperseded_by: 099-ghost.md\n---\n'),
    ])
    expect(findings[0].reason).toBe('dangling-successor')
  })

  it('accepts Superseded whose successor is in the corpus', () => {
    expect(
      sweepSpecStatus([
        file('docs/specs/010-x.md', '---\nstatus: Superseded\nsuperseded_by: 011-y.md\n---\n'),
        file('docs/specs/011-y.md', '---\nstatus: Shipped\n---\n'),
      ]),
    ).toEqual([])
  })

  it('knows exactly the five ladder values', () => {
    expect([...VALID_STATUSES]).toEqual(['Draft', 'In dev', 'Shipped', 'Superseded', 'Retired'])
  })
})

describe('parseNameStatus', () => {
  it('parses adds, deletes and renames', () => {
    const entries = parseNameStatus(
      [
        'M\tdocs/specs/010-x.md',
        'D\tdocs/specs/011-y.md',
        'R100\tdocs/specs/a.md\tdocs/specs/b.md',
      ].join('\n'),
    )
    expect(entries).toEqual([
      { status: 'M', path: 'docs/specs/010-x.md' },
      { status: 'D', path: 'docs/specs/011-y.md' },
      { status: 'R100', oldPath: 'docs/specs/a.md', path: 'docs/specs/b.md' },
    ])
  })
})

describe('evaluateSpecDeletion', () => {
  const deleted = [{ status: 'D', path: 'docs/specs/010-x.md' }]

  it('passes a diff that deletes no decision record', () => {
    expect(evaluateSpecDeletion([{ status: 'D', path: 'src/lib/x.ts' }], [], '').ok).toBe(true)
  })

  it('flags a deleted spec with no sanctioned escape', () => {
    const verdict = evaluateSpecDeletion(deleted, [], 'Closes #157')
    expect(verdict.ok).toBe(false)
    expect(verdict.offenders).toEqual(['docs/specs/010-x.md'])
  })

  it('treats a rename as no deletion at all', () => {
    const verdict = evaluateSpecDeletion(
      [{ status: 'R100', oldPath: 'docs/specs/010-x.md', path: 'docs/specs/010-y.md' }],
      [],
      '',
    )
    expect(verdict.ok).toBe(true)
    expect(verdict.offenders).toEqual([])
  })

  it('accepts an explicit justification marker in the PR body', () => {
    const verdict = evaluateSpecDeletion(deleted, [], 'spec-deletion: merged into 011-y.md')
    expect(verdict.ok).toBe(true)
    expect(verdict.escape).toBe('marker')
  })

  it('rejects a bare marker with no reason', () => {
    expect(evaluateSpecDeletion(deleted, [], 'spec-deletion:').ok).toBe(false)
  })

  it('accepts a documented retirement wave — a Superseded/Retired transition in the same PR', () => {
    const verdict = evaluateSpecDeletion(deleted, ['docs/specs/011-y.md'], '')
    expect(verdict.ok).toBe(true)
    expect(verdict.escape).toBe('superseded-transition')
  })
})

describe('spec-deletion (spawned)', () => {
  const prEnv = (dir: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: dir,
  })

  it('exits 1 and names the deleted spec when the PR carries no escape', () => {
    const dir = caseDir('spec-deletion', 'deleted-bare')
    const res = runGuard('spec-deletion-lint.mjs', dir, {
      env: {
        ...prEnv(ghDir('spec-deletion', 'deleted-bare')),
        LINT_DIFF_NAMESTATUS_FILE: `${dir}/diff/name-status.txt`,
      },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('docs/specs/010-thing.md')
  })

  it('exits 0 when the PR body carries the justification marker', () => {
    const dir = caseDir('spec-deletion', 'deleted-marker')
    const res = runGuard('spec-deletion-lint.mjs', dir, {
      env: {
        ...prEnv(ghDir('spec-deletion', 'deleted-marker')),
        LINT_DIFF_NAMESTATUS_FILE: `${dir}/diff/name-status.txt`,
      },
    })
    expect(res.code).toBe(0)
  })

  it('exits 1 on a statusless spec even outside a PR event — the sweep always runs', () => {
    const res = runGuard('spec-deletion-lint.mjs', caseDir('spec-deletion', 'statusless'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('statusless')
  })

  it('exits 0 on a status-clean tree outside a PR event', () => {
    const res = runGuard('spec-deletion-lint.mjs', caseDir('spec-deletion', 'clean'))
    expect(res.code).toBe(0)
  })

  it('exits 0 on the real repo tree — the sweep must be green at merge', () => {
    const res = runGuard('spec-deletion-lint.mjs', null, { realTree: true })
    expect(res.code).toBe(0)
  })
})
