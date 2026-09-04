'use client'

import React from 'react'

import { Badge } from '@/ui/badge'
import { cn } from '@/ui/utils'

import { formatDate } from './constants'
import type { RequestBoardItem } from './request-board-contract'
import { canDragRequest, formatRequestMoney, requestCardFlags } from './request-board-model'

/**
 * One intake item on the board.
 *
 * COMPOSITION. The wireframe puts the AMOUNT first and largest, and everything
 * else under it in one falling weight — that is the reading order of a person
 * deciding whether to open the card, and it is kept: money, what it is for,
 * who and where, then the flags that would change the decision.
 *
 * IT IS A CONTROL, so it carries a control's states — the kit's `cursor-pointer`
 * base rule reaches it through `data-bbm-ui`, and hover / focus-visible are
 * written here because a `<div role="button">` gets neither for free. Keyboard
 * opens it with Enter and Space, which is what makes the board usable without a
 * pointer at all: dragging is an ACCELERATOR here, never the only way to act
 * (every act also lives in the sheet).
 */
export function RequestCard({
  request,
  precision,
  canApprove,
  onOpen,
}: {
  request: RequestBoardItem
  precision: number
  canApprove: boolean
  onOpen: () => void
}) {
  const draggable = canDragRequest(request, canApprove)
  const flags = requestCardFlags(request)
  const money = formatRequestMoney(request.amount, request.currency, precision)

  return (
    // interaction-states-ok: the hover and focus-visible treatments are on this
    // element's own className below; it is a role="button" div because the whole
    // card is the target, and a kit Button cannot carry a four-line body.
    <div
      role="button"
      tabIndex={0}
      aria-label={`Заявка №${request.id} — ${money}`}
      draggable={draggable}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', String(request.id))
        event.dataTransfer.effectAllowed = 'move'
      }}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-left shadow-xs transition-colors',
        'hover:border-ring hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        request.status === 'posted' || request.status === 'refused'
          ? 'bg-muted/40 text-muted-foreground'
          : undefined,
      )}
    >
      <span className="font-heading text-base font-semibold tracking-tight tabular-nums">
        {money}
      </span>
      {request.note ? <span className="text-sm text-foreground">{request.note}</span> : null}
      <span className="text-xs text-muted-foreground">
        {[request.createdByName, request.project.name, request.product?.name]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {/* A pre-spend request has no money date (EARS-533) and the card says so
          in words — printing «—» where a date belongs would read as a value. */}
      <span className="text-xs text-muted-foreground">
        {request.status === 'posted' && request.operation
          ? `операция в реестре · ${formatDate(request.operation.occurredOn)}`
          : request.occurredOn === null
            ? 'деньги ещё не двигались'
            : formatDate(request.occurredOn)}
      </span>
      {request.refusalReason ? (
        <span className="text-xs text-muted-foreground">
          {request.decidedByName ? `${request.decidedByName}: ` : ''}«{request.refusalReason}»
        </span>
      ) : null}
      {flags.length > 0 ? (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {flags.map((flag) => (
            <Badge
              key={flag.id}
              variant={flag.tone === 'warning' ? 'destructive' : 'outline'}
              className="text-[11px]"
            >
              {flag.label}
            </Badge>
          ))}
        </span>
      ) : null}
    </div>
  )
}
