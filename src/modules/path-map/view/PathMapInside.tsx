'use client'

import React, { useId, useState } from 'react'

import { plural, type MapView } from '@/lib/path-map/derive'
import { shortDate } from '@/lib/path-map/nav'
import type { PathObstacle, PathTask } from '@/lib/path-map/schema'
import {
  isTaskDone,
  ownDone,
  taskDoneDate,
  taskProgress,
  type TaskProgress,
} from '@/lib/path-map/tasks'

import { ChevronIcon, CloseIcon, ExternalLinkIcon, TaskTickIcon } from './icons'
import { opensText, ownerColor } from './labels'
import { useScrollRegion } from './useScrollRegion'

/**
 * «Что внутри» (#536) — the right panel a barrier opens in map mode: the
 * obstacle, what it opens, its progress, and the task tree behind it.
 *
 * No artboard draws this panel: it is composed in the visual language of the
 * check panel (`Night-Check.dc.html`) — same aside, eyebrow, title and list
 * rhythm — and recorded so in `design-source/README.md`. Read-only for now;
 * ticking a task off from here is a later task.
 */

export interface InsideTarget {
  node: PathObstacle
  opensTitle: string | null
  progress: TaskProgress | null
}

export const INSIDE_PANEL_ID = 'pm-inside'

/**
 * The open obstacle, looked up in the CURRENT view by id (#537 review): the
 * panel keeps only the id, so a reload (or a later edit) shows fresh tasks and
 * progress, and `null` — the obstacle is gone — closes the panel.
 */
export function insideTargetOf(view: MapView, id: string | null): InsideTarget | null {
  if (!id) return null
  for (const track of view.focus) {
    for (const item of track.upcoming) {
      if (item.kind === 'node' && item.node.type === 'obstacle' && item.node.id === id) {
        return { node: item.node, opensTitle: item.opensTitle, progress: item.progress }
      }
    }
    for (const item of track.passed) {
      if (item.node.id === id && item.progress) {
        return { node: item.node, opensTitle: item.opensTitle, progress: item.progress }
      }
    }
  }
  return null
}

function TaskItem({
  task,
  path,
  closed,
}: {
  task: PathTask
  /** Index path from the obstacle's list — the task's address (`getTaskAt`). */
  path: number[]
  closed: boolean
}) {
  // The first level of the tree is expanded; anything deeper waits for a click.
  const [open, setOpen] = useState(path.length === 1)
  const done = closed || isTaskDone(task)
  const children = task.tasks ?? []
  const date = taskDoneDate(task)
  const childrenClosed = closed || ownDone(task)
  const sub = children.length > 0 ? taskProgress(children, childrenClosed) : null
  const listId = useId()

  return (
    <li className="pm-task" data-done={done ? 'true' : undefined} data-path={path.join('.')}>
      <div className="pm-task-row">
        <span className="pm-task-check" aria-hidden="true">
          {done ? <TaskTickIcon /> : null}
        </span>
        <span className="pm-sr">{done ? 'выполнено: ' : 'не выполнено: '}</span>
        {sub ? (
          <button
            type="button"
            className="pm-task-toggle"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronIcon />
            <span className="pm-task-title">{task.title}</span>
            <span className="pm-task-count">
              {sub.done}/{sub.total}
            </span>
          </button>
        ) : (
          <span className="pm-task-title">{task.title}</span>
        )}
        {date ? <span className="pm-task-date">{shortDate(date)}</span> : null}
        {task.owner ? (
          <span className="pm-task-owner" style={{ color: ownerColor(task.owner) }}>
            <span className="pm-sr">исполнитель </span>
            {task.owner}
          </span>
        ) : null}
        {task.link ? (
          <a
            className="pm-task-link"
            href={task.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть «${task.title}» в новой вкладке`}
          >
            <ExternalLinkIcon />
          </a>
        ) : null}
      </div>
      {sub && open ? (
        <ul id={listId} className="pm-tasks pm-tasks--nested">
          {/* Keyed by position: tasks have no ids (#537 review), so a rename keeps the row. */}
          {children.map((child, i) => (
            <TaskItem key={i} task={child} path={[...path, i]} closed={childrenClosed} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function InsidePanel({
  target,
  onClose,
  panelRef,
}: {
  target: InsideTarget
  onClose: () => void
  panelRef: React.RefObject<HTMLElement | null>
}) {
  const { node, opensTitle, progress } = target
  const tasks = node.tasks ?? []
  const percent = progress ? Math.round(progress.ratio * 100) : 0
  const scroll = useScrollRegion('Что внутри — прокручиваемое содержимое')

  return (
    <aside
      id={INSIDE_PANEL_ID}
      ref={panelRef}
      aria-label="Что внутри"
      className="pm-aside pm-aside--check pm-aside--inside"
      tabIndex={-1}
    >
      <div className="pm-aside-inner pm-inside" {...scroll}>
        <div className="pm-inside-bar">
          <span className="pm-eyebrow">Что внутри</span>
          <button type="button" className="pm-inside-close" aria-label="Закрыть" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="pm-aside-head">
          <span className="pm-inside-kicker">
            {node.done ? `Шлагбаум снят · ${shortDate(node.done)}` : 'Шлагбаум · проезд закрыт'}
          </span>
          <h2 className="pm-aside-title">{node.title}</h2>
          <p className="pm-inside-meta">
            {node.owner ? (
              <span className="pm-task-owner" style={{ color: ownerColor(node.owner) }}>
                <span className="pm-sr">исполнитель </span>
                {node.owner}
              </span>
            ) : null}
            <span>{opensText(opensTitle, node.opens)}</span>
          </p>
        </div>

        {progress ? (
          <div className="pm-inside-progress">
            <span className="pm-inside-meter" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
            <span className="pm-inside-progress-text">
              <b>
                {progress.done} из {progress.total}
              </b>{' '}
              {plural(progress.total, 'задачи', 'задач', 'задач')} выполнено
            </span>
          </div>
        ) : null}

        {tasks.length > 0 ? (
          <ul className="pm-tasks" aria-label="Задачи шлагбаума">
            {/* A removed obstacle's own done closes all its tasks (#537 review). */}
            {tasks.map((task, i) => (
              <TaskItem key={i} task={task} path={[i]} closed={Boolean(node.done)} />
            ))}
          </ul>
        ) : (
          <p className="pm-aside-lead">
            Задач пока нет. Их добавляют в файл карты — поле tasks у шлагбаума.
          </p>
        )}
      </div>
    </aside>
  )
}
