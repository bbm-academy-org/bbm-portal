import React from 'react'

import { Separator } from '@/ui/separator'
import { cn } from '@/ui/utils'

/**
 * The cabinet's persistent left navigation (spec 311 EARS-432, EARS-433,
 * EARS-474).
 *
 * PRESENTATIONAL ON PURPOSE. It takes a menu tree and renders it; it calls no
 * hook and reads no registry. The tree it is given is `useMenu().menuItems`
 * from `@refinedev/core` — Refine's own multi-level menu model, built from
 * `meta.parent`, which is exactly the behaviour the owner accepted on
 * 2026-08-25. Keeping the render dumb is what lets EARS-433 be asserted by
 * rendering this component alone, without standing up a Refine context to
 * prove that a list is indented.
 *
 * WHY IT IS NOT IN `src/ui`. Same reason as `TopBar.tsx` next door: the kit is
 * the copied shadcn/ui neutral theme (#360) — primitives, not application
 * chrome. A cabinet sidebar is a composition belonging to one surface.
 *
 * THE STATES THE VENDORED WIREFRAME DOES NOT DEPICT (its header lists them):
 *
 * - **empty** — a cabinet whose registry declares no admin section anywhere.
 *   Structurally unlikely and still rendered, because «cannot happen» and
 *   «renders a blank column» are one refactor apart.
 * - **hover / focus-visible** — the theme's own `accent` hover and its focus
 *   ring, on the item, which is the anchor. A group node is not a control and
 *   has neither.
 * - **loading** — there is none here: the tree is derived from the registry,
 *   which is a typed import, so it is complete the moment the shell mounts.
 * - **error** — likewise none. A broken registry is a build failure, not a
 *   runtime one.
 * - **narrow** — the shell (`CabinetShell.tsx`) drops to one column and this
 *   nav becomes a horizontal band above the work area; the groups keep their
 *   nesting, so «which module am I in» survives the reflow.
 */

/**
 * The shape of one `useMenu()` node this component needs — structurally a
 * subset of `TreeMenuItem`, declared here so the component has no dependency on
 * Refine at all.
 */
export interface CabinetMenuItem {
  key?: string
  name: string
  label?: string
  route?: string
  children: CabinetMenuItem[]
}

const ITEM_BASE =
  'block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function Item({ item, selectedKey }: { item: CabinetMenuItem; selectedKey: string }) {
  const key = item.key ?? item.name
  const selected = key === selectedKey
  const label = item.label ?? item.name

  // A node with children is a GROUP: a name with a nested list under it, and
  // deliberately not a link — there is no screen behind a module, only its
  // resources (EARS-433).
  if (item.children.length > 0) {
    return (
      <li data-nav-group={key} className="mb-4">
        <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
          {label}
        </div>
        <ul data-nav-children className="mt-1 space-y-0.5 border-l pl-3">
          {item.children.map((child) => (
            <Item key={child.key ?? child.name} item={child} selectedKey={selectedKey} />
          ))}
        </ul>
      </li>
    )
  }

  // A leaf with no route is a resource whose only declared operation is not
  // `list` — it has no screen to open, so it is named and not offered
  // (EARS-437: absent, never a control that fails on click).
  if (!item.route) {
    return (
      <li>
        <span data-nav-item={key} className={cn(ITEM_BASE, 'cursor-default opacity-60')}>
          {label}
        </span>
      </li>
    )
  }

  return (
    <li>
      <a
        data-nav-item={key}
        href={item.route}
        {...(selected ? { 'aria-current': 'page' as const } : {})}
        className={cn(ITEM_BASE, selected && 'bg-accent font-medium text-accent-foreground')}
      >
        {label}
      </a>
    </li>
  )
}

export function CabinetSidebar({
  items,
  selectedKey,
}: {
  items: CabinetMenuItem[]
  selectedKey: string
}) {
  return (
    <nav
      data-cabinet-nav
      aria-label="Разделы админки"
      className="min-w-0 border-b py-4 md:h-full md:border-b-0 md:border-r md:py-6"
    >
      <div className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Разделы
      </div>
      <Separator className="my-3" />
      {items.length === 0 ? (
        <p data-nav-empty className="px-3 text-sm text-muted-foreground">
          Разделов пока нет — ни один модуль не объявил админ-раздел.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <Item key={item.key ?? item.name} item={item} selectedKey={selectedKey} />
          ))}
        </ul>
      )}
    </nav>
  )
}
