'use client'

import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

import { plural } from '@/lib/path-map/derive'
import { inboundLinks, type InboundLinks } from '@/lib/path-map/links'
import { shortDate } from '@/lib/path-map/nav'
import {
  BEACON_ID,
  type Confidence,
  type PathMap,
  type PathNode,
  type PathObstacle,
  type PathTask,
  type PathTrack,
} from '@/lib/path-map/schema'
import { isTaskDone, MAX_TASK_DEPTH } from '@/lib/path-map/tasks'

import {
  NEW_NODE_KIND,
  NODE_ACCUSATIVE,
  NODE_KIND,
  type NodeDraft,
  nodeExists,
  opensChoices,
  outcomeErrors,
  swapImpact,
  todayIso,
  type RunEdit,
} from './editing'
import { EditMenu, type EditMenuItem } from './EditMenu'
import { TaskTickIcon } from './icons'
import { ownerColor } from './labels'

/**
 * The editor's right-panel forms (#539): a node (station / barrier / fog), a
 * track, the beacon, and the barrier's task tree.
 *
 * Content: the AddStation artboard of the owner's «Карта пути» canvas, vendored
 * as `design-source/path-map/AddStation.dc.html` (#541 rework) — «Что должно
 * стать правдой?», the target pills of «что это открывает выше» with the
 * «потому что» under them, «Насколько уверены?» as three road swatches, and
 * the Отмена / «Поставить на дорогу» footer. Its «Режим встречи» button is out
 * of scope. The swap dialog follows `Roadside.dc.html`. Layout and type were
 * reworked after the owner's review of #541 (form practice: grouped fields,
 * quiet inputs, one primary action, delete apart) — see the anatomy note
 * above the small parts below.
 *
 * Every form validates in the browser first (a station needs «потому что»),
 * then shows whatever the server refused. A stale map is the editor's banner,
 * not the form's: the form keeps its input so nothing typed is lost.
 */

// ── small parts ──────────────────────────────────────────────────────────────
//
// Form anatomy (#541 owner feedback «грубо, плотно, всё в одну кучу»): a head
// (what is being edited + where), then labelled groups — one column, labels
// above inputs, helper text muted under them, an error right under its field —
// then ONE footer (quiet «Отмена», the primary action), then what saves at
// once (the barrier's tasks), the rarely used «Переместить» collapsed, and the
// delete action last, in its own zone.

