'use client'

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import type { MapView } from '@/lib/path-map'
import type { EditCommand } from '@/lib/path-map/edit'
import type { PathMapEditOutcome } from '@/lib/path-map/save'
import type { PathMap, PathNode, PathTrack } from '@/lib/path-map/schema'
import { Button } from '@/ui/button'
import { Sheet, SheetContent } from '@/ui/sheet'

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
import { PM_KIT } from './kit'
import {
  BeaconForm,
  ConfirmDialog,
  FormErrors,
  NodeForm,
  type NodeTarget,
  SwapDialog,
  TrackForm,
} from './PathMapEditForms'

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
 * in a side Sheet and puts a pulsing dashed placeholder card on the road at
 * that spot (the AddStation artboard). Clicking any card opens its form; a
 * track label carries a «⋯» menu (rename, to the roadside / into focus with the
 * swap dialog, delete). The right column is the editable «Обочина»: roadside
 * tracks and their blocks, stations without «потому что», «+ Трек».
 *
 * #541 v2: the form panel is the kit Sheet (non-modal), the discard and delete
 * confirmations kit AlertDialogs, the menus the kit DropdownMenu; the Обочина is
 * a flat list in the page's one scroll.
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

/** With no form open: the Обочина panel, editable — a flat list (#541 v2). */
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
  trackMenu: (trackId: string, look: 'canvas' | 'quiet') => React.ReactNode
  onNode: (nodeId: string) => void
  onNewBlock: (track: PathTrack, type: PathNode['type']) => void
  onNewTrack: () => void
}) {
  const roadside = map.tracks.filter((t) => t.status === 'roadside')
  const bars = Math.max(view.focusLimit, view.focusCount)
  const nodeRow = (node: PathNode) => (
    <li key={node.id}>
      <Button
        type="button"
        variant="ghost"
        className="pm-side-node"
        aria-label={`Править: ${NODE_KIND[node.type].toLowerCase()} «${node.title}»`}
        aria-pressed={
          panel?.kind === 'node' && panel.target.mode === 'edit' && panel.target.nodeId === node.id
        }
        onClick={() => onNode(node.id)}
      >
        <span className="pm-f-kind" data-type={node.type}>
          {NODE_KIND[node.type]}
        </span>
        <span className="pm-side-node-title">{node.title}</span>
      </Button>
    </li>
  )
  return (
    <div className="pm-side">
      <div className="pm-side-head">
        <h2 className="pm-side-title">Обочина</h2>
        <p className="pm-f-hint">
          Видно, но вне фокуса. Вывести трек на дорогу — значит отправить сюда другой.
        </p>
        <p className="pm-side-meter" data-overflow={view.focusOverflow || undefined}>
          <span>В фокусе</span>
          <span className="pm-meter-bars" aria-hidden="true">
            {Array.from({ length: bars }, (_, i) => (
              <span
                key={i}
                data-on={i < view.focusCount || undefined}
                data-over={i >= view.focusLimit || undefined}
              />
            ))}
          </span>
          <span>
            {view.focusCount} из {view.focusLimit}
          </span>
        </p>
      </div>
      {roadside.length > 0 ? (
        <ul className="pm-side-tracks">
          {roadside.map((track) => (
            <li key={track.id} className="pm-side-track">
              <div className="pm-side-trackhead">
                <h3 className="pm-side-trackname">{track.title}</h3>
                {trackMenu(track.id, 'quiet')}
              </div>
              {track.nodes.length > 0 ? (
                <ul className="pm-side-nodes">{[...track.nodes].reverse().map(nodeRow)}</ul>
              ) : (
                <p className="pm-f-hint">пока без блоков</p>
              )}
              <EditMenu
                look="quiet"
                className="pm-side-add"
                trigger="+ Блок"
                label={`Добавить блок в трек «${track.title}»`}
                menuLabel={`Что поставить: трек «${track.title}»`}
                disabled={busy}
                items={newBlockItems((type) => onNewBlock(track, type))}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {view.roadsideStations.length > 0 ? (
        <div className="pm-side-track">
          <h3 className="pm-side-trackname">Станции без «потому что»</h3>
          <ul className="pm-side-nodes">
            {view.roadsideStations.map(({ node }) => nodeRow(node))}
          </ul>
        </div>
      ) : null}
      {roadside.length === 0 && view.roadsideStations.length === 0 ? (
        <p className="pm-f-hint">На обочине пусто.</p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="pm-side-addtrack"
        aria-label="+ Трек"
        aria-pressed={panel?.kind === 'track' && panel.trackId === null}
        disabled={busy}
        onClick={onNewTrack}
      >
        <PlusIcon aria-hidden="true" />
        Трек
      </Button>
      <p className="pm-f-hint pm-side-note">
        «+» на дороге ставит новый блок на это место, клик по карточке открывает её форму, «⋯» у
        трека — название, фокус и удаление. Каждое сохранение — коммит в файл карты с вашим именем;
        люди и агенты продолжают править тот же файл через git.
      </p>
    </div>
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
  // The «⋯» that opened the swap dialog: focus returns to it on close.
  const swapOpener = useRef<string | null>(null)

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

  // Esc (the Sheet's own) closes the open form — with a confirm when it holds
  // unsaved input. The discard confirm is an AlertDialog above the Sheet, so
  // Esc there means «Вернуться к форме» and never reaches the Sheet (#541).
  const requestRef = useRef(request)
  useEffect(() => {
    requestRef.current = request
  })

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

  const focusByLabel = (label: string | null) => {
    if (!label) return
    Array.from(document.querySelectorAll<HTMLElement>('[aria-label]'))
      .find((el) => el.getAttribute('aria-label') === label)
      ?.focus()
  }
  const openSwap = (trackId: string) => {
    const track = map.tracks.find((t) => t.id === trackId)
    swapOpener.current = track ? trackMenuLabel(track.title) : null
    setSwapFor(trackId)
  }

  const trackMenu = (trackId: string, look: 'canvas' | 'quiet' = 'canvas') => {
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
                ? openSwap(trackId)
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
        look={look}
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-bbm-ui=""
        className={`${PM_KIT} pm-ed-beaconbtn`}
        aria-pressed={panel?.kind === 'beacon'}
        onClick={() => request({ kind: 'beacon' })}
      >
        Править маяк
      </Button>
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
        onSwap={openSwap}
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

  const notices = (
    <>
      {stale ? (
        <div role="alert" className="pm-f-stale">
          <p className="pm-f-stale-title">Карта обновилась — перечитайте.</p>
          <p className="pm-f-hint">
            Пока вы правили, файл карты изменили (другой человек или агент). Ваша правка не
            сохранена, но введённое осталось в форме: перечитайте карту и сохраните ещё раз.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {refreshing ? 'Перечитываем…' : 'Перечитать карту'}
          </Button>
        </div>
      ) : null}
      <FormErrors errors={actionErrors} />
    </>
  )

  return (
    <div className="pm-body" data-editing="" data-form={form ? '' : undefined}>
      <MapMain road={road} render={renderMain} />
      {/* One scroll (#541 v2): the Обочина is a plain column of the page — no
          sticky inner scroll region. Forms open in the Sheet below. */}
      <aside
        id="pm-roadside"
        aria-label="Обочина"
        data-bbm-ui=""
        className={`pm-aside pm-ed-aside ${PM_KIT}`}
      >
        {form ? null : notices}
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
      </aside>
      {/* The form panel: the kit Sheet, NON-modal — the map stays live beside it
          (click another card to switch, the placeholder card stays in view),
          and it is in view wherever on the long map the member clicked. */}
      <Sheet
        open={Boolean(form)}
        modal={false}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          aria-describedby={undefined}
          className={`${PM_KIT} pm-ed-sheet`}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            // The first field, not the close button.
            const first = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              'textarea, input',
            )
            if (first) {
              e.preventDefault()
              first.focus()
            }
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            // A task row's own Esc cancels that row only (#541 re-review).
            if ((e.target as Element | null)?.closest?.('[data-esc-local]')) return
            requestRef.current(null)
          }}
        >
          {notices}
          {form}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={Boolean(pending)}
        title="Закрыть без сохранения?"
        description="В форме есть несохранённые изменения — они пропадут."
        cancel="Вернуться к форме"
        confirm="Закрыть"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          dirty.current = false
          open(pending?.next ?? null)
          setPending(null)
        }}
      />
      {swapTrack ? (
        <SwapDialog
          map={map}
          incoming={swapTrack}
          busy={busy}
          onCancel={() => setSwapFor(null)}
          onReturnFocus={() => focusByLabel(swapOpener.current)}
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
    </div>
  )
}
