import React from 'react'

import type { PathMapReadFailureKind } from '@/lib/path-map/source'

import { LighthouseIcon } from './icons'

/**
 * `/p/path` when the map could not be READ (#534 review) — a revoked token,
 * a wrong path, GitHub down, a malformed `PATH_MAPS_*` env. Unlike the map
 * view's invalid-file state (`PathMapView`), the file itself may be fine, so
 * this never says it «has errors» or points at its format: each kind names
 * what went wrong and where the fix is. A sibling of `PathMapView` so the map's
 * own view files (reshaped by #532) stay untouched; it reuses their
 * `pm-page` / `pm-error` classes.
 */

const COPY: Record<PathMapReadFailureKind, { title: string; next: string }> = {
  auth: {
    title: 'Нет доступа к репозиторию карт',
    next:
      'Проверьте токен на сервере (PATH_MAPS_GITHUB_TOKEN): он мог истечь или быть отозван, ' +
      'или у него нет права Contents: read на этот репозиторий. Сам файл карты, скорее всего, в порядке.',
  },
  'not-found': {
    title: 'Файл карты не найден',
    next:
      'Проверьте на сервере PATH_MAPS_REPO, PATH_MAPS_FILE и PATH_MAPS_BRANCH и что файл есть по этому пути. ' +
      'GitHub отвечает «не найден» и тогда, когда токен не видит репозиторий.',
  },
  'rate-limit': {
    title: 'Превышен лимит запросов к GitHub',
    next: 'GitHub временно ограничил запросы портала — подождите и обновите страницу.',
  },
  network: {
    title: 'GitHub не отвечает',
    next: 'Обновите страницу через минуту. Если не проходит — проверьте, что сервер портала видит api.github.com.',
  },
  config: {
    title: 'Источник карты настроен неверно',
    next: 'Исправьте PATH_MAPS_REPO / PATH_MAPS_FILE в окружении сервера портала.',
  },
  local: {
    title: 'Пример карты не прочитан',
    next: 'Проверьте, что каталог content/path-map/ попал в сборку портала.',
  },
}

export function PathMapReadError({
  reason,
  message,
  file,
}: {
  reason: PathMapReadFailureKind
  message: string
  file: string
}) {
  const copy = COPY[reason]
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
          <h1 className="pm-error-title">{copy.title}</h1>
          <p className="pm-error-lead">
            Не удалось получить карту из <code>{file}</code>:
          </p>
          <ul className="pm-error-list">
            <li>
              <code>{message}</code>
            </li>
          </ul>
          <p className="pm-error-hint">{copy.next}</p>
        </section>
      </main>
    </div>
  )
}