export function FormErrors({ errors }: { errors: string[] }) {
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
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')
  return (
    <div className="pm-ed-field" data-invalid={error ? 'true' : undefined}>
      <span className="pm-ed-labelrow">
        <label htmlFor={id} className="pm-ed-label">
          {label}
        </label>
        {required ? <span className="pm-ed-req">обязательно</span> : null}
      </span>
      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {error ? (
        <span id={errorId} className="pm-ed-error">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="pm-ed-hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/** A labelled group of related fields: `<fieldset>` + `<legend>`. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="pm-ed-group">
      <legend className="pm-ed-group-title">{title}</legend>
      <div className="pm-ed-group-body">{children}</div>
    </fieldset>
  )
}

function ConfirmBar({
  text,
  confirm,
  onConfirm,
  onCancel,
  busy,
  children,
}: {
  text: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  children?: React.ReactNode
}) {
  return (
    <div role="alertdialog" aria-label={text} className="pm-ed-confirm">
      <span className="pm-ed-confirm-text">{text}</span>
      {children}
      <span className="pm-ed-confirm-actions">
        <button type="button" className="pm-ed-btn pm-ed-btn--ghost" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="pm-ed-btn pm-ed-btn--danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirm}
        </button>
      </span>
    </div>
  )
}

function titleOf(map: PathMap, id: string): string {
  if (id === BEACON_ID) return 'маяк'
  return map.tracks.flatMap((t) => t.nodes).find((n) => n.id === id)?.title ?? id
}

/** Named in the delete confirm; the rest are counted. */
const SHOWN_REFERRERS = 5

/**
 * The delete confirm's warning (#541 review): the blocks that lead into what
 * is being deleted, and — by default — repointing them to what it opened.
 */
function InboundWarning({
  map,
  links,
  scope,
  repoint,
  onRepoint,
}: {
  map: PathMap
  links: InboundLinks
  scope: 'node' | 'track'
  repoint: boolean
  onRepoint: (next: boolean) => void
}) {
  const n = links.referrers.length
  if (n === 0) return null
  const blocks = `${n} ${plural(n, 'блок', 'блока', 'блоков')}`
  const lead =
    scope === 'node'
      ? `На этот блок ${n === 1 ? 'ссылается' : 'ссылаются'} ${blocks} — их связь станет разрывом.`
      : `На блоки этого трека ${n === 1 ? 'ссылается' : 'ссылаются'} ${blocks} из других треков — их связь станет разрывом.`
  return (
    <span className="pm-ed-inbound">
      <span>{lead}</span>
      <ul>
        {links.referrers.slice(0, SHOWN_REFERRERS).map(({ node, track }) => (
          <li key={node.id}>
            {NODE_KIND[node.type]} «{node.title}» · трек «{track.title}»
          </li>
        ))}
        {n > SHOWN_REFERRERS ? <li>и ещё {n - SHOWN_REFERRERS}</li> : null}
      </ul>
      {links.target ? (
        <label className="pm-ed-check">
          <input type="checkbox" checked={repoint} onChange={(e) => onRepoint(e.target.checked)} />
          <span>Перенаправить их на «{titleOf(map, links.target)}»</span>
        </label>
      ) : null}
    </span>
  )
}

const CONFIDENCE_LOOK: Record<Confidence, { label: string; road: string; swatch: string }> = {
  known: { label: 'Знаем', road: 'асфальт', swatch: 'asphalt' },
  hypothesis: { label: 'Гипотеза', road: 'грунтовка', swatch: 'dirt' },
  unknown: { label: 'Не знаем', road: 'станет туманом', swatch: 'fog' },
}

function ConfidencePicker({
  value,
  onChange,
}: {
  value: Confidence
  onChange: (next: Confidence) => void
}) {
  return (
    <fieldset className="pm-ed-group">
      <legend className="pm-ed-group-title">Насколько уверены?</legend>
      <div className="pm-ed-confgrid">
        {(['known', 'hypothesis', 'unknown'] as const).map((c) => (
          <button
            key={c}
            type="button"
            className="pm-ed-conf"
            aria-pressed={value === c}
            onClick={() => onChange(c)}
          >
            <span
              className="pm-ed-conf-road"
              data-kind={CONFIDENCE_LOOK[c].swatch}
              aria-hidden="true"
            />
            <span className="pm-ed-conf-text">
              <span className="pm-ed-conf-label">{CONFIDENCE_LOOK[c].label}</span>
              <span className="pm-ed-conf-road-word">{CONFIDENCE_LOOK[c].road}</span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * «Что это открывает выше?»: the nearest blocks above on this road and the
 * beacon as one-tap pills (the artboard), plus «Другой блок…» for anything
 * else — another road, or nothing at all.
 */
function OpensPicker({
  map,
  trackId,
  index,
  existing,
  selfId,
  value,
  onChange,
  label,
  hint,
}: {
  map: PathMap
  trackId: string
  index: number
  existing: boolean
  selfId?: string
  value: string
  onChange: (next: string) => void
  label: string
  hint?: string
}) {
  const labelId = useId()
  const hintId = `${labelId}-hint`
  const { above, others } = opensChoices(map, trackId, index, existing, selfId)
  const pills: Array<{ value: string; label: string }> = [
    ...above.slice(0, 2).map((n) => ({ value: n.id, label: `${NODE_KIND[n.type]}: ${n.title}` })),
    { value: BEACON_ID, label: 'Маяк' },
  ]
  if (value && !pills.some((p) => p.value === value)) {
    pills.unshift({
      value,
      label: nodeExists(map, value) ? `${titleOf(map, value)}` : `«${value}» — такого блока нет`,
    })
  }
  if (!value) pills.push({ value: '', label: 'Никуда — дорога обрывается' })
  return (
    <div className="pm-ed-field">
      <span className="pm-ed-labelrow">
        <span id={labelId} className="pm-ed-label">
          {label}
        </span>
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        className="pm-ed-pills"
      >
        {pills.map((p) => (
          <button
            key={p.value || 'none'}
            type="button"
            className="pm-ed-pill"
            aria-pressed={value === p.value}
            onClick={() => onChange(p.value)}
          >
            {p.label}
          </button>
        ))}
        <select
          className="pm-ed-pill pm-ed-pill--select"
          aria-label="Другой блок — куда ведёт"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value === '__none' ? '' : e.target.value)
          }}
        >
          <option value="">Другой блок…</option>
          <option value="__none">— никуда (дорога обрывается)</option>
          <option value={BEACON_ID}>Маяк</option>
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
      </div>
      {hint ? (
        <span id={hintId} className="pm-ed-hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/** What is being edited (the heading) and where it sits (a muted line under it). */
function PanelHead({
  title,
  context,
  onClose,
}: {
  title: string
  context?: string
  onClose: () => void
}) {
  return (
    <div className="pm-ed-head">
      <span className="pm-ed-head-text">
        <h2 className="pm-ed-title">{title}</h2>
        {context ? <span className="pm-ed-context">{context}</span> : null}
      </span>
      <button type="button" className="pm-ed-close" aria-label="Закрыть" onClick={onClose}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  )
}

function FormFooter({
  submit,
  busy,
  onCancel,
}: {
  submit: string
  busy: boolean
  onCancel: () => void
}) {
  return (
    <div className="pm-ed-footer">
      <button type="button" className="pm-ed-btn pm-ed-btn--ghost" onClick={onCancel}>
        Отмена
      </button>
      <button type="submit" className="pm-ed-btn pm-ed-btn--primary" disabled={busy}>
        {submit}
      </button>
    </div>
  )
}

/** The delete action, apart from everything else, at the bottom of a form. */
function DangerZone({ children }: { children: React.ReactNode }) {
  return <div className="pm-ed-danger">{children}</div>
}

/**
 * Reports dirtiness up whenever the serialised form state differs from its
 * start, or `also` says a nested draft (a task row) holds unsaved text.
 */
function useDirty(state: unknown, onDirty: (dirty: boolean) => void, also = false) {
  const [initial] = useState(() => JSON.stringify(state))
  const dirty = also || JSON.stringify(state) !== initial
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

const TITLE_LABEL: Record<PathNode['type'], string> = {
  station: 'Что должно стать правдой?',
  obstacle: 'Что мешает проехать?',
  fog: 'Какой вопрос пока без ответа?',
}

export function NodeForm({
  map,
  target,
  run,
  busy,
  onDirty,
  onDraft,
  onDone,
  onClose,
}: {
  map: PathMap
  target: NodeTarget
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  /** A new block mirrors its type, title and confidence on the road's placeholder card. */
  onDraft?: (draft: NodeDraft) => void
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

  const type: PathNode['type'] =
    node?.type ?? (target.mode === 'new' ? (target.type ?? 'station') : 'station')
  const [title, setTitle] = useState(node?.title ?? '')
  const [because, setBecause] = useState(node?.type === 'station' ? (node.because ?? '') : '')
  const [confidence, setConfidence] = useState<Confidence>(
    node?.type === 'station' ? node.confidence : 'hypothesis',
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
  const [repoint, setRepoint] = useState(true)
  const formRef = useRef<HTMLFormElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  // Text typed into a task row of the barrier counts as unsaved too (#541 re-review).
  const [tasksDirty, setTasksDirty] = useState(false)

  useDirty({ title, because, confidence, owner, opens, removed, removedOn }, onDirty, tasksDirty)

  const isNew = target.mode === 'new'
  // A «+» slot's trigger unmounts when its placeholder takes the spot: focus
  // goes to the form's first field, not to <body> (#541 re-review).
  useEffect(() => {
    if (isNew) titleRef.current?.focus()
  }, [isNew])
  useEffect(() => {
    if (isNew) onDraft?.({ type, title, confidence })
  }, [isNew, onDraft, type, title, confidence])

  if (target.mode === 'edit' && !found) {
    return (
      <div className="pm-ed-form">
        <PanelHead title="Блока больше нет на карте" onClose={onClose} />
        <p className="pm-aside-lead">Его удалили или переименовали — выберите другой блок.</p>
      </div>
    )
  }

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
  const links = node ? inboundLinks(map, [node.id]) : null

  return (
    <form
      ref={formRef}
      className="pm-ed-form"
      onSubmit={submit}
      noValidate
      aria-label={isNew ? NEW_NODE_KIND[type] : `${kind}: ${node!.title}`}
    >
      <PanelHead
        title={isNew ? NEW_NODE_KIND[type] : kind}
        context={`Трек «${track?.title ?? trackId}»`}
        onClose={onClose}
      />

      <div className="pm-ed-fields">
        <Field label={TITLE_LABEL[type]} error={errors.title}>
          {({ id, describedBy, invalid }) => (
            <textarea
              ref={titleRef}
              id={id}
              className="pm-ed-input pm-ed-textarea"
              rows={2}
              value={title}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              maxLength={300}
              onChange={(e) => {
                setTitle(e.target.value)
                if (errors.title) setErrors({ ...errors, title: undefined })
              }}
            />
          )}
        </Field>

        {type === 'station' ? (
          <>
            <Group title="Зачем она нужна">
              <OpensPicker
                map={map}
                trackId={trackId}
                index={index}
                existing={!isNew}
                selfId={node?.id}
                value={opens}
                onChange={setOpens}
                label="Что это открывает выше?"
              />
              <Field
                label="Потому что"
                required
                hint="Чем станция приближает маяк. Без этого она встанет на обочину серой."
                error={errors.because}
              >
                {({ id, describedBy, invalid }) => (
                  <textarea
                    id={id}
                    className="pm-ed-input pm-ed-textarea"
                    value={because}
                    rows={2}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    maxLength={1000}
                    onChange={(e) => {
                      setBecause(e.target.value)
                      if (errors.because) setErrors({ ...errors, because: undefined })
                    }}
                  />
                )}
              </Field>
            </Group>
            <ConfidencePicker value={confidence} onChange={setConfidence} />
          </>
        ) : null}

        {type === 'obstacle' ? (
          <>
            <OpensPicker
              map={map}
              trackId={trackId}
              index={index}
              existing={!isNew}
              selfId={node?.id}
              value={opens}
              onChange={setOpens}
              label="Куда ведёт?"
            />
            <Group title="Кто и когда снимает">
              <Field label="Кто снимает" hint="Метка или имя, например «ДС»">
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
              <div className="pm-ed-field">
                <label className="pm-ed-check">
                  <input
                    type="checkbox"
                    checked={removed}
                    onChange={(e) => setRemoved(e.target.checked)}
                  />
                  <span>Снят — уходит в «Пройденный путь»</span>
                </label>
                {removed ? (
                  <label className="pm-ed-inline">
                    <span className="pm-ed-label">Дата</span>
                    <input
                      type="date"
                      className="pm-ed-input pm-ed-input--date"
                      value={removedOn}
                      onChange={(e) => setRemovedOn(e.target.value || todayIso())}
                    />
                  </label>
                ) : null}
              </div>
            </Group>
            {isNew ? (
              <p className="pm-ed-hint">Задачи можно добавить, когда шлагбаум встанет на дорогу.</p>
            ) : null}
          </>
        ) : null}

        {type === 'fog' ? (
          <OpensPicker
            map={map}
            trackId={trackId}
            index={index}
            existing={!isNew}
            selfId={node?.id}
            value={opens}
            onChange={setOpens}
            label="Куда ведёт?"
            hint="Туман — открытый вопрос. Без цели дорога на нём обрывается, с целью — «доходит через туман»."
          />
        ) : null}
      </div>

      <FormErrors errors={serverErrors} />
      <FormFooter
        submit={isNew ? 'Поставить на дорогу' : 'Сохранить'}
        busy={busy}
        onCancel={onClose}
      />

      {!isNew && node?.type === 'obstacle' ? (
        <TaskTreeEditor obstacle={node} run={run} busy={busy} onDirty={setTasksDirty} />
      ) : null}

      {!isNew && node && track ? (
        <details className="pm-ed-more">
          <summary className="pm-ed-more-summary">Переместить</summary>
          <div className="pm-ed-more-body">
            <span className="pm-ed-hint">Перемещение сохраняется сразу.</span>
            <div className="pm-ed-row" role="group" aria-label="Положение на дороге">
              <button
                type="button"
                className="pm-ed-btn pm-ed-btn--small"
                disabled={busy || index >= track.nodes.length - 1}
                onClick={() =>
                  move({ op: 'node.move', nodeId: node.id, trackId, index: index + 1 })
                }
              >
                ↑ Выше
              </button>
              <button
                type="button"
                className="pm-ed-btn pm-ed-btn--small"
                disabled={busy || index === 0}
                onClick={() =>
                  move({ op: 'node.move', nodeId: node.id, trackId, index: index - 1 })
                }
              >
                ↓ Ниже
              </button>
            </div>
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
        </details>
      ) : null}

      {!isNew && node && links ? (
        <DangerZone>
          {confirmDelete ? (
            <ConfirmBar
              text={`Удалить «${node.title}» с карты?`}
              confirm="Удалить"
              busy={busy}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={async () => {
                const outcome = await run({
                  op: 'node.remove',
                  nodeId: node.id,
                  ...(links.referrers.length > 0
                    ? { inbound: repoint && links.target ? 'repoint' : 'break' }
                    : {}),
                })
                if (outcome.status === 'ok') onDone()
                else {
                  setConfirmDelete(false)
                  setServerErrors(outcomeErrors(outcome))
                }
              }}
            >
              <InboundWarning
                map={map}
                links={links}
                scope="node"
                repoint={repoint}
                onRepoint={setRepoint}
              />
            </ConfirmBar>
          ) : (
            <button type="button" className="pm-ed-delete" onClick={() => setConfirmDelete(true)}>
              Удалить {NODE_ACCUSATIVE[type]}
            </button>
          )}
        </DangerZone>
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
  onDirty,
}: {
  initial: TaskDraft
  submitLabel: string
  busy: boolean
  onSubmit: (draft: TaskDraft) => Promise<string[]>
  onCancel: () => void
  /** Whether the draft differs from `initial` — the editor's unsaved-input confirm. */
  onDirty?: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<{ field: 'title' | 'link'; text: string } | null>(null)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const titleRef = useRef<HTMLInputElement | null>(null)
  const linkRef = useRef<HTMLInputElement | null>(null)
  const ids = useId()
  const errorId = `${ids}-error`
  useEffect(() => titleRef.current?.focus(), [])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

  const save = async () => {
    if (!draft.title.trim()) {
      setError({ field: 'title', text: 'Введите задачу' })
      titleRef.current?.focus()
      return
    }
    if (draft.link.trim() && !/^https?:\/\/\S+$/.test(draft.link.trim())) {
      setError({ field: 'link', text: 'Ссылка должна начинаться с http:// или https://' })
      linkRef.current?.focus()
      return
    }
    setError(null)
    setServerErrors(await onSubmit(draft))
  }
  const invalid = (field: 'title' | 'link') =>
    error?.field === field ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {}
  const errorFor = (field: 'title' | 'link') =>
    error?.field === field ? (
      <span id={errorId} className="pm-ed-error">
        {error.text}
      </span>
    ) : null

  return (
    <div
      className="pm-ed-taskform"
      role="group"
      aria-label={submitLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          void save()
        } else if (e.key === 'Escape') {
          // Esc cancels this row only — the editor's Esc (close the panel)
          // must not see it (#541 re-review).
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="pm-ed-field">
        <label htmlFor={`${ids}-title`} className="pm-ed-label">
          Задача
        </label>
        <input
          ref={titleRef}
          id={`${ids}-title`}
          className="pm-ed-input"
          placeholder="Что сделать"
          value={draft.title}
          {...invalid('title')}
          maxLength={300}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        {errorFor('title')}
      </div>
      <div className="pm-ed-taskform-row">
        <div className="pm-ed-field pm-ed-field--owner">
          <label htmlFor={`${ids}-owner`} className="pm-ed-label">
            Исполнитель
          </label>
          <input
            id={`${ids}-owner`}
            className="pm-ed-input"
            placeholder="Кто"
            value={draft.owner}
            maxLength={40}
            onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
          />
        </div>
        <div className="pm-ed-field pm-ed-field--grow">
          <label htmlFor={`${ids}-link`} className="pm-ed-label">
            Ссылка
          </label>
          <input
            ref={linkRef}
            id={`${ids}-link`}
            className="pm-ed-input"
            placeholder="https://…"
            value={draft.link}
            {...invalid('link')}
            maxLength={2000}
            onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          />
          {errorFor('link')}
        </div>
      </div>
      <FormErrors errors={serverErrors} />
      <div className="pm-ed-taskform-actions">
        <button
          type="button"
          className="pm-ed-btn pm-ed-btn--ghost pm-ed-btn--small"
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="pm-ed-btn pm-ed-btn--primary pm-ed-btn--small"
          disabled={busy}
          onClick={() => void save()}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

type RowMode = 'view' | 'edit' | 'add' | 'delete'

/**
 * One task row (#541 rework): a done checkbox and the title (with the owner
 * label when set) — every other action is in the row's «⋯» menu, and editing
 * expands inline under the row.
 */
function TaskEditItem({
  obstacle,
  task,
  path,
  siblings,
  run,
  busy,
  onShift,
  onDirty,
}: {
  obstacle: PathObstacle
  task: PathTask
  path: number[]
  siblings: number
  run: RunEdit
  busy: boolean
  /** A row was deleted or moved: every open row draft is closed (indices shifted). */
  onShift: () => void
  onDirty: (key: string, dirty: boolean) => void
}) {
  const [mode, setMode] = useState<RowMode>('view')
  const [errors, setErrors] = useState<string[]>([])
  const done = isTaskDone(task)
  const children = task.tasks ?? []
  const at = path[path.length - 1]
  const expectTitle = task.title
  // `path` is a fresh array each render; its joined form is the row's identity.
  const pathKey = path.join('.')
  const reportDirty = useCallback((dirty: boolean) => onDirty(pathKey, dirty), [onDirty, pathKey])
  const reportAddDirty = useCallback(
    (dirty: boolean) => onDirty(`${pathKey}+`, dirty),
    [onDirty, pathKey],
  )

  const exec = async (command: Parameters<RunEdit>[0]): Promise<string[]> => {
    const outcome = await run(command)
    if (outcome.status === 'ok') {
      setMode('view')
      setErrors([])
      if (command.op === 'task.remove' || command.op === 'task.move') onShift()
      return []
    }
    const errs = outcomeErrors(outcome)
    setErrors(errs)
    return errs
  }

  const items: EditMenuItem[] = [
    { label: 'Изменить…', onSelect: () => setMode('edit') },
    {
      label: 'Добавить подзадачу',
      disabled: path.length >= MAX_TASK_DEPTH,
      onSelect: () => setMode('add'),
    },
    {
      label: 'Выше',
      disabled: at === 0,
      onSelect: () =>
        void exec({ op: 'task.move', nodeId: obstacle.id, path, expectTitle, delta: -1 }),
    },
    {
      label: 'Ниже',
      disabled: at >= siblings - 1,
      onSelect: () =>
        void exec({ op: 'task.move', nodeId: obstacle.id, path, expectTitle, delta: 1 }),
    },
    { label: 'Удалить…', danger: true, onSelect: () => setMode('delete') },
  ]

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
            void exec({
              op: 'task.toggle',
              nodeId: obstacle.id,
              path,
              expectTitle,
              date: todayIso(),
            })
          }
        >
          {done ? <TaskTickIcon /> : null}
        </button>
        <span className="pm-task-title">
          {task.title}
          {typeof task.done === 'string' ? (
            <span className="pm-task-date"> · {shortDate(task.done)}</span>
          ) : null}
        </span>
        {task.owner ? (
          <span className="pm-task-owner" style={{ color: ownerColor(task.owner) }}>
            {task.owner}
          </span>
        ) : null}
        <EditMenu
          className="pm-ed-taskmenu"
          label={`Действия с задачей «${task.title}»`}
          disabled={busy}
          items={items}
        />
      </div>
      {mode === 'edit' ? (
        <TaskFieldsForm
          initial={{ title: task.title, owner: task.owner ?? '', link: task.link ?? '' }}
          submitLabel="Сохранить задачу"
          busy={busy}
          onCancel={() => setMode('view')}
          onDirty={reportDirty}
          onSubmit={(d) =>
            exec({ op: 'task.update', nodeId: obstacle.id, path, expectTitle, fields: d })
          }
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
          onConfirm={() => void exec({ op: 'task.remove', nodeId: obstacle.id, path, expectTitle })}
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
              onShift={onShift}
              onDirty={onDirty}
            />
          ))}
          {mode === 'add' ? (
            <li className="pm-ed-task-new">
              <TaskFieldsForm
                initial={{ title: '', owner: '', link: '' }}
                submitLabel="Добавить подзадачу"
                busy={busy}
                onCancel={() => setMode('view')}
                onDirty={reportAddDirty}
                onSubmit={(d) =>
                  exec({
                    op: 'task.add',
                    nodeId: obstacle.id,
                    parent: path,
                    parentTitle: expectTitle,
                    fields: d,
                  })
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
  onDirty,
}: {
  obstacle: PathObstacle
  run: RunEdit
  busy: boolean
  /** Whether any task draft holds unsaved text. */
  onDirty?: (dirty: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  // Bumped when a row is deleted or moved: the rows are keyed by index, so
  // every row remounts and no open draft is left over another task (#541
  // re-review). The server refuses a mismatched title regardless.
  const [epoch, setEpoch] = useState(0)
  const onShift = useCallback(() => setEpoch((n) => n + 1), [])
  const drafts = useRef(new Set<string>())
  const onDirtyRef = useRef(onDirty)
  useEffect(() => {
    onDirtyRef.current = onDirty
  })
  const report = useCallback((key: string, dirty: boolean) => {
    const before = drafts.current.size
    if (dirty) drafts.current.add(key)
    else drafts.current.delete(key)
    if (before > 0 !== drafts.current.size > 0) onDirtyRef.current?.(drafts.current.size > 0)
  }, [])
  const reportNew = useCallback((dirty: boolean) => report('+', dirty), [report])
  const tasks = obstacle.tasks ?? []
  return (
    <section className="pm-ed-sec" aria-label="Задачи шлагбаума">
      <span className="pm-ed-sec-head">
        <h3 className="pm-ed-sec-title">Задачи</h3>
        <span className="pm-ed-hint">Каждое изменение сохраняется сразу.</span>
      </span>
      {tasks.length > 0 ? (
        <ul className="pm-tasks pm-ed-tasks">
          {tasks.map((task, i) => (
            <TaskEditItem
              key={`${epoch}:${i}`}
              obstacle={obstacle}
              task={task}
              path={[i]}
              siblings={tasks.length}
              run={run}
              busy={busy}
              onShift={onShift}
              onDirty={report}
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
          onDirty={reportNew}
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
          className="pm-ed-btn pm-ed-btn--ghost pm-ed-btn--small pm-ed-addtask"
          onClick={() => setAdding(true)}
        >
          + Задача
        </button>
      )}
    </section>
  )
}

// ── the swap dialog (Roadside.dc.html) ───────────────────────────────────────

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * «Фокус полон»: which focus track goes to the roadside. A modal dialog — focus
 * moves in, Tab and Shift+Tab are trapped inside, Esc cancels, and on close
 * focus returns to whatever opened it (#541 review).
 */
export function SwapDialog({
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
  const dialogRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    firstRef.current?.focus()
    return () => {
      if (opener && opener.isConnected) opener.focus()
    }
  }, [])

  // One tab stop for the radio group: the checked radio, else the first.
  const checkedAt = focus.findIndex((t) => t.id === choice)
  const stop = checkedAt >= 0 ? checkedAt : 0
  /** ↑/←/↓/→ (and Home/End) move to the next radio and check it, wrapping (#541 re-review). */
  const onRadioKey = (e: React.KeyboardEvent) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0
    const radios = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [],
    )
    const from = radios.indexOf(document.activeElement as HTMLElement)
    let to: number
    if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = focus.length - 1
    else if (step !== 0 && from >= 0) to = (from + step + focus.length) % focus.length
    else return
    e.preventDefault()
    setChoice(focus[to].id)
    radios[to]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="pm-ed-overlay">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Вывести трек в фокус"
        className="pm-ed-dialog"
        onKeyDown={onKeyDown}
      >
        <div className="pm-ed-dialog-head">
          <h2 className="pm-ed-dialog-title">Какой трек уходит на обочину?</h2>
          <p className="pm-ed-dialog-lead">
            {`Фокус полон (${focus.length} из ${map.limits.focus_tracks}). Чтобы вывести «${incoming.title}» на дорогу, один трек из фокуса уйдёт на обочину.`}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Трек для обочины"
          className="pm-ed-radios"
          onKeyDown={onRadioKey}
        >
          {focus.map((t, i) => (
            <button
              key={t.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              role="radio"
              aria-checked={choice === t.id}
              tabIndex={i === stop ? 0 : -1}
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
          Трек на обочине остаётся на карте со всеми станциями. Вернуть его можно так же — обменом.
        </p>
        <div className="pm-ed-dialog-actions">
          <button type="button" className="pm-ed-btn pm-ed-btn--ghost" onClick={onCancel}>
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

// ── track form ───────────────────────────────────────────────────────────────

export function TrackForm({
  map,
  trackId,
  initialDelete,
  run,
  busy,
  onDirty,
  onDone,
  onClose,
  onSwap,
}: {
  map: PathMap
  /** `null` — a new track. */
  trackId: string | null
  /** Opened from the track menu's «Удалить трек…»: the confirm is shown at once. */
  initialDelete?: boolean
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  onDone: () => void
  onClose: () => void
  /** Bringing a roadside track into a FULL focus: open the swap dialog. */
  onSwap: (trackId: string) => void
}) {
  const track = trackId ? map.tracks.find((t) => t.id === trackId) : undefined
  const focusCount = map.tracks.filter((t) => t.status === 'focus').length
  const focusFull = focusCount >= map.limits.focus_tracks
  const [title, setTitle] = useState(track?.title ?? '')
  const [short, setShort] = useState(track?.short ?? '')
  const [status, setStatus] = useState<'focus' | 'roadside'>(focusFull ? 'roadside' : 'focus')
  const [error, setError] = useState<string | undefined>()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(Boolean(initialDelete))
  const [repoint, setRepoint] = useState(true)
  const formRef = useRef<HTMLFormElement | null>(null)
  useDirty({ title, short, status }, onDirty)

  if (trackId && !track) {
    return (
      <div className="pm-ed-form">
        <PanelHead title="Трека больше нет на карте" onClose={onClose} />
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

  const links = track
    ? inboundLinks(
        map,
        track.nodes.map((n) => n.id),
      )
    : null

  return (
    <form
      ref={formRef}
      className="pm-ed-form"
      onSubmit={submit}
      noValidate
      aria-label={track ? `Трек «${track.title}»` : 'Новый трек'}
    >
      <PanelHead
        title={track ? 'Трек' : 'Новый трек'}
        context={track ? undefined : 'Новая дорога к маяку'}
        onClose={onClose}
      />
      <div className="pm-ed-fields">
        <Field label="Название" error={error}>
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
        {!track ? (
          <fieldset className="pm-ed-group">
            <legend className="pm-ed-group-title">Куда ставим</legend>
            <div className="pm-ed-group-body pm-ed-choices">
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
                  {focusFull ? (
                    <span className="pm-ed-check-note">
                      {` — фокус полон (${focusCount} из ${map.limits.focus_tracks})`}
                    </span>
                  ) : null}
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
            </div>
          </fieldset>
        ) : null}
        <details className="pm-ed-more" open={Boolean(track?.short) || undefined}>
          <summary className="pm-ed-more-summary">Дополнительно</summary>
          <div className="pm-ed-more-body">
            <Field
              label="Короткое имя"
              hint="Для вкладок на телефоне. Пусто — покажем полное название."
            >
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
          </div>
        </details>
      </div>

      <FormErrors errors={serverErrors} />
      <FormFooter submit={track ? 'Сохранить' : 'Добавить трек'} busy={busy} onCancel={onClose} />

      {track ? (
        <section className="pm-ed-sec" aria-label="Фокус">
          <span className="pm-ed-sec-head">
            <h3 className="pm-ed-sec-title">
              {track.status === 'focus' ? 'В фокусе — на дороге' : 'На обочине'}
            </h3>
            <span className="pm-ed-hint">Сохраняется сразу.</span>
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
                  ? onSwap(track.id)
                  : void exec({ op: 'track.status', trackId: track.id, status: 'focus' }, false)
              }
            >
              Вывести в фокус
            </button>
          )}
        </section>
      ) : null}

      {track && links ? (
        <DangerZone>
          {confirmDelete ? (
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
                  {
                    op: 'track.remove',
                    trackId: track.id,
                    force: track.nodes.length > 0,
                    ...(links.referrers.length > 0
                      ? { inbound: repoint && links.target ? 'repoint' : 'break' }
                      : {}),
                  },
                  true,
                )
              }
            >
              <InboundWarning
                map={map}
                links={links}
                scope="track"
                repoint={repoint}
                onRepoint={setRepoint}
              />
            </ConfirmBar>
          ) : (
            <button type="button" className="pm-ed-delete" onClick={() => setConfirmDelete(true)}>
              Удалить трек
            </button>
          )}
        </DangerZone>
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
      <PanelHead title="Маяк" context="Куда идём и зачем" onClose={onClose} />
      <div className="pm-ed-fields">
        <Field label="Куда идём" error={error}>
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
        <Field label="Зачем" hint="Одна-две фразы: почему это важно.">
          {({ id, describedBy }) => (
            <textarea
              id={id}
              className="pm-ed-input pm-ed-textarea"
              rows={3}
              value={why}
              maxLength={1000}
              aria-describedby={describedBy}
              onChange={(e) => setWhy(e.target.value)}
            />
          )}
        </Field>
      </div>
      <FormErrors errors={serverErrors} />
      <FormFooter submit="Сохранить" busy={busy} onCancel={onClose} />
    </form>
  )
}
