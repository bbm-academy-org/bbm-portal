// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { PathTask } from '@/lib/path-map/schema'
import {
  MAX_TASK_DEPTH,
  flattenTasks,
  getTaskAt,
  isTaskDone,
  ownDone,
  taskDepth,
  taskDoneDate,
  taskProgress,
} from '@/lib/path-map/tasks'

/**
 * «Карта пути» v2 (#536) — the tasks nested inside an obstacle. Pure counting
 * rules the barrier's counter, its lifting arm and the «Что внутри» panel all
 * share:
 *
 *   - progress counts LEAVES (tasks without subtasks): a parent is a heading,
 *     the leaves are the units of work, so «4/7» never double-counts;
 *   - `done` on a parent closes its whole subtree;
 *   - a parent without its own `done` is done when every child is.
 */

const t = (title: string, extra: Partial<PathTask> = {}): PathTask => ({ title, ...extra })

const TREE: PathTask[] = [
  t('Свет и звук', {
    tasks: [t('Микрофоны', { done: '2026-10-24' }), t('Свет', { done: true }), t('Тест')],
  }),
  t('Площадка', {
    tasks: [
      t('Аренда', { done: '2026-10-20' }),
      t('Расписание', { tasks: [t('Дни', { done: true }), t('Зал')] }),
    ],
  }),
  t('Монтажёр'),
]

describe('isTaskDone / taskDoneDate', () => {
  it('reads true and a date as done, false and absent as open', () => {
    expect(isTaskDone(t('a', { done: true }))).toBe(true)
    expect(isTaskDone(t('a', { done: '2026-10-01' }))).toBe(true)
    expect(isTaskDone(t('a', { done: false }))).toBe(false)
    expect(isTaskDone(t('a'))).toBe(false)
  })

  it('a parent without its own done is done exactly when every child is', () => {
    expect(isTaskDone(t('p', { tasks: [t('a', { done: true }), t('b', { done: true })] }))).toBe(
      true,
    )
    expect(isTaskDone(t('p', { tasks: [t('a', { done: true }), t('b')] }))).toBe(false)
  })

  it('gives the date only when done carries one', () => {
    expect(taskDoneDate(t('a', { done: '2026-10-01' }))).toBe('2026-10-01')
    expect(taskDoneDate(t('a', { done: true }))).toBeNull()
    expect(taskDoneDate(t('a'))).toBeNull()
  })
})

describe('taskProgress', () => {
  it('is null for an obstacle with no tasks', () => {
    expect(taskProgress(undefined)).toBeNull()
    expect(taskProgress([])).toBeNull()
  })

  it('counts leaves at any depth: 4 of 7 in the example tree', () => {
    expect(taskProgress(TREE)).toEqual({ done: 4, total: 7, ratio: 4 / 7 })
  })

  it('a done parent closes every leaf below it', () => {
    const closed = [t('p', { done: true, tasks: [t('a'), t('b', { tasks: [t('c'), t('d')] })] })]
    expect(taskProgress(closed)).toEqual({ done: 3, total: 3, ratio: 1 })
  })

  it("the obstacle's own done closes every task, like a done parent (#537 review)", () => {
    expect(taskProgress(TREE, true)).toEqual({ done: 7, total: 7, ratio: 1 })
    expect(taskProgress(TREE, false)).toEqual(taskProgress(TREE))
  })

  it('a flat list of open tasks is 0 of n', () => {
    expect(taskProgress([t('a'), t('b')])).toEqual({ done: 0, total: 2, ratio: 0 })
  })
})

describe('taskDepth', () => {
  it('is 0 without tasks, 1 for a flat list, the longest branch otherwise', () => {
    expect(taskDepth(undefined)).toBe(0)
    expect(taskDepth([t('a')])).toBe(1)
    expect(taskDepth(TREE)).toBe(3)
  })

  it('caps the schema at five levels', () => {
    expect(MAX_TASK_DEPTH).toBe(5)
  })
})

describe('flattenTasks', () => {
  it('lists every task in reading order with its depth, path and effective done', () => {
    const flat = flattenTasks(TREE)
    expect(flat.map((f) => [f.task.title, f.depth, f.path.join('.'), f.done])).toEqual([
      ['Свет и звук', 0, '0', false],
      ['Микрофоны', 1, '0.0', true],
      ['Свет', 1, '0.1', true],
      ['Тест', 1, '0.2', false],
      ['Площадка', 0, '1', false],
      ['Аренда', 1, '1.0', true],
      ['Расписание', 1, '1.1', false],
      ['Дни', 2, '1.1.0', true],
      ['Зал', 2, '1.1.1', false],
      ['Монтажёр', 0, '2', false],
    ])
  })

  it('a closed root (a removed obstacle) reads every task as done', () => {
    expect(flattenTasks(TREE, true).every((f) => f.done)).toBe(true)
  })

  it('children of a done parent read as done', () => {
    const flat = flattenTasks([t('p', { done: true, tasks: [t('a')] })])
    expect(flat.map((f) => f.done)).toEqual([true, true])
  })
})

describe('ownDone', () => {
  it("is the task's own mark only — true or a date; children do not count", () => {
    expect(ownDone(t('a', { done: true }))).toBe(true)
    expect(ownDone(t('a', { done: '2026-10-01' }))).toBe(true)
    expect(ownDone(t('a', { done: false }))).toBe(false)
    expect(ownDone(t('p', { tasks: [t('a', { done: true })] }))).toBe(false)
  })
})

/**
 * Tasks carry no ids — people edit the YAML by hand. A task is addressed by
 * its index path from the obstacle's list (the write contract of the later
 * editing task, checked against the whole file's sha).
 */
describe('getTaskAt — a task by its index path', () => {
  it('finds a task at any depth', () => {
    expect(getTaskAt(TREE, [0])?.title).toBe('Свет и звук')
    expect(getTaskAt(TREE, [0, 2])?.title).toBe('Тест')
    expect(getTaskAt(TREE, [1, 1, 1])?.title).toBe('Зал')
  })

  it('agrees with the paths flattenTasks hands out', () => {
    for (const f of flattenTasks(TREE)) expect(getTaskAt(TREE, f.path)).toBe(f.task)
  })

  it('is null for an empty path, a missing index or a path through a leaf', () => {
    expect(getTaskAt(TREE, [])).toBeNull()
    expect(getTaskAt(TREE, [9])).toBeNull()
    expect(getTaskAt(TREE, [-1])).toBeNull()
    expect(getTaskAt(TREE, [2, 0])).toBeNull()
    expect(getTaskAt(TREE, [0.5])).toBeNull()
    expect(getTaskAt(undefined, [0])).toBeNull()
  })
})
