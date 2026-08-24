import React from 'react'

import type { TocEntry } from './toc'
import './rules.css'

/**
 * Оболочка поверхности `/p/model/rules` — макет «Документ с оглавлением»
 * (Stage-A пик владельца 2026-08-24, `design-source/p-model-rules.md`):
 * слева липкое оглавление из разделов документа, справа колонка ~720px,
 * на узком экране оглавление сворачивается наверх.
 *
 * Как и у соседних поверхностей группы `(platform)`, палитра объявлена на
 * корне модуля (`.rules-root`), а не на `:root`: фон холста красится точечно
 * через `body:has(.rules-root)` в `rules.css`, поэтому /p/hours и /p/okr
 * остаются ровно такими, какими были.
 */

/** ISO-дата паспорта → «11.08.2026». Без Intl: одна и та же строка на любом рантайме. */
export function passportDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

export interface Passport {
  commitSha: string
  commitDate: string
  sourcePath: string
}

export function RulesShell({
  toc,
  passport,
  children,
}: {
  toc: TocEntry[]
  passport: Passport
  children: React.ReactNode
}) {
  return (
    <div className="rules-root">
      <a className="rules-skip" href="#rules-document">
        К тексту документа
      </a>
      <div className="rules-grid">
        <nav className="rules-toc" aria-label="Разделы документа">
          <p className="rules-toc__label">Разделы</p>
          <ul className="rules-toc__list">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="rules-main" id="rules-document">
          <header className="rules-head">
            <h1 className="rules-title">Смарт-контракт BBM</h1>
            {/* Статус документа объявлен его мастером: драфт до двух гейтов —
                юридической проверки формулировок и подтверждения словаря и
                весов майнинга. Пометка стоит у заголовка, а не в подвале,
                чтобы её нельзя было не заметить, начав читать правила. */}
            <p className="rules-draft">
              <span className="rules-draft__pill">драфт</span>
              <span className="rules-draft__note">
                правила и формулы приняты; формулировки проходят юридическую проверку, словарь и
                веса — на подтверждении
              </span>
            </p>
          </header>

          {children}

          <footer className="rules-passport">
            {/* Паспорт версии: коммит САМОГО документа в мастере, а не HEAD
                bbm-kb на момент снятия. Читателю нужно знать, когда менялся
                этот текст. */}
            <span className="rules-passport__label">версия</span>{' '}
            <code className="rules-passport__sha">{passport.commitSha.slice(0, 7)}</code>{' '}
            <span className="rules-passport__dot">·</span> {passportDate(passport.commitDate)}
            <span className="rules-passport__source">
              снимок мастера <code>{passport.sourcePath}</code> (bbm-kb)
            </span>
          </footer>
        </main>
      </div>
    </div>
  )
}
