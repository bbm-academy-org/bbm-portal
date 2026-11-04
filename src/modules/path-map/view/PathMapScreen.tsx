'use client'

import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import type {
  MapView,
  PassedItem,
  PathBreak,
  PathCheck,
  PathNode,
  TrackView,
  UpcomingItem,
} from '@/lib/path-map'
import { buildMapView, plural } from '@/lib/path-map/derive'
import { ANCHOR_IDS, buildNavAnchors, nodeAnchorId, shortDate } from '@/lib/path-map/nav'
import type { PathMap } from '@/lib/path-map/schema'
import type { TaskProgress } from '@/lib/path-map/tasks'

import {
  BrokenLinkIcon,
  CheckIcon,
  FogIcon,
  LiftedBarrierIcon,
  LighthouseIcon,
  LighthouseMark,
  PinIcon,
  UpArrowIcon,
} from './icons'
import { NODE_KIND, type PathMapEditing, type RoadEdit, type SlotAt } from './editing'
import { opensText, ownerColor } from './labels'
import { PathMapEditor } from './PathMapEditor'
import { INSIDE_PANEL_ID, InsidePanel, insideTargetOf } from './PathMapInside'
import { PathMapNav } from './PathMapNav'
import { useScrollRegion } from './useScrollRegion'

/**
 * The interactive half of `/p/path` (#530): the map and its two modes.
 *
 * Built against the vendored canvas `design-source/path-map/` — `Main.dc.html`
 * (desktop map), `Night-Check.dc.html` («Проверить путь» with a break),
 * `Mobile.dc.html` (≤640px: one track at a time behind tabs), `Roadside.dc.html`
 * (the panel look) and `Victory.dc.html` (the lit road). What the canvas draws
 * and v1 deliberately does not ship — avatars, share/invite, meeting mode,
 * «Снять», «+ Трек / + Станция», the activity feed, live cursors — is absent by
 * design: editing the map is editing the YAML file.
 *
 * Everything here is presentation: the layout and every node's path check
 * arrive precomputed from `src/lib/path-map/derive.ts`.
 *
 * v2 (#536): in map mode a barrier is a button that opens «Что внутри»
 * (`PathMapInside.tsx`) in place of the Обочина panel; its card carries a
 * done/total counter and its striped arm lifts with the task progress.
 *
 * #539: a third mode, «Править», edits IN PLACE (#541 rework): the same road
 * layout stays, with every open node of a focus road drawn (nothing folds into
 * fog), and the editor (`PathMapEditor.tsx`) overlays it — «+» slots on the
 * road, clickable cards, a «⋯» menu on each track label, «Править маяк» — and
 * owns the right panel. Off (with the reason) when the map is the local
 * example, the source is misconfigured or the file version is unknown.
 */

type Mode = 'map' | 'check' | 'edit'

const CONFIDENCE_LABEL = { known: 'знаем', hypothesis: 'гипотеза', unknown: 'не знаем' } as const

function linksWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'звена'
  return 'звеньев'
}

function nodeKind(node: PathNode): string {
  if (node.type === 'station') return `станция · ${CONFIDENCE_LABEL[node.confidence]}`
  if (node.type === 'obstacle') return node.owner ? `препятствие · ${node.owner}` : 'препятствие'
  return 'туман'
}

/** What a member reads for a road's outcome — «доходит», «доходит, по грунтовке», «разрыв». */
function roadStatus(check: PathCheck | null): { text: string; ok: boolean } {
  if (!check) return { text: 'нет дороги', ok: false }
  if (!check.reached) return { text: 'разрыв', ok: false }
  if (check.confidence === 'hypothesis') return { text: 'доходит, по грунтовке', ok: true }
  if (check.confidence === 'unknown') return { text: 'доходит через туман', ok: true }
  return { text: 'доходит', ok: true }
}

/** The break in words, without naming it «разрыв» — the label next to it already does. */
function describeBreak(check: PathCheck, brk: PathBreak): string {
  const title = (id: string | null) =>
    (id && check.chain.find((link) => link.id === id)?.node.title) ?? id ?? ''
  switch (brk.kind) {
    case 'unknown-target':
      return brk.at
        ? `«${title(brk.at)}» открывает «${brk.target}», но блока с таким id на карте нет.`
        : `Блока «${brk.target}» на карте нет.`
    case 'missing-because':
      return `У станции «${title(brk.at)}» нет «потому что» — она стоит на обочине и в путь не входит.`
    case 'cycle':
      return `«${title(brk.at)}» открывает «${title(brk.target)}», а дорога оттуда уже вела сюда — петля.`
    case 'no-opens':
      return `«${title(brk.at)}» ничего не открывает: у блока не указано, куда он ведёт.`
    case 'fog':
      return `Дальше туман: «${title(brk.at)}» — вопрос, на который пока нет ответа.`
  }
}

// ── road pieces ───────────────────────────────────────────────────────────────

