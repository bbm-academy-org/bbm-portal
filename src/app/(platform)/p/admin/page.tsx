import React from 'react'

import { WORKSPACE_REGISTRY } from '@/lib/workspace'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

import { CABINET_ROOT } from './resources'

/**
 * `/p/admin` — the cabinet's INDEX OF SECTIONS (spec 311 EARS-434).
 *
 * «Not a dashboard, and not a jump into the first resource.» Both alternatives
 * were rejected in the spec and both are the easy thing to build: a dashboard
 * invents numbers nobody asked for, and a redirect into the first resource
 * makes the cabinet's own shape unknowable — an admin who lands inside Периоды
 * cannot tell what else is there without reading the sidebar sideways.
 *
 * It holds NO list of apps (EARS-402, D-2). Every section and every item on
 * this screen comes from `WORKSPACE_REGISTRY`; grep this file for the name of a
 * module and you find nothing.
 *
 * LAYOUT from `design-source/p-admin-shell.html` (`fidelity: wireframe`, owner
 * pick 2026-08-25) — the file draws the index as «тот же макет с пустой рабочей
 * областью», i.e. the shell with the work area holding the sections rather than
 * a resource. LOOK from the `system:` row at `fidelity: visual` (#360): the
 * card is the kit's `Card`, and this file writes no colour of its own.
 *
 * The wireframe does not depict the EMPTY state; it is rendered here, because a
 * cabinet whose registry declares no admin section anywhere must say so rather
 * than show an empty page.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Админка · BBM',
}

export default function AdminIndexPage() {
  const sections = WORKSPACE_REGISTRY.flatMap((entry) =>
    entry.kind === 'internal' && entry.admin
      ? [{ slug: entry.slug, label: entry.admin.label, resources: entry.admin.resources }]
      : [],
  )

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        Админка
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Разделы, доступные вам. Каждый раздел принадлежит своему модулю.
      </p>

      {sections.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Ни один модуль пока не объявил админ-раздел.
        </p>
      ) : (
        <div
          data-section-grid
          className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]"
        >
          {sections.map((section) => (
            <Card key={section.slug} data-section={section.slug} className="h-full">
              <CardHeader>
                <CardTitle>{section.label}</CardTitle>
                <CardDescription>
                  {section.resources.length === 1
                    ? '1 раздел'
                    : `${section.resources.length} раздела`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {section.resources.map((resource) => {
                    const href = `${CABINET_ROOT}/${section.slug}/${resource.name}`
                    // EARS-437: a resource that does not support `list` has no
                    // screen to open, so it is named and not offered — there is
                    // no link here that could fail on click.
                    return (
                      <li key={resource.name}>
                        {resource.operations.includes('list') ? (
                          <a
                            data-section-item={`${section.slug}.${resource.name}`}
                            href={href}
                            className="rounded-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {resource.label}
                          </a>
                        ) : (
                          <span
                            data-section-item={`${section.slug}.${resource.name}`}
                            className="text-muted-foreground/60"
                          >
                            {resource.label}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
