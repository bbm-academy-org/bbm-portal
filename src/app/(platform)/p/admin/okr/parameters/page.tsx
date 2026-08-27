import React from 'react'

import { describeOkrReadError, getOkrParameters, getOkrTree } from '@/lib/okr'
import { Badge } from '@/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Separator } from '@/ui/separator'

/**
 * `/p/admin/okr/parameters` — «Источник и параметры» (spec 311 §G: EARS-453,
 * EARS-455, EARS-475, EARS-476).
 *
 * A READ-ONLY settings page, not a list. The section exists by the owner's
 * amendment (b) of 2026-08-25, which reversed the earlier exclusion: «источник
 * данных не аргумент для выноса из админки». What it answers is the question an
 * admin actually arrives with — «what is the OKR dashboard reading, and is it
 * reading it right now».
 *
 * NO SAVE, NO DELETE, AND THE REASON IS ON THE SCREEN (EARS-455, EARS-437). The
 * records are mastered in Plane and these parameters are deploy-time
 * configuration with no settings store in `core` to write to; making them
 * editable needs such a store and belongs to the OKR module's own product
 * cycle. That is stated in one line here rather than implied by the absence of
 * a button.
 *
 * IT READS THE MODULE THROUGH ITS DOOR (ADR-004 §6): `getOkrParameters()` — the
 * one accessor EARS-475 adds — and `getOkrTree()`. It reaches no config file
 * and no table of its own.
 *
 * A SERVER COMPONENT, deliberately. The same facts are served over
 * `/api/p/okr/admin/parameters` for the cabinet's data provider (and that
 * handler re-checks `platform-admin` for itself, EARS-462); this screen has no
 * interaction to make client-side, so it renders on the server and needs no
 * loading state at all — one of the states the vendored wireframe does not
 * depict, and the honest answer here is that there is none to design.
 *
 * LAYOUT from `design-source/p-admin-shell.html` (`fidelity: wireframe`) — the
 * work area to the right of the persistent nav, a title, a hint line, then the
 * content. LOOK from the `system:` row at `fidelity: visual` (#360): `Card`,
 * `Badge` and `Separator` from the kit, and no colour written here.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'OKR · Источник и параметры · Админка BBM',
}

/** «24 августа 2026, 14:05» — the moment the module's read was obtained. */
function momentLabel(at: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(at)
}

export default async function OkrParametersPage() {
  const parameters = getOkrParameters()

  // EARS-476: the module's CURRENT read state and when it was obtained — the
  // same read `/p/okr` is running on, cache included. Not stored anywhere,
  // which is why §G needs no read-health store.
  let read: { ok: boolean; at: Date; message?: string }
  try {
    await getOkrTree()
    read = { ok: true, at: new Date() }
  } catch (error) {
    read = { ok: false, at: new Date(), message: describeOkrReadError(error) }
  }

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        Источник и параметры
      </h1>
      {/* EARS-455: the reason, in one line, on the screen. */}
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Только просмотр: записи OKR ведутся в Plane, а параметры ниже — конфигурация деплоя;
        хранилища настроек в платформе для них нет, поэтому редактирования и удаления здесь не
        существует.
      </p>

      <div className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
        <Card data-okr-read>
          <CardHeader>
            <CardTitle>Чтение данных</CardTitle>
            <CardDescription>
              То же чтение, на котором сейчас работает дашборд `/p/okr`, вместе с кэшем.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={read.ok ? 'secondary' : 'outline'} data-okr-read-state>
                {read.ok ? 'данные получены' : 'чтение не удалось'}
              </Badge>
              <span className="text-muted-foreground">{momentLabel(read.at)}</span>
            </div>
            {read.message ? (
              <p data-okr-read-message className="text-muted-foreground">
                {read.message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card data-okr-source>
          <CardHeader>
            <CardTitle>Источник</CardTitle>
            <CardDescription>Рабочее пространство Plane и период дашборда.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Пространство: <span className="text-foreground">{parameters.workspace}</span>
            </p>
            <p>
              Период:{' '}
              <span className="text-foreground">
                {parameters.period.start} — {parameters.period.end}
              </span>
            </p>
            <p>
              Plane:{' '}
              <a
                href={parameters.planeWebBaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {parameters.planeWebBaseUrl}
              </a>
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator className="my-8" />

      <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
        Проекты и соответствие
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Соответствие «проект → миссия и порядок» задаётся конфигурацией: из Plane оно не выводится.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table data-okr-projects className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Проект</th>
              <th className="py-2 pr-4 font-medium">Миссия</th>
              <th className="py-2 pr-4 font-medium">Порядок</th>
              <th className="py-2 font-medium">Идентификатор в Plane</th>
            </tr>
          </thead>
          <tbody>
            {parameters.projects.map((project) => (
              <tr key={project.projectId} className="border-b last:border-b-0">
                <td className="py-2 pr-4 text-foreground">{project.ident}</td>
                <td className="py-2 pr-4 text-muted-foreground">{project.mission}</td>
                <td className="py-2 pr-4 text-muted-foreground">{project.order}</td>
                <td className="py-2 font-mono text-xs text-muted-foreground">
                  {project.projectId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