type SegKind =
  'asphalt' | 'dirt' | 'fade' | 'edges' | 'lit' | 'chain' | 'broken' | 'passed' | 'passed-fade'

function Seg({ kind, tall }: { kind: SegKind; tall?: boolean }) {
  return (
    <div className="pm-seg" data-kind={kind} data-tall={tall || undefined} aria-hidden="true" />
  )
}

function lookOfItem(item: UpcomingItem | undefined): SegKind {
  if (!item || item.kind === 'collapsed') return 'fade'
  if (item.look === 'dirt') return 'dirt'
  if (item.look === 'fog') return 'fade'
  return 'asphalt'
}

interface PickProps {
  interactive: boolean
  pressed: boolean
  onPick: () => void
  className: string
  label?: string
  /** The DOM id the left navigator jumps to (#532). */
  id?: string
  /**
   * Map mode only (#536): the node opens «Что внутри». It stays an `<article>`
   * (its title keeps its `<h3>`) and a disclosure button (`aria-expanded`) is
   * stretched over the whole card. `undefined` = not openable.
   */
  open?: { expanded: boolean; name: string; onOpen: (trigger: HTMLElement) => void }
  /** Edit mode (#539): the card is a button that opens its form in the panel. */
  edit?: { label: string; pressed: boolean; onEdit: () => void }
  children: React.ReactNode
}

/**
 * A node is an `<article>` on the map and a real `<button>` in «Проверить путь».
 * An obstacle on the map opens «Что внутри» (#536): the card stays an
 * `<article>` with its heading, and a short-named disclosure button covers it
 * (#537 review: a heading inside a `<button>` is invalid and drops out of
 * heading navigation).
 */
function Pick({
  interactive,
  pressed,
  onPick,
  className,
  label,
  id,
  open,
  edit,
  children,
}: PickProps) {
  if (edit) {
    return (
      <button
        id={id}
        type="button"
        className={`pm-pick pm-ed-pick ${className}`}
        aria-label={edit.label}
        aria-pressed={edit.pressed}
        onClick={edit.onEdit}
      >
        {children}
      </button>
    )
  }
  if (!interactive && open) {
    return (
      <article
        id={id}
        className={`pm-pick pm-pick--stretch ${className}${open.expanded ? ' is-open' : ''}`}
        aria-label={label}
      >
        {children}
        <button
          type="button"
          className="pm-stretch"
          aria-label={open.name}
          aria-expanded={open.expanded}
          aria-controls={open.expanded ? INSIDE_PANEL_ID : undefined}
          onClick={(e) => open.onOpen(e.currentTarget)}
        />
      </article>
    )
  }
  if (interactive) {
    return (
      <button
        id={id}
        type="button"
        className={`pm-pick ${className}`}
        aria-pressed={pressed}
        onClick={onPick}
      >
        {children}
      </button>
    )
  }
  return (
    <article id={id} className={className} aria-label={label}>
      {children}
    </article>
  )
}

interface NodeCtx {
  interactive: boolean
  selectedId: string | null
  chainIndex: Map<string, number>
  brokenAt: string | null
  onPick: (id: string) => void
  /** The obstacle whose «Что внутри» is open (map mode, #536). */
  openId: string | null
  onOpen: (id: string, trigger: HTMLElement) => void
  /** Edit mode (#539): the editor's overlay hooks. */
  road?: RoadEdit
}

function editProps(ctx: NodeCtx, node: PathNode): PickProps['edit'] {
  const road = ctx.road
  if (!road) return undefined
  return {
    label: `Править: ${NODE_KIND[node.type].toLowerCase()} «${node.title}»`,
    pressed: road.selectedId === node.id,
    onEdit: () => road.onNode(node.id),
  }
}

function openProps(ctx: NodeCtx, node: { id: string; title: string }): PickProps['open'] {
  return {
    expanded: ctx.openId === node.id,
    name: `Что внутри: ${node.title}`,
    onOpen: (trigger) => ctx.onOpen(node.id, trigger),
  }
}

/**
 * The barrier's done/total counter (#536), counted over leaf tasks
 * (`src/lib/path-map/tasks.ts`). Absent when the obstacle has no tasks.
 */
function TaskCounter({ progress }: { progress: TaskProgress | null }) {
  if (!progress) return null
  return (
    <span className="pm-count" data-full={progress.done === progress.total || undefined}>
      <span className="pm-sr">
        задачи: выполнено {progress.done} из {progress.total} —{' '}
      </span>
      <span aria-hidden="true">
        {progress.done}/{progress.total}
      </span>
    </span>
  )
}

/**
 * The striped top bar of a barrier card is its arm: it lifts with the task
 * progress (#536) — flat at 0%, at its highest at 100%. The angle lives in CSS
 * (`--pm-lift`, 0…1); without tasks the arm stays flat and carries no data.
 */
