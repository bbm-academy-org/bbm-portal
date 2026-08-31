import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The canon lives in exactly one place — stage 5 of the task-cycle skill; the
 * iteration-end checklist only POINTS at it (CLAUDE.md, path-is-the-contract).
 * These assertions are section-anchored on purpose: the same phrase surviving
 * somewhere else in the file after the stage-5 clause is deleted must not pass.
 */

const root = process.cwd()

/** Collapse the prose wrapping so a re-wrap of the paragraph never turns the guard red. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

const read = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8')

/** Body of a `## <heading>` section, up to the next `## ` heading. */
const section = (markdown: string, heading: string) => {
  const start = markdown.indexOf(`## ${heading}`)
  expect(start, `heading "## ${heading}" not found`).toBeGreaterThanOrEqual(0)
  const rest = markdown.slice(start)
  const end = rest.indexOf('\n## ')
  return normalize(end === -1 ? rest : rest.slice(0, end))
}

/** Body of numbered checklist item `<n>.`, up to the next numbered item or heading. */
const numberedItem = (markdown: string, n: number) => {
  const start = markdown.search(new RegExp(`^${n}\\. `, 'm'))
  expect(start, `checklist item ${n} not found`).toBeGreaterThanOrEqual(0)
  const firstLineEnd = markdown.indexOf('\n', start)
  const rest = markdown.slice(firstLineEnd)
  const end = rest.search(/^(?:\d+\. |## )/m)
  const body = end === -1 ? rest : rest.slice(0, end)
  return normalize(markdown.slice(start, firstLineEnd) + body)
}

describe('acceptance-data canon (#357)', () => {
  it('pins the representative-data precondition inside task-cycle stage 5', () => {
    const stage5 = section(read('.claude/skills/task-cycle/SKILL.md'), 'Stage 5')

    expect(stage5).toMatch(/the stand carries representative scenario data/i)
    expect(stage5).toMatch(
      /an empty state is sufficient only when that empty state is what is being accepted/i,
    )
  })

  it('keeps item 12 of the iteration-end checklist pointing at that stage', () => {
    const item12 = numberedItem(read('.claude/skills/run-iteration-end-checklist/SKILL.md'), 12)

    expect(item12).toMatch(/representative-data precondition/i)
    expect(item12).toMatch(/`\.claude\/skills\/task-cycle\/SKILL\.md` stage 5/)
  })
})
