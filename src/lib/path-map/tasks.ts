import type { PathTask } from './schema'

/**
 * The tasks inside an obstacle (#536) — pure counting rules shared by the
 * barrier's counter, its lifting arm and the «Что внутри» panel.
 *
 *   - Progress counts LEAVES (tasks without subtasks). A parent is a heading
 *     over its leaves; counting it too would make «4/7» depend on how the file
 *     happens to group the work.
 *   - `done` on a parent closes its whole subtree: every leaf below counts done.
 *   - A parent without its own `done` is done exactly when every child is.
 *   - The obstacle's own `done` closes all of its tasks, like a done parent
 *     (callers pass `closed`), so a removed barrier never reads «1 из 3».
 *
 * Tasks carry no ids: people edit the YAML by hand. A task is addressed by its
 * index path from the obstacle's list (`getTaskAt`); the editing task writes
 * by that path under a whole-file sha check.
 */

/** Deepest allowed nesting of `tasks` below an obstacle; enforced in `./parse.ts`. */
export const MAX_TASK_DEPTH = 5

export interface TaskProgress {
  done: number
  total: number
  /** `done / total`, 0…1 — how far the barrier arm is lifted. */
  ratio: number
}

export interface FlatTask {
  task: PathTask
  /** 0 for a task directly under the obstacle. */
  depth: number
  /** Index path from the obstacle's list: `[1, 0]` = first subtask of the second task. */
  path: number[]
  /** Effective done: its own `done`, a done ancestor, or every child done. */
  done: boolean
}

/** The task's own mark only — `true` or a date; its children do not count. */
export const ownDone = (task: PathTask): boolean =>
  task.done === true || typeof task.done === 'string'

export function isTaskDone(task: PathTask): boolean {
  if (ownDone(task)) return true
  const children = task.tasks ?? []
  return children.length > 0 && children.every(isTaskDone)
}

/** The day the task was done, when `done` names one; `null` for `true` or open. */
export function taskDoneDate(task: PathTask): string | null {
  return typeof task.done === 'string' ? task.done : null
}

function countLeaves(tasks: PathTask[], closed: boolean): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const task of tasks) {
    const isClosed = closed || ownDone(task)
    const children = task.tasks ?? []
    if (children.length === 0) {
      total += 1
      if (isClosed) done += 1
    } else {
      const sub = countLeaves(children, isClosed)
      done += sub.done
      total += sub.total
    }
  }
  return { done, total }
}

/**
 * Done / total leaves; `null` when the obstacle has no tasks (no counter is
 * drawn). `closed` = the obstacle itself is done: every leaf counts done.
 */
export function taskProgress(tasks: PathTask[] | undefined, closed = false): TaskProgress | null {
  if (!tasks || tasks.length === 0) return null
  const { done, total } = countLeaves(tasks, closed)
  return { done, total, ratio: total === 0 ? 0 : done / total }
}

/** 0 without tasks, 1 for a flat list, else the longest branch. */
export function taskDepth(tasks: PathTask[] | undefined): number {
  if (!tasks || tasks.length === 0) return 0
  return 1 + Math.max(...tasks.map((t) => taskDepth(t.tasks)))
}

/**
 * Every task in reading order (depth-first), with its depth, path and
 * effective done. `closed` = the obstacle itself is done.
 */
export function flattenTasks(tasks: PathTask[] | undefined, closed = false): FlatTask[] {
  const out: FlatTask[] = []
  const walk = (list: PathTask[], depth: number, prefix: number[], closed: boolean) => {
    list.forEach((task, i) => {
      const path = [...prefix, i]
      const done = closed || isTaskDone(task)
      out.push({ task, depth, path, done })
      if (task.tasks) walk(task.tasks, depth + 1, path, closed || ownDone(task))
    })
  }
  walk(tasks ?? [], 0, [], closed)
  return out
}

/**
 * The task at an index path from the obstacle's list — `[1, 0]` is the first
 * subtask of the second task; `null` when the path is empty or leads nowhere.
 * The same paths `flattenTasks` hands out.
 */
export function getTaskAt(
  tasks: readonly PathTask[] | undefined,
  path: readonly number[],
): PathTask | null {
  if (path.length === 0) return null
  let list: readonly PathTask[] | undefined = tasks
  let found: PathTask | null = null
  for (const index of path) {
    if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) return null
    found = list[index]
    list = found.tasks
  }
  return found
}
