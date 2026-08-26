import React from 'react'

import { auth } from '@/auth'
import { hasClaim } from '@/lib/platform/authGate'
import type { LauncherTile } from '@/lib/workspace'
import { buildLauncherView, WORKSPACE_REGISTRY } from '@/lib/workspace'
import { AppTile, Container, PageHeader, TileGrid } from '@/ui'

/**
 * `/p` — the workspace home (spec 311 EARS-422), built to
 * `design-source/p-launcher.html` (option `launcher-a`, owner pick 2026-08-25).
 *
 * ONE FLAT GRID in registry order — no grouping, no search, no pinning, no
 * personalised ordering. This file holds NO list of apps: every name, every
 * href and every caption on this screen comes from `WORKSPACE_REGISTRY`
 * (EARS-402, D-2). Grep this file for the name of any app in the portfolio and
 * you find nothing — that absence is the whole point, it is what makes the tenth
 * app cost what the third did, and `tests/unit/workspace-registry.spec.ts`
 * asserts it rather than trusting it.
 *
 * THE STATES THE VENDORED WIREFRAME DOES NOT DEPICT (its own header lists them),
 * and what happens in each:
 *
 * - **hover / focus-visible** — the kit's, not this screen's: `AppTile` derives
 *   both from the palette (`src/ui/README.md` §3). The design has no colour to
 *   signal with, so neither does the tile.
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
 * - **narrow** — the grid is `auto-fill` at a minimum column width and the top
 *   bar wraps (both in the kit, `src/ui/README.md` §§1–2, EARS-428).
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
 * The vendored file draws a foot rule on every INTERNAL tile: a live pulse where
 * the module publishes one, and this dashed line where it does not — the tile it
 * draws that way is the cabinet's, which declares no provider. External and
 * placeholder tiles have no foot at all.
 *
 * A provider that failed lands here too (EARS-407): «no line» is what the member
 * sees either way, and the tile keeps the height its neighbours have.
 */
const EMPTY_STATUS = '— без статус-строки —'

/**
 * One tile.
 *
 * The registry gives an entry ONE description; what the tile's description slot
 * means is the tile FORM's business, exactly as the wireframe draws it: the
 * admin tile's slot holds its «только администратор» flag, a placeholder's holds
 * its «портфель, позже» caption, and a normal tile's holds the phrase saying
 * what the app is for. That is why the copy is passed rather than defaulted —
 * the kit owns the shape of the slot, the registry owns the words in it.
 */
function Tile({ tile }: { tile: LauncherTile }) {
  const common = { name: tile.name, href: tile.href, variant: tile.form }

  switch (tile.form) {
    case 'planned':
      return <AppTile {...common} plannedLabel={tile.description} />
    case 'admin':
      return (
        <AppTile
          {...common}
          adminLabel={tile.description}
          status={tile.status}
          emptyStatus={EMPTY_STATUS}
        />
      )
    case 'external':
      return <AppTile {...common} description={tile.description} />
    default:
      return (
        <AppTile
          {...common}
          description={tile.description}
          status={tile.status}
          emptyStatus={EMPTY_STATUS}
        />
      )
  }
}

export default async function WorkspaceHomePage() {
  const session = await auth()
  const tiles = await buildLauncherView(WORKSPACE_REGISTRY, (claim) => hasClaim(session, claim))

  return (
    <Container as="main">
      <PageHeader
        title="Рабочее пространство BBM"
        subtitle={`Всё, что открыто для вас сегодня. ${todayLabel()}.`}
      />
      {tiles.length > 0 ? (
        <TileGrid>
          {tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </TileGrid>
      ) : (
        <p>Пока здесь ничего не открыто.</p>
      )}
    </Container>
  )
}
