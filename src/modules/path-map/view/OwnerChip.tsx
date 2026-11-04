import React from 'react'

import { ownerColor, ownerInitials } from './labels'

/**
 * The owner chip (#538): a fixed circle with 1–2 initials, the full name in
 * `title` (hover) and in the accessible name. `withName` also prints the full
 * name next to the circle — for the places with room for it (the «Что внутри»
 * header, task rows); the barrier card keeps the circle alone.
 */
export function OwnerChip({ owner, withName = false }: { owner: string; withName?: boolean }) {
  const disc = (
    <span className="pm-owner" style={{ background: ownerColor(owner) }} title={owner}>
      {withName ? null : <span className="pm-sr">исполнитель {owner}</span>}
      <span aria-hidden="true">{ownerInitials(owner)}</span>
    </span>
  )
  if (!withName) return disc
  return (
    <span className="pm-owner-named">
      {disc}
      <span className="pm-owner-name">
        <span className="pm-sr">исполнитель </span>
        {owner}
      </span>
    </span>
  )
}