function BarrierArm({ progress }: { progress: TaskProgress | null }) {
  if (!progress) return <span className="pm-stripes" aria-hidden="true" />
  return (
    <span
      className="pm-stripes"
      aria-hidden="true"
      data-lift={Math.round(progress.ratio * 100)}
      style={{ '--pm-lift': String(progress.ratio) } as React.CSSProperties}
    />
  )
}

function chainSuffix(ctx: NodeCtx, id: string): string {
  // The selected node already carries its «Выбрано · звено 1» tag.
  if (ctx.selectedId === id) return ''
  const link = ctx.chainIndex.get(id)
  return link ? ` · звено ${link}` : ''
}

function NodeCard({ item, ctx }: { item: Extract<UpcomingItem, { kind: 'node' }>; ctx: NodeCtx }) {
  const { node } = item
  const Title = ctx.interactive || ctx.road ? 'span' : 'h3'
  const selected = ctx.selectedId === node.id
  const inChain = ctx.chainIndex.has(node.id)
  const common = {
    id: node.type === 'station' ? nodeAnchorId(node.id) : undefined,
    interactive: ctx.interactive,
    pressed: selected,
    onPick: () => ctx.onPick(node.id),
    edit: editProps(ctx, node),
  }
  const editing = ctx.road?.selectedId === node.id
  const state = `${inChain ? ' is-chain' : ''}${selected || editing ? ' is-selected' : ''}`

  let card: React.ReactNode
  if (node.type === 'obstacle') {
    const opens = opensText(item.opensTitle, node.opens)
    card = (
      <Pick
        {...common}
        open={ctx.road ? undefined : openProps(ctx, node)}
        className={`pm-card pm-obstacle${state}`}
      >
        <BarrierArm progress={item.progress} />
        <span className="pm-obstacle-body">
          <span className="pm-obstacle-top">
            <span className="pm-obstacle-kicker">
              Препятствие · проезд закрыт{chainSuffix(ctx, node.id)}
            </span>
            {node.owner ? (
              <span className="pm-owner" style={{ color: ownerColor(node.owner) }}>
                <span className="pm-sr">исполнитель </span>
                {node.owner}
              </span>
            ) : null}
          </span>
          <Title className="pm-obstacle-title">{node.title}</Title>
          <span className="pm-obstacle-foot">
            <span className="pm-obstacle-opens">{opens}</span>
            <TaskCounter progress={item.progress} />
          </span>
        </span>
      </Pick>
    )
  } else if (node.type === 'fog') {
    card = (
      <Pick {...common} className={`pm-card pm-fog${state}`}>
        <span className="pm-fog-kicker">
          <FogIcon />
          Туман{chainSuffix(ctx, node.id)}
        </span>
        <span className="pm-fog-text">Здесь пока неизвестно: {node.title}</span>
      </Pick>
    )
  } else if (item.look === 'fog') {
    // A station with confidence «unknown»: on the road, but drawn inside the fog.
    card = (
      <Pick
        {...common}
        className={`pm-card pm-far${state}`}
        label="Дальняя станция, скрыта туманом"
      >
        <span className="pm-far-title">{node.title}</span>
        <span className="pm-sr"> — станция в тумане, уверенности нет</span>
      </Pick>
    )
  } else {
    const brokenHere = ctx.brokenAt === node.id
    card = (
      <Pick
        {...common}
        className={`pm-card pm-station${item.look === 'dirt' ? ' is-dirt' : ''}${state}${brokenHere ? ' is-broken' : ''}`}
      >
        <span className="pm-card-top">
          <span className="pm-kicker">Станция{chainSuffix(ctx, node.id)}</span>
          <span className="pm-pill" data-confidence={node.confidence}>
            {CONFIDENCE_LABEL[node.confidence]}
          </span>
        </span>
        <Title className="pm-station-title">{node.title}</Title>
        {node.because ? (
          <span className="pm-because">
            <UpArrowIcon />
            <span>
              <b>потому что</b> {node.because}
              {brokenHere ? <span className="pm-notfound"> → не найдено</span> : null}
            </span>
          </span>
        ) : null}
        {item.overloaded ? (
          <span className="pm-hint">
            Препятствий на станции: {item.openObstacles} — разбей станцию
          </span>
        ) : null}
      </Pick>
    )
  }

  if (selected) {
    return (
      <div className="pm-selected-wrap">
        <span className="pm-selected-tag">Выбрано · звено 1</span>
        {card}
      </div>
    )
  }
  return card
}

/**
 * Everything beyond `limits.visible_stations`. On the map the names are a
 * blurred hint; in «Проверить путь» each one is a real button, so a collapsed
 * node can be checked like any other.
 */
