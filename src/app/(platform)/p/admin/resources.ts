import type { ResourceProps } from '@refinedev/core'
import type { ZodType } from 'zod'

import { PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'
import type { WorkspaceAdminSection, WorkspaceEntry } from '@/lib/workspace/contract'

/**
 * The cabinet's navigation tree, DERIVED from the registry (spec 311 EARS-402,
 * EARS-409, EARS-410, EARS-432, EARS-433, EARS-437, EARS-474; D-2, D-9).
 *
 * This file holds NO list of apps. Grep it for the name of any module in the
 * portfolio and you find nothing — every group, every item and every route on
 * the cabinet's sidebar comes from `WORKSPACE_REGISTRY`. That absence is what
 * makes the tenth module cost what the third did: shipping one is an edit to
 * its own entry in the composition root and zero lines here.
 *
 * IT LIVES IN THE ROUTE GROUP because it reads the registry, and EARS-457 lets
 * only `src/lib/workspace/**` and `src/app/(platform)/**` do that.
 */

/** The cabinet's route root. One spelling, used by the tree and the breadcrumb. */
export const CABINET_ROOT = '/p/admin'

/** What the cabinet calls itself — the first breadcrumb, and the shell's own name. */
export const CABINET_LABEL = 'Админка'

/** Refine's resource name for a module group and for one of its resources (D-9). */
export function groupName(slug: string): string {
  return slug
}
export function resourceName(slug: string, resource: string): string {
  return `${slug}.${resource}`
}

/** The section a Refine resource name belongs to — `finance.purposes` → `finance`. */
export function cabinetSectionSlugOf(name: string): string {
  const dot = name.indexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

/** One entry's cabinet section, or `null` for an entry that declares none (EARS-410). */
function sectionOf(entries: readonly WorkspaceEntry[], slug: string): WorkspaceAdminSection | null {
  for (const entry of entries) {
    if ((entry.kind !== 'internal' && entry.kind !== 'cabinet') || !entry.admin) continue
    if (entry.slug === slug) return entry.admin
  }
  return null
}

/**
 * WHO administers one cabinet section (EARS-462, EARS-466).
 *
 * `platform-admin` ALWAYS, plus whatever the section declared beside it
 * (`WorkspaceAdminSection.additionalClaims`) — so a declaration can only widen
 * a section and never lock the workspace administrator out of one. A slug that
 * names no section answers `platform-admin` alone: an unresolvable path must
 * not be an unguarded one.
 *
 * Every enforcement point of the cabinet reads THIS function: the shell's gate
 * (`layout.tsx`), the sidebar and the index of sections (below), and the
 * validation Server Function (`actions.ts`). The module's own HTTP handlers ask
 * the same question of the same declaration through `adminRoute`.
 */
export function cabinetSectionClaims(
  entries: readonly WorkspaceEntry[],
  slug: string,
): readonly string[] {
  return [PLATFORM_ADMIN_ROLE, ...(sectionOf(entries, slug)?.additionalClaims ?? [])]
}

/**
 * The claims that admit to a cabinet PATH.
 *
 * Inside a section (`/p/admin/<slug>/…`) it is that section's set. At the
 * cabinet root — and on any path that names no section — it is the UNION over
 * every declared section: `/p/admin` is an index of sections (EARS-434), and
 * refusing it to someone who administers one of them would leave them with a
 * breadcrumb that 403s and no way in but a typed URL.
 */
export function cabinetClaimsForPath(
  entries: readonly WorkspaceEntry[],
  pathname: string,
): readonly string[] {
  const inside = pathname.startsWith(`${CABINET_ROOT}/`)
    ? pathname.slice(CABINET_ROOT.length + 1).split('/')[0]
    : ''
  if (inside && sectionOf(entries, inside)) return cabinetSectionClaims(entries, inside)

  const claims = new Set<string>([PLATFORM_ADMIN_ROLE])
  for (const entry of entries) {
    if ((entry.kind !== 'internal' && entry.kind !== 'cabinet') || !entry.admin) continue
    for (const claim of entry.admin.additionalClaims ?? []) claims.add(claim)
  }
  return [...claims]
}

/** «May this viewer administer this section» — the predicate the two derivations take. */
export type CabinetAdmits = (slug: string) => boolean

/** One section of the cabinet's index (EARS-434), as the index screen needs it. */
export interface CabinetSection {
  slug: string
  label: string
  resources: WorkspaceAdminSection['resources']
}

/**
 * The sections of the cabinet the viewer may enter.
 *
 * The index screen and the sidebar are two renderings of ONE answer: an entry
 * the viewer cannot open is omitted rather than shown and refused on click
 * (EARS-437's rule, applied to the section itself). Omitting `admits` means «no
 * filtering» — the shape the breadcrumb needs, which derives labels and never
 * decides access.
 */
export function cabinetSections(
  entries: readonly WorkspaceEntry[],
  admits?: CabinetAdmits,
): CabinetSection[] {
  const sections: CabinetSection[] = []
  for (const entry of entries) {
    if ((entry.kind !== 'internal' && entry.kind !== 'cabinet') || !entry.admin) continue
    if (admits && !admits(entry.slug)) continue
    sections.push({ slug: entry.slug, label: entry.admin.label, resources: entry.admin.resources })
  }
  return sections
}

/**
 * The registry → Refine `resources[]` mapping.
 *
 * A module that declares an `admin` section produces a PARENT node carrying no
 * `list` — Refine renders a parent with no route as an expandable group, which
 * is EARS-433's «a real parent node with indented children» rather than a
 * heading over a flat list — followed by one child per resource, each naming
 * the parent through `meta.parent` (the owner's amendment (a) of 2026-08-25:
 * Refine's own multi-level menu model, no bespoke navigation).
 *
 * A module that declares none produces NOTHING: no group, no item, no route
 * (EARS-410). So do `external` entries and `planned` placeholders, by type.
 *
 * EARS-437 is the `operations` array doing its job: an action route exists only
 * where the resource declares the operation, so the shell has nothing to link
 * to and no control that could fail on click.
 */
export function cabinetResources(
  entries: readonly WorkspaceEntry[],
  admits?: CabinetAdmits,
): ResourceProps[] {
  const resources: ResourceProps[] = []

  for (const section of cabinetSections(entries, admits)) {
    resources.push({
      name: groupName(section.slug),
      meta: { label: section.label },
    })

    for (const resource of section.resources) {
      const base = `${CABINET_ROOT}/${section.slug}/${resource.name}`
      const ops = resource.operations
      resources.push({
        name: resourceName(section.slug, resource.name),
        ...(ops.includes('list') || ops.includes('singleton') ? { list: base } : {}),
        ...(ops.includes('show') ? { show: `${base}/show/:id` } : {}),
        ...(ops.includes('create') ? { create: `${base}/create` } : {}),
        ...(ops.includes('edit') ? { edit: `${base}/edit/:id` } : {}),
        meta: {
          label: resource.label,
          parent: groupName(section.slug),
          // Carried onto the meta so a screen can ask «may I offer this?»
          // without re-deriving it from the routes (EARS-437).
          operations: ops,
        },
      })
    }
  }

  return resources
}

/**
 * The resource-name → module-schema map the data provider parses with
 * (EARS-436). Keyed by the SAME name the tree uses, so a resource cannot be
 * navigable and unparseable at once.
 */
export function cabinetSchemas(entries: readonly WorkspaceEntry[]): Record<string, ZodType> {
  const schemas: Record<string, ZodType> = {}
  for (const entry of entries) {
    if ((entry.kind !== 'internal' && entry.kind !== 'cabinet') || !entry.admin) continue
    for (const resource of entry.admin.resources) {
      schemas[resourceName(entry.slug, resource.name)] = resource.schema
    }
  }
  return schemas
}

export interface Crumb {
  label: string
  /** Absent for the module group: it is a name, not a screen (EARS-433). */
  href?: string
}

/**
 * The breadcrumb of EARS-435: `Админка / <module> / <resource>`.
 *
 * Three levels and no more. `/p/admin/hours/periods/create` is still the
 * Периоды screen doing something — an action is not a fourth place — and a path
 * that resolves to no declared resource names the cabinet and invents nothing,
 * rather than echoing whatever segments the URL happened to carry.
 *
 * Derived from the same registry the tree is, so a renamed module is renamed in
 * both at once.
 */
export function cabinetBreadcrumb(entries: readonly WorkspaceEntry[], pathname: string): Crumb[] {
  return breadcrumbFromResources(cabinetResources(entries), pathname)
}

/**
 * The same breadcrumb, from the tree the shell already has.
 *
 * The shell renders on the CLIENT and cannot read the registry (see
 * `schemas.ts`), but `ResourceProps[]` crossed the boundary with it — and it
 * carries every label the breadcrumb needs. Two entry points, ONE
 * implementation: a second derivation of «what is this screen called» is how
 * the sidebar and the breadcrumb start disagreeing.
 */
export function breadcrumbFromResources(resources: ResourceProps[], pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: CABINET_LABEL, href: CABINET_ROOT }]

  const rest = pathname.startsWith(`${CABINET_ROOT}/`)
    ? pathname.slice(CABINET_ROOT.length + 1).split('/')
    : []
  const [slug, resourceSegment] = rest
  if (!slug || !resourceSegment) return crumbs

  const resource = resources.find((r) => r.name === resourceName(slug, resourceSegment))
  const group = resources.find((r) => r.name === groupName(slug) && !r.meta?.parent)
  if (!resource || !group) return crumbs

  crumbs.push({ label: String(group.meta?.label ?? slug) })
  crumbs.push({
    label: String(resource.meta?.label ?? resourceSegment),
    href: `${CABINET_ROOT}/${slug}/${resourceSegment}`,
  })
  return crumbs
}
