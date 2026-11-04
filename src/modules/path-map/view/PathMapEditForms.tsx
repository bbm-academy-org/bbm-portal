'use client'

import React, { useEffect, useId, useRef, useState } from 'react'

import { shortDate } from '@/lib/path-map/nav'
import {
  BEACON_ID,
  CONFIDENCE,
  type Confidence,
  type PathMap,
  type PathNode,
  type PathObstacle,
  type PathTask,
  type PathTrack,
} from '@/lib/path-map/schema'
import { isTaskDone, MAX_TASK_DEPTH } from '@/lib/path-map/tasks'

import {
  NODE_KIND,
  nodeExists,
  opensChoices,
  outcomeErrors,
  swapImpact,
  todayIso,
  type RunEdit,
} from './editing'
import { ExternalLinkIcon, TaskTickIcon } from './icons'
import { ownerColor } from './labels'

/**
 * The editor's right-panel forms (#539): a node (station / barrier / fog), a
 * track, the beacon, and the barrier's task tree.
 *
 * Look: the AddStation artboard of the «Карта пути» canvas is NOT vendored in
 * `design-source/path-map/` (only Main, Night-Check, Mobile, Roadside, Victory,
 * Empty are), so the form is composed in the canvas's language — the aside,
 * eyebrow and title of the panels, the legend's road swatches for the
 * confidence picker, the accent primary button — as recorded in
 * `design-source/README.md`. The swap dialog follows `Roadside.dc.html`.
 *
 * Every form validates in the browser first (a station needs «потому что»),
 * then shows whatever the server refused. A stale map is the editor's banner,
 * not the form's: the form keeps its input so nothing typed is lost.
 */

// ── small parts ──────────────────────────────────────────────────────────────

function FormErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <div role="alert" className="pm-ed-errors">
      <b>Не сохранено:</b>
      <ul>
        {errors.map((e, i) => (
          <li key={`${i}:${e}`}>{e}</li>
        ))}
      </ul>
    </div>
  )
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')
  return (
    <div className="pm-ed-field" data-invalid={error ? 'true' : undefined}>
      <label htmlFor={id} className="pm-ed-label">
        {label}
        {required ? <span className="pm-ed-req"> · обязательно</span> : null}
      </label>
      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {hint ? (
        <span id={hintId} className="pm-ed-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="pm-ed-error">
          {error}
        </span>
      ) : null}
    </div>
  )
}

function ConfirmBar({
  text,
  confirm,
  onConfirm,
  onCancel,
  busy,
}: {
  text: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <div role="alertdialog" aria-label={text} className="pm-ed-confirm">
      <span>{text}</span>
      <span className="pm-ed-confirm-actions">
        <button
          type="button"
          className="pm-ed-btn pm-ed-btn--danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirm}
        </button>
        <button type="button" className="pm-ed-btn" onClick={onCancel}>
          Отмена
        </button>
      </span>
    </div>
  )
}

const CONFIDENCE_LOOK: Record<Confidence, { label: string; road: string; swatch: string }> = {
  known: { label: 'Знаем', road: 'асфальт', swatch: 'asphalt' },
  hypothesis: { label: 'Гипотеза', road: 'грунтовка', swatch: 'dirt' },
  unknown: { label: 'Не знаем', road: 'туман', swatch: 'fog' },
}

