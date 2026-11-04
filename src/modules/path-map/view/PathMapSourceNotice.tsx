import React from 'react'

import type { PathMapOrigin, PathMapReadFailureKind } from '@/lib/path-map/source'

import './path-map-source-notice.css'

/**
 * The two small source notices of `/p/path` (#533), kept out of the map's view
 * components on purpose (#532 reshapes those in parallel):
 *
 *   - the local design example is on screen, not the team's live map;
 *   - GitHub failed and the last good copy is shown — its data may be stale,
 *     and the notice says why by kind (no access / not found / rate limit /
 *     GitHub down), so an expired token is not passed off as an outage.
 *
 * A fresh live map renders nothing.
 */

const TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
})

/** Why the last refresh failed, by kind (#534 review) — an expired token is not «GitHub is down». */
const STALE_CAUSE: Record<PathMapReadFailureKind, string> = {
  auth: 'нет доступа к репозиторию карт — проверьте токен на сервере (PATH_MAPS_GITHUB_TOKEN)',
  'not-found': 'файл карты не найден в репозитории — проверьте PATH_MAPS_FILE и доступ токена',
  'rate-limit': 'превышен лимит запросов к GitHub',
  network: 'GitHub сейчас не отвечает',
  config: 'источник карты настроен неверно — проверьте PATH_MAPS_REPO / PATH_MAPS_FILE',
  local: 'пример карты не прочитан',
}

export function PathMapSourceNotice({
  origin,
  stale,
  staleReason,
  asOf,
}: {
  origin: PathMapOrigin['kind']
  stale: boolean
  staleReason?: PathMapReadFailureKind
  asOf: string
}) {
  if (origin === 'local') {
    return (
      <p role="status" className="pm-source-note">
        Показан пример карты из кода портала — это не рабочая карта команды.
      </p>
    )
  }
  if (stale) {
    return (
      <p role="status" className="pm-source-note pm-source-note--stale">
        Данные могли устареть: {STALE_CAUSE[staleReason ?? 'network']}, показана копия от{' '}
        {TIME.format(new Date(asOf))} МСК.
      </p>
    )
  }
  return null
}
