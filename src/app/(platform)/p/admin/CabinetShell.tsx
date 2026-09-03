'use client'

import { Refine, useMenu, type ResourceProps } from '@refinedev/core'
import routerProvider from '@refinedev/nextjs-router'
import { usePathname } from 'next/navigation'
import React from 'react'

import { createCabinetDataProvider } from '@/lib/platform/cabinet'
import { useNotificationProvider } from '@/ui/refine-ui/notification/use-notification-provider'
import { Toaster } from '@/ui/sonner'

import { validateCabinetResponse } from './actions'
import { CabinetSidebar } from './CabinetSidebar'
import { breadcrumbFromResources } from './resources'

/**
 * The `/p/admin` cabinet shell (spec 311 §D — EARS-431, EARS-432, EARS-433,
 * EARS-435, EARS-440).
 *
 * TWO SOURCES, TWO HALVES (EARS-430, `design-source/README.md`):
 *
 * - **Layout** from `design-source/p-admin-shell.html` (option `admin-a`, owner
 *   pick 2026-08-25), which is `fidelity: wireframe` — it fixes a PERSISTENT
 *   LEFT COLUMN grouped by module with the work area to its right, a breadcrumb
 *   above the screen's title, and nothing about how any of it looks. Its greys,
 *   its 248px column and its borders are scaffolding.
 * - **Look** from the `system:` row at `fidelity: visual` — the default neutral
 *   theme of shadcn/ui via Refine's integration, owner Stage-A decision by
 *   Антон on 2026-08-26 (#360). This file writes no colour, no radius and no
 *   shadow of its own.
 *
 * The owner's amendment (a) of 2026-08-25 asked for visually explicit
 * sub-section nesting and named `ThemedLayoutV2` as the example. That component
 * ships in Refine's UI packages, which EARS-431 excludes — so the amendment is
 * met the way EARS-433's own note prescribes: the MENU TREE comes from
 * `useMenu()`, Refine's native `meta.parent` model, and `CabinetSidebar`
 * renders it with the kit. The behaviour is what was accepted; the package is
 * not.
 *
 * FEEDBACK IS ONE CHANNEL (#434). Refine's `notificationProvider` is wired to
 * the kit's sonner `Toaster`, so every mutation the cabinet runs — through any
 * screen, from any module — reports success and failure in the same place, in
 * the same shape. Before this, each screen invented its own: an inline
 * `<Alert>` here, a `saved` boolean there, nothing at all on the third. A
 * screen may still render an inline Alert for a state the reader must keep
 * looking at (a record that would not load, a save that failed while the form
 * is still on screen); the toast is the "it happened" signal, not a substitute
 * for that.
 *
 * WHAT IS DELIBERATELY ABSENT: a top bar. The workspace's shared bar
 * (EARS-425) comes from `(platform)/p/layout.tsx`, which this shell is inside,
 * so the cabinet carries it by existing (EARS-440). A second bar here would be
 * the frame naming the current app twice.
 *
 * THE STATES THE VENDORED WIREFRAME DOES NOT DEPICT (its header lists them):
 *
 * - **denied** — never reaches this component. `layout.tsx` next door refuses a
 *   session without `platform-admin` with a bare 403 before the shell renders
 *   (EARS-418, D-5), and every handler re-checks for itself (EARS-462).
 * - **loading** — the shell itself has none: the resource tree is derived on
 *   the server from a typed import and arrives complete. A RESOURCE screen's
 *   own loading state belongs to that screen (#316/#317), where the provider's
 *   query is.
 * - **error** — likewise: a refusal from a handler is surfaced by the data
 *   provider as its own reason (EARS-472/473), on the screen that asked, not as
 *   chrome here.
 * - **empty** — a cabinet with no declared sections renders the sidebar's own
 *   empty line rather than a blank column; the index page says the same.
 * - **narrow** — one column instead of two, the nav becoming a band above the
 *   work area with its nesting intact.
 */

export function CabinetShell({
  resources,
  children,
}: {
  /**
   * Built on the SERVER from `WORKSPACE_REGISTRY` and passed down, because the
   * composition root cannot cross into the client bundle: its module entries
   * carry server-only status providers. `ResourceProps` is plain data, so this
   * crosses as JSON; response validation crosses the other way through the
   * authenticated Server Function in `actions.ts`.
   */
  resources: ResourceProps[]
  children: React.ReactNode
}) {
  const dataProvider = React.useMemo(
    () => createCabinetDataProvider({ validateResponse: validateCabinetResponse }),
    [],
  )
  const notificationProvider = useNotificationProvider()

  return (
    <Refine
      dataProvider={dataProvider}
      notificationProvider={notificationProvider}
      routerProvider={routerProvider}
      resources={resources}
      options={{
        // No telemetry ping out of an internal tool, and a leave-confirmation
        // on a half-filled cabinet form — the one thing EARS-472's «answers
        // unambiguously» cannot help with, because a navigation away is not a
        // save that failed.
        disableTelemetry: true,
        warnWhenUnsavedChanges: true,
      }}
    >
      <CabinetFrame resources={resources}>{children}</CabinetFrame>
    </Refine>
  )
}

/**
 * Inside the Refine context, so `useMenu()` is reachable. Split out only for
 * that reason — a hook cannot run in the component that provides its context.
 */
function CabinetFrame({
  resources,
  children,
}: {
  resources: ResourceProps[]
  children: React.ReactNode
}) {
  const { menuItems, selectedKey } = useMenu()
  const pathname = usePathname() ?? ''
  const crumbs = breadcrumbFromResources(resources, pathname)

  return (
    <div
      data-bbm-ui
      data-cabinet
      // The wireframe's two-column shell: a persistent nav column and the work
      // area. One column while narrow — the state the file does not draw.
      className="mx-auto grid w-full max-w-[1440px] grid-cols-1 bg-background md:grid-cols-[248px_minmax(0,1fr)]"
    >
      <CabinetSidebar items={menuItems} selectedKey={selectedKey} />
      {/* Inside the opted-in subtree so the toast is painted by the kit's own
          base layer — sonner renders where it is placed, it does not portal. */}
      <Toaster position="bottom-right" richColors closeButton />
      <main className="min-w-0 px-4 py-6 sm:px-8">
        {/* EARS-435: every cabinet screen says whose data it is showing, in one
            place, so a screen author cannot forget to. */}
        <nav data-cabinet-crumbs aria-label="Хлебные крошки" className="mb-4 text-sm">
          <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            {crumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href && index < crumbs.length - 1 ? (
                  <a
                    href={crumb.href}
                    className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className={index === crumbs.length - 1 ? 'text-foreground' : undefined}>
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {children}
      </main>
    </div>
  )
}
