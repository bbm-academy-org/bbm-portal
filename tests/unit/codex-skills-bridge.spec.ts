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
})
