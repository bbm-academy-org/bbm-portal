// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function section(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading)
  const end = markdown.indexOf(nextHeading, start + heading.length)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return markdown.slice(start, end)
}

describe('solution proportionality canon', () => {
  it('requires the session plan to compare a one-time need with the smallest disposable path', () => {
    const taskCycle = section(
      read('.claude/skills/task-cycle/SKILL.md'),
      '## Stage 1 — orient & plan (no implementation)',
      '## Stage 1a — spec (new module / user-facing behavior only)',
    )

    expect(taskCycle).toContain(
      '`Соразмерность: <one-time|recurring> → <smallest sufficient path>; permanent artifacts: <none|justified list>`',
    )
    expect(taskCycle).toMatch(
      /one-time\s+data repair or backfill defaults to a private temporary script/i,
    )
    expect(taskCycle).toMatch(/ask the owner\s+before the go/i)
  })

  it('makes the independent iteration gate verify the plan against the actual diff', () => {
    const checklist = read('.claude/skills/run-iteration-end-checklist/SKILL.md')
    const item8 = section(
      checklist,
      '8. **Scope proportionality / spec / ADR gate**',
      '9. **Docs that describe the changed surface**',
    )

    expect(item8).toMatch(/Scope proportionality \/ spec \/ ADR gate/)
    expect(item8).toMatch(/one-time operation has not\s+grown a permanent CLI\/API\/UI\/runtime/i)
    expect(item8).toMatch(/review fixes expanded\s+the mechanism/i)
  })
})
