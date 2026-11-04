'use client'

import { useRouter } from 'next/navigation'
import React, { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react'

import type { EditCommand } from '@/lib/path-map/edit'
import { TRACK_COLORS } from '@/lib/path-map/derive'
import { shortDate } from '@/lib/path-map/nav'
import type { PathMapEditOutcome } from '@/lib/path-map/save'
import type { PathMap, PathNode, PathTrack } from '@/lib/path-map/schema'

import { NODE_KIND, type PathMapEditing } from './editing'
import { BeaconForm, NodeForm, type NodeTarget, TrackForm } from './PathMapEditForms'

import './path-map-edit.css'

/**
 * «Править» — the edit mode of `/p/path` (#539).
 *
 * The map's reading view folds far stations into fog and hides roadside tracks
 * in the side panel; an editor needs every node of every track in file order,
 * so edit mode draws its own board: one column per track (focus first, then
 * roadside), all nodes top-down, a «+» insert point between every two of them
 * and at both ends, «+ Трек» after the last column. Clicking anything opens its
 * form in the right panel (`PathMapEditForms.tsx`).
 *
 * The save loop: every command goes to the Server Action with the blob sha the
 * page was drawn from; on success the page is refreshed (`router.refresh()`,
 * the server cache already holds the written text) and «Сохранено» is shown.
 * The editor stays busy until the refresh lands, so a second edit is never
 * built on index paths of the previous text. A stale sha shows «карта
 * обновилась — перечитайте» with a reload button; the open form keeps its
 * input across the reload.
 */

type PanelTarget =
  | { kind: 'node'; target: NodeTarget }
  | { kind: 'track'; trackId: string | null }
  | { kind: 'beacon' }

function sameTarget(a: PanelTarget | null, b: PanelTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function nodeLine(node: PathNode): string {
  if (node.type === 'station') {
    const conf = { known: 'знаем', hypothesis: 'гипотеза', unknown: 'не знаем' }[node.confidence]
    return node.because ? `${conf} · потому что ${node.because}` : `${conf} · без «потому что»`
  }
  if (node.type === 'obstacle') {
    const tasks = node.tasks?.length ? ` · задач: ${node.tasks.length}` : ''
    return `${node.done ? `снят ${shortDate(node.done)}` : 'проезд закрыт'}${node.owner ? ` · ${node.owner}` : ''}${tasks}`
  }
  return 'открытый вопрос'
}

function InsertPoint({
  track,
  index,
  lower,
  upper,
  active,
  onInsert,
}: {
  track: PathTrack
  index: number
  lower?: PathNode
  upper?: PathNode
  active: boolean
  onInsert: () => void
}) {
  const label =
    upper && lower
      ? `Добавить блок между «${lower.title}» и «${upper.title}»`
      : lower
        ? `Добавить блок выше «${lower.title}» в треке «${track.title}»`
        : upper
          ? `Добавить блок ниже «${upper.title}» в треке «${track.title}»`
          : `Добавить первый блок в трек «${track.title}»`
  return (
    <li className="pm-ed-insert" data-index={index}>
      <button
        type="button"
        className="pm-ed-insert-btn"
        aria-label={label}
        aria-pressed={active}
        onClick={onInsert}
      >
        <span aria-hidden="true">+</span>
      </button>
    </li>
  )
}

function EditColumn({
  track,
  color,
  panel,
  onOpen,
}: {
  track: PathTrack
  color: string
  panel: PanelTarget | null
  onOpen: (next: PanelTarget) => void
}) {
  const nodes = track.nodes
  const focus = track.status === 'focus'
  const insertActive = (index: number) =>
    panel?.kind === 'node' &&
    panel.target.mode === 'new' &&
    panel.target.trackId === track.id &&
    panel.target.index === index
  const insert = (index: number) => () =>
    onOpen({ kind: 'node', target: { mode: 'new', trackId: track.id, index } })

  // Top-down: insert(len), node(len-1), insert(len-1), …, node(0), insert(0).
  const items: React.ReactNode[] = [
    <InsertPoint
      key="i-top"
      track={track}
      index={nodes.length}
      lower={nodes[nodes.length - 1]}
      active={insertActive(nodes.length)}
      onInsert={insert(nodes.length)}
    />,
  ]
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    const selected =
      panel?.kind === 'node' && panel.target.mode === 'edit' && panel.target.nodeId === node.id
    items.push(
      <li key={node.id}>
        <button
          type="button"
          className="pm-ed-node"
          data-type={node.type}
          data-confidence={node.type === 'station' ? node.confidence : undefined}
          data-done={node.type === 'obstacle' && node.done ? 'true' : undefined}
          aria-pressed={selected}
          aria-label={`Править: ${NODE_KIND[node.type].toLowerCase()} «${node.title}»`}
          onClick={() => onOpen({ kind: 'node', target: { mode: 'edit', nodeId: node.id } })}
        >
          {node.type === 'obstacle' ? <span className="pm-stripes" aria-hidden="true" /> : null}
          <span className="pm-ed-node-kind">{NODE_KIND[node.type]}</span>
          <span className="pm-ed-node-title">{node.title}</span>
          <span className="pm-ed-node-line">{nodeLine(node)}</span>
        </button>
      </li>,
      <InsertPoint
        key={`i-${i}`}
        track={track}
        index={i}
        upper={node}
        lower={nodes[i - 1]}
        active={insertActive(i)}
        onInsert={insert(i)}
      />,
    )
  }

  const trackSelected = panel?.kind === 'track' && panel.trackId === track.id
  return (
    <section className="pm-ed-col" data-status={track.status} aria-label={`Трек «${track.title}»`}>
      <div className="pm-ed-colhead">
        <span
          className="pm-dot"
          style={{ background: focus ? color : undefined }}
          aria-hidden="true"
        />
        <h2 className="pm-ed-coltitle">{track.title}</h2>
        <span className="pm-ed-tag">{focus ? 'в фокусе' : 'обочина'}</span>
        <button
          type="button"
          className="pm-ed-menu"
          aria-pressed={trackSelected}
          aria-label={`Настроить трек «${track.title}»`}
          onClick={() => onOpen({ kind: 'track', trackId: track.id })}
        >
          ⋯
        </button>
      </div>
      <ol className="pm-ed-road">{items}</ol>
      <span className="pm-ed-here">↓ ближе к «Мы здесь»</span>
    </section>
  )
}

function Intro() {
  return (
    <div className="pm-ed-form">
      <span className="pm-eyebrow">Правка карты</span>
      <h2 className="pm-aside-title">Выберите блок или «+»</h2>
      <p className="pm-aside-lead">
        Нажмите на станцию, шлагбаум или туман — справа откроется форма. «+» между блоками ставит
        новый блок на это место дороги, «⋯» у трека — название, фокус и удаление трека.
      </p>
      <p className="pm-aside-lead">
        Каждое сохранение — коммит в файл карты в репозитории path-maps с вашим именем. Агенты и
        люди продолжают править тот же файл через git.
      </p>
    </div>
  )
}

function isNarrow(): { narrow: boolean; still: boolean } {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { narrow: false, still: false }
  }
  return {
    narrow: window.matchMedia('(max-width: 1140px)').matches,
    still: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

export function PathMapEditor({ map, editing }: { map: PathMap; editing: PathMapEditing }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [saving, setSaving] = useState(false)
  const [stale, setStale] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [panel, setPanel] = useState<PanelTarget | null>(null)
  // A switch (or close) waiting for the member to confirm discarding a dirty form.
  const [pending, setPending] = useState<{ next: PanelTarget | null } | null>(null)
  const dirty = useRef(false)
  const shaRef = useRef(editing.sha)
  const asideRef = useRef<HTMLElement | null>(null)

  // A fresh page (after a save or a «Перечитать») brings the new base sha
  // and clears the stale banner (state adjusted during render, not in an effect).
  const [seenSha, setSeenSha] = useState(editing.sha)
  if (seenSha !== editing.sha) {
    setSeenSha(editing.sha)
    setStale(false)
  }
  useEffect(() => {
    shaRef.current = editing.sha
  }, [editing.sha])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const busy = saving || refreshing

  const run = useCallback(
    async (command: EditCommand): Promise<PathMapEditOutcome> => {
      const baseSha = shaRef.current
      if (!editing.enabled || !baseSha) {
        return { status: 'disabled', reason: editing.reason ?? 'редактирование недоступно' }
      }
      setSaving(true)
      try {
        const outcome = await editing.save({ command, baseSha })
        if (outcome.status === 'ok') {
          shaRef.current = outcome.sha
          setStale(false)
          setToast('Сохранено')
          startRefresh(() => router.refresh())
        } else if (outcome.status === 'stale') {
          setStale(true)
        }
        return outcome
      } catch {
        return {
          status: 'error',
          message: 'Сервер не ответил — правка не сохранена, попробуйте ещё раз',
        }
      } finally {
        setSaving(false)
      }
    },
    [editing, router],
  )

  const onDirty = useCallback((value: boolean) => {
    dirty.current = value
  }, [])

  const request = useCallback(
    (next: PanelTarget | null) => {
      if (sameTarget(next, panel)) return
      if (dirty.current) {
        setPending({ next })
        return
      }
      setPanel(next)
    },
    [panel],
  )

  // Opening a form where the panel sits under the board scrolls it into view.
  useEffect(() => {
    if (!panel) return
    const { narrow, still } = isNarrow()
    if (narrow)
      asideRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }, [panel])

  // Esc closes the open form — with a confirm when it holds unsaved input.
  const requestRef = useRef(request)
  useEffect(() => {
    requestRef.current = request
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      requestRef.current(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const close = () => request(null)
  const done = () => {
    dirty.current = false
    setPanel(null)
  }

  const focusFirst = map.tracks.filter((t) => t.status === 'focus')
  const ordered = [...focusFirst, ...map.tracks.filter((t) => t.status !== 'focus')]
  const colorOf = (track: PathTrack) =>
    TRACK_COLORS[Math.max(0, focusFirst.indexOf(track)) % TRACK_COLORS.length]

  let form: React.ReactNode = <Intro />
  const formKey = JSON.stringify(panel)
  if (panel?.kind === 'node') {
    form = (
      <NodeForm
        key={formKey}
        map={map}
        target={panel.target}
        run={run}
        busy={busy}
        onDirty={onDirty}
        onDone={done}
        onClose={close}
      />
    )
  } else if (panel?.kind === 'track') {
    form = (
      <TrackForm
        key={formKey}
        map={map}
        trackId={panel.trackId}
        run={run}
        busy={busy}
        onDirty={onDirty}
        onDone={done}
        onClose={close}
      />
    )
  } else if (panel?.kind === 'beacon') {
    form = (
      <BeaconForm
        key={formKey}
        map={map}
        run={run}
        busy={busy}
        onDirty={onDirty}
        onDone={done}
        onClose={close}
      />
    )
  }

  return (
    <div className="pm-body pm-ed-body">
      <main className="pm-main pm-ed-main">
        <section aria-label="Маяк" className="pm-ed-beacon">
          <span className="pm-eyebrow">Маяк</span>
          <h1 className="pm-beacon-title">{map.beacon.title}</h1>
          {map.beacon.why ? (
            <span className="pm-beacon-why">
              <b>Зачем:</b> {map.beacon.why}
            </span>
          ) : null}
          <button
            type="button"
            className="pm-ed-btn pm-ed-btn--small"
            aria-pressed={panel?.kind === 'beacon'}
            onClick={() => request({ kind: 'beacon' })}
          >
            Править маяк
          </button>
        </section>

        <div className="pm-ed-grid">
          {ordered.map((track) => (
            <Fragment key={track.id}>
              <EditColumn track={track} color={colorOf(track)} panel={panel} onOpen={request} />
            </Fragment>
          ))}
          <button
            type="button"
            className="pm-ed-addtrack"
            aria-pressed={panel?.kind === 'track' && panel.trackId === null}
            onClick={() => request({ kind: 'track', trackId: null })}
          >
            + Трек
          </button>
        </div>
      </main>

      <aside
        ref={asideRef}
        aria-label="Правка карты"
        className="pm-aside pm-aside--check pm-ed-aside"
      >
        <div className="pm-aside-inner pm-inside">
          {stale ? (
            <div role="alert" className="pm-ed-stale">
              <b>Карта обновилась — перечитайте.</b>
              <span>
                Пока вы правили, файл карты изменили (другой человек или агент). Ваша правка не
                сохранена, но введённое осталось в форме: перечитайте карту и сохраните ещё раз.
              </span>
              <button
                type="button"
                className="pm-ed-btn pm-ed-btn--primary pm-ed-btn--small"
                disabled={refreshing}
                onClick={() => startRefresh(() => router.refresh())}
              >
                {refreshing ? 'Перечитываем…' : 'Перечитать карту'}
              </button>
            </div>
          ) : null}
          {pending ? (
            <div role="alertdialog" aria-label="Несохранённые изменения" className="pm-ed-confirm">
              <span>В форме есть несохранённые изменения. Закрыть без сохранения?</span>
              <span className="pm-ed-confirm-actions">
                <button
                  type="button"
                  className="pm-ed-btn pm-ed-btn--danger"
                  onClick={() => {
                    dirty.current = false
                    setPanel(pending.next)
                    setPending(null)
                  }}
                >
                  Закрыть без сохранения
                </button>
                <button type="button" className="pm-ed-btn" onClick={() => setPending(null)}>
                  Вернуться к форме
                </button>
              </span>
            </div>
          ) : null}
          {form}
        </div>
      </aside>

      {/* Always mounted, so the live region announces «Сохранено» when it fills. */}
      <div role="status" className="pm-ed-toast" data-shown={toast ? 'true' : undefined}>
        {toast}
      </div>
    </div>
  )
}
