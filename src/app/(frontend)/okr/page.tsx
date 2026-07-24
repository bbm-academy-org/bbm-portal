import React from 'react'
import { getOkrTree } from '@/lib/okr'
import type { Health, OkrTree } from '@/lib/okr'
import { Badge, Bar, HEALTH_META, ObjectiveCard } from './components'

// Every request goes through the module's own TTL snapshot (FR-6) — the page
// must never be statically built (a build without PLANE_API_TOKEN would fail
// or freeze stale data into the bundle).
export const dynamic = 'force-dynamic'

const LEGEND: Health[] = ['on', 'risk', 'behind', 'undef', 'q4']

function formatRu(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(iso))
}

function Hero({ tree }: { tree: OkrTree }) {
  return (
    <header className="okr-hero">
      <div className="okr-container">
        <div className="okr-hero__row">
          <span className="okr-overline">Северная звезда · OKR</span>
        </div>
        <h1 className="okr-hero__title">{tree.goalTitle}</h1>
        <div className="okr-hero__prog">
          <Bar pct={tree.pct} color="var(--accent)" variant="hero" />
          <span className="okr-hero__pct">{tree.pct == null ? '—' : `${Math.round(tree.pct)}%`}</span>
        </div>
        <div className="okr-hero__meta">
          <span>
            Горизонт: <span className="mono">OKR → 01.09.2026</span>
          </span>
          <span>
            Данные: Plane · обновлено <span className="mono">{formatRu(tree.asOf)} МСК</span>
          </span>
          <span className="okr-legend">
            {LEGEND.map((h) => (
              <span key={h}>
                <i style={{ background: HEALTH_META[h].dot }} />
                {HEALTH_META[h].label}
              </span>
            ))}
          </span>
        </div>
      </div>
    </header>
  )
}

export default async function OkrPage() {
  let tree: OkrTree
  try {
    tree = await getOkrTree()
  } catch {
    // FR-7: no cache to fall back to — a clear error, not an empty tree.
    return (
      <div>
        <header className="okr-hero">
          <div className="okr-container">
            <div className="okr-hero__row">
              <span className="okr-overline">Северная звезда · OKR</span>
            </div>
            <h1 className="okr-hero__title">Цель «Academy Doctor.School»</h1>
          </div>
        </header>
        <main className="okr-main">
          <div className="okr-container">
            <div className="okr-banner okr-banner--error" role="alert">
              Plane недоступен, а кэш ещё не наполнен — дерево OKR построить не из чего. Попробуйте
              обновить страницу через пару минут; если не помогает — проверьте PLANE_API_TOKEN и
              доступность plane.bbm.academy.
            </div>
          </div>
        </main>
      </div>
    )
  }

  const social = tree.objectives.filter((o) => o.mission === 'social')
  const business = tree.objectives.filter((o) => o.mission === 'business')
  const bridge = tree.objectives.filter((o) => o.mission === 'both')

  return (
    <div>
      <Hero tree={tree} />
      <main className="okr-main">
        <div className="okr-container">
          {tree.stale && (
            <div className="okr-banner okr-banner--warn" role="status">
              Plane сейчас недоступен — показан последний снапшот от {formatRu(tree.asOf)} МСК.
            </div>
          )}
          <div className="okr-lanes" style={{ marginTop: 'var(--gutter)' }}>
            <div className="okr-lane">
              <div className="okr-lane__h" style={{ background: 'var(--accent-soft)' }}>
                Социальная миссия
              </div>
              {social.map((o) => (
                <ObjectiveCard key={o.id} objective={o} />
              ))}
            </div>
            <div className="okr-lane">
              <div className="okr-lane__h" style={{ background: 'var(--accent-2-soft)' }}>
                Бизнес миссия
              </div>
              {business.map((o) => (
                <ObjectiveCard key={o.id} objective={o} />
              ))}
            </div>
          </div>
          <div className="okr-bridge">
            {bridge.map((o) => (
              <ObjectiveCard key={o.id} objective={o} wide />
            ))}
          </div>
          {(tree.offTreeNotes.length > 0 || tree.warnings.length > 0) && (
            <footer className="okr-foot">
              {tree.offTreeNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              {tree.warnings.length > 0 && (
                <>
                  <p>
                    <Badge health="undef" text="предупреждения данных" small />
                  </p>
                  <ul>
                    {tree.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
            </footer>
          )}
        </div>
      </main>
    </div>
  )
}
