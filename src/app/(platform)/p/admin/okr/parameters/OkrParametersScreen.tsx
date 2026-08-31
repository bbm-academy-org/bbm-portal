'use client'

import React from 'react'

import type { OkrParametersRecord } from '@/lib/okr/contract'
import { createModuleApiClient } from '@/lib/platform/cabinet'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Separator } from '@/ui/separator'
import { Skeleton } from '@/ui/skeleton'

import { validateCabinetResponse } from '../../actions'

const okrClient = createModuleApiClient({ validateResponse: validateCabinetResponse })

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Не удалось прочитать параметры OKR.'
}

function momentLabel(at: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(at))
}

export function OkrParametersScreen() {
  const [parameters, setParameters] = React.useState<OkrParametersRecord | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void okrClient
      .one<OkrParametersRecord>({
        resource: 'okr.parameters',
        path: '/okr/admin/parameters',
      })
      .then((data) => {
        if (!cancelled) setParameters(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        Источник и параметры
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Только просмотр: записи OKR ведутся в Plane, а параметры ниже — конфигурация деплоя;
        хранилища настроек в платформе для них нет, поэтому редактирования и удаления здесь не
        существует.
      </p>

      {failure ? (
        <Alert variant="destructive" role="alert" className="mt-8">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      {!parameters && !failure ? (
        <div aria-label="Загружаем параметры OKR" className="mt-8 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : null}
      {parameters ? <OkrParametersContent parameters={parameters} /> : null}
    </>
  )
}

function OkrParametersContent({ parameters }: { parameters: OkrParametersRecord }) {
  const readOk = parameters.read.state === 'ok'
  return (
    <>
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
              <Badge variant={readOk ? 'secondary' : 'outline'} data-okr-read-state>
                {readOk ? 'данные получены' : 'чтение не удалось'}
              </Badge>
              <span className="text-muted-foreground">{momentLabel(parameters.read.at)}</span>
            </div>
            {parameters.read.message ? (
              <p data-okr-read-message className="text-muted-foreground">
                {parameters.read.message}
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
