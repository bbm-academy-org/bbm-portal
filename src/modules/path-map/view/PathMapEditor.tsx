'use client'

import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import type { MapView } from '@/lib/path-map'
import type { EditCommand } from '@/lib/path-map/edit'
import type { PathMapEditOutcome } from '@/lib/path-map/save'
import type { PathMap, PathNode, PathTrack } from '@/lib/path-map/schema'

import {
  CONFIDENCE_WORD,
  NEW_NODE_KIND,
  NODE_KIND,
  type NodeDraft,
  outcomeErrors,
  type PathMapEditing,
  type RoadEdit,
  type SlotAt,
} from './editing'
import { EditMenu, type EditMenuItem } from './EditMenu'
import {
  BeaconForm,
  FormErrors,
  NodeForm,
  type NodeTarget,
  SwapDialog,
  TrackForm,
} from './PathMapEditForms'
import { useScrollRegion } from './useScrollRegion'

import './path-map-edit.css'

/**
 * «Править» — editing the map IN PLACE (#539; reworked in #541 at the owner's
 * direction: no column board, no horizontal scroll, editing complements the
 * canvas instead of replacing it).
 *
 * The map keeps its road layout (`PathMapScreen.tsx` renders it; this
 * component hands it the overlay as `RoadEdit` hooks): a small «+» slot on the
 * road between blocks, at the top of each road and just above «Мы здесь»
 * opens a mini-picker «станция / шлагбаум / туман»; the choice opens the form
 * in the right panel and puts a pulsing dashed placeholder card on the road at
 * that spot (the AddStation artboard). Clicking any card opens its form; a
 * track label carries a «⋯» menu (rename, to the roadside / into focus with the
 * swap dialog, delete). With no form open the right panel is the editable
 * «Обочина»: roadside tracks and their blocks, stations without «потому что»,
 * «+ Трек».
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
  | { kind: 'track'; trackId: string | null; intent?: 'delete' }
  | { kind: 'beacon' }

function sameTarget(a: PanelTarget | null, b: PanelTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function slotLabel(at: SlotAt): string {
  const { lower, upper } = at
  if (lower && upper) return `Добавить блок между «${lower.title}» и «${upper.title}»`
  if (lower) return `Добавить блок выше «${lower.title}» в треке «${at.trackTitle}»`
  if (upper) return `Добавить блок ниже «${upper.title}» в треке «${at.trackTitle}»`
  return `Добавить первый блок в трек «${at.trackTitle}»`
}

function newBlockItems(open: (type: PathNode['type']) => void): EditMenuItem[] {
  return (['station', 'obstacle', 'fog'] as const).map((type) => ({
    label: NODE_KIND[type],
    onSelect: () => open(type),
  }))
}

/** The dashed card that stands on the road where the new block will go (AddStation artboard). */
function Placeholder({ draft }: { draft: NodeDraft }) {
  const kicker =
    draft.type === 'station'
      ? `${NEW_NODE_KIND.station} · ${CONFIDENCE_WORD[draft.confidence]}`
      : NEW_NODE_KIND[draft.type]
  return (
    <div
      role="status"
      aria-live="off"
      aria-label="Здесь встанет новый блок"
      className="pm-ed-placeholder"
      data-type={draft.type}
    >
      <span className="pm-ed-placeholder-kicker">{kicker}</span>
      <span className="pm-ed-placeholder-title" data-empty={draft.title.trim() ? undefined : ''}>
        {draft.title.trim() || 'Название появится здесь'}
      </span>
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

/** With no form open: the Обочина panel, editable (#541 rework). */
function EditRoadside({
  map,
  view,
  busy,
  panel,
  trackMenu,
  onNode,
  onNewBlock,
  onNewTrack,
}: {
  map: PathMap
  view: MapView
  busy: boolean
  panel: PanelTarget | null
  trackMenu: (trackId: string) => React.ReactNode
  onNode: (nodeId: string) => void
  onNewBlock: (track: PathTrack, type: PathNode['type']) => void
  onNewTrack: () => void
}) {
  const roadside = map.tracks.filter((t) => t.status === 'roadside')
  const bars = Math.max(view.focusLimit, view.focusCount)
  const nodeButton = (node: PathNode) => (
    <button
      key={node.id}
      type="button"
      className="pm-ed-sidenode"
      data-type={node.type}
      aria-label={`Править: ${NODE_KIND[node.type].toLowerCase()} «${node.title}»`}
      aria-pressed={
        panel?.kind === 'node' && panel.target.mode === 'edit' && panel.target.nodeId === node.id
      }
      onClick={() => onNode(node.id)}
    >
      <span className="pm-ed-sidenode-kind">{NODE_KIND[node.type]}</span>
      <span className="pm-ed-sidenode-title">{node.title}</span>
    </button>
  )
  return (
    <>
      <section className="pm-aside-sec">
        <div className="pm-aside-head">
          <h2 className="pm-aside-title">Обочина</h2>
          <p className="pm-aside-lead">
            Видно, но вне фокуса. Вывести трек на дорогу — значит отправить сюда другой.
          </p>
        </div>
        <div className="pm-meter" data-overflow={view.focusOverflow || undefined}>
          <span className="pm-meter-label">В фокусе</span>
          <span className="pm-meter-bars" aria-hidden="true">
            {Array.from({ length: bars }, (_, i) => (
              <span
                key={i}
                data-on={i < view.focusCount || undefined}
                data-over={i >= view.focusLimit || undefined}
              />
            ))}
          </span>
          <b>
            {view.focusCount} из {view.focusLimit}
          </b>
        </div>
        {roadside.map((track) => (
          <div key={track.id} className="pm-roadside-track pm-ed-sidetrack">
            <span className="pm-roadside-row">
              <span className="pm-dot pm-dot--muted" aria-hidden="true" />
              <span className="pm-roadside-name">{track.title}</span>
              <span className="pm-roadside-tag">трек</span>
              {trackMenu(track.id)}
            </span>
            {track.nodes.length > 0 ? (
              <span className="pm-ed-sidenodes">{[...track.nodes].reverse().map(nodeButton)}</span>
            ) : (
              <span className="pm-roadside-summary">пока без блоков</span>
            )}
            <EditMenu
              className="pm-ed-sideadd"
              trigger="+ Блок"
              label={`Добавить блок в трек «${track.title}»`}
              menuLabel={`Что поставить: трек «${track.title}»`}
              disabled={busy}
              items={newBlockItems((type) => onNewBlock(track, type))}
            />
          </div>
        ))}
        {view.roadsideStations.length > 0 ? (
          <div className="pm-ed-sideloose">
            <span className="pm-roadside-kicker">Станции без «потому что»</span>
            {view.roadsideStations.map(({ node }) => nodeButton(node))}
          </div>
        ) : null}
        {roadside.length === 0 && view.roadsideStations.length === 0 ? (
          <p className="pm-aside-lead">На обочине пусто.</p>
        ) : null}
        <button
          type="button"
          className="pm-ed-btn pm-ed-addtrack"
          aria-pressed={panel?.kind === 'track' && panel.trackId === null}
          disabled={busy}
          onClick={onNewTrack}
        >
          + Трек
        </button>
      </section>
      <p className="pm-aside-lead pm-ed-hint">
        «+» на дороге ставит новый блок на это место, клик по карточке открывает её форму, «⋯» у
        трека — название, фокус и удаление. Каждое сохранение — коммит в файл карты с вашим именем;
        люди и агенты продолжают править тот же файл через git.
      </p>
    </>
  )
}

/** The map, drawn by `PathMapScreen` with the overlay hooks (a component boundary, not a call). */
function MapMain({
  road,
  render,
}: {
  road: RoadEdit
  render: (road: RoadEdit) => React.ReactNode
}) {
  return <>{render(road)}</>
}

export function PathMapEditor({
  map,
  view,
  editing,
  renderMain,
}: {
  map: PathMap
  /** The edit view model (every open node of a focus road). */
  view: MapView
  editing: PathMapEditing
  /** Renders the map (`<main>`) with the editor's overlay hooks. */
  renderMain: (road: RoadEdit) => React.ReactNode
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [saving, setSaving] = useState(false)
  const [stale, setStale] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [panel, setPanel] = useState<PanelTarget | null>(null)
  const [draft, setDraft] = useState<NodeDraft | null>(null)
  // A switch (or close) waiting for the member to confirm discarding a dirty form.
  const [pending, setPending] = useState<{ next: PanelTarget | null } | null>(null)
  // A roadside track on its way into a FULL focus: the swap dialog (Roadside.dc.html).
  const [swapFor, setSwapFor] = useState<string | null>(null)
  // A refusal of a command run straight from a menu (no form to show it in).
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const dirty = useRef(false)
  const shaRef = useRef(editing.sha)
  const asideRef = useRef<HTMLElement | null>(null)
  const scroll = useScrollRegion('Правка карты — прокручиваемое содержимое')

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

  /** A command straight from a menu: its refusal shows at the top of the panel. */
  const runAction = useCallback(
    async (command: EditCommand) => {
      setActionErrors([])
      const outcome = await run(command)
      if (outcome.status !== 'ok') setActionErrors(outcomeErrors(outcome))
      return outcome
    },
    [run],
  )

  const onDirty = useCallback((value: boolean) => {
    dirty.current = value
  }, [])

  const open = useCallback((next: PanelTarget | null) => {
    setPanel(next)
    setActionErrors([])
    if (next?.kind === 'node' && next.target.mode === 'new') {
      setDraft({ type: next.target.type ?? 'station', title: '', confidence: 'hypothesis' })
    } else {
      setDraft(null)
    }
  }, [])

  const request = useCallback(
    (next: PanelTarget | null) => {
      if (sameTarget(next, panel)) return
      if (dirty.current) {
        setPending({ next })
        return
      }
      open(next)
    },
    [panel, open],
  )

  // Opening a form where the panel sits under the map scrolls it into view.
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
  // Esc while the discard confirm is open means «Вернуться к форме» — it never
  // replaces the waiting switch with «close» (#541 re-review).
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (pendingRef.current) {
        setPending(null)
        return
      }
      requestRef.current(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const close = () => request(null)
  const done = () => {
    dirty.current = false
    open(null)
  }

  const focusFull = map.tracks.filter((t) => t.status === 'focus').length >= map.limits.focus_tracks

  // A track that moves between the road and the Обочина loses its «⋯» trigger
  // (it re-mounts in the other place): once the refreshed map lands, focus
  // follows it to the new trigger instead of dropping to <body> (#541 re-review).
  const refocus = useRef<string | null>(null)
  const trackMenuLabel = (title: string) => `Трек «${title}»: действия`
  const moveTrack = async (command: Extract<EditCommand, { op: 'track.status' }>) => {
    const track = map.tracks.find((t) => t.id === command.trackId)
    refocus.current = track ? trackMenuLabel(track.title) : null
    const outcome = await runAction(command)
    if (outcome.status !== 'ok') refocus.current = null
    return outcome
  }
  useEffect(() => {
    const label = refocus.current
    if (!label) return
    const target = Array.from(document.querySelectorAll<HTMLElement>('[aria-label]')).find(
      (el) => el.getAttribute('aria-label') === label,
    )
    if (target && target !== document.activeElement && !target.isSameNode(document.body)) {
      refocus.current = null
      target.focus()
    }
  }, [map])

  const trackMenu = (trackId: string) => {
    const track = map.tracks.find((t) => t.id === trackId)
    if (!track) return null
    const items: EditMenuItem[] = [
      { label: 'Переименовать…', onSelect: () => request({ kind: 'track', trackId }) },
      track.status === 'focus'
        ? {
            label: 'Убрать на обочину',
            onSelect: () => void moveTrack({ op: 'track.status', trackId, status: 'roadside' }),
          }
        : {
            label: 'Вывести в фокус…',
            onSelect: () =>
              focusFull
                ? setSwapFor(trackId)
                : void moveTrack({ op: 'track.status', trackId, status: 'focus' }),
          },
      {
        label: 'Удалить трек…',
        danger: true,
        onSelect: () => request({ kind: 'track', trackId, intent: 'delete' }),
      },
    ]
    return (
      <EditMenu
        className="pm-ed-trackmenu"
        label={trackMenuLabel(track.title)}
        disabled={busy}
        pressed={panel?.kind === 'track' && panel.trackId === trackId}
        items={items}
      />
    )
  }

  const indexOf = (nodeId: string) => {
    for (const track of map.tracks) {
      const i = track.nodes.findIndex((n) => n.id === nodeId)
      if (i >= 0) return i
    }
    return 0
  }

  const slotOpen = (trackId: string, index: number) =>
    panel?.kind === 'node' &&
    panel.target.mode === 'new' &&
    panel.target.trackId === trackId &&
    panel.target.index === index

  const road: RoadEdit = {
    selectedId: panel?.kind === 'node' && panel.target.mode === 'edit' ? panel.target.nodeId : null,
    onNode: (nodeId) => request({ kind: 'node', target: { mode: 'edit', nodeId } }),
    slotOpen,
    slot: (at) =>
      slotOpen(at.trackId, at.index) && draft ? (
        <Placeholder draft={draft} />
      ) : (
        <EditMenu
          className="pm-ed-slot"
          trigger="+"
          label={slotLabel(at)}
          menuLabel={`Что поставить: ${slotLabel(at).replace(/^Добавить блок /, '')}`}
          disabled={busy}
          items={newBlockItems((type) =>
            request({
              kind: 'node',
              target: { mode: 'new', trackId: at.trackId, index: at.index, type },
            }),
          )}
        />
      ),
    trackMenu,
    beaconAction: (
      <button
        type="button"
        className="pm-ed-btn pm-ed-btn--small pm-ed-beaconbtn"
        aria-pressed={panel?.kind === 'beacon'}
        onClick={() => request({ kind: 'beacon' })}
      >
        Править маяк
      </button>
    ),
    indexOf,
    size: (trackId) => map.tracks.find((t) => t.id === trackId)?.nodes.length ?? 0,
  }

  let form: React.ReactNode = null
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
        onDraft={setDraft}
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
        initialDelete={panel.intent === 'delete'}
        run={run}
        busy={busy}
        onDirty={onDirty}
        onDone={done}
        onClose={close}
        onSwap={setSwapFor}
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

  const swapTrack = swapFor ? map.tracks.find((t) => t.id === swapFor) : undefined

  return (
    <div className="pm-body" data-editing="">
      <MapMain road={road} render={renderMain} />
      <aside
        ref={asideRef}
        id="pm-roadside"
        aria-label={form ? 'Правка карты' : 'Обочина'}
        className="pm-aside pm-ed-aside"
        data-form={form ? '' : undefined}
      >
        <div className="pm-aside-inner pm-inside" {...scroll}>
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
                    open(pending.next)
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
          <FormErrors errors={actionErrors} />
          {form ?? (
            <EditRoadside
              map={map}
              view={view}
              busy={busy}
              panel={panel}
              trackMenu={trackMenu}
              onNode={road.onNode}
              onNewBlock={(track, type) =>
                request({
                  kind: 'node',
                  target: { mode: 'new', trackId: track.id, index: track.nodes.length, type },
                })
              }
              onNewTrack={() => request({ kind: 'track', trackId: null })}
            />
          )}
        </div>
        {swapTrack ? (
          <SwapDialog
            map={map}
            incoming={swapTrack}
            busy={busy}
            onCancel={() => setSwapFor(null)}
            onSwap={async (out) => {
              const outcome = await moveTrack({
                op: 'track.status',
                trackId: swapTrack.id,
                status: 'focus',
                swapWith: out,
              })
              if (outcome.status === 'ok') setSwapFor(null)
            }}
          />
        ) : null}
        {/* Always mounted, so the live region announces «Сохранено» when it fills. */}
        <div role="status" className="pm-ed-toast" data-shown={toast ? 'true' : undefined}>
          {toast}
        </div>
      </aside>
    </div>
  )
}
