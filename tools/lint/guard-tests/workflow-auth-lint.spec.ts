import { describe, expect, it } from 'vitest'

import { auditWorkflows } from '../workflow-auth-lint.mjs'
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

describe('workflow-auth (spawned)', () => {
  it('exits 1 on a workflow whose gh-gated job has no auth block', () => {
    const res = runGuard('workflow-auth-lint.mjs', caseDir('workflow-auth', 'unwired'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('missing-permission')
  })

  it('exits 0 against the REAL repo tree — this repo wires its own guard jobs', () => {
    const res = runGuard('workflow-auth-lint.mjs', null)
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
