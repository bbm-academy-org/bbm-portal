/**
 * The workspace module plug-in contract (spec 311 EARS-401, D-1, D-3, D-10,
 * D-13a).
 *
 * This file holds TYPES and nothing else. It is the half of `src/lib/workspace`
 * a module may import: a module declares its own entry against these types and
 * exports it from its public API, and `pnpm boundaries` forbids that same module
 * from reaching the composition root next door (EARS-456) — a module must not be
 * able to read its neighbours.
 *
 * Why typed TypeScript rather than a JSON/YAML manifest (D-1): a manifest cannot
 * carry the status provider, which is a function; it would need a hand-kept
 * parallel type declaration, i.e. a second source of truth; and it is invisible
 * to `tsc` and to `pnpm boundaries`. Here a malformed registration is a build
 * failure.
 */

import type { ZodType } from 'zod'

/**
 * A stable icon reference (EARS-401). The vendored `design-source/p-launcher.html`
 * draws the tile's icon as an EMPTY swatch — there is no icon set in this design
 * yet — so the launcher renders no glyph in v1: the tile that
 * `src/app/(platform)/p/page.tsx` builds out of the kit's `Card` has no icon
 * slot at all. The reference is still declared, and required, because the entry
 * is the place that owns it: when the design gains icons, every live entry
 * already names one and no module is edited to catch up.
 */
export type WorkspaceIconRef = string

/**
 * A module's one-line pulse on its launcher tile («Период «август 2026» открыт
 * до 1 сентября»).
 *
 * Returning `null` is a legitimate answer meaning «nothing to say right now» —
 * the tile then renders in its static form, exactly as a rejection does
 * (EARS-407), because the member cannot tell the two apart and should not have
 * to. The launcher invokes every provider concurrently under a 1-second deadline
 * (EARS-406, D-6); a provider therefore may be slow without being wrong, but it
 * must never be the reason the home fails to render.
 */
export type WorkspaceStatusProvider = () => string | null | Promise<string | null>

/**
 * The operations a cabinet resource may support (EARS-437).
 *
 * Declared per resource rather than discovered, because the clause is about
 * what the SCREEN renders: «the cabinet shall omit an operation a resource does
 * not support from the screen entirely — no control that fails on click». An
 * operation absent from a resource's array gets no route in the shell, so there
 * is no control to remember to hide and none to disable.
 */
export const RESOURCE_OPERATIONS = ['list', 'show', 'create', 'edit', 'delete'] as const
export type ResourceOperation = (typeof RESOURCE_OPERATIONS)[number]

/** One CRUD resource of a module's cabinet section, mounted at `/p/admin/<slug>/<resource>` (D-9). */
export interface WorkspaceAdminResource {
  /** The route segment, and the module's own name for the resource. */
  name: string
  /** What the cabinet's navigation calls it. */
  label: string
  /**
   * The operations this resource supports, in the order the shell offers them
   * (EARS-437). An empty `create` is not «create is disabled» — it is «there is
   * no create screen and no button that could lead to one».
   */
  operations: readonly ResourceOperation[]
  /**
   * The MODULE's own zod schema for one record of this resource (EARS-436).
   *
   * It is carried on the declaration rather than registered twice because
   * «one schema typing the client and validating the handler» is only true if
   * there is literally one: the cabinet's data provider parses answers with
   * this object, and the module's route handler validates with the same one.
   * A second registration is the thing that drifts.
   */
  schema: ZodType
}

/** A module's cabinet presence (EARS-409). Absent means no presence at all (EARS-410). */
export interface WorkspaceAdminSection {
  /** What the cabinet's navigation group is called. */
  label: string
  resources: WorkspaceAdminResource[]
}

/** Fields no `external` and no `planned` entry may carry (D-10, D-13a). */
interface NoStatusNoAdmin {
  status?: never
  admin?: never
}

/**
 * A module that lives inside the portal: it has a slug, a route under `/p/`, and
 * may publish a pulse and a cabinet section.
 */
export interface InternalWorkspaceEntry extends Partial<Record<'url', never>> {
  kind: 'internal'
  /** ONE identifier used three times (D-9): module directory, `/p/admin/<slug>`, `/api/p/<slug>`. */
  slug: string
  name: string
  description: string
  /** Always under `/p/` — the workspace serves nothing else (EARS-401). */
  href: `/p${string}`
  icon: WorkspaceIconRef
  /** The extra claim this entry needs on top of `platform-user` (EARS-404). */
  requiredClaim?: string
  status?: WorkspaceStatusProvider
  admin?: WorkspaceAdminSection
}

/**
 * A tool that lives outside the portal (Plane, Mattermost, the knowledge base).
 *
 * It has no status provider and no cabinet section BY TYPE (D-10): «an external
 * link has no admin section» is a compile error here, not a runtime validation
 * with a message nobody reads.
 */
export interface ExternalWorkspaceEntry extends NoStatusNoAdmin, Partial<Record<'href', never>> {
  kind: 'external'
  slug: string
  name: string
  description: string
  /** Absolute URL. The launcher opens it in a new tab (EARS-423). */
  url: string
  icon: WorkspaceIconRef
  requiredClaim?: string
}

/**
 * A target-portfolio app that is not live yet (EARS-477, EARS-478, D-13a).
 *
 * A third variant of the SAME union rather than a second list, so the launcher,
 * the app switcher and the cabinet still hold zero lines naming an app, and
 * promoting a placeholder to a live app is an edit to its own entry in the
 * composition root and nowhere else. It carries a name and a description and
 * NOTHING else — «a planned app has a target» is a type error too.
 */
export interface PlannedWorkspaceEntry
  extends
    NoStatusNoAdmin,
    Partial<Record<'slug' | 'href' | 'url' | 'icon' | 'requiredClaim', never>> {
  kind: 'planned'
  name: string
  description: string
}

/** The discriminated union every registry entry is one of (EARS-401). */
export type WorkspaceEntry = InternalWorkspaceEntry | ExternalWorkspaceEntry | PlannedWorkspaceEntry

/** What a module exports from its public API (`src/lib/<module>/index.ts`), per ADR-002 §3. */
export type WorkspaceModule = InternalWorkspaceEntry | ExternalWorkspaceEntry

/** An entry a member can actually open — the two variants that carry a target. */
export type OpenableWorkspaceEntry = InternalWorkspaceEntry | ExternalWorkspaceEntry

/** Narrowing helper: does this entry have somewhere to go? */
export function isOpenable(entry: WorkspaceEntry): entry is OpenableWorkspaceEntry {
  return entry.kind !== 'planned'
}

/** Where an openable entry points. */
export function entryTarget(entry: OpenableWorkspaceEntry): string {
  return entry.kind === 'internal' ? entry.href : entry.url
}
