import { describe, expect, it } from 'vitest'

import { auditWorkflows, ghConsumerSources } from '../workflow-auth-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * workflow-auth — the meta-guard that keeps the OTHER guards runnable (canon
 * docs/ci-guardrails.md §5, WARN since 2026-08-05).
 *
 * A gh-gated job without `permissions:` + `GH_TOKEN` goes red before it
 * evaluates its own rule, which reads exactly like a real finding and silently
 * spends the guard's promotion window on vacuous reds (canon §4).
 */

const READ = { contents: 'read', 'pull-requests': 'read' }
const CONSUMERS = ['tools/lint/epic-autoclose-lint.mjs']
const SCRIPTS = { 'lint:epic-autoclose': 'node tools/lint/epic-autoclose-lint.mjs' }

const wf = (jobs: unknown, permissions?: unknown) => [
  { file: '.github/workflows/x.yml', doc: { jobs, ...(permissions ? { permissions } : {}) } },
]

describe('auditWorkflows', () => {
  it('passes a fully wired gh-consumer job', () => {
    const findings = auditWorkflows(
      wf({
        'epic-autoclose': {
          permissions: READ,
          steps: [{ run: 'pnpm lint:epic-autoclose', env: { GH_TOKEN: 'x', PR_NUMBER: '1' } }],
        },
      }),
      { ghConsumers: CONSUMERS, scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([])
  })

  it('flags a missing permissions block — the Issue-#10 root cause', () => {
    const findings = auditWorkflows(
      wf({
        'epic-autoclose': {
          steps: [{ run: 'pnpm lint:epic-autoclose', env: { GH_TOKEN: 'x', PR_NUMBER: '1' } }],
        },
      }),
      { ghConsumers: CONSUMERS, scriptMap: SCRIPTS },
    )
    expect(findings.map((f) => f.kind)).toEqual(['missing-permission', 'missing-permission'])
  })

  it('accepts permissions inherited from the workflow level', () => {
    const findings = auditWorkflows(
      wf(
        {
          'epic-autoclose': {
            steps: [{ run: 'pnpm lint:epic-autoclose', env: { GH_TOKEN: 'x', PR_NUMBER: '1' } }],
          },
        },
        READ,
      ),
      { ghConsumers: CONSUMERS, scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([])
  })

  it('does NOT inherit when the job declares its own block — job-level replaces workflow-level', () => {
    const findings = auditWorkflows(
      wf(
        {
          'epic-autoclose': {
            permissions: { contents: 'read' },
            steps: [{ run: 'pnpm lint:epic-autoclose', env: { GH_TOKEN: 'x', PR_NUMBER: '1' } }],
          },
        },
        READ,
      ),
      { ghConsumers: CONSUMERS, scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'missing-permission',
        detail: expect.stringContaining('pull-requests'),
      }),
    ])
  })

  it('flags a missing GH_TOKEN and a missing PR_NUMBER separately', () => {
    const findings = auditWorkflows(
      wf({ 'epic-autoclose': { permissions: READ, steps: [{ run: 'pnpm lint:epic-autoclose' }] } }),
      { ghConsumers: CONSUMERS, scriptMap: SCRIPTS },
    )
    expect(findings.map((f) => f.kind)).toEqual(['missing-token', 'missing-pr-number'])
  })

  it('treats a bare `gh` step as gated but does not demand PR_NUMBER — it names its own target', () => {
    const findings = auditWorkflows(
      wf({
        notify: {
          permissions: READ,
          steps: [{ run: 'gh pr comment 1 --body hi', env: { GH_TOKEN: 'x' } }],
        },
      }),
      { ghConsumers: CONSUMERS, scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([])
  })

  it('leaves a job that never touches GitHub alone', () => {
    const findings = auditWorkflows(wf({ build: { steps: [{ run: 'pnpm build' }] } }), {
      ghConsumers: CONSUMERS,
      scriptMap: SCRIPTS,
    })
    expect(findings).toEqual([])
  })

  it('does not mistake a word ending in gh for the CLI', () => {
    const findings = auditWorkflows(wf({ build: { steps: [{ run: 'pnpm dev:high' }] } }), {})
    expect(findings).toEqual([])
  })
})

/**
 * The gh-consumer set is DERIVED from the guard sources, and `stage-b-lint.mjs`
 * (landed by #151) showed the derivation was too narrow: it spawns `gh` through
 * its own runner instead of importing `lib/gh.mjs`, so it would have been wired
 * with no auth block and gone vacuously red on every PR — the exact failure this
 * meta-guard exists to prevent.
 */
describe('ghConsumerSources — a guard reaches GitHub by import OR by spawning gh', () => {
  it('detects the lib/gh.mjs import', () => {
    expect(
      ghConsumerSources([
        { rel: 'tools/lint/a-lint.mjs', text: "import { ghViewJson } from './lib/gh.mjs'" },
      ]),
    ).toEqual(['tools/lint/a-lint.mjs'])
  })

  it('detects a guard spawning the gh binary itself', () => {
    expect(
      ghConsumerSources([
        { rel: 'tools/lint/b-lint.mjs', text: "const res = spawnSync('gh', args, opts)" },
      ]),
    ).toEqual(['tools/lint/b-lint.mjs'])
  })

  it('leaves a pure tree guard out of the set', () => {
    expect(
      ghConsumerSources([
        { rel: 'tools/lint/c-lint.mjs', text: "import { walkFiles } from './lib/guard.mjs'" },
      ]),
    ).toEqual([])
  })
})

/**
 * Review of PR #154, finding 2: canon §2.1 defines BLOCK and WARN, but a ci.yml
 * job that is NEITHER `continue-on-error` NOR in the `ci` needs-list is
 * representable — it shows a red X on the PR while gating nothing, and nothing
 * detected it. The invariant is now mechanical.
 */
describe('auditWorkflows — declared severity (canon §2.1)', () => {
  const ciDoc = (jobs: Record<string, unknown>) => [
    { file: '.github/workflows/ci.yml', doc: { jobs } },
  ]

  it('accepts a BLOCK job (in the needs-list) and a WARN job (continue-on-error)', () => {
    const findings = auditWorkflows(
      ciDoc({
        build: { steps: [{ run: 'pnpm build' }] },
        'no-stub': { 'continue-on-error': true, steps: [{ run: 'pnpm lint:no-stub' }] },
        ci: { needs: ['build'], steps: [{ run: 'echo ok' }] },
      }),
    )
    expect(findings).toEqual([])
  })

  it('flags the third state — neither continue-on-error nor in the needs-list', () => {
    const findings = auditWorkflows(
      ciDoc({
        orphan: { steps: [{ run: 'pnpm lint:orphan' }] },
        ci: { needs: ['build'], steps: [{ run: 'echo ok' }] },
      }),
    )
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'undeclared-severity', job: 'orphan' }),
    ])
  })

  it('exempts the `ci` aggregate itself — it cannot be in its own needs-list', () => {
    const findings = auditWorkflows(ciDoc({ ci: { needs: ['build'], steps: [] } }))
    expect(findings).toEqual([])
  })

  it('does not apply the rule to a workflow with no `ci` aggregate', () => {
    const findings = auditWorkflows([
      { file: '.github/workflows/pr-body-guards.yml', doc: { jobs: { 'stage-b': { steps: [] } } } },
    ])
    expect(findings).toEqual([])
  })
})

