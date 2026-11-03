import React from 'react'

import './path-map-source-notice.css'

/**
 * The two small source notices of `/p/path` (#533), kept out of the map's view
 * components on purpose (#532 reshapes those in parallel):
 *
 *   - the local design example is on screen, not the team's live map;
 *   - GitHub failed and the last good copy is shown — its data may be stale.
 *
 * A fresh live map renders nothing.
 */

const TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
})

export function PathMapSourceNotice({
  origin,
  stale,
  asOf,
}: {
  origin: 'github' | 'local'
  stale: boolean
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
        Данные могли устареть: GitHub сейчас не отвечает, показана копия от{' '}
        {TIME.format(new Date(asOf))} МСК.
      </p>
    )
  }
  return null
}
