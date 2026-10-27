'use client'

import React, { Fragment, useRef, useState } from 'react'

import type {
  MapView,
  PassedItem,
  PathBreak,
  PathCheck,
  PathNode,
  TrackView,
  UpcomingItem,
} from '@/lib/path-map'
import { plural } from '@/lib/path-map/derive'

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
 */

type Mode = 'map' | 'check'

const CONFIDENCE_LABEL = { known: 'знаем', hypothesis: 'гипотеза', unknown: 'не знаем' } as const
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const OWNER_COLORS = ['#8FD3C1', '#B9A6F5', '#F4A3A3', '#F2B544', '#9EC5FF']

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1] ?? ''}`.trim()
}

function ownerColor(owner: string): string {
  let hash = 0
  for (const ch of owner) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return OWNER_COLORS[hash % OWNER_COLORS.length]
}

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
  children: React.ReactNode
}

/** A node is an `<article>` on the map and a real `<button>` in «Проверить путь». */
function Pick({ interactive, pressed, onPick, className, label, children }: PickProps) {
  if (interactive) {
    return (
      <button
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
    <article className={className} aria-label={label}>
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
}

function chainSuffix(ctx: NodeCtx, id: string): string {
  // The selected node already carries its «Выбрано · звено 1» tag.
  if (ctx.selectedId === id) return ''
  const link = ctx.chainIndex.get(id)
  return link ? ` · звено ${link}` : ''
}

function NodeCard({ item, ctx }: { item: Extract<UpcomingItem, { kind: 'node' }>; ctx: NodeCtx }) {
  const { node } = item
  const Title = ctx.interactive ? 'span' : 'h3'
  const selected = ctx.selectedId === node.id
  const inChain = ctx.chainIndex.has(node.id)
  const common = {
    interactive: ctx.interactive,
    pressed: selected,
    onPick: () => ctx.onPick(node.id),
  }
  const state = `${inChain ? ' is-chain' : ''}${selected ? ' is-selected' : ''}`

  let card: React.ReactNode
  if (node.type === 'obstacle') {
    const opens = item.opensTitle
      ? item.opensTitle === 'маяк'
        ? 'открывает маяк'
        : `открывает «${item.opensTitle}»`
      : node.opens
        ? `открывает «${node.opens}» — такого блока нет`
        : 'ничего не открывает'
    card = (
      <Pick {...common} className={`pm-card pm-obstacle${state}`}>
        <span className="pm-stripes" aria-hidden="true" />
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
          <span className="pm-obstacle-opens">{opens}</span>
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
  return (
    <div className="pm-col" data-active={active || undefined} data-dimmed={dimmed || undefined}>
      <div className="pm-track-label">
        <span className="pm-dot" style={{ background: track.color }} aria-hidden="true" />
        {track.title}
      </div>
      <Seg
        kind={
          !top || top.kind === 'collapsed' || top.node.type === 'fog' ? 'edges' : lookOfItem(top)
        }
      />
      {topDown.map((item, i) => {
        const lower = topDown[i + 1]
        const id = item.kind === 'node' ? item.node.id : `collapsed-${i}`
        const breaksHere =
          breakShownAt !== null &&
          (item.kind === 'node'
            ? item.node.id === breakShownAt
            : item.nodes.some((n) => n.id === breakShownAt))
        return (
          <Fragment key={id}>
            {check && breaksHere ? <BreakAbove check={check} /> : null}
            {item.kind === 'node' ? (
              <NodeCard item={item} ctx={ctx} />
            ) : (
              <CollapsedFog nodes={item.nodes} ctx={ctx} />
            )}
            {lower ? <Seg kind={between(item, lower)} /> : null}
          </Fragment>
        )
      })}
      <Seg kind="lit" />
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
  const bars = Math.max(view.focusLimit, view.focusCount)
  return (
    <aside id="pm-roadside" aria-label="Обочина" className="pm-aside">
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
    </aside>
  )
}

export function PathMapScreen({
  view,
  checks,
  warnings,
}: {
  view: MapView
  checks: Record<string, PathCheck>
  warnings: string[]
}) {
  const [mode, setMode] = useState<Mode>('map')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTrack, setActiveTrack] = useState<string | null>(view.focus[0]?.id ?? null)
  const panelRef = useRef<HTMLElement | null>(null)

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
  }

  const ctx: NodeCtx = { interactive: checking, selectedId, chainIndex, brokenAt, onPick }
  const columns = { '--pm-cols': view.focus.length } as React.CSSProperties
  const roadsideCount = view.roadsideTracks.length
  const looseCount = view.roadsideStations.length

  return (
    <div className="pm-page" data-mode={mode}>
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
          <button type="button" aria-pressed={!checking} onClick={() => switchMode('map')}>
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
        </div>
        <div className="pm-header-end" />
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

      <div className="pm-body">
        <main className="pm-main">
          <section aria-label="Маяк" className="pm-beacon">
            <LighthouseMark />
            <span className="pm-beacon-copy">
              <span className="pm-eyebrow">Маяк</span>
              <h1 className="pm-beacon-title">{view.beacon.title}</h1>
              {view.beacon.why ? (
                <span className="pm-beacon-why">
                  <b>Зачем:</b> {view.beacon.why}
                </span>
              ) : null}
            </span>
          </section>

          <div className="pm-mobile-nav">
            <div role="group" aria-label="Треки в фокусе" className="pm-tabs">
              {view.focus.map((track) => (
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

          <ConvergingRoads view={view} chainTracks={chainTracks} check={selected} />

          <div className="pm-grid" style={columns}>
            {view.focus.map((track) => (
              <TrackColumn
                key={track.id}
                track={track}
                active={activeTrack === track.id}
                dimmed={Boolean(selected) && !chainTracks.has(track.id)}
                ctx={ctx}
                check={selected && chainTracks.has(track.id) ? selected : null}
              />
            ))}
          </div>

          <div className="pm-here">
            <span className="pm-here-line" aria-hidden="true" />
            <span className="pm-here-pill">
              <PinIcon />
              <span>Мы здесь</span>
            </span>
            <span className="pm-here-line pm-here-line--right" aria-hidden="true" />
          </div>

          <div className="pm-grid" style={columns}>
            {view.focus.map((track) => (
              <PassedColumn
                key={track.id}
                track={track}
                active={activeTrack === track.id}
                ctx={ctx}
                check={selected && chainTracks.has(track.id) ? selected : null}
              />
            ))}
          </div>
          <p className="pm-passed-caption">
            Пройденный путь{view.started ? ` · старт ${shortDate(view.started)}` : ''}
          </p>
        </main>

        {checking ? (
          <CheckPanel view={view} selected={selected} panelRef={panelRef} />
        ) : (
          <RoadsidePanel view={view} />
        )}
      </div>
    </div>
  )
}