function ConfidencePicker({
  value,
  onChange,
}: {
  value: Confidence
  onChange: (next: Confidence) => void
}) {
  const name = useId()
  return (
    <fieldset className="pm-ed-field pm-ed-confidence">
      <legend className="pm-ed-label">Уверенность — какая под станцией дорога</legend>
      <div className="pm-ed-choices">
        {CONFIDENCE.map((c) => (
          <label key={c} className="pm-ed-choice" data-checked={value === c || undefined}>
            <input
              type="radio"
              name={name}
              value={c}
              checked={value === c}
              onChange={() => onChange(c)}
            />
            <span className="pm-swatch" data-kind={CONFIDENCE_LOOK[c].swatch} aria-hidden="true" />
            <span className="pm-ed-choice-text">
              <b>{CONFIDENCE_LOOK[c].label}</b>
              <span>{CONFIDENCE_LOOK[c].road}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function OpensSelect({
  map,
  trackId,
  index,
  existing,
  selfId,
  value,
  onChange,
}: {
  map: PathMap
  trackId: string
  index: number
  existing: boolean
  selfId?: string
  value: string
  onChange: (next: string) => void
}) {
  const { above, others } = opensChoices(map, trackId, index, existing, selfId)
  const dangling = value && !nodeExists(map, value)
  return (
    <Field
      label="Куда ведёт"
      hint="Что этот блок открывает выше: блок на этой дороге, на другой или сразу маяк"
    >
      {({ id, describedBy }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          className="pm-ed-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— никуда (дорога обрывается)</option>
          <option value={BEACON_ID}>Маяк</option>
          {dangling ? <option value={value}>«{value}» — такого блока нет</option> : null}
          {above.length > 0 ? (
            <optgroup label="Выше на этой дороге">
              {above.map((n) => (
                <option key={n.id} value={n.id}>
                  {NODE_KIND[n.type]}: {n.title}
                </option>
              ))}
            </optgroup>
          ) : null}
          {others.map(({ track, nodes }) => (
            <optgroup key={track.id} label={`Трек «${track.title}»`}>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {NODE_KIND[n.type]}: {n.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </Field>
  )
}

function PanelHead({
  eyebrow,
  title,
  onClose,
}: {
  eyebrow: string
  title: string
  onClose: () => void
}) {
  return (
    <>
      <div className="pm-inside-bar">
        <span className="pm-eyebrow">{eyebrow}</span>
        <button type="button" className="pm-inside-close" aria-label="Закрыть" onClick={onClose}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <h2 className="pm-aside-title">{title}</h2>
    </>
  )
}

/** Reports dirtiness up whenever the serialised form state differs from its start. */
function useDirty(state: unknown, onDirty: (dirty: boolean) => void) {
  const [initial] = useState(() => JSON.stringify(state))
  const dirty = JSON.stringify(state) !== initial
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  return dirty
}

/** Focus the first field marked invalid after a refused submit. */
function focusFirstInvalid(form: HTMLFormElement | null) {
  const el = form?.querySelector<HTMLElement>('[aria-invalid="true"]')
  el?.focus()
}

// ── node form ────────────────────────────────────────────────────────────────

export type NodeTarget =
  | { mode: 'edit'; nodeId: string }
  | { mode: 'new'; trackId: string; index: number; type?: PathNode['type'] }

function locate(map: PathMap, nodeId: string) {
  for (const track of map.tracks) {
    const index = track.nodes.findIndex((n) => n.id === nodeId)
    if (index >= 0) return { track, index, node: track.nodes[index] }
  }
  return null
}

export function NodeForm({
  map,
  target,
  run,
  busy,
  onDirty,
  onDone,
  onClose,
}: {
  map: PathMap
  target: NodeTarget
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  onDone: () => void
  onClose: () => void
}) {
  const found = target.mode === 'edit' ? locate(map, target.nodeId) : null
  const node = found?.node
  const trackId = found?.track.id ?? (target.mode === 'new' ? target.trackId : '')
  const index = found?.index ?? (target.mode === 'new' ? target.index : 0)
  const track = map.tracks.find((t) => t.id === trackId)

  const defaultOpens = () => {
    const above = track?.nodes[index]
    return above ? above.id : BEACON_ID
  }

  const [type, setType] = useState<PathNode['type']>(
    node?.type ?? (target.mode === 'new' ? (target.type ?? 'station') : 'station'),
  )
  const [title, setTitle] = useState(node?.title ?? '')
  const [because, setBecause] = useState(node?.type === 'station' ? (node.because ?? '') : '')
  const [confidence, setConfidence] = useState<Confidence>(
    node?.type === 'station' ? node.confidence : 'known',
  )
  const [owner, setOwner] = useState(node?.owner ?? '')
  const [opens, setOpens] = useState(node ? (node.opens ?? '') : defaultOpens())
  const [removed, setRemoved] = useState(node?.type === 'obstacle' ? Boolean(node.done) : false)
  const [removedOn, setRemovedOn] = useState(
    node?.type === 'obstacle' && node.done ? node.done : todayIso(),
  )
  const [errors, setErrors] = useState<{ title?: string; because?: string }>({})
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  useDirty({ type, title, because, confidence, owner, opens, removed, removedOn }, onDirty)

  if (target.mode === 'edit' && !found) {
    return (
      <div className="pm-ed-form">
        <PanelHead eyebrow="Правка" title="Блока больше нет на карте" onClose={onClose} />
        <p className="pm-aside-lead">Его удалили или переименовали — выберите другой блок.</p>
      </div>
    )
  }

  const isNew = target.mode === 'new'
  const kind = NODE_KIND[type]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!title.trim()) next.title = type === 'fog' ? 'Сформулируйте вопрос' : 'Введите название'
    if (type === 'station' && !because.trim()) {
      next.because =
        'Без «потому что» станция не встанет на дорогу — напишите, чем она приближает маяк'
    }
    setErrors(next)
    setServerErrors([])
    if (next.title || next.because) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    const fields = {
      title,
      owner: type === 'obstacle' ? owner : node?.owner,
      opens: opens || undefined,
      ...(type === 'station' ? { because, confidence } : {}),
      ...(type === 'obstacle' && removed ? { done: removedOn } : {}),
    }
    const outcome = await run(
      isNew
        ? { op: 'node.add', trackId, index, type, fields }
        : { op: 'node.update', nodeId: node!.id, fields },
    )
    if (outcome.status === 'ok') onDone()
    else setServerErrors(outcomeErrors(outcome))
  }

  const move = async (command: Parameters<RunEdit>[0]) => {
    setServerErrors([])
    const outcome = await run(command)
    if (outcome.status !== 'ok') setServerErrors(outcomeErrors(outcome))
  }

  const otherTracks = map.tracks.filter((t) => t.id !== trackId)

  return (
    <form
      ref={formRef}
      className="pm-ed-form"
      onSubmit={submit}
      noValidate
      aria-label={isNew ? 'Новый блок' : `Правка: ${node!.title}`}
    >
      <PanelHead
        eyebrow={isNew ? `Новый блок · трек «${track?.title ?? trackId}»` : `${kind} · правка`}
        title={
          isNew
            ? `Новая ${type === 'station' ? 'станция' : type === 'obstacle' ? 'преграда — шлагбаум' : 'неизвестность — туман'}`
            : node!.title
        }
        onClose={onClose}
      />

      {isNew ? (
        <div role="group" aria-label="Что ставим" className="pm-ed-types">
          {(['station', 'obstacle', 'fog'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className="pm-ed-type-btn"
              aria-pressed={type === t}
              onClick={() => setType(t)}
            >
              {NODE_KIND[t]}
            </button>
          ))}
        </div>
      ) : null}

      <Field
        label={type === 'fog' ? 'Вопрос' : type === 'obstacle' ? 'Что мешает проехать' : 'Название'}
        error={errors.title}
        required
      >
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            className="pm-ed-input"
            value={title}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>

      {type === 'station' ? (
        <>
          <Field
            label="Потому что"
            hint="Чем эта станция приближает маяк. Без ответа станция стоит на обочине."
            error={errors.because}
            required
          >
            {({ id, describedBy, invalid }) => (
              <textarea
                id={id}
                className="pm-ed-input pm-ed-textarea"
                value={because}
                rows={3}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                maxLength={1000}
                onChange={(e) => setBecause(e.target.value)}
              />
            )}
          </Field>
          <ConfidencePicker value={confidence} onChange={setConfidence} />
        </>
      ) : null}

      {type === 'obstacle' ? (
        <>
          <Field label="Кто снимает" hint="Короткая метка, например «ДС»">
            {({ id, describedBy }) => (
              <input
                id={id}
                className="pm-ed-input pm-ed-input--short"
                value={owner}
                aria-describedby={describedBy}
                maxLength={40}
                onChange={(e) => setOwner(e.target.value)}
              />
            )}
          </Field>
          <div className="pm-ed-field pm-ed-removed">
            <label className="pm-ed-check">
              <input
                type="checkbox"
                checked={removed}
                onChange={(e) => setRemoved(e.target.checked)}
              />
              <span>Снят — шлагбаум поднят, уходит в «Пройденный путь»</span>
            </label>
            {removed ? (
              <label className="pm-ed-inline">
                <span>Дата</span>
                <input
                  type="date"
                  className="pm-ed-input pm-ed-input--short"
                  value={removedOn}
                  onChange={(e) => setRemovedOn(e.target.value || todayIso())}
                />
              </label>
            ) : null}
          </div>
        </>
      ) : null}

      <OpensSelect
        map={map}
        trackId={trackId}
        index={index}
        existing={!isNew}
        selfId={node?.id}
        value={opens}
        onChange={setOpens}
      />

      <FormErrors errors={serverErrors} />

      <div className="pm-ed-actions">
        <button type="submit" className="pm-ed-btn pm-ed-btn--primary" disabled={busy}>
          {isNew ? 'Поставить на дорогу' : 'Сохранить'}
        </button>
        <button type="button" className="pm-ed-btn" onClick={onClose}>
          Отмена
        </button>
      </div>

      {!isNew && node && track ? (
        <section className="pm-ed-sec" aria-label="Положение на карте">
          <span className="pm-ed-label">Положение</span>
          <div className="pm-ed-row">
            <button
              type="button"
              className="pm-ed-btn pm-ed-btn--small"
              disabled={busy || index >= track.nodes.length - 1}
              onClick={() => move({ op: 'node.move', nodeId: node.id, trackId, index: index + 1 })}
            >
              ↑ Выше
            </button>
            <button
              type="button"
              className="pm-ed-btn pm-ed-btn--small"
              disabled={busy || index === 0}
              onClick={() => move({ op: 'node.move', nodeId: node.id, trackId, index: index - 1 })}
            >
              ↓ Ниже
            </button>
            {otherTracks.length > 0 ? (
              <select
                className="pm-ed-input pm-ed-input--short"
                aria-label="Перенести в трек"
                value=""
                disabled={busy}
                onChange={(e) => {
                  const to = map.tracks.find((t) => t.id === e.target.value)
                  if (to)
                    move({
                      op: 'node.move',
                      nodeId: node.id,
                      trackId: to.id,
                      index: to.nodes.length,
                    })
                }}
              >
                <option value="">Перенести в трек…</option>
                {otherTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </section>
      ) : null}

      {!isNew && node?.type === 'obstacle' ? (
        <TaskTreeEditor obstacle={node} run={run} busy={busy} />
      ) : null}
      {isNew && type === 'obstacle' ? (
        <p className="pm-aside-lead">
          Задачи шлагбаума добавляются после того, как он встанет на дорогу.
        </p>
      ) : null}

      {!isNew && node ? (
        confirmDelete ? (
          <ConfirmBar
            text={`Удалить «${node.title}» с карты?`}
            confirm="Удалить"
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              const outcome = await run({ op: 'node.remove', nodeId: node.id })
              if (outcome.status === 'ok') onDone()
              else {
                setConfirmDelete(false)
                setServerErrors(outcomeErrors(outcome))
              }
            }}
          />
        ) : (
          <button type="button" className="pm-ed-delete" onClick={() => setConfirmDelete(true)}>
            Удалить {kind.toLowerCase()}
          </button>
        )
      ) : null}
    </form>
  )
}

// ── barrier task tree ────────────────────────────────────────────────────────

interface TaskDraft {
  title: string
  owner: string
  link: string
}

function TaskFieldsForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: TaskDraft
  submitLabel: string
  busy: boolean
  onSubmit: (draft: TaskDraft) => Promise<string[]>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const titleRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => titleRef.current?.focus(), [])

  const save = async () => {
    if (!draft.title.trim()) {
      setError('Введите задачу')
      titleRef.current?.focus()
      return
    }
    if (draft.link.trim() && !/^https?:\/\/\S+$/.test(draft.link.trim())) {
      setError('Ссылка должна начинаться с http:// или https://')
      return
    }
    setError(null)
    setServerErrors(await onSubmit(draft))
  }

  return (
    <div
      className="pm-ed-taskform"
      role="group"
      aria-label={submitLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          void save()
        }
      }}
    >
      <input
        ref={titleRef}
        className="pm-ed-input"
        aria-label="Задача"
        placeholder="Что сделать"
        value={draft.title}
        aria-invalid={error ? true : undefined}
        maxLength={300}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <div className="pm-ed-row">
        <input
          className="pm-ed-input pm-ed-input--short"
          aria-label="Исполнитель"
          placeholder="Кто (метка)"
          value={draft.owner}
          maxLength={40}
          onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
        />
        <input
          className="pm-ed-input"
          aria-label="Ссылка"
          placeholder="https://… (необязательно)"
          value={draft.link}
          maxLength={2000}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
        />
      </div>
      {error ? <span className="pm-ed-error">{error}</span> : null}
      <FormErrors errors={serverErrors} />
      <div className="pm-ed-row">
        <button
          type="button"
          className="pm-ed-btn pm-ed-btn--primary pm-ed-btn--small"
          disabled={busy}
          onClick={() => void save()}
        >
          {submitLabel}
        </button>
        <button type="button" className="pm-ed-btn pm-ed-btn--small" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}

type RowMode = 'view' | 'edit' | 'add' | 'delete'

function TaskEditItem({
  obstacle,
  task,
  path,
  siblings,
  run,
  busy,
}: {
  obstacle: PathObstacle
  task: PathTask
  path: number[]
  siblings: number
  run: RunEdit
  busy: boolean
}) {
  const [mode, setMode] = useState<RowMode>('view')
  const [errors, setErrors] = useState<string[]>([])
  const done = isTaskDone(task)
  const children = task.tasks ?? []
  const at = path[path.length - 1]

  const exec = async (command: Parameters<RunEdit>[0]): Promise<string[]> => {
    const outcome = await run(command)
    if (outcome.status === 'ok') {
      setMode('view')
      setErrors([])
      return []
    }
    const errs = outcomeErrors(outcome)
    setErrors(errs)
    return errs
  }

  return (
    <li
      className="pm-task pm-ed-task"
      data-done={done ? 'true' : undefined}
      data-path={path.join('.')}
    >
      <div className="pm-task-row pm-ed-task-row">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Выполнено: ${task.title}`}
          className="pm-task-check pm-ed-task-check"
          disabled={busy}
          onClick={() =>
            void exec({ op: 'task.toggle', nodeId: obstacle.id, path, date: todayIso() })
          }
        >
          {done ? <TaskTickIcon /> : null}
        </button>
        <span className="pm-task-title">{task.title}</span>
        {typeof task.done === 'string' ? (
          <span className="pm-task-date">{shortDate(task.done)}</span>
        ) : null}
        {task.owner ? (
          <span className="pm-task-owner" style={{ color: ownerColor(task.owner) }}>
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
      <div
        className="pm-ed-task-tools"
        role="group"
        aria-label={`Действия с задачей «${task.title}»`}
      >
        <button
          className="pm-ed-tool-btn"
          type="button"
          disabled={busy}
          onClick={() => setMode('edit')}
        >
          Изменить
        </button>
        {path.length < MAX_TASK_DEPTH ? (
          <button
            className="pm-ed-tool-btn"
            type="button"
            disabled={busy}
            onClick={() => setMode('add')}
          >
            + подзадача
          </button>
        ) : null}
        <button
          className="pm-ed-tool-btn"
          type="button"
          aria-label={`Выше: ${task.title}`}
          disabled={busy || at === 0}
          onClick={() => void exec({ op: 'task.move', nodeId: obstacle.id, path, delta: -1 })}
        >
          ↑
        </button>
        <button
          className="pm-ed-tool-btn"
          type="button"
          aria-label={`Ниже: ${task.title}`}
          disabled={busy || at >= siblings - 1}
          onClick={() => void exec({ op: 'task.move', nodeId: obstacle.id, path, delta: 1 })}
        >
          ↓
        </button>
        <button
          type="button"
          className="pm-ed-tool-btn pm-ed-task-del"
          disabled={busy}
          onClick={() => setMode('delete')}
        >
          Удалить
        </button>
      </div>
      {mode === 'edit' ? (
        <TaskFieldsForm
          initial={{ title: task.title, owner: task.owner ?? '', link: task.link ?? '' }}
          submitLabel="Сохранить задачу"
          busy={busy}
          onCancel={() => setMode('view')}
          onSubmit={(d) => exec({ op: 'task.update', nodeId: obstacle.id, path, fields: d })}
        />
      ) : null}
      {mode === 'delete' ? (
        <ConfirmBar
          text={
            children.length > 0
              ? `Удалить «${task.title}» вместе с подзадачами?`
              : `Удалить «${task.title}»?`
          }
          confirm="Удалить"
          busy={busy}
          onCancel={() => setMode('view')}
          onConfirm={() => void exec({ op: 'task.remove', nodeId: obstacle.id, path })}
        />
      ) : null}
      {errors.length > 0 && mode === 'view' ? <FormErrors errors={errors} /> : null}
      {children.length > 0 || mode === 'add' ? (
        <ul className="pm-tasks pm-tasks--nested">
          {children.map((child, i) => (
            <TaskEditItem
              key={i}
              obstacle={obstacle}
              task={child}
              path={[...path, i]}
              siblings={children.length}
              run={run}
              busy={busy}
            />
          ))}
          {mode === 'add' ? (
            <li className="pm-ed-task-new">
              <TaskFieldsForm
                initial={{ title: '', owner: '', link: '' }}
                submitLabel="Добавить подзадачу"
                busy={busy}
                onCancel={() => setMode('view')}
                onSubmit={(d) =>
                  exec({ op: 'task.add', nodeId: obstacle.id, parent: path, fields: d })
                }
              />
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

export function TaskTreeEditor({
  obstacle,
  run,
  busy,
}: {
  obstacle: PathObstacle
  run: RunEdit
  busy: boolean
}) {
  const [adding, setAdding] = useState(false)
  const tasks = obstacle.tasks ?? []
  return (
    <section className="pm-ed-sec" aria-label="Задачи шлагбаума">
      <span className="pm-ed-label">Задачи · каждая правка сохраняется сразу</span>
      {tasks.length > 0 ? (
        <ul className="pm-tasks">
          {tasks.map((task, i) => (
            <TaskEditItem
              key={i}
              obstacle={obstacle}
              task={task}
              path={[i]}
              siblings={tasks.length}
              run={run}
              busy={busy}
            />
          ))}
        </ul>
      ) : (
        <p className="pm-aside-lead">Задач пока нет.</p>
      )}
      {adding ? (
        <TaskFieldsForm
          initial={{ title: '', owner: '', link: '' }}
          submitLabel="Добавить задачу"
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (d) => {
            const outcome = await run({
              op: 'task.add',
              nodeId: obstacle.id,
              parent: [],
              fields: d,
            })
            if (outcome.status === 'ok') {
              setAdding(false)
              return []
            }
            return outcomeErrors(outcome)
          }}
        />
      ) : (
        <button
          type="button"
          className="pm-ed-btn pm-ed-btn--small"
          onClick={() => setAdding(true)}
        >
          + Задача
        </button>
      )}
    </section>
  )
}

// ── track form + the swap dialog (Roadside.dc.html) ──────────────────────────

function SwapDialog({
  map,
  incoming,
  busy,
  onCancel,
  onSwap,
}: {
  map: PathMap
  incoming: PathTrack
  busy: boolean
  onCancel: () => void
  onSwap: (outgoingId: string) => void
}) {
  const focus = map.tracks.filter((t) => t.status === 'focus')
  const [choice, setChoice] = useState<string | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => firstRef.current?.focus(), [])
  return (
    <div className="pm-ed-overlay">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Вывести трек в фокус"
        className="pm-ed-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <div className="pm-ed-dialog-head">
          <span className="pm-ed-dialog-kicker">
            Фокус полон · {focus.length} из {map.limits.focus_tracks}
          </span>
          <h2 className="pm-ed-dialog-title">
            Выводим «{incoming.title}» на дорогу. Какой трек уходит на обочину?
          </h2>
        </div>
        <div role="radiogroup" aria-label="Трек для обочины" className="pm-ed-radios">
          {focus.map((t, i) => (
            <button
              key={t.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              role="radio"
              aria-checked={choice === t.id}
              className="pm-ed-radio"
              onClick={() => setChoice(t.id)}
            >
              <span className="pm-ed-radio-mark" aria-hidden="true" />
              <span className="pm-ed-radio-text">
                <b>{t.title}</b>
                <span>{swapImpact(t)}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="pm-ed-dialog-note">
          Трек на обочине остаётся видимым, со всеми станциями. Вернуть можно так же — обменом.
          Лимит фокуса: {map.limits.focus_tracks}
        </p>
        <div className="pm-ed-dialog-actions">
          <button type="button" className="pm-ed-btn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="pm-ed-btn pm-ed-btn--primary"
            disabled={!choice || busy}
            onClick={() => choice && onSwap(choice)}
          >
            Поменять местами
          </button>
        </div>
      </section>
    </div>
  )
}

export function TrackForm({
  map,
  trackId,
  run,
  busy,
  onDirty,
  onDone,
  onClose,
}: {
  map: PathMap
  /** `null` — a new track. */
  trackId: string | null
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  onDone: () => void
  onClose: () => void
}) {
  const track = trackId ? map.tracks.find((t) => t.id === trackId) : undefined
  const focusCount = map.tracks.filter((t) => t.status === 'focus').length
  const focusFull = focusCount >= map.limits.focus_tracks
  const [title, setTitle] = useState(track?.title ?? '')
  const [short, setShort] = useState(track?.short ?? '')
  const [status, setStatus] = useState<'focus' | 'roadside'>(focusFull ? 'roadside' : 'focus')
  const [error, setError] = useState<string | undefined>()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [swapping, setSwapping] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)
  useDirty({ title, short, status }, onDirty)

  if (trackId && !track) {
    return (
      <div className="pm-ed-form">
        <PanelHead eyebrow="Трек" title="Трека больше нет на карте" onClose={onClose} />
      </div>
    )
  }

  const exec = async (command: Parameters<RunEdit>[0], close: boolean) => {
    setServerErrors([])
    const outcome = await run(command)
    if (outcome.status === 'ok') {
      if (close) onDone()
      return true
    }
    setServerErrors(outcomeErrors(outcome))
    return false
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Введите название трека')
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    setError(undefined)
    await exec(
      track
        ? { op: 'track.update', trackId: track.id, title, short: short || undefined }
        : { op: 'track.add', title, short: short || undefined, status },
      true,
    )
  }

  return (
    <form
      ref={formRef}
      className="pm-ed-form"
      onSubmit={submit}
      noValidate
      aria-label={track ? `Трек «${track.title}»` : 'Новый трек'}
    >
      <PanelHead
        eyebrow={track ? 'Трек · правка' : 'Новый трек'}
        title={track ? track.title : 'Новая дорога к маяку'}
        onClose={onClose}
      />
      <Field label="Название" error={error} required>
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            className="pm-ed-input"
            value={title}
            maxLength={120}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field label="Короткое имя" hint="Для вкладок на телефоне; пусто — полное название">
        {({ id, describedBy }) => (
          <input
            id={id}
            className="pm-ed-input pm-ed-input--short"
            value={short}
            maxLength={40}
            aria-describedby={describedBy}
            onChange={(e) => setShort(e.target.value)}
          />
        )}
      </Field>
      {!track ? (
        <fieldset className="pm-ed-field">
          <legend className="pm-ed-label">Куда ставим</legend>
          <label className="pm-ed-check">
            <input
              type="radio"
              name="pm-new-track-status"
              checked={status === 'focus'}
              disabled={focusFull}
              onChange={() => setStatus('focus')}
            />
            <span>
              В фокус
              {focusFull ? ` — фокус полон (${focusCount} из ${map.limits.focus_tracks})` : ''}
            </span>
          </label>
          <label className="pm-ed-check">
            <input
              type="radio"
              name="pm-new-track-status"
              checked={status === 'roadside'}
              onChange={() => setStatus('roadside')}
            />
            <span>На обочину</span>
          </label>
        </fieldset>
      ) : null}

      <FormErrors errors={serverErrors} />
      <div className="pm-ed-actions">
        <button type="submit" className="pm-ed-btn pm-ed-btn--primary" disabled={busy}>
          {track ? 'Сохранить' : 'Добавить трек'}
        </button>
        <button type="button" className="pm-ed-btn" onClick={onClose}>
          Отмена
        </button>
      </div>

      {track ? (
        <section className="pm-ed-sec" aria-label="Фокус">
          <span className="pm-ed-label">
            {track.status === 'focus' ? 'Трек в фокусе — на дороге' : 'Трек на обочине'}
          </span>
          {track.status === 'focus' ? (
            <button
              type="button"
              className="pm-ed-btn pm-ed-btn--small"
              disabled={busy}
              onClick={() =>
                void exec({ op: 'track.status', trackId: track.id, status: 'roadside' }, false)
              }
            >
              Убрать на обочину
            </button>
          ) : (
            <button
              type="button"
              className="pm-ed-btn pm-ed-btn--small"
              disabled={busy}
              onClick={() =>
                focusFull
                  ? setSwapping(true)
                  : void exec({ op: 'track.status', trackId: track.id, status: 'focus' }, false)
              }
            >
              Вывести в фокус
            </button>
          )}
        </section>
      ) : null}

      {track ? (
        confirmDelete ? (
          <ConfirmBar
            text={
              track.nodes.length > 0
                ? `Удалить трек «${track.title}» вместе с ${track.nodes.length} ${track.nodes.length === 1 ? 'блоком' : 'блоками'}?`
                : `Удалить трек «${track.title}»?`
            }
            confirm="Удалить трек"
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() =>
              void exec(
                { op: 'track.remove', trackId: track.id, force: track.nodes.length > 0 },
                true,
              )
            }
          />
        ) : (
          <button type="button" className="pm-ed-delete" onClick={() => setConfirmDelete(true)}>
            Удалить трек
          </button>
        )
      ) : null}

      {swapping && track ? (
        <SwapDialog
          map={map}
          incoming={track}
          busy={busy}
          onCancel={() => setSwapping(false)}
          onSwap={async (out) => {
            const ok = await exec(
              { op: 'track.status', trackId: track.id, status: 'focus', swapWith: out },
              false,
            )
            if (ok) setSwapping(false)
          }}
        />
      ) : null}
    </form>
  )
}

// ── beacon ───────────────────────────────────────────────────────────────────

export function BeaconForm({
  map,
  run,
  busy,
  onDirty,
  onDone,
  onClose,
}: {
  map: PathMap
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  onDone: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(map.beacon.title)
  const [why, setWhy] = useState(map.beacon.why ?? '')
  const [error, setError] = useState<string | undefined>()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  useDirty({ title, why }, onDirty)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Маяку нужно название — куда идём')
      return
    }
    setError(undefined)
    const outcome = await run({ op: 'beacon.update', title, why: why || undefined })
    if (outcome.status === 'ok') onDone()
    else setServerErrors(outcomeErrors(outcome))
  }

  return (
    <form className="pm-ed-form" onSubmit={submit} noValidate aria-label="Маяк">
      <PanelHead eyebrow="Маяк · правка" title="Куда идём и зачем" onClose={onClose} />
      <Field label="Маяк" error={error} required>
        {({ id, describedBy, invalid }) => (
          <textarea
            id={id}
            className="pm-ed-input pm-ed-textarea"
            rows={3}
            value={title}
            maxLength={300}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field label="Зачем">
        {({ id }) => (
          <textarea
            id={id}
            className="pm-ed-input pm-ed-textarea"
            rows={3}
            value={why}
            maxLength={1000}
            onChange={(e) => setWhy(e.target.value)}
          />
        )}
      </Field>
      <FormErrors errors={serverErrors} />
      <div className="pm-ed-actions">
        <button type="submit" className="pm-ed-btn pm-ed-btn--primary" disabled={busy}>
          Сохранить
        </button>
        <button type="button" className="pm-ed-btn" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  )
}
