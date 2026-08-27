import { hoursWorkspaceEntry } from '@/lib/hours'
import { okrWorkspaceEntry } from '@/lib/okr'

import type { PlannedWorkspaceEntry, WorkspaceEntry } from './contract'

/**
 * THE COMPOSITION ROOT (spec 311 EARS-402, D-2).
 *
 * The one and only list of what this workspace contains. The `/p` launcher, the
 * top-bar app switcher and the `/p/admin` navigation each derive their contents
 * from THIS array and hold no list of their own — grep the three of them for an
 * app name and you find nothing.
 *
 * Discovery is explicit imports, not filesystem globbing (D-2): globbing is
 * webpack-specific, defeats the Next server bundle's static analysis, and makes
 * the registry's contents unknowable to a reviewer. The price is one import and
 * one array element per app — and EARS-403's test closes even that gap by
 * failing, by name, when a module declares an entry nobody registered.
 *
 * ORDER IS DISPLAY ORDER (EARS-422): one order over all entries, live apps
 * first and the `planned` placeholders last, exactly as
 * `design-source/p-launcher.html` draws them.
 */

/**
 * The caption every not-yet-live portfolio app carries (EARS-478). It is the
 * entry's `description`: the launcher puts an entry's description in the tile's
 * description slot whatever the tile's form is, and for a placeholder that slot
 * IS the caption the vendored file draws. One constant rather than six literals,
 * because six spellings of one caption is how they drift.
 */
export const PORTFOLIO_LATER = 'портфель, позже'

const planned = (name: string): PlannedWorkspaceEntry => ({
  kind: 'planned',
  name,
  description: PORTFOLIO_LATER,
})

export const WORKSPACE_REGISTRY: readonly WorkspaceEntry[] = [
  // ── live internal apps ────────────────────────────────────────────────────
  hoursWorkspaceEntry,
  okrWorkspaceEntry,

  // ── the frame's own cabinet (D-4) ─────────────────────────────────────────
  // Not a special case in the launcher: a registry entry like any other, which
  // is why the hybrid-visibility rule (EARS-404) is exercised by the frame's own
  // surface on day one. Its `description` is the flag the vendored file draws in
  // the tile's description slot.
  {
    kind: 'internal',
    slug: 'admin',
    name: 'Админка',
    description: 'только администратор',
    href: '/p/admin',
    icon: 'admin',
    requiredClaim: 'platform-admin',
  },

  // ── external tools (EARS-423) ─────────────────────────────────────────────
  {
    kind: 'external',
    slug: 'plane',
    name: 'Plane',
    description: 'Задачи и проекты',
    url: 'https://plane.bbm.academy',
    icon: 'plane',
  },
  {
    kind: 'external',
    slug: 'mattermost',
    name: 'Mattermost',
    description: 'Общение команды',
    // Confirmed by the owner (Антон, 2026-08-27, Stage-B acceptance of PR #354):
    // this is the team's Mattermost home. The origin exists in no repo document
    // (`.env.example` holds incoming-webhook URLs only, and those are secrets,
    // not a home page), so the owner's record here is its pin — every other
    // tool is pinned by a document (Plane by `PLANE_API_BASE_URL`, the
    // knowledge base by ADR-005 §1).
    url: 'https://chat.bbm.academy',
    icon: 'mattermost',
  },
  {
    kind: 'external',
    slug: 'kb',
    name: 'База знаний',
    description: 'Вики BBM',
    // ADR-005 §1: the knowledge base is its own surface, `kb.bbm.academy`,
    // behind oauth2-proxy against the same Zitadel. The portal links to it and
    // never re-renders its text.
    url: 'https://kb.bbm.academy',
    icon: 'kb',
  },

  // ── the target portfolio, not live yet (EARS-477, D-13a) ──────────────────
  // Consolidation spec §4 (revision -f) lists ten apps. Hours and OKR are live
  // `internal` entries above and Mattermost is a live `external` one, which
  // leaves seven — and управление задачами is served today by the Plane entry,
  // so it carries no placeholder. That is exactly these six, and exactly the six
  // the vendored file draws. Shipping one is a swap of ITS OWN element here.
  planned('Финансы'),
  planned('Колоды'),
  planned('CRM'),
  planned('Поиск команды'),
  planned('Запуск проекта'),
  planned('Калькуляторы'),
]
