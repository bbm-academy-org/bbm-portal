import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every project agent definition carries a `maxTurns` cap (#594, modelled on
 * ds-platform's per-role values). Without it a runaway agent loops until its
 * context budget hook stops it, which is the expensive end of the same failure.
 */

const AGENTS_DIR = resolve(import.meta.dirname, '..', '..', '.claude', 'agents')
const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))

function frontmatter(file: string): Record<string, string> {
  const text = readFileSync(resolve(AGENTS_DIR, file), 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const fields: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]] = kv[2].trim()
  }
  return fields
}

describe('.claude/agents — maxTurns', () => {
  it('there are agent definitions to check', () => {
    expect(agentFiles.length).toBeGreaterThan(0)
  })

  it.each(agentFiles)('%s declares a positive integer maxTurns', (file) => {
    const value = frontmatter(file).maxTurns
    expect(value, `${file} has no maxTurns`).toMatch(/^[1-9]\d*$/)
  })
})