function CollapsedFog({ nodes, ctx }: { nodes: PathNode[]; ctx: NodeCtx }) {
  const stations = nodes.filter((n) => n.type === 'station').length
  const inChain = nodes.some((n) => ctx.chainIndex.has(n.id))
  return (
    <div className={`pm-card pm-fog pm-collapsed${inChain ? ' is-chain' : ''}`}>
      <span className="pm-fog-kicker">
        <FogIcon />
        Дальше туман
      </span>
      <span className="pm-fog-text">
        {stations > 0
          ? `Ещё ${stations} ${plural(stations, 'станция', 'станции', 'станций')} за горизонтом`
          : 'Дальше дорогу пока не видно'}
      </span>
      {ctx.interactive ? (
        <span className="pm-far-list" data-interactive="">
          {nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`pm-far-pick${ctx.chainIndex.has(n.id) ? ' is-chain' : ''}`}
              aria-pressed={ctx.selectedId === n.id}
              onClick={() => ctx.onPick(n.id)}
            >
              {n.title}
              {chainSuffix(ctx, n.id)}
            </button>
          ))}
        </span>
      ) : (
        <span className="pm-far-list" aria-hidden="true">
          {nodes.map((n) => (
            <span key={n.id}>{n.title}</span>
          ))}
        </span>
      )}
    </div>
  )
}

function BreakCard({ check, brk }: { check: PathCheck; brk: PathBreak }) {
  return (
    <div className="pm-break" role="note">
      <span className="pm-break-kicker">
        <BrokenLinkIcon />
        Разрыв · дороги нет
      </span>
      <span className="pm-break-text">{describeBreak(check, brk)}</span>
      {brk.kind === 'unknown-target' ? (
        <span className="pm-break-hint">
          Чтобы закрыть разрыв, добавьте блок с id «{brk.target}» в файл карты или исправьте opens.
        </span>
      ) : null}
    </div>
  )
}

/** The node a break card is drawn above, for the break kinds that name one on the map. */
function breakAnchor(check: PathCheck | null): string | null {
  const brk = check?.break ?? null
  return brk && (brk.kind === 'unknown-target' || brk.kind === 'no-opens' || brk.kind === 'cycle')
    ? brk.at
    : null
}

function BreakAbove({ check }: { check: PathCheck }) {
  return check.break ? (
    <>
      <BreakCard check={check} brk={check.break} />
      <Seg kind="broken" />
    </>
  ) : null
}

function TrackColumn({
  track,
  active,
  dimmed,
  ctx,
  check,
}: {
  track: TrackView
  active: boolean
  dimmed: boolean
  ctx: NodeCtx
  check: PathCheck | null
}) {
  const topDown = [...track.upcoming].reverse()
  const breakShownAt = breakAnchor(check)

  const between = (upper: UpcomingItem, lower: UpcomingItem): SegKind => {
    if (upper.kind === 'node' && lower.kind === 'node') {
      const u = ctx.chainIndex.get(upper.node.id)
      const l = ctx.chainIndex.get(lower.node.id)
      if (u && l && u === l + 1) return 'chain'
    }
    return lookOfItem(lower)
  }

  const top = topDown[0]
  const road = ctx.road
  const nodeOf = (item: UpcomingItem | undefined) => (item?.kind === 'node' ? item.node : undefined)
  // Edit mode (#539): a road segment carries a «+» slot — or, while the slot's
  // form is open, the pulsing placeholder card of the block being added.
  const gap = (seg: React.ReactNode, at: SlotAt | null, key?: string) => {
    if (!road || !at) return seg
    if (road.slotOpen(at.trackId, at.index)) {
      return (
        <Fragment key={key}>
          {seg}
          {road.slot(at)}
          <Seg kind="dirt" />
        </Fragment>
      )
    }
    return (
      <div key={key} className="pm-ed-gap">
        {seg}
        {road.slot(at)}
      </div>
    )
  }
  const slotAt = (index: number, lower?: PathNode, upper?: PathNode): SlotAt => ({
    trackId: track.id,
    trackTitle: track.title,
    index,
    lower,
    upper,
  })
  const lowest = nodeOf(topDown[topDown.length - 1])

  return (
    <div
      className="pm-col"
      data-active={active || undefined}
      data-dimmed={dimmed || undefined}
      role={road ? 'group' : undefined}
      aria-label={road ? `Трек «${track.title}»` : undefined}
    >
      <div className="pm-track-label">
        <span className="pm-dot" style={{ background: track.color }} aria-hidden="true" />
        {track.title}
        {road ? road.trackMenu(track.id) : null}
      </div>
      {gap(
        <Seg
          kind={
            !top || top.kind === 'collapsed' || top.node.type === 'fog' ? 'edges' : lookOfItem(top)
          }
        />,
        road ? slotAt(road.size(track.id), nodeOf(top)) : null,
      )}
      {topDown.map((item, i) => {
        const lower = topDown[i + 1]
        const id = item.kind === 'node' ? item.node.id : `collapsed-${i}`
        const breaksHere =
          breakShownAt !== null &&
          (item.kind === 'node'
            ? item.node.id === breakShownAt
            : item.nodes.some((n) => n.id === breakShownAt))
        const lowerNode = nodeOf(lower)
        return (
          <Fragment key={id}>
            {check && breaksHere ? <BreakAbove check={check} /> : null}
            {item.kind === 'node' ? (
              <NodeCard item={item} ctx={ctx} />
            ) : (
              <CollapsedFog nodes={item.nodes} ctx={ctx} />
            )}
            {lower
              ? gap(
                  <Seg kind={between(item, lower)} />,
                  road && lowerNode
                    ? slotAt(road.indexOf(lowerNode.id) + 1, lowerNode, nodeOf(item))
                    : null,
                )
              : null}
          </Fragment>
        )
      })}
      {gap(
        <Seg kind="lit" />,
        road && lowest ? slotAt(road.indexOf(lowest.id), undefined, lowest) : null,
      )}
    </div>
  )
}

