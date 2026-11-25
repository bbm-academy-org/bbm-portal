import { describe, expect, it } from 'vitest'

import { verdict } from '../change-tier-lint.mjs'
import {
  classifyChangeTier,
  isAskPath,
  isShipPath,
  isTestPath,
  parseDeclaration,
  resolveTier,
  SHIP_LINE_CAP,
} from '../lib/change-tier.mjs'
import { normalizeFilesPage } from '../lib/gh.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * change-tier — the PR body's `Change-tier:` must not sit below the minimum its
 * changed-file set determines (#597; rule `.claude/rules/change-tiers.md`,
 * canon docs/ci-guardrails.md §5). WARN since 2026-11-25.
 */

const mod = (path: string, lines = 4) => ({
  path,
  status: 'modified',
  additions: lines,
  deletions: 0,
})
const added = (path: string, lines = 4) => ({ ...mod(path, lines), status: 'added' })

describe('classifyChangeTier — the mechanical minimum', () => {
  it('prose-only docs are Ship', () => {
    const c = classifyChangeTier([mod('docs/runbooks/deploy.md'), mod('README.md'), mod('DEBT.md')])
    expect(c.minimum).toBe('ship')
  })

  it('a src/app UI change is Show', () => {
    expect(classifyChangeTier([mod('src/app/(platform)/p/hours/page.tsx')]).minimum).toBe('show')
    expect(classifyChangeTier([mod('src/app/(platform)/p/okr/OkrBoard.tsx')]).minimum).toBe('show')
    expect(classifyChangeTier([mod('src/components/ui/card.css')]).minimum).toBe('show')
  })

  it('ordinary logic is Show', () => {
    expect(classifyChangeTier([mod('src/lib/hours/formula.ts')]).minimum).toBe('show')
  })

  it('a platform-db migration is Ask', () => {
    const c = classifyChangeTier([added('src/lib/platform/db/migrations/0042_add_col.sql')])
    expect(c.minimum).toBe('ask')
    expect(c.reasons.join('\n')).toContain('src/lib/platform/db/migrations/0042_add_col.sql')
  })

  it('a Payload migration is Ask', () => {
    expect(classifyChangeTier([added('src/migrations/20261125_x.ts')]).minimum).toBe('ask')
  })

  it('a tools/ change is Ask, a test there included', () => {
    expect(classifyChangeTier([mod('tools/lint/stage-b-lint.mjs')]).minimum).toBe('ask')
    expect(classifyChangeTier([mod('tools/lint/guard-tests/stage-b-lint.spec.ts')]).minimum).toBe(
      'ask',
    )
  })

  it.each([
    'src/auth.ts',
    'src/lib/platform/authGate.ts',
    'src/app/(platform)/api/auth/[...nextauth]/route.ts',
    'src/app/(platform)/p/finance/page.tsx',
    'src/lib/finance/budget/budgets.ts',
    'src/lib/finmodel/model.ts',
    'src/endpoints/leads.ts',
    'src/lib/platform/api/handler.ts',
    'src/collections/Posts.ts',
    'src/globals/Header.ts',
    'src/middleware.ts',
    'infra/dev-stand/idp/provision.sh',
    'deploy/compose.yml',
    '.claude/rules/change-tiers.md',
    '.github/workflows/ci.yml',
    'AGENTS.md',
    'package.json',
    'pnpm-lock.yaml',
    'next.config.ts',
    'Dockerfile',
    'docs/adr/004-x.md',
    'docs/specs/finance.md',
  ])('%s is an Ask path', (path) => {
    expect(isAskPath(path)).toBe(true)
    expect(classifyChangeTier([mod(path)]).minimum).toBe('ask')
  })

  it.each([
    'src/lib/member/profile.ts',
    'src/lib/siteDispatch.ts',
    'src/lib/siteSync.ts',
    'src/seed/index.ts',
  ])('%s (PII / outbound integration / seed) is an Ask path', (path) => {
    expect(isAskPath(path)).toBe(true)
    expect(classifyChangeTier([mod(path)]).minimum).toBe('ask')
  })

  it('plain docs prose is Ship at any size and when new', () => {
    expect(classifyChangeTier([added('docs/runbooks/new.md', 400)]).minimum).toBe('ship')
    expect(classifyChangeTier([mod('docs/a.md', SHIP_LINE_CAP * 5)]).minimum).toBe('ship')
  })

  it('canon docs keep their higher floor', () => {
    expect(classifyChangeTier([added('docs/specs/new.md')]).minimum).toBe('ask')
    expect(classifyChangeTier([mod('docs/adr/001-x.md')]).minimum).toBe('ask')
  })

  it('a new non-prose file floors at Show', () => {
    expect(classifyChangeTier([added('src/lib/okr/copy.ts')]).minimum).toBe('show')
  })

  it(`more than ${SHIP_LINE_CAP} changed copy-module lines floor at Show`, () => {
    expect(classifyChangeTier([mod('src/lib/okr/copy.ts', SHIP_LINE_CAP + 1)]).minimum).toBe('show')
    expect(classifyChangeTier([mod('src/lib/okr/copy.ts', SHIP_LINE_CAP)]).minimum).toBe('ship')
  })

  it('tests/helpers is not a test path: it seeds and deletes users in the shared dev DB', () => {
    expect(isTestPath('tests/helpers/base-url.ts')).toBe(false)
    expect(classifyChangeTier([mod('tests/helpers/users.ts')]).minimum).toBe('show')
  })

  it('a rename source is read from the REST listing (previous_filename)', () => {
    const [file] = normalizeFilesPage([
      {
        filename: 'docs/runbooks/x.md',
        previous_filename: 'docs/adr/x.md',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ])
    expect(file).toMatchObject({ path: 'docs/runbooks/x.md', previousPath: 'docs/adr/x.md' })
    expect(classifyChangeTier([file]).minimum).toBe('ask')
  })

  it('a test-only PR is Ship, test-only', () => {
    const c = classifyChangeTier([
      mod('tests/unit/hours-formula.spec.ts', 300),
      added('tests/e2e/okr.e2e.spec.ts'),
    ])
    expect(c).toMatchObject({ minimum: 'ship', testOnly: true })
  })

  it('a removed test is Show', () => {
    expect(
      classifyChangeTier([{ ...mod('tests/unit/x.spec.ts'), status: 'removed' }]).minimum,
    ).toBe('show')
  })

  it('a rename source on an Ask path keeps Ask', () => {
    const c = classifyChangeTier([
      { ...mod('docs/runbooks/x.md'), status: 'renamed', previousPath: 'docs/adr/x.md' },
    ])
    expect(c.minimum).toBe('ask')
  })

  it('an empty or incomplete changed-file set is Ask', () => {
    expect(classifyChangeTier([]).minimum).toBe('ask')
    expect(classifyChangeTier([mod('docs/a.md')], 2).minimum).toBe('ask')
  })

  it('the highest tier wins across files', () => {
    expect(
      classifyChangeTier([mod('docs/a.md'), mod('src/lib/hours/formula.ts'), mod('tools/x.mjs')])
        .minimum,
    ).toBe('ask')
  })

  it('ship paths and test paths are what the rule file says', () => {
    expect(isShipPath('docs/runbooks/deploy.md')).toBe(true)
    expect(isShipPath('src/lib/okr/copy.ts')).toBe(true)
    expect(isShipPath('src/app/(platform)/p/okr/OkrBoard.tsx')).toBe(false)
    expect(isTestPath('tests/unit/x.spec.ts')).toBe(true)
    expect(isTestPath('src/lib/okr/__tests__/x.ts')).toBe(true)
    expect(isTestPath('src/lib/okr/x.ts')).toBe(false)
  })
})

describe('parseDeclaration', () => {
  it('reads one Ship|Show|Ask line, case-insensitive, with a reason', () => {
    expect(parseDeclaration('Change-tier: Ship — typo in the runbook')).toMatchObject({
      tier: 'ship',
      problem: null,
    })
    expect(parseDeclaration('Change-tier: show - new empty state')).toMatchObject({ tier: 'show' })
    expect(parseDeclaration('Change-tier: Ask')).toMatchObject({ tier: 'ask', problem: null })
  })

  it('reports a missing line', () => {
    expect(parseDeclaration('## What\nstuff')).toMatchObject({ tier: null, problem: 'missing' })
  })

  it('reports a duplicate line', () => {
    expect(parseDeclaration('Change-tier: Ship — a\nChange-tier: Ask')).toMatchObject({
      tier: null,
      problem: 'duplicate',
    })
  })

  it('reports a malformed or placeholder line', () => {
    expect(parseDeclaration('Change-tier: low')).toMatchObject({ problem: 'malformed' })
    expect(parseDeclaration('Change-tier: <Ship | Show | Ask> — <reason>')).toMatchObject({
      problem: 'malformed',
    })
    expect(parseDeclaration('Change-tier: Ship')).toMatchObject({ problem: 'no-reason' })
    expect(parseDeclaration('Change-tier: Show — n/a')).toMatchObject({ problem: 'no-reason' })
  })

  it('accepts the bold-label form', () => {
    expect(parseDeclaration('**Change-tier:** Show — new empty state')).toMatchObject({
      tier: 'show',
      problem: null,
    })
    expect(parseDeclaration('- **Change-tier:** Ask')).toMatchObject({ tier: 'ask' })
  })

  it('ignores the shapes quoted in an HTML comment or a fence', () => {
    const body = '<!-- Change-tier: Ship — x -->\n```\nChange-tier: Show — y\n```\nChange-tier: Ask'
    expect(parseDeclaration(body)).toMatchObject({ tier: 'ask', problem: null })
  })
})

describe('verdict', () => {
  it('passes a declaration at or above the minimum', () => {
    expect(verdict({ body: 'Change-tier: Ask', files: [mod('docs/a.md')] })).toMatchObject({
      ok: true,
      declared: 'ask',
      minimum: 'ship',
    })
  })

  it('fails a declaration below the computed minimum', () => {
    const v = verdict({ body: 'Change-tier: Ship — tiny', files: [mod('tools/x.mjs')] })
    expect(v).toMatchObject({ ok: false, declared: 'ship', minimum: 'ask' })
    expect(v.problems.join('\n')).toContain('below the minimum')
  })

  it('fails a missing or duplicate declaration', () => {
    expect(verdict({ body: '', files: [mod('docs/a.md')] }).ok).toBe(false)
    expect(
      verdict({ body: 'Change-tier: Ask\nChange-tier: Ask', files: [mod('docs/a.md')] }).ok,
    ).toBe(false)
  })
})

describe('change-tier-lint.mjs (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('change-tier', n),
  })

  it('exits 1 when the declared tier is below the minimum', () => {
    const res = runGuard('change-tier-lint.mjs', caseDir('change-tier', 'below'), {
      env: env('below'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('below the minimum')
    expect(res.stderr).toContain('src/lib/platform/db/migrations/0001_init.sql')
  })

  it('exits 1 when the declaration is missing', () => {
    const res = runGuard('change-tier-lint.mjs', caseDir('change-tier', 'missing'), {
      env: env('missing'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('no `Change-tier:` line')
  })

  it('exits 1 when a REST rename source is on an Ask path', () => {
    const res = runGuard('change-tier-lint.mjs', caseDir('change-tier', 'rename'), {
      env: env('rename'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('ask path: docs/adr/002-x.md')
  })

  it('exits 0 for a declaration at the minimum', () => {
    const res = runGuard('change-tier-lint.mjs', caseDir('change-tier', 'ok'), { env: env('ok') })
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('minimum show')
  })

  it('exits 0 with a reason outside a pull_request event', () => {
    const res = runGuard('change-tier-lint.mjs', null, {})
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('not a pull_request event')
  })

  it('exits 1 when the PR cannot be read', () => {
    const res = runGuard('change-tier-lint.mjs', caseDir('change-tier', 'unreadable'), {
      env: env('unreadable'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('could not fetch')
  })
})

/**
 * Slice B of #597: the one tier resolution every consumer routes by — the
 * merge gate (`pr:land`) and `stage-b` read the EFFECTIVE tier, never the body
 * line alone.
 */
describe('resolveTier — the effective tier the gates route by', () => {
  const ui = [mod('src/app/(platform)/p/okr/OkrBoard.tsx')]

  it('the effective tier is max(declared, minimum)', () => {
    const t = resolveTier('Change-tier: Ask', ui, 1)
    expect(t).toMatchObject({ declared: 'ask', minimum: 'show', effective: 'ask', below: false })
  })

  it('a declaration below the minimum is flagged and the minimum wins', () => {
    const t = resolveTier('Change-tier: Ship — a typo', ui, 1)
    expect(t).toMatchObject({ declared: 'ship', minimum: 'show', effective: 'show', below: true })
  })

  it('a missing or malformed declaration is Ask — undeclared never buys a lighter procedure', () => {
    expect(resolveTier('no line here', [mod('docs/x.md')], 1)).toMatchObject({
      declared: null,
      problem: 'missing',
      minimum: 'ship',
      effective: 'ask',
      below: false,
    })
    expect(resolveTier('Change-tier: fast', [mod('docs/x.md')], 1).effective).toBe('ask')
  })

  it('a Ship line without a reason does not buy Ship', () => {
    expect(resolveTier('Change-tier: Ship', [mod('docs/x.md')], 1).effective).toBe('ask')
  })

  it('an unreadable or truncated listing floors at Ask', () => {
    expect(resolveTier('Change-tier: Show — badge', [], 0).minimum).toBe('ask')
    expect(resolveTier('Change-tier: Show — badge', ui, 3)).toMatchObject({
      minimum: 'ask',
      below: true,
    })
  })

  it('a verified Ship and a verified Show resolve to themselves', () => {
    expect(
      resolveTier('Change-tier: Ship — typo in the runbook', [mod('docs/x.md')], 1).effective,
    ).toBe('ship')
    expect(resolveTier('Change-tier: Show — a new empty state', ui, 1).effective).toBe('show')
  })
})
