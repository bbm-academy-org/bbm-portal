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
  rationale?: string
}

const command = (path: string) => ({
  type: 'command',
  command: `node ${path}`,
  commandWindows: `node ${path}`,
})
const config = (event: string, path: string) => ({
  hooks: { [event]: [{ hooks: [command(path)] }] },
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
})

describe('Codex readiness inspection', () => {
  it('prints enough finding context to repair a broken mapping', () => {
    expect(
      formatReadiness({
        findings: [
          {
            kind: 'missing-codex-registration',
            entry: {
              claudeEvent: 'PreToolUse',
              claudePath: 'tools/hooks/guard.mjs',
              codexEvent: 'PreToolUse',
              codexPath: 'tools/hooks/guard.mjs',
            },
          },
        ],
        unverified: [],
      }),
    ).toContain('PreToolUse tools/hooks/guard.mjs')
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

  it('rejects an existing Windows command with a different path', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-readiness-'))
    try {
      mkdirSync(resolve(root, '.claude'), { recursive: true })
      mkdirSync(resolve(root, '.codex'), { recursive: true })
      mkdirSync(resolve(root, 'tools', 'hooks'), { recursive: true })
      writeFileSync(resolve(root, 'tools', 'hooks', 'guard.mjs'), '')
      writeFileSync(resolve(root, 'tools', 'hooks', 'other.mjs'), '')
      writeFileSync(resolve(root, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }))

      const codex = config('PreToolUse', 'tools/hooks/guard.mjs')
      codex.hooks.PreToolUse[0].hooks[0].commandWindows = 'node tools/hooks/other.mjs'
      writeFileSync(resolve(root, '.codex', 'hooks.json'), JSON.stringify(codex))

      expect(
        inspectCodexReadiness(root, {
          inventory: [],
          gitPath: () => resolve(root, 'pre-commit'),
        }).findings,
      ).toContainEqual(
        expect.objectContaining({
          kind: 'command-platform-mismatch',
          event: 'PreToolUse',
        }),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts matching paths from the exact repository command forms', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-readiness-'))
    try {
      mkdirSync(resolve(root, '.claude'), { recursive: true })
      mkdirSync(resolve(root, '.codex'), { recursive: true })
      const realCodex = JSON.parse(readFileSync(resolve('.codex', 'hooks.json'), 'utf8'))
      writeFileSync(resolve(root, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }))
      writeFileSync(resolve(root, '.codex', 'hooks.json'), JSON.stringify(realCodex))

      const result = inspectCodexReadiness(root, {
        inventory: [],
        gitPath: () => resolve(root, 'pre-commit'),
      })
      expect(result.registrations).toBeGreaterThan(0)
      const { findings } = result
      expect(
        findings.filter(
          ({ kind }) =>
            kind === 'command-platform-mismatch' || kind === 'unrecognized-command-registration',
        ),
      ).toEqual([])
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