function PassedChip({ item, ctx }: { item: PassedItem; ctx: NodeCtx }) {
  const { node } = item
  return (
    <Pick
      interactive={ctx.interactive}
      pressed={ctx.selectedId === node.id}
      onPick={() => ctx.onPick(node.id)}
      // A removed barrier looks as before, but its tasks stay readable (#536).
      open={item.progress && !ctx.road ? openProps(ctx, node) : undefined}
      edit={editProps(ctx, node)}
      id={nodeAnchorId(node.id)}
      className={`pm-chip${ctx.chainIndex.has(node.id) ? ' is-chain' : ''}`}
    >
      <LiftedBarrierIcon />
      <span className="pm-chip-title">{node.title}</span>
      <span className="pm-chip-date">{shortDate(node.done)}</span>
    </Pick>
  )
}

function PassedColumn({
  track,
  active,
  ctx,
  check,
}: {
  track: TrackView
  active: boolean
  ctx: NodeCtx
  check: PathCheck | null
}) {
  const topDown = [...track.passed].reverse()
  const breakShownAt = breakAnchor(check)
  return (
    <div className="pm-col pm-col--passed" data-active={active || undefined}>
      {topDown.length === 0 ? (
        <Seg kind="passed-fade" tall />
      ) : (
        <>
          {topDown.map((item) => (
            <Fragment key={item.node.id}>
              {check && breakShownAt === item.node.id ? <BreakAbove check={check} /> : null}
              <Seg kind="passed" />
              <PassedChip item={item} ctx={ctx} />
            </Fragment>
          ))}
          <Seg kind="passed-fade" />
        </>
      )}
    </div>
  )
}

