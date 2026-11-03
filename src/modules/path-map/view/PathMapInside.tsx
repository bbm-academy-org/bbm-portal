'use client'

import React, { useId, useState } from 'react'

import { plural } from '@/lib/path-map/derive'
import { shortDate } from '@/lib/path-map/nav'
import type { PathObstacle, PathTask } from '@/lib/path-map/schema'
import { isTaskDone, taskDoneDate, taskProgress, type TaskProgress } from '@/lib/path-map/tasks'

import { ChevronIcon, CloseIcon, ExternalLinkIcon, TaskTickIcon } from './icons'
import { opensText, ownerColor } from './labels'

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

function TaskItem({ task, depth, closed }: { task: PathTask; depth: number; closed: boolean }) {
  // The first level of the tree is expanded; anything deeper waits for a click.
  const [open, setOpen] = useState(depth === 0)
  const done = closed || isTaskDone(task)
  const children = task.tasks ?? []
  const date = taskDoneDate(task)
  const childrenClosed = closed || task.done === true || typeof task.done === 'string'
  const sub = children.length > 0 ? taskProgress(children) : null
  const subDone = sub ? (childrenClosed ? sub.total : sub.done) : 0
  const listId = useId()

  return (
    <li className="pm-task" data-done={done ? 'true' : undefined}>
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
              {subDone}/{sub.total}
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
          {children.map((child, i) => (
            <TaskItem
              key={`${i}-${child.title}`}
              task={child}
              depth={depth + 1}
              closed={childrenClosed}
            />
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

  return (
    <aside
      id={INSIDE_PANEL_ID}
      ref={panelRef}
      aria-label="Что внутри"
      className="pm-aside pm-aside--check pm-aside--inside"
      tabIndex={-1}
    >
      <div className="pm-aside-inner pm-inside">
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
            {tasks.map((task, i) => (
              <TaskItem key={`${i}-${task.title}`} task={task} depth={0} closed={false} />
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