/**
 * #207, first half. The `undeclared-severity` rule above covers the THIRD state
 * (neither WARN nor BLOCK). The FOURTH is a job that is BOTH: listed in the `ci`
 * needs-list — where it reads as a gate — while `continue-on-error: true` means
 * its failure can no longer redden the aggregate. A vacuous BLOCK, and with the
 * batch shape one such flag masks every guard in the job at once.
 */
describe('auditWorkflows — vacuous BLOCK (#207)', () => {
  const ciDoc = (jobs: Record<string, unknown>) => [
    { file: '.github/workflows/ci.yml', doc: { jobs } },
  ]

  it('flags a needs-listed job that also carries continue-on-error', () => {
    const findings = auditWorkflows(
      ciDoc({
        guards: { 'continue-on-error': true, steps: [{ run: 'pnpm lint:no-stub' }] },
        ci: { needs: ['guards'], steps: [{ run: 'echo ok' }] },
      }),
    )
    expect(findings).toEqual([expect.objectContaining({ kind: 'vacuous-block', job: 'guards' })])
  })

  it('reports the fourth state ONCE — it is not also an undeclared severity', () => {
    const findings = auditWorkflows(
      ciDoc({
        guards: { 'continue-on-error': true, steps: [] },
        ci: { needs: ['guards'], steps: [] },
      }),
    )
    expect(findings.map((f) => f.kind)).toEqual(['vacuous-block'])
  })

  it('accepts a real BLOCK job — needs-listed and no continue-on-error', () => {
    const findings = auditWorkflows(
      ciDoc({
        guards: { steps: [{ run: 'pnpm test:guards' }] },
        ci: { needs: ['guards'], steps: [] },
      }),
    )
    expect(findings).toEqual([])
  })
})

