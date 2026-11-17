import React from 'react'

import { PROCESS_CATALOG } from '@/lib/processes'
import { Card, CardDescription, CardHeader, CardTitle } from '@/ui/card'

/**
 * `/p/processes` — the «Процессы» workspace index (#553, spec 553 EARS-602):
 * every process of the catalog as a linked card, in the launcher's own visual
 * language (the `system:` row — shadcn/ui neutral theme, `@/ui` Card; the same
 * tile treatment as `/p`). The catalog is a typed import, so there is no
 * loading or error state to design; an empty catalog still says so.
 */

export const metadata = {
  title: 'Процессы · BBM',
}

export default function ProcessesIndexPage() {
  return (
    <main data-bbm-ui className="min-h-[calc(100vh-3.25rem)] bg-background">
      <div className="mx-auto w-full max-w-[1160px] px-4 py-10 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Процессы
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Модели того, как работают команды. Модель правится в базе знаний — здесь всегда её
          последняя версия.
        </p>
        {PROCESS_CATALOG.length > 0 ? (
          <div className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
            {PROCESS_CATALOG.map((entry) => (
              <a
                key={entry.slug}
                href={entry.href}
                className="group/tile block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Card className="h-full transition-colors group-hover/tile:bg-muted/50 group-hover/tile:ring-foreground/20">
                  <CardHeader>
                    <CardTitle>{entry.name}</CardTitle>
                    <CardDescription>{entry.description}</CardDescription>
                  </CardHeader>
                </Card>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">Пока здесь нет ни одной модели.</p>
        )}
      </div>
    </main>
  )
}