/** The roads converging from the track columns onto the beacon. */
function ConvergingRoads({
  view,
  chainTracks,
  check,
}: {
  view: MapView
  chainTracks: Set<string>
  check: PathCheck | null
}) {
  const n = view.focus.length
  return (
    <svg
      className="pm-converge"
      aria-hidden="true"
      viewBox="0 0 600 100"
      preserveAspectRatio="none"
    >
      {view.focus.map((track, i) => {
        const x = ((i + 0.5) / n) * 600
        const d = Math.abs(x - 300) < 1 ? 'M300 100 L300 0' : `M${x} 100 C${x} 40 300 62 300 0`
        const inChain = chainTracks.has(track.id)
        const state = !check ? 'idle' : !inChain ? 'faint' : check.reached ? 'reached' : 'broken'
        return (
          <g key={track.id} data-state={state}>
            <path className="pm-converge-bed" d={d} vectorEffect="non-scaling-stroke" />
            <path className="pm-converge-line" d={d} vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
}

function Legend() {
  return (
    <section className="pm-aside-sec" aria-labelledby="pm-legend-title">
      <h2 id="pm-legend-title" className="pm-aside-title pm-aside-title--small">
        Как читать дорогу
      </h2>
      <ul className="pm-legend">
        <li>
          <span className="pm-swatch" data-kind="asphalt" aria-hidden="true" />
          <span>
            <b>Знаем</b> — асфальт
          </span>
        </li>
        <li>
          <span className="pm-swatch" data-kind="dirt" aria-hidden="true" />
          <span>
            <b>Гипотеза</b> — грунтовка
          </span>
        </li>
        <li>
          <span className="pm-swatch" data-kind="fog" aria-hidden="true" />
          <span>
            <b>Не знаем</b> — туман
          </span>
        </li>
        <li>
          <span className="pm-swatch" data-kind="barrier" aria-hidden="true" />
          <span>
            <b>Шлагбаум</b> — что мешает проехать
          </span>
        </li>
      </ul>
    </section>
  )
}

function RoadsidePanel({ view }: { view: MapView }) {
  const scroll = useScrollRegion('Обочина — прокручиваемое содержимое')
  const bars = Math.max(view.focusLimit, view.focusCount)
  return (
    <aside id="pm-roadside" aria-label="Обочина" className="pm-aside">
      <div className="pm-aside-inner" {...scroll}>
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
          {view.focusOverflow ? <span className="pm-badge-warn">фокус переполнен</span> : null}
          {view.roadsideTracks.map((track) => (
            <div key={track.id} className="pm-roadside-track">
              <span className="pm-roadside-row">
                <span className="pm-dot pm-dot--muted" aria-hidden="true" />
                <span className="pm-roadside-name">{track.title}</span>
                <span className="pm-roadside-tag">трек</span>
              </span>
              <span className="pm-roadside-summary">{track.summary}</span>
            </div>
          ))}
          {view.roadsideStations.map(({ node, trackId, trackTitle }) => (
            <div key={`${trackId}-${node.id}`} className="pm-roadside-station">
              <span className="pm-roadside-kicker">Станция без «потому что»</span>
              <span className="pm-roadside-name">{node.title}</span>
              <span className="pm-roadside-summary">
                Не входит в путь, пока не ясно, что она открывает выше. Трек «{trackTitle}».
              </span>
            </div>
          ))}
          {view.roadsideTracks.length === 0 && view.roadsideStations.length === 0 ? (
            <p className="pm-aside-lead">На обочине пусто.</p>
          ) : null}
        </section>
        <Legend />
      </div>
    </aside>
  )
}

function CheckPanel({
  view,
  selected,
  panelRef,
}: {
  view: MapView
  selected: PathCheck | null
  panelRef: React.RefObject<HTMLElement | null>
}) {
  const scroll = useScrollRegion('Проверка пути — прокручиваемое содержимое')
  const chainTracks = new Set(selected?.chain.map((l) => l.trackId) ?? [])
  const roads = view.trackChecks.filter((c) => !chainTracks.has(c.trackId))
  const titleOf = (trackId: string) => view.focus.find((t) => t.id === trackId)?.title ?? trackId
  const colorOf = (trackId: string) => view.focus.find((t) => t.id === trackId)?.color

  let head: React.ReactNode
  if (!selected) {
    head = (
      <>
        <h2 className="pm-aside-title">Выберите блок на карте</h2>
        <p className="pm-aside-lead">
          Нажмите на станцию, шлагбаум или туман — подсветим дорогу от него до маяка.
        </p>
      </>
    )
  } else {
    const start = selected.chain[0]
    const status = roadStatus(selected)
    head = (
      <>
        <h2 className="pm-aside-title">«{start?.node.title ?? selected.start}» → маяк</h2>
        <p className={status.ok ? 'pm-status-ok' : 'pm-status-bad'}>
          {selected.reached
            ? `Дорога доходит до маяка${selected.confidence === 'hypothesis' ? ', по грунтовке' : selected.confidence === 'unknown' ? ', через туман' : ''}`
            : `Дорога обрывается после ${selected.chain.length} ${linksWord(selected.chain.length)}`}
        </p>
      </>
    )
  }

  return (
    <aside
      ref={panelRef}
      aria-label="Проверка пути"
      className="pm-aside pm-aside--check"
      tabIndex={-1}
    >
      <div className="pm-aside-inner" {...scroll}>
        <div className="pm-aside-head">
          <span className="pm-eyebrow">Проверка пути</span>
          {head}
        </div>

        {selected ? (
          <ol className="pm-chain">
            <li data-kind={selected.reached ? 'beacon-ok' : 'beacon-miss'}>
              <span className="pm-chain-mark" aria-hidden="true" />
              <span className="pm-chain-text">
                <span className="pm-chain-name">Маяк</span>
                <span className="pm-chain-sub">
                  {selected.reached ? 'достигнут' : 'не достигнут'}
                </span>
              </span>
            </li>
            {selected.break ? (
              <li data-kind="break">
                <span className="pm-chain-mark" aria-hidden="true">
                  !
                </span>
                <span className="pm-chain-text">
                  <span className="pm-chain-name pm-chain-name--bad">Разрыв</span>
                  <span className="pm-chain-sub">{describeBreak(selected, selected.break)}</span>
                </span>
              </li>
            ) : null}
            {[...selected.chain].reverse().map((link) => (
              <li key={link.id} data-kind={link.node.type}>
                <span className="pm-chain-mark" aria-hidden="true" />
                <span className="pm-chain-text">
                  <span className="pm-chain-name">{link.node.title}</span>
                  <span className="pm-chain-sub">{nodeKind(link.node)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="pm-roads">
          <span className="pm-roads-title">{selected ? 'Остальные дороги' : 'Все дороги'}</span>
          {roads.map(({ trackId, result }) => {
            const status = roadStatus(result)
            return (
              <div key={trackId} className="pm-roads-row">
                <span
                  className="pm-dot"
                  style={{ background: colorOf(trackId) }}
                  aria-hidden="true"
                />
                <span className="pm-roads-name">{titleOf(trackId)}</span>
                <span
                  className={status.ok ? 'pm-roads-status' : 'pm-roads-status pm-roads-status--bad'}
                >
                  {status.text}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

/** Whether «Что внутри» sits below the map (≤1140px) and whether motion is reduced. */
function layoutMedia(): { narrow: boolean; still: boolean } {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { narrow: false, still: false }
  }
  return {
    narrow: window.matchMedia('(max-width: 1140px)').matches,
    still: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

/** An Esc typed into a field belongs to the field (a future editor cancels its edit first). */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  )
}

export function PathMapScreen({
  view,
  checks,
  warnings,
  map,
  editing,
  initialMode = 'map',
}: {
  view: MapView
  checks: Record<string, PathCheck>
  warnings: string[]
  /** The parsed map, for the editor (#539). */
  map?: PathMap
  editing?: PathMapEditing
  initialMode?: Mode
}) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTrack, setActiveTrack] = useState<string | null>(view.focus[0]?.id ?? null)
  const panelRef = useRef<HTMLElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  // «Что внутри» (#536): only the open obstacle's id is kept; its data is read
  // from the current view on every render (#537 review), and the panel closes
  // when the obstacle is gone. The trigger is the button that opened it, so
  // closing hands the reader back to the barrier.
  const [openId, setOpenId] = useState<string | null>(null)
  const inside = insideTargetOf(view, openId)
  if (openId && !inside) setOpenId(null)
  const insideRef = useRef<HTMLElement | null>(null)
  const insideTrigger = useRef<HTMLElement | null>(null)

  const closeInside = () => {
    setOpenId(null)
    const trigger = insideTrigger.current
    if (!trigger) return
    // ≤1140px the panel sits below the map: without this the reader is left at
    // the bottom of the page, far below the barrier (#537 review).
    const { narrow, still } = layoutMedia()
    if (narrow) trigger.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
    trigger.focus({ preventScroll: true })
  }

  const openInside = (id: string, trigger: HTMLElement) => {
    if (openId === id) {
      closeInside()
      return
    }
    insideTrigger.current = trigger
    setOpenId(id)
  }

  // On open, focus moves into the panel — and where the panel sits below the
  // map (≤1140px) it is scrolled into view first. Esc closes it, unless another
  // handler took the key or the reader is typing (#537 review).
  const insideId = inside ? openId : null
  const closeRef = useRef(closeInside)
  useEffect(() => {
    closeRef.current = closeInside
  })
  useEffect(() => {
    if (!insideId) return
    const panel = insideRef.current
    const { narrow, still } = layoutMedia()
    if (panel && narrow) {
      panel.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    }
    panel?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTypingTarget(e.target)) return
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [insideId])
  // Edit mode draws every open node of a focus road (#539): its own view model.
  const editView = useMemo(() => (map ? buildMapView(map, { expandAll: true }) : view), [map, view])
  const editMode = mode === 'edit' && Boolean(editing && map)
  const shown = editMode ? editView : view
  // The navigator's points come from the same view model the map renders (#532).
  const anchors = useMemo(() => buildNavAnchors(shown), [shown])

  const checking = mode === 'check'
  const selected = checking && selectedId ? (checks[selectedId] ?? null) : null
  const chainIndex = new Map<string, number>(
    selected?.chain.map((link, i) => [link.id, i + 1]) ?? [],
  )
  const chainTracks = new Set(selected?.chain.map((l) => l.trackId) ?? [])
  const brokenAt =
    selected?.break && selected.break.kind === 'unknown-target' ? selected.break.at : null

  const onPick = (id: string) => {
    setSelectedId(id)
    const check = checks[id]
    const home = check?.chain[0]?.trackId
    if (home && view.focus.some((t) => t.id === home)) setActiveTrack(home)
    // On the narrow layout the panel sits below the map: bring the answer into view.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(max-width: 640px)').matches) {
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        panelRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
      }
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    if (next === 'map') setSelectedId(null)
    // Check and edit mode own the right panel; «Что внутри» does not survive the switch.
    if (next !== 'map') setOpenId(null)
  }

  const ctx: NodeCtx = {
    interactive: checking,
    selectedId,
    chainIndex,
    brokenAt,
    onPick,
    openId: insideId,
    onOpen: openInside,
  }
  const roadsideCount = shown.roadsideTracks.length
  const looseCount = shown.roadsideStations.length

  /** The map itself — the same road layout in every mode, the editor's overlay in «Править». */
  const mapMain = (road?: RoadEdit) => {
    const v = road ? editView : view
    const nodeCtx = road ? { ...ctx, road } : ctx
    const columns = { '--pm-cols': v.focus.length } as React.CSSProperties
    return (
      <main className="pm-main">
        <section id={ANCHOR_IDS.beacon} aria-label="Маяк" className="pm-beacon">
          <LighthouseMark />
          <span className="pm-beacon-copy">
            <span className="pm-eyebrow">Маяк</span>
            <h1 className="pm-beacon-title">{v.beacon.title}</h1>
            {v.beacon.why ? (
              <span className="pm-beacon-why">
                <b>Зачем:</b> {v.beacon.why}
              </span>
            ) : null}
            {road ? road.beaconAction : null}
          </span>
        </section>

        <div className="pm-mobile-nav">
          <div role="group" aria-label="Треки в фокусе" className="pm-tabs">
            {v.focus.map((track) => (
              <button
                key={track.id}
                type="button"
                aria-pressed={activeTrack === track.id}
                onClick={() => setActiveTrack(track.id)}
                title={track.short === track.title ? undefined : track.title}
              >
                <span className="pm-dot" style={{ background: track.color }} aria-hidden="true" />
                <span className="pm-tab-label">{track.short}</span>
              </button>
            ))}
          </div>
          {!checking && roadsideCount + looseCount > 0 ? (
            <a href="#pm-roadside" className="pm-roadside-link">
              На обочине:{' '}
              {[
                roadsideCount > 0
                  ? `${roadsideCount} ${plural(roadsideCount, 'трек', 'трека', 'треков')}`
                  : null,
                looseCount > 0
                  ? `${looseCount} ${plural(looseCount, 'станция', 'станции', 'станций')} без «потому что»`
                  : null,
              ]
                .filter(Boolean)
                .join(', ')}{' '}
              →
            </a>
          ) : null}
        </div>

        <ConvergingRoads view={v} chainTracks={chainTracks} check={selected} />

        <div className="pm-grid" style={columns}>
          {v.focus.map((track) => (
            <TrackColumn
              key={track.id}
              track={track}
              active={activeTrack === track.id}
              dimmed={Boolean(selected) && !chainTracks.has(track.id)}
              ctx={nodeCtx}
              check={selected && chainTracks.has(track.id) ? selected : null}
            />
          ))}
        </div>

        <div id={ANCHOR_IDS.here} className="pm-here">
          <span className="pm-here-line" aria-hidden="true" />
          <span className="pm-here-pill">
            <PinIcon />
            <span>Мы здесь</span>
          </span>
          <span className="pm-here-line pm-here-line--right" aria-hidden="true" />
        </div>

        <div className="pm-grid" style={columns}>
          {v.focus.map((track) => (
            <PassedColumn
              key={track.id}
              track={track}
              active={activeTrack === track.id}
              ctx={nodeCtx}
              check={selected && chainTracks.has(track.id) ? selected : null}
            />
          ))}
        </div>
        <p id={ANCHOR_IDS.start} className="pm-passed-caption">
          Пройденный путь{v.started ? ` · старт ${shortDate(v.started)}` : ''}
        </p>
        {/* Last in DOM so Tab walks the map before the rail's points (#535). */}
        <PathMapNav anchors={anchors} beaconTitle={v.beacon.title} pageRef={pageRef} />
      </main>
    )
  }

  return (
    <div ref={pageRef} className="pm-page" data-mode={mode}>
      <div className="pm-glow" aria-hidden="true" />
      <header className="pm-header">
        <div className="pm-brand">
          <LighthouseIcon />
          <span className="pm-brand-name">Карта пути</span>
          <span className="pm-sep" aria-hidden="true" />
          <span className="pm-map-title">{view.title}</span>
          {view.focusOverflow ? <span className="pm-badge-warn">фокус переполнен</span> : null}
        </div>
        <div role="group" aria-label="Режим карты" className="pm-modes">
          <button type="button" aria-pressed={mode === 'map'} onClick={() => switchMode('map')}>
            Карта
          </button>
          <button
            type="button"
            aria-pressed={checking}
            data-accent="check"
            onClick={() => switchMode(checking ? 'map' : 'check')}
          >
            <CheckIcon />
            Проверить путь
          </button>
          {editing && map ? (
            <button
              type="button"
              aria-pressed={mode === 'edit'}
              data-accent="edit"
              disabled={!editing.enabled}
              aria-describedby={editing.enabled ? undefined : 'pm-edit-off'}
              onClick={() => switchMode(mode === 'edit' ? 'map' : 'edit')}
            >
              Править
            </button>
          ) : null}
        </div>
        <div className="pm-header-end">
          {editing && !editing.enabled ? (
            <span id="pm-edit-off" className="pm-edit-off">
              {editing.reason}
            </span>
          ) : null}
        </div>
      </header>

      {checking ? (
        <div role="status" className="pm-checkbar">
          <span>Режим проверки: нажмите на любой блок — подсветим дорогу от него до маяка</span>
          <button type="button" className="pm-checkbar-exit" onClick={() => switchMode('map')}>
            Выйти
          </button>
        </div>
      ) : null}

      {warnings.length > 0 && !view.focusOverflow ? (
        <ul className="pm-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {editMode && editing && map ? (
        <PathMapEditor map={map} view={editView} editing={editing} renderMain={mapMain} />
      ) : (
        <div className="pm-body">
          {mapMain()}
          {checking ? (
            <CheckPanel view={view} selected={selected} panelRef={panelRef} />
          ) : inside ? (
            <InsidePanel
              key={inside.node.id}
              target={inside}
              onClose={closeInside}
              panelRef={insideRef}
            />
          ) : (
            <RoadsidePanel view={view} />
          )}
        </div>
      )}
    </div>
  )
}
