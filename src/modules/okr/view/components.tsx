import React from 'react'
import { TEAM } from '@/lib/okr'
import type { Health, OkrAction, OkrKr, OkrObjective, StateGroup } from '@/lib/okr'

/**
 * Server-rendered pieces of the OKR dashboard, ported from the static
 * prototype (deploy/index.html). KR expansion is native <details>/<summary> —
 * the page ships zero client JS.
 */

export const HEALTH_META: Record<
  Health,
  { fill: string; bg: string; ink: string; dot: string; label: string }
> = {
  on: {
    fill: 'var(--accent)',
    bg: 'var(--status-pos-bg)',
    ink: 'var(--status-pos-ink)',
    dot: 'var(--status-pos-dot)',
    label: 'в графике',
  },
  risk: {
    fill: '#e0a100',
    bg: 'var(--status-warn-bg)',
    ink: 'var(--status-warn-ink)',
    dot: 'var(--status-warn-dot)',
    label: 'под риском',
  },
  behind: { fill: '#c25e00', bg: '#f7dfb8', ink: '#6e4400', dot: '#c25e00', label: 'отстаём' },
  undef: {
    fill: 'var(--ink-3)',
    bg: 'var(--status-neutral-bg)',
    ink: 'var(--status-neutral-ink)',
    dot: 'var(--status-neutral-dot)',
    label: 'не определено',
  },
  q4: {
    fill: 'var(--accent-2)',
    bg: 'var(--accent-2-soft)',
    ink: 'var(--accent-2-ink)',
    dot: 'var(--accent-2)',
    label: 'цель на IV квартал',
  },
}

export function Badge({ health, text, small }: { health: Health; text?: string; small?: boolean }) {
  const m = HEALTH_META[health]
  return (
    <span
      className={`okr-badge${small ? ' okr-kr__badge' : ''}`}
      style={{ background: m.bg, color: m.ink }}
    >
      <i style={{ background: m.dot }} />
      {text ?? m.label}
    </span>
  )
}

export function Bar({
  pct,
  color,
  variant,
}: {
  pct: number | null
  color: string
  variant: 'hero' | 'card' | 'mini' | 'act'
}) {
  const width = pct == null ? 0 : Math.round(pct * 10) / 10
  return (
    <div className={`okr-bar okr-bar--${variant}`}>
      {width > 0 && (
        <div className="okr-bar__fill" style={{ width: `${width}%`, background: color }} />
      )}
    </div>
  )
}

/**
 * The only way out of the dashboard into Plane (spec 075 req.2). Row titles are
 * plain text so that a click anywhere on a row toggles it instead of
 * navigating; the jump is this explicit icon. Inside a <summary> the anchor is
 * the click's activation target, so following it does not also toggle the row.
 *
 * The name is deliberately context-free: the accessible name of the enclosing
 * <summary>/<h2> is computed from its contents and already includes this
 * label, so spelling the row title out here made a screen reader announce the
 * title twice. `title` matches the accessible name so hover and SR agree.
 */
function PlaneLink({ href }: { href: string }) {
  return (
    <a
      className="okr-ext"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Открыть в Plane"
      title="Открыть в Plane"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.2 7.8 8 4" />
          <path d="M5 4h3v3" />
        </g>
      </svg>
    </a>
  )
}

/** Geometry-exact chevron: an SVG centred in the first text line of the row —
 * a font glyph's optical centre is metric-dependent and cannot be aligned in
 * both the collapsed and the rotated state (spec 075 req.4). */
