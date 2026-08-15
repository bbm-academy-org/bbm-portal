import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureSkillsBridge, verifySkillsBridge } from '../../tools/codex/skills-bridge.mjs'

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-skills-'))
  roots.push(root)
  const canonical = resolve(root, '.claude', 'skills')
  mkdirSync(resolve(canonical, 'task-cycle'), { recursive: true })
  mkdirSync(resolve(canonical, 'wrap'), { recursive: true })
  writeFileSync(resolve(canonical, 'task-cycle', 'SKILL.md'), '# task-cycle\n')
  writeFileSync(resolve(canonical, 'wrap', 'SKILL.md'), '# wrap\n')
  return { root, canonical }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('generated Codex skills bridge', () => {
  it('creates a Windows-safe link to the canonical Claude skills and is idempotent', () => {
    const { root, canonical } = fixture()
    const first = ensureSkillsBridge(root)
    const second = ensureSkillsBridge(root)

    expect(first.skills).toEqual(['task-cycle', 'wrap'])
    expect(second).toEqual(first)
    expect(realpathSync(resolve(root, '.agents', 'skills'))).toBe(realpathSync(canonical))
    expect(verifySkillsBridge(root)).toEqual(first)
  })

  it('refuses to replace a real .agents/skills directory', () => {
    const { root } = fixture()
    mkdirSync(resolve(root, '.agents', 'skills'), { recursive: true })
    writeFileSync(resolve(root, '.agents', 'skills', 'SKILL.md'), 'duplicate')

    expect(() => ensureSkillsBridge(root)).toThrow(/refusing to replace/i)
  })

  it('rejects a case-only different target on a case-sensitive filesystem', () => {
    const { root } = fixture()
    ensureSkillsBridge(root)
    const verifyWithDeps = verifySkillsBridge as unknown as (
      root: string,
      deps: Record<string, unknown>,
    ) => unknown

    expect(() =>
      verifyWithDeps(root, {
        platform: 'linux',
        realpath: (path: string) =>
          path.includes('.agents') ? '/repo/.CLAUDE/skills' : '/repo/.claude/skills',
        stat: (path: string) =>
          path.includes('.agents') ? { dev: 1, ino: 2 } : { dev: 1, ino: 1 },
      }),
    ).toThrow(/points to/i)
  })

  it('accepts case-only path spelling when Windows reports the same filesystem identity', () => {
    const { root } = fixture()
    const expected = ensureSkillsBridge(root)
    const verifyWithDeps = verifySkillsBridge as unknown as (
      root: string,
      deps: Record<string, unknown>,
    ) => typeof expected

    expect(
      verifyWithDeps(root, {
        platform: 'win32',
        realpath: (path: string) =>
          path.includes('.agents') ? 'C:\\repo\\.CLAUDE\\skills' : 'C:\\repo\\.claude\\skills',
        stat: () => ({ dev: 1, ino: 1 }),
      }),
    ).toEqual(expected)
  })
})
