import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createLintStagedConfig } from '../../lint-staged.config.mjs'
import {
  auditHookCoverage,
  formatReadiness,
  inspectCodexReadiness,
} from '../../tools/codex/readiness.mjs'

type HookCoverageEntry = {
  claudeEvent: string
  claudePath: string
  status: 'mapped' | 'intentional-difference'
  codexEvent?: string
  codexPath?: string
  codexArgs?: string
  rationale?: string
}

const command = (path: string, args = '') => ({
  type: 'command',
  command: `node ${path}${args}`,
  commandWindows: `node ${path}${args}`,
})
const config = (event: string, path: string, args = '') => ({
  hooks: { [event]: [{ hooks: [command(path, args)] }] },
})

describe('Codex hook coverage inventory', () => {
  it('keeps the repository hook inventory aligned with both real configs', () => {
    const claude = JSON.parse(readFileSync(resolve('.claude', 'settings.json'), 'utf8'))
    const codex = JSON.parse(readFileSync(resolve('.codex', 'hooks.json'), 'utf8'))
    const inventory = JSON.parse(
      readFileSync(resolve('tools', 'codex', 'hook-coverage.json'), 'utf8'),
    )

    expect(auditHookCoverage(claude, codex, inventory)).toEqual([])
  })

  it('rejects a newly registered Claude hook that the inventory does not classify', () => {
    expect(
      auditHookCoverage(
        config('PreToolUse', 'tools/other/new-guard.mjs'),
        config('PreToolUse', 'tools/other/new-guard.mjs'),
        [],
      ),
    ).toEqual([expect.objectContaining({ kind: 'unclassified-claude-hook' })])
  })

  it('rejects a mapped entry whose Codex registration is absent', () => {
    const inventory: HookCoverageEntry[] = [
      {
        claudeEvent: 'PreToolUse',
        claudePath: 'tools/hooks/guard.mjs',
        status: 'mapped',
        codexEvent: 'PreToolUse',
        codexPath: 'tools/hooks/guard.mjs',
      },
    ]
    expect(
      auditHookCoverage(config('PreToolUse', 'tools/hooks/guard.mjs'), { hooks: {} }, inventory),
    ).toEqual([expect.objectContaining({ kind: 'missing-codex-registration' })])
  })

  it('accepts an explicit intentional difference with a rationale', () => {
    const inventory: HookCoverageEntry[] = [
      {
        claudeEvent: 'PreToolUse',
        claudePath: 'tools/hooks/usage-only.mjs',
        status: 'intentional-difference',
        rationale: 'Codex exposes no stable usage payload for this gate.',
      },
    ]
    expect(
      auditHookCoverage(
        config('PreToolUse', 'tools/hooks/usage-only.mjs'),
        { hooks: {} },
        inventory,
      ),
    ).toEqual([])
  })

  it.each([
    ['completion-report-gate.mjs', 'completion'],
    ['deviations-gate.mjs', 'deviations'],
    ['surface-decision-debt-gate.mjs', 'debt'],
  ])('distinguishes the %s adapter mode', (claudeScript, requiredMode) => {
    const inventory: HookCoverageEntry[] = [
      {
        claudeEvent: 'Stop',
        claudePath: `tools/hooks/${claudeScript}`,
        status: 'mapped',
        codexEvent: 'Stop',
        codexPath: 'tools/hooks/codex-stop-adapter.mjs',
        codexArgs: requiredMode,
      },
    ]
    expect(
      auditHookCoverage(
        config('Stop', `tools/hooks/${claudeScript}`),
        config('Stop', 'tools/hooks/codex-stop-adapter.mjs', ' wrong-mode'),
        inventory,
      ),
    ).toEqual([expect.objectContaining({ kind: 'missing-codex-registration' })])
  })
})

