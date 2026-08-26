import React from 'react'

import { auth } from '@/auth'
import { hasClaim } from '@/lib/platform/authGate'
import type { LauncherTile } from '@/lib/workspace'
import { buildLauncherView, WORKSPACE_REGISTRY } from '@/lib/workspace'
import { Badge } from '@/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { cn } from '@/ui/utils'

/**
 * `/p` — the workspace home (spec 311 EARS-422).
 *
 * TWO SOURCES, TWO HALVES (EARS-430, `design-source/README.md`):
 *
 * - **Layout** from `design-source/p-launcher.html` (option `launcher-a`, owner
 *   pick 2026-08-25), which is `fidelity: wireframe` — it fixes ONE FLAT GRID in
 *   registry order, no grouping, no search, no pinning, no personalised
 *   ordering, and which four tile forms exist (EARS-468). It fixes nothing about
 *   how any of it looks; its greys, dashes and borders are scaffolding.
 * - **Look** from the `system:` row at `fidelity: visual` — the default neutral
 *   theme of shadcn/ui via Refine's integration, owner Stage-A decision by Антон
 *   on 2026-08-26 (#360). Every element class on this screen is a `@/ui`
 *   primitive: `Card` for a tile, `Badge` for the external and admin marks. This
 *   file writes no colour, no radius and no shadow of its own — reading one off
 *   the wireframe is the 2026-08-26 incident this slice is the remedy for.
 *
 * This file holds NO list of apps: every name, every href and every caption on
 * this screen comes from `WORKSPACE_REGISTRY` (EARS-402, D-2). Grep this file
 * for the name of any app in the portfolio and you find nothing — that absence
 * is what makes the tenth app cost what the third did, and
 * `tests/unit/workspace-registry.spec.ts` asserts it rather than trusting it.
 *
 * THE STATES THE VENDORED WIREFRAME DOES NOT DEPICT (its own header lists them),
 * and what happens in each:
 *
 * - **hover** — a live tile lifts its surface to `bg-muted/50`; a placeholder
 *   does not react at all, because it is not a control. The theme's own hover
 *   value, not a colour chosen here.
 * - **focus-visible** — the theme's focus ring (`outline-ring`) on the tile
 *   itself, which is the anchor. A placeholder is not focusable (EARS-478), so
 *   it has no focus state to design.
 * - **loading** — there is none to design. This is a server component; the page
 *   is sent when it is complete, and the only thing that could make it wait is a
 *   module's status provider, which is bounded at one second and yields the
 *   tile's static form when it runs out (EARS-406/407, D-6). Streaming the lines
 *   in per tile is the better end state and is deferred by D-6, not forgotten.
 * - **error** — there is no error path left to render. A provider that rejects
 *   or hangs is absorbed by `resolveStatus`, one tile at a time (EARS-407); the
 *   registry itself is a typed import, so a broken registry is a build failure
 *   and never a runtime one; and the membership refusal above this page is
 *   deliberately bare (EARS-418, D-5).
 * - **empty** — structurally unreachable rather than merely unlikely: the
 *   `planned` placeholders carry no claim and are never filtered (EARS-478), so
 *   the grid always has tiles. The empty branch is still written, because
 *   «cannot happen» and «renders nothing at all» are one refactor apart.
 * - **denied** — an entry the session may not see is absent from the view model
 *   before markup exists (D-7), so it is absent from the response body. Nothing
 *   is rendered greyed-out or disabled: absence IS the treatment (EARS-404).
 * - **narrow** — the grid is `auto-fill` at a minimum column width and the bar
 *   wraps (EARS-428); the switcher is one collapsed control at every width.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Рабочее пространство · BBM',
}

/** «24 августа 2026» — `Intl` says «24 августа 2026 г.», and the design does not draw the «г.». */
export function todayLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  })
    .format(now)
    .replace(/\s*г\.$/, '')
}

/**
 * The wireframe draws a foot rule on every INTERNAL tile: the module's own line
 * where it publishes one, and this explicit «no line» where it does not — the
 * tile it draws that way is the cabinet's, which declares no provider.
 *
 * A provider that failed lands here too (EARS-407): «no line» is what the member
 * sees either way, and the tile keeps the height its neighbours have.
 */
const EMPTY_STATUS = '— без статус-строки —'

/** The tile surface, shared by all four forms so they are one element class. */
const TILE_CARD = 'h-full transition-colors'

/**
 * One tile.
 *
 * The registry gives an entry ONE description; what the description slot MEANS
 * is the tile form's business, exactly as the wireframe composes it: the admin
 * tile's slot holds its «только администратор» flag, a placeholder's holds its
 * «портфель, позже» caption, and a normal tile's holds the phrase saying what
 * the app is for.
 */
function Tile({ tile }: { tile: LauncherTile }) {
  const form = tile.form

  // «↗ внешний» is the FORM's mark and the only string on this screen the
  // registry does not supply — EARS-423 names it, and every entry of that form
  // carries it. The admin flag is the opposite case: it is that entry's own
  // description («только администратор»), promoted from the description slot
  // into the mark because that is where the wireframe puts it.
  const mark =
    form === 'external' ? (
      <Badge variant="outline">↗ внешний</Badge>
    ) : form === 'admin' ? (
      <Badge variant="secondary">{tile.description}</Badge>
    ) : null

  const description = form === 'admin' ? null : tile.description

  const foot =
    form === 'planned' ? null : (
      <CardContent
        data-tile-status={tile.status ? 'line' : 'empty'}
        className={cn(
          'text-xs',
          tile.status ? 'text-muted-foreground' : 'text-muted-foreground/60',
        )}
      >
        {tile.status ?? EMPTY_STATUS}
      </CardContent>
    )

  const body = (
    <Card
      className={cn(
        TILE_CARD,
        form === 'planned'
          ? 'bg-muted/40 text-muted-foreground'
          : 'group-hover/tile:bg-muted/50 group-hover/tile:ring-foreground/20',
      )}
    >
      <CardHeader>
        <CardTitle data-tile-name>{tile.name}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {mark ? <CardAction>{mark}</CardAction> : null}
      </CardHeader>
      {foot}
    </Card>
  )

  // EARS-478: a placeholder is inert BY ELEMENT TYPE — a `div`, not a disabled
  // link. There is nothing to remember to switch off.
  if (form === 'planned') {
    return (
      <div data-tile data-tile-form="planned" className="block">
        {body}
      </div>
    )
  }

  return (
    <a
      data-tile
      data-tile-form={form}
      href={tile.href}
      {...(form === 'external' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group/tile block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {body}
    </a>
  )
}

export default async function WorkspaceHomePage() {
  const session = await auth()
  const tiles = await buildLauncherView(WORKSPACE_REGISTRY, (claim) => hasClaim(session, claim))

  return (
    <main data-bbm-ui className="min-h-[calc(100vh-3.25rem)] bg-background">
      <div className="mx-auto w-full max-w-[1160px] px-4 py-10 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Рабочее пространство BBM
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {`Всё, что открыто для вас сегодня. ${todayLabel()}.`}
        </p>

        {tiles.length > 0 ? (
          <div
            data-tile-grid
            className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]"
          >
            {tiles.map((tile) => (
              <Tile key={tile.key} tile={tile} />
            ))}
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">Пока здесь ничего не открыто.</p>
        )}
      </div>
    </main>
  )
}