function Chevron({ hidden }: { hidden?: boolean }) {
  return (
    <span
      className="okr-kr__chev"
      aria-hidden="true"
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      <svg viewBox="0 0 12 12" focusable="false">
        <path
          d="M4.6 2.6 8 6l-3.4 3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function LeadChip({ leadId }: { leadId: string | null }) {
  const member = leadId ? TEAM[leadId] : undefined
  if (!member) return null
  return (
    <span className="okr-av" title={`${member.name} · ${member.role}`}>
      {member.initials}
    </span>
  )
}

/**
 * The action row names its own Plane state (spec 077 req.2). Three values, not
 * two: a Todo issue labelled «в работе» was the same kind of lie as the one
 * that opened #77. `cancelled` never reaches the view — the mapper drops it
 * from the tree — but the map stays total so a new group cannot slip through.
 */
const ACTION_STATE: Record<StateGroup, { mod: string; label: string }> = {
  completed: { mod: 'done', label: '✓ готово' },
  started: { mod: 'started', label: '◐ в работе' },
  unstarted: { mod: 'todo', label: '○ не начато' },
  backlog: { mod: 'todo', label: '○ не начато' },
  cancelled: { mod: 'todo', label: '⊘ отменено' },
}

function ActionRow({ action }: { action: OkrAction }) {
  // The counter includes the action itself (spec 077 req.3), so `total` is
  // never 0: sub-tasks — not the counter — decide whether a counter is shown.
  // The guard keeps that invariant from being load-bearing across two files.
  const hasTasks = action.tasks.length > 0
  const pct = action.total > 0 ? (action.done / action.total) * 100 : 0
  const state = ACTION_STATE[action.stateGroup]
  return (
    <div className="okr-act">
      <span className="okr-act__t">
        {action.title}
        <PlaneLink href={action.planeUrl} />
      </span>
      {/* One wrappable unit, like `.okr-kr__meta` on the KR row above: chip,
          counter and the 64px bar travel to a second line together instead of
          being clipped by `.okr-card{overflow:hidden}` (spec 077 req.7). */}
      <span className="okr-act__meta">
        <span className={`okr-act__state okr-act__state--${state.mod}`}>{state.label}</span>
        {hasTasks && (
          <>
            <span className="okr-act__c">
              {action.done}/{action.total}
            </span>
            <span className="okr-act__bar">
              <Bar pct={pct} color="var(--accent)" variant="act" />
            </span>
          </>
        )}
      </span>
    </div>
  )
}

function KrRight({ kr }: { kr: OkrKr }) {
  if (kr.q4) return <Badge health="q4" small />
  if (kr.note) return <Badge health="undef" text={kr.note} small />
  if (kr.pct == null) return <Badge health="undef" small />
  const m = HEALTH_META[kr.health]
  const value =
    kr.pctSource === 'metric' && kr.metric
      ? `${kr.metric.current} / ${kr.metric.target}`
      : `${Math.round(kr.pct)}%`
  return (
    <>
      <span className="okr-kr__v">{value}</span>
      <span className="okr-kr__bar">
        <Bar pct={kr.pct} color={m.fill} variant="mini" />
      </span>
    </>
  )
}

export function KrRow({ kr }: { kr: OkrKr }) {
  // «подготовка d/t» when a metric-KR runs in execution mode; plain d/t for execution-KRs.
  const counter =
    kr.counts && kr.note
      ? `подготовка ${kr.counts.done}/${kr.counts.total}`
      : kr.counts && kr.pctSource === 'execution'
        ? `${kr.counts.done}/${kr.counts.total}`
        : null

  const head = (
    <>
      {/* chevron + title share a top-aligned box so the chevron tracks the
          first line of a wrapping title, not the middle of the whole row. */}
      <span className="okr-kr__main">
        <Chevron hidden={kr.actions.length === 0} />
        <span className="okr-kr__t">
          {kr.title}
          <PlaneLink href={kr.planeUrl} />
        </span>
      </span>
      {/* One wrappable unit for everything nowrap or fixed-width (lead chip,
          counter, value, 88px bar, badge): the row is a single-line flex with a
          ~460px floor, so the cluster has to travel to a second line as a whole
          rather than be clipped by `.okr-card{overflow:hidden}` (spec 075
          scenario 6). Geometry on one line is unchanged — same gap, same order. */}
      <span className="okr-kr__meta">
        <LeadChip leadId={kr.leadId} />
        {counter && <span className="okr-kr__n">{counter}</span>}
        <KrRight kr={kr} />
      </span>
    </>
  )

  if (kr.actions.length === 0) {
    return (
      <div className="okr-kr">
        <div className="okr-kr__head">{head}</div>
      </div>
    )
  }
  return (
    <details className="okr-kr">
      <summary className="okr-kr__head">{head}</summary>
      <div className="okr-acts__in">
        {kr.actions.map((a) => (
          <ActionRow key={a.id} action={a} />
        ))}
      </div>
    </details>
  )
}

export function ObjectiveCard({ objective, wide }: { objective: OkrObjective; wide?: boolean }) {
  const missionClass =
    objective.mission === 'social'
      ? 'okr-card--soc'
      : objective.mission === 'business'
        ? 'okr-card--biz'
        : ''

  if (objective.krs.length === 0) {
    return (
      <article className={`okr-card okr-card--soon ${missionClass}`}>
        <div className="okr-card__head">
          <div className="okr-card__row">
            <Badge health="undef" text={objective.note ?? 'KR не заданы'} />
          </div>
          <h2 className="okr-card__t" style={{ marginBottom: 0 }}>
            {objective.title}
            <PlaneLink href={objective.planeUrl} />
          </h2>
          <p className="okr-soon-note">
            Key Results ещё не сформулированы. Objective не входит в общий прогресс цели.
          </p>
        </div>
      </article>
    )
  }

  const m = HEALTH_META[objective.health]
  return (
    <article className={`okr-card ${missionClass}`}>
      <div className="okr-card__head">
        <div className="okr-card__row">
          <span className="okr-card__flags">
            {wide && <span className="okr-tag">На стыке обеих миссий</span>}
            <Badge health={objective.health} />
          </span>
        </div>
        <h2 className="okr-card__t">
          {objective.title}
          <PlaneLink href={objective.planeUrl} />
        </h2>
        {objective.pct != null && (
          <div className="okr-card__prog">
            <Bar pct={objective.pct} color={m.fill} variant="card" />
            <span className="okr-card__pct">{Math.round(objective.pct)}%</span>
          </div>
        )}
      </div>
      <div className="okr-card__body">
        {objective.krs.map((kr) => (
          <KrRow key={kr.krId} kr={kr} />
        ))}
      </div>
    </article>
  )
}
