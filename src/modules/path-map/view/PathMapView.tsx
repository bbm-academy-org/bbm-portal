import React from 'react'

import { buildMapView, checkPath } from '@/lib/path-map/derive'
import type { ParseResult } from '@/lib/path-map/parse'

import { LighthouseIcon, LighthouseMark } from './icons'
import { PathMapScreen } from './PathMapScreen'

/**
 * `/p/path` body (#530) — picks the state the parsed file is in and hands the
 * interactive screen everything precomputed: the track layout AND the path
 * check of every node, so the client half needs no parser, no `fs` and no
 * re-derivation of rules that are unit-tested on the server side.
 *
 * States: invalid file → the error list (the map is not drawn from a file it
 * could not read); no tracks → the empty state (beacon + where to add one);
 * otherwise the map.
 */
export function PathMapView({ result, file }: { result: ParseResult; file: string }) {
  if (!result.ok) {
    return (
      <div className="pm-page pm-page--state">
        <header className="pm-header">
          <div className="pm-brand">
            <LighthouseIcon />
            <span className="pm-brand-name">Карта пути</span>
          </div>
        </header>
        <main className="pm-state">
          <section role="alert" className="pm-error">
            <h1 className="pm-error-title">Карту не удалось прочитать</h1>
            <p className="pm-error-lead">
              В файле <code>{file}</code> есть ошибки — карта не рисуется, пока они не исправлены:
            </p>
            <ul className="pm-error-list">
              {result.errors.map((error, i) => (
                // Two errors may read the same; the position keeps the keys unique.
                <li key={`${i}:${error}`}>
                  <code>{error}</code>
                </li>
              ))}
            </ul>
            <p className="pm-error-hint">
              Формат описан в первых строках файла и в <code>content/path-map/README.md</code>.
            </p>
          </section>
        </main>
      </div>
    )
  }

  const view = buildMapView(result.map)

  if (view.empty) {
    return (
      <div className="pm-page pm-page--state">
        <header className="pm-header">
          <div className="pm-brand">
            <LighthouseIcon />
            <span className="pm-brand-name">Карта пути</span>
            <span className="pm-sep" aria-hidden="true" />
            <span className="pm-map-title">{view.title}</span>
          </div>
        </header>
        <main className="pm-state">
          <section aria-label="Маяк" className="pm-beacon">
            <span className="pm-eyebrow">Маяк</span>
            <h1 className="pm-beacon-title">{view.beacon.title}</h1>
            {view.beacon.why ? (
              <p className="pm-beacon-why">
                <b>Зачем:</b> {view.beacon.why}
              </p>
            ) : null}
            <LighthouseMark />
          </section>
          <div className="pm-empty-road" aria-hidden="true" />
          <p className="pm-empty-text">
            Карта пуста — добавьте трек в файл <code>{file}</code>
          </p>
        </main>
      </div>
    )
  }

  const checks = Object.fromEntries(
    result.map.tracks.flatMap((track) =>
      track.nodes.map((node) => [node.id, checkPath(result.map, node.id)] as const),
    ),
  )

  return <PathMapScreen view={view} checks={checks} warnings={result.warnings} />
}