describe('Codex readiness inspection', () => {
  it('prints enough finding context to repair a broken mapping', () => {
    expect(
      formatReadiness({
        findings: [
          {
            kind: 'missing-codex-registration',
            entry: {
              claudeEvent: 'Stop',
              claudePath: 'tools/hooks/deviations-gate.mjs',
              codexEvent: 'Stop',
              codexPath: 'tools/hooks/codex-stop-adapter.mjs',
              codexArgs: 'deviations',
            },
          },
        ],
        unverified: [],
      }),
    ).toContain('Stop tools/hooks/deviations-gate.mjs')
  })

  it('keeps tracked Codex hook config in the staged formatting policy', () => {
    const root = resolve('C:/repo')
    const hookConfig = resolve(root, '.codex', 'hooks.json')
    expect(createLintStagedConfig(root)([hookConfig])).toEqual([`prettier --write "${hookConfig}"`])
  })

  it('checks definitions, command paths, coverage, and pre-commit without claiming runtime trust', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-readiness-'))
    try {
      mkdirSync(resolve(root, '.claude'), { recursive: true })
      mkdirSync(resolve(root, '.codex'), { recursive: true })
      mkdirSync(resolve(root, 'tools', 'hooks'), { recursive: true })
      mkdirSync(resolve(root, '.git', 'hooks'), { recursive: true })
      writeFileSync(resolve(root, 'tools', 'hooks', 'guard.mjs'), '')
      writeFileSync(
        resolve(root, '.claude', 'settings.json'),
        JSON.stringify(config('PreToolUse', 'tools/hooks/guard.mjs')),
      )
      writeFileSync(
        resolve(root, '.codex', 'hooks.json'),
        JSON.stringify(config('PreToolUse', 'tools/hooks/guard.mjs')),
      )
      writeFileSync(
        resolve(root, '.git', 'hooks', 'pre-commit'),
        'pnpm exec lint-staged && node tools/lint/tdd-order-lint.mjs --staged\n',
      )

      const result = inspectCodexReadiness(root, {
        inventory: [
          {
            claudeEvent: 'PreToolUse',
            claudePath: 'tools/hooks/guard.mjs',
            status: 'mapped',
            codexEvent: 'PreToolUse',
            codexPath: 'tools/hooks/guard.mjs',
          },
        ],
        gitPath: () => resolve(root, '.git', 'hooks', 'pre-commit'),
      })

      expect(result.findings).toEqual([])
      expect(result.unverified).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/runtime trust/i),
          expect.stringMatching(/capabilit/i),
        ]),
      )

      const brokenCodex = config('PreToolUse', 'tools/hooks/guard.mjs')
      brokenCodex.hooks.PreToolUse[0].hooks[0].commandWindows =
        'node tools/windows-only/missing-guard.mjs'
      writeFileSync(resolve(root, '.codex', 'hooks.json'), JSON.stringify(brokenCodex))
      expect(
        inspectCodexReadiness(root, {
          inventory: [
            {
              claudeEvent: 'PreToolUse',
              claudePath: 'tools/hooks/guard.mjs',
              status: 'mapped',
              codexEvent: 'PreToolUse',
              codexPath: 'tools/hooks/guard.mjs',
            },
          ],
          gitPath: () => resolve(root, '.git', 'hooks', 'pre-commit'),
        }).findings,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'missing-command-path',
            field: 'commandWindows',
            path: 'tools/windows-only/missing-guard.mjs',
          }),
        ]),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an existing Windows command with a different path or adapter mode', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-readiness-'))
    try {
      mkdirSync(resolve(root, '.claude'), { recursive: true })
      mkdirSync(resolve(root, '.codex'), { recursive: true })
      mkdirSync(resolve(root, 'tools', 'hooks'), { recursive: true })
      writeFileSync(resolve(root, 'tools', 'hooks', 'codex-stop-adapter.mjs'), '')
      writeFileSync(resolve(root, 'tools', 'hooks', 'other.mjs'), '')
      writeFileSync(resolve(root, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }))

      const codex = config('Stop', 'tools/hooks/codex-stop-adapter.mjs', ' completion')
      codex.hooks.Stop[0].hooks[0].commandWindows = 'node tools/hooks/other.mjs deviations'
      writeFileSync(resolve(root, '.codex', 'hooks.json'), JSON.stringify(codex))

      expect(
        inspectCodexReadiness(root, {
          inventory: [],
          gitPath: () => resolve(root, 'pre-commit'),
        }).findings,
      ).toContainEqual(
        expect.objectContaining({
          kind: 'command-platform-mismatch',
          event: 'Stop',
        }),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts matching modes from the exact repository Stop command forms', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-readiness-'))
    try {
      mkdirSync(resolve(root, '.claude'), { recursive: true })
      mkdirSync(resolve(root, '.codex'), { recursive: true })
      const realCodex = JSON.parse(readFileSync(resolve('.codex', 'hooks.json'), 'utf8'))
      writeFileSync(resolve(root, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }))
      writeFileSync(
        resolve(root, '.codex', 'hooks.json'),
        JSON.stringify({ hooks: { Stop: realCodex.hooks.Stop } }),
      )

      const findings = inspectCodexReadiness(root, {
        inventory: [],
        gitPath: () => resolve(root, 'pre-commit'),
      }).findings
      expect(findings.filter(({ kind }) => kind === 'command-platform-mismatch')).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports malformed event and group shapes without throwing', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-readiness-'))
    try {
      mkdirSync(resolve(root, '.claude'), { recursive: true })
      mkdirSync(resolve(root, '.codex'), { recursive: true })
      writeFileSync(resolve(root, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }))
      writeFileSync(
        resolve(root, '.codex', 'hooks.json'),
        JSON.stringify({ hooks: { Stop: { hooks: {} }, PreToolUse: [null] } }),
      )

      expect(() =>
        inspectCodexReadiness(root, {
          inventory: [],
          gitPath: () => resolve(root, 'pre-commit'),
        }),
      ).not.toThrow()
      expect(
        inspectCodexReadiness(root, {
          inventory: [],
          gitPath: () => resolve(root, 'pre-commit'),
        }).findings,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'invalid-hook-event', detail: 'Codex:Stop' }),
          expect.objectContaining({
            kind: 'invalid-hook-group',
            detail: 'Codex:PreToolUse[0]',
          }),
        ]),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
