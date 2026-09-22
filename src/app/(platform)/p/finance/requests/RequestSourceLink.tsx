'use client'

import { ExternalLinkIcon } from 'lucide-react'

import type { RequestBoardItem } from './request-board-contract'

/**
 * «ИСТОЧНИК» — the one control that leaves this portal (#517).
 *
 * WHAT IT IS FOR. A request is typed somewhere before it reaches the intake —
 * a Mattermost post, a ticket, a message — and «где это обсуждали» is the
 * question the record could not answer until `source_ref` was allowed on a
 * `request` (revised EARS-503). The URL is resolved on the SERVER
 * (`sourceRefToUrl`); this component only renders what it was handed.
 *
 * THREE STATES, AND TWO OF THEM RENDER NOTHING.
 *
 *  - no ref at all — nothing. Not «—», not a disabled icon: a register that
 *    printed a dash per row for a field most rows legitimately lack would add
 *    a column of noise to say «nothing here».
 *  - a ref the resolver could not turn into a URL (an unknown source system, a
 *    stand with no Mattermost origin configured) — the ref as TEXT in the
 *    sheet, nothing in the compact cell. A dead link is a worse answer than an
 *    honest identifier.
 *  - a resolved URL — a link, opened in a NEW TAB. Leaving the register to read
 *    a post and coming back to a lost scroll position is the behaviour this
 *    avoids; `rel="noopener noreferrer"` is what makes `target="_blank"` safe.
 *
 * The compact form carries an accessible name and a `title`, because a bare
 * icon in a table cell has neither otherwise.
 */
export function RequestSourceLink({
  request,
  compact = false,
}: {
  request: RequestBoardItem
  compact?: boolean
}) {
  const label = request.sourceLabel ?? request.sourceRef
  if (request.sourceUrl === null) {
    if (compact || request.sourceRef === null) return null
    return <span className="text-muted-foreground">{request.sourceRef}</span>
  }
  const name = `Открыть источник заявки №${request.id}${label === null ? '' : ` (${label})`}`
  return (
    <a
      href={request.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={name}
      aria-label={compact ? name : undefined}
      className="inline-flex items-center gap-1 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:opacity-70"
    >
      {compact ? null : <span>{label}</span>}
      <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  )
}
