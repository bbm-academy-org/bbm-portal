import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  RETIREABLE_PATH_RE,
  SPEC_STATUS_PATH_RE,
  VALID_STATUSES,
  evaluateSpecDeletion,
  frontmatterField,
  isRetirementTransition,
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

  // #577: the real diff is read with `-z` — NUL-terminated fields, never
  // quoted, a rename's two paths as two fields.
  it('parses the NUL-terminated `-z` form, paths verbatim', () => {
    const fields = [
      'M',
      'docs/specs/010-x.md',
      'D',
      'docs/specs/011-спека.md',
      'R100',
      'docs/adr/a.md',
      'docs/adr/решения/b.md',
    ]
    expect(parseNameStatus(fields.map((f) => `${f}\0`).join(''))).toEqual([
      { status: 'M', path: 'docs/specs/010-x.md' },
      { status: 'D', path: 'docs/specs/011-спека.md' },
      { status: 'R100', oldPath: 'docs/adr/a.md', path: 'docs/adr/решения/b.md' },
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

  it('accepts the backticked form, as `spec-link`s sibling hatch does', () => {
    expect(evaluateSpecDeletion(deleted, [], '`spec-deletion: merged into 011-y.md`').ok).toBe(true)
  })

  it('rejects a bare marker with no reason', () => {
    expect(evaluateSpecDeletion(deleted, [], 'spec-deletion:').ok).toBe(false)
  })

  /**
   * Review of PR #160, blocker. A PR that deletes a spec is exactly the PR whose
   * body is likely to CONTAIN the guard's own failure text — pasted in a fence,
   * quoted from a review comment, or left in the template's HTML comment. Text
   * that merely talks about the hatch must never arm it: `.claude/rules/
   * design-process.md` states the rule for `stage-b`, and `spec-link` fixed the
   * same class in PR #151 blocker 1. This guard shipped without it.
   */
  describe('text that merely QUOTES the marker never arms the hatch', () => {
    const quoted = (body: string) => evaluateSpecDeletion(deleted, [], body)

    it('a fenced example does not arm it', () => {
      const body = ['## What', '', '```', 'spec-deletion: <reason + successor>', '```', ''].join(
        '\n',
      )
      expect(quoted(body).ok).toBe(false)
    })

    it('a tilde-fenced example does not arm it', () => {
      expect(quoted('~~~md\nspec-deletion: merged into 011-y.md\n~~~').ok).toBe(false)
    })

    it('a blockquoted marker — a pasted review comment — does not arm it', () => {
      expect(quoted('> spec-deletion: merged into 011-y.md').ok).toBe(false)
    })

    it('a list-item marker does not arm it', () => {
      expect(quoted('- spec-deletion: merged into 011-y.md').ok).toBe(false)
    })

    it('the marker inside an HTML comment does not arm it', () => {
      expect(quoted('<!--\nspec-deletion: <reason + successor>\n-->').ok).toBe(false)
    })

    /**
     * Review round 2, NIT: `^\s*` admitted a 4-space-indented line, which in
     * markdown is an INDENTED CODE BLOCK — the shape a pasted terminal
     * transcript takes. `stripNonEvidence` deliberately does not strip those
     * (each marker owns its own anchor), so the anchor has to. Up to three
     * spaces is ordinary leading whitespace and still counts.
     */
    it('an indented code block quoting the marker does not arm it', () => {
      expect(quoted('Log:\n\n    spec-deletion: merged into 011-y.md\n').ok).toBe(false)
    })

    it('a tab-indented code block does not arm it either', () => {
      expect(quoted('Log:\n\n\tspec-deletion: merged into 011-y.md\n').ok).toBe(false)
    })

    it('up to three spaces is ordinary indentation and still arms it', () => {
      expect(quoted('   spec-deletion: merged into 011-y.md').escape).toBe('marker')
    })

    it('a real marker still arms it even when the body also quotes one', () => {
      const body = [
        '```',
        'spec-deletion: <reason + successor>',
        '```',
        '',
        'spec-deletion: folded into 011-y.md',
      ].join('\n')
      expect(quoted(body).escape).toBe('marker')
    })
  })

  it('accepts a documented retirement wave — a Superseded/Retired transition in the same PR', () => {
    const verdict = evaluateSpecDeletion(deleted, ['docs/specs/011-y.md'], '')
    expect(verdict.ok).toBe(true)
    expect(verdict.escape).toBe('superseded-transition')
  })
})

/**
 * Review of PR #160, MAJOR: escape (c) promised a TRANSITION and delivered
 * "carries a retired status". A PR that fixes a typo in a spec retired months
 * ago, and separately `git rm`s a different one, must not be read as a
 * documented retirement wave.
 */
describe('isRetirementTransition', () => {
  const fm = (status: string) => `---\nstatus: ${status}\n---\n\n# X\n`

  it('is a transition when the PR moves a live spec to Superseded', () => {
    expect(isRetirementTransition(fm('Shipped'), fm('Superseded'))).toBe(true)
  })

  it('is a transition for Retired too', () => {
    expect(isRetirementTransition(fm('In dev'), fm('Retired'))).toBe(true)
  })

  it('is NOT a transition when the spec was already Superseded before the PR', () => {
    expect(isRetirementTransition(fm('Superseded'), fm('Superseded'))).toBe(false)
  })

  it('is NOT a transition when the head status is not a retirement', () => {
    expect(isRetirementTransition(fm('Draft'), fm('Shipped'))).toBe(false)
  })

  it('is NOT a transition when the base version cannot be read — fail closed', () => {
    expect(isRetirementTransition(null, fm('Superseded'))).toBe(false)
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

  it('exits 1 when a fenced example is the only thing resembling the marker', () => {
    const dir = caseDir('spec-deletion', 'deleted-quoted-marker')
    const res = runGuard('spec-deletion-lint.mjs', dir, {
      env: {
        ...prEnv(ghDir('spec-deletion', 'deleted-quoted-marker')),
        LINT_DIFF_NAMESTATUS_FILE: `${dir}/diff/name-status.txt`,
      },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('docs/specs/010-thing.md')
  })

  /**
   * Review round 2, NIT: `isRetirementTransition` was well covered as a pure
   * function, but the IO around it — `baseFileText` + the rewritten
   * `retiredInThisPr` — had no spawned case, so the `LINT_BASE_TREE_DIR` seam
   * was untested code wearing a test affordance. Both fixtures delete one spec
   * and touch another; they differ ONLY in the base version of the touched one.
   */
  describe('escape (c) end to end, through the LINT_BASE_TREE_DIR seam', () => {
    const wave = (name: string) => {
      const dir = caseDir('spec-deletion', name)
      return runGuard('spec-deletion-lint.mjs', dir, {
        env: {
          ...prEnv(ghDir('spec-deletion', name)),
          LINT_DIFF_NAMESTATUS_FILE: `${dir}/diff/name-status.txt`,
          LINT_BASE_TREE_DIR: `${dir}/base`,
        },
      })
    }

    it('exits 0 when the PR retires a live spec in the same diff', () => {
      const res = wave('retired-wave')
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('superseded-transition')
    })

    it('exits 1 when the touched spec was ALREADY retired before the PR', () => {
      const res = wave('already-retired')
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('docs/specs/010-thing.md')
    })
  })

  /**
   * Review of PR #160, MINOR: zero spec FILES is the wrong-tree input problem,
   * not a clean sweep — the same argument the instruction-budget empty-corpus
   * decision rests on. A CI guard has no exit 2 (canon §8 admits 0 and 1 only),
   * so fail-closed here means exit 1 with a message that is not a finding about
   * any spec.
   */
  it('exits 1 on a tree with no spec files at all — it cleared nothing', () => {
    const res = runGuard('spec-deletion-lint.mjs', caseDir('spec-deletion', 'no-specs'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('no spec files')
  })

  /**
   * #577: with git's default `core.quotepath=true`, `git diff --name-status`
   * printed a non-ASCII path as a quoted octal escape
   * (`"docs/specs/010-\321\201..."`), which never matched the decision-record
   * pattern — a spec deleted under a Cyrillic path passed with exit 0. These run
   * the real diff in a throwaway repo that pins `quotepath=true` locally, so a
   * machine-wide `false` (the owner's checkout) cannot hide the bug.
   */
  describe('against a real git diff (non-ASCII paths)', () => {
    const repos: string[] = []
    afterAll(() => {
      for (const dir of repos) rmSync(dir, { recursive: true, force: true })
    })

    const git = (cwd: string, ...args: string[]) => {
      const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
      if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
      return res.stdout
    }
    const put = (root: string, rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), text)
    }
    const spec = (status: string, n: number) =>
      ['---', `status: ${status}`, `issue: ${n}`, '---', '', `# Spec ${n}`, ''].join('\n')

    /** Branch `base` holds the given specs; HEAD is `base` plus one `change` commit. */
    const repo = (specs: string[], change: (root: string) => void) => {
      const root = mkdtempSync(join(tmpdir(), 'spec-deletion-'))
      repos.push(root)
      git(root, 'init', '-q')
      git(root, 'config', 'core.quotepath', 'true')
      git(root, 'config', 'user.email', 'guard@test.local')
      git(root, 'config', 'user.name', 'guard test')
      put(root, 'docs/specs/001-keep.md', spec('Shipped', 1))
      specs.forEach((rel, i) => put(root, rel, spec('Shipped', i + 10)))
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'base')
      git(root, 'branch', 'base')
      change(root)
      git(root, 'add', '-A')
      git(root, 'commit', '-qm', 'change')
      return root
    }
    const run = (root: string) =>
      runGuard('spec-deletion-lint.mjs', root, {
        env: { ...prEnv(ghDir('spec-deletion', 'deleted-bare')), LINT_DIFF_BASE: 'base' },
      })

    it.each([
      ['an ASCII path (control)', 'docs/specs/010-thing.md'],
      ['a non-ASCII file name', 'docs/specs/010-спека.md'],
      ['a non-ASCII directory', 'docs/adr/решения/010-thing.md'],
    ])('exits 1 and names the spec deleted under %s', (_, deleted) => {
      const root = repo([deleted], (r) => unlinkSync(join(r, deleted)))
      const res = run(root)
      expect(res.code).toBe(1)
      expect(res.stderr).toContain(deleted)
    })

    it('exits 0 on a rename under a non-ASCII path — a rename is not a deletion', () => {
      const from = 'docs/specs/010-спека.md'
      const root = repo([from], (r) => git(r, 'mv', from, 'docs/specs/010-новая.md'))
      const res = run(root)
      expect(res.code).toBe(0)
    })

    it('exits 0 when the same PR retires a spec whose path is non-ASCII', () => {
      const gone = 'docs/specs/010-thing.md'
      const retired = 'docs/specs/011-спека.md'
      const root = repo([gone, retired], (r) => {
        unlinkSync(join(r, gone))
        put(r, retired, spec('Retired', 11))
      })
      const res = run(root)
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('superseded-transition')
    })
  })

  it('exits 0 on the real repo tree — the sweep must be green at merge', () => {
    const res = runGuard('spec-deletion-lint.mjs', null, { realTree: true })
    expect(res.code).toBe(0)
  })
})