/**
 * #207, second half (review of PR #206, MAJOR 4). In a batch job the severity
 * moved from the job to the STEP: a guard step carries `continue-on-error: true`
 * and its finding surfaces only through a row in the job's WARN-outcomes
 * aggregation step. A step with no row is invisible — the finding is swallowed
 * and §4's promotion window is counted off a table that omits it.
 */
describe('auditWorkflows — WARN step aggregation (#207)', () => {
  const AGG = {
    name: 'WARN guard outcomes',
    run: 'if [ "${{ steps.no-stub.outcome }}" = "failure" ]; then echo "::warning::no-stub"; fi',
  }
  const warnStep = (id: string, script: string) => ({
    id,
    'continue-on-error': true,
    run: `pnpm lint:${script}`,
  })
  const batch = (steps: unknown[]) => [
    { file: '.github/workflows/ci.yml', doc: { jobs: { guards: { steps } } } },
  ]
  const SCRIPTS = {
    'lint:no-stub': 'node tools/lint/no-stub-lint.mjs',
    'lint:ears-naming': 'node tools/lint/ears-naming-lint.mjs',
  }

  it('accepts a batch job whose every WARN step has a row', () => {
    const findings = auditWorkflows(batch([warnStep('no-stub', 'no-stub'), AGG]), {
      scriptMap: SCRIPTS,
    })
    expect(findings).toEqual([])
  })

  it('flags a WARN step the aggregation step never reads', () => {
    const findings = auditWorkflows(
      batch([warnStep('no-stub', 'no-stub'), warnStep('ears-naming', 'ears-naming'), AGG]),
      { scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'unaggregated-warn-step',
        detail: expect.stringContaining('ears-naming'),
      }),
    ])
  })

  it('flags a WARN guard step with no `id:` — no row can ever reference it', () => {
    const findings = auditWorkflows(
      batch([{ 'continue-on-error': true, run: 'pnpm lint:no-stub' }, AGG]),
      { scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'unaggregated-warn-step',
        detail: expect.stringContaining('id'),
      }),
    ])
  })

  it('flags every WARN step when the job has no aggregation step at all', () => {
    const findings = auditWorkflows(
      batch([warnStep('no-stub', 'no-stub'), warnStep('ears-naming', 'ears-naming')]),
      { scriptMap: SCRIPTS },
    )
    expect(findings.map((f) => f.kind)).toEqual([
      'unaggregated-warn-step',
      'unaggregated-warn-step',
    ])
  })

  it('leaves a non-guard continue-on-error step alone — the rule is about guard steps', () => {
    const findings = auditWorkflows(batch([{ 'continue-on-error': true, run: 'rm -rf tmp' }]), {
      scriptMap: SCRIPTS,
    })
    expect(findings).toEqual([])
  })

  it('demands no row from a plain (BLOCK) guard step in the same batch job', () => {
    const findings = auditWorkflows(
      batch([{ id: 'guard-tests', run: 'pnpm test:guards' }, warnStep('no-stub', 'no-stub'), AGG]),
      { scriptMap: SCRIPTS },
    )
    expect(findings).toEqual([])
  })

  it('recognises a guard invoked by path, not only through its pnpm alias', () => {
    const findings = auditWorkflows(
      batch([{ id: 'orphan', 'continue-on-error': true, run: 'node tools/lint/no-stub-lint.mjs' }]),
      {},
    )
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'unaggregated-warn-step', job: 'guards' }),
    ])
  })
})

describe('workflow-auth (spawned)', () => {
  it('exits 1 on a workflow whose gh-gated job has no auth block', () => {
    const res = runGuard('workflow-auth-lint.mjs', caseDir('workflow-auth', 'unwired'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('missing-permission')
  })

  it('exits 1 on a needs-listed job carrying continue-on-error (#207)', () => {
    const res = runGuard('workflow-auth-lint.mjs', caseDir('workflow-auth', 'vacuous-block'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('vacuous-block')
  })

  it('exits 1 on a WARN guard step with no row in the aggregation step (#207)', () => {
    const res = runGuard('workflow-auth-lint.mjs', caseDir('workflow-auth', 'warn-step-no-row'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('unaggregated-warn-step')
  })

  it('exits 0 against the REAL repo tree — this repo wires its own guard jobs', () => {
    const res = runGuard('workflow-auth-lint.mjs', null)
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
