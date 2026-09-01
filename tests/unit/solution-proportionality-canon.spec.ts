// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('solution proportionality canon', () => {
  it('requires the session plan to compare a one-time need with the smallest disposable path', () => {
    const taskCycle = read('.claude/skills/task-cycle/SKILL.md')

    expect(taskCycle).toContain('`Соразмерность:')
    expect(taskCycle).toMatch(
      /one-time\s+data repair or backfill defaults to a private temporary script/i,
    )
    expect(taskCycle).toMatch(/ask the owner\s+before the go/i)
  })

  it('makes the independent iteration gate verify the plan against the actual diff', () => {
    const checklist = read('.claude/skills/run-iteration-end-checklist/SKILL.md')

    expect(checklist).toMatch(/Scope proportionality \/ spec \/ ADR gate/)
    expect(checklist).toMatch(
      /one-time operation has not\s+grown a permanent CLI\/API\/UI\/runtime/i,
    )
    expect(checklist).toMatch(/review fixes expanded\s+the mechanism/i)
  })
})
