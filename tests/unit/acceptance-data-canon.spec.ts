import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('acceptance-data canon (#357)', () => {
  it('pins representative scenario data as a precondition in both acceptance canons', () => {
    const root = process.cwd()
    const taskCycle = readFileSync(resolve(root, '.claude/skills/task-cycle/SKILL.md'), 'utf8')
    const iterationEnd = readFileSync(
      resolve(root, '.claude/skills/run-iteration-end-checklist/SKILL.md'),
      'utf8',
    )

    expect(taskCycle).toMatch(/representative scenario data/i)
    expect(taskCycle).toMatch(/empty state.*being accepted/i)
    expect(iterationEnd).toMatch(/representative scenario data/i)
  })
})
