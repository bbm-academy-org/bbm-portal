'use client'

import { useDelete, useNavigation, useOne, useUpdate, type HttpError } from '@refinedev/core'
import React from 'react'

import type { HoursPeriodCreate, HoursPeriodRecord, HoursPeriodUpdate } from '@/lib/hours'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

import { errorMessage, HOURS_PERIOD_RESOURCE, rubles } from '../constants'
import { HoursPeriodForm, periodFormValue } from './HoursPeriodForm'

export function HoursPeriodRecordScreen({ id }: { id: string }) {
  const navigation = useNavigation()
  const { query, result } = useOne<HoursPeriodRecord, HttpError>({
    resource: HOURS_PERIOD_RESOURCE,
    id,
  })
  const update = useUpdate<HoursPeriodRecord, HttpError, HoursPeriodUpdate>()
  const remove = useDelete<HoursPeriodRecord, HttpError>()
  const [notice, setNotice] = React.useState<string[]>([])

  if (query.isLoading) return <Skeleton className="h-[34rem] w-full" />
  if (query.error || !result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {errorMessage(query.error, 'Не удалось прочитать период.')}
        </AlertDescription>
      </Alert>
    )
  }

  const period = result
  const busy = update.mutation.isPending || remove.mutation.isPending
  const failure = update.mutation.error ?? remove.mutation.error

  function save(values: HoursPeriodCreate) {
    setNotice([])
    update.mutate(
      { resource: HOURS_PERIOD_RESOURCE, id, values },
      {
        onSuccess: ({ data }) =>
          setNotice(data.warnings.length ? data.warnings : ['Период сохранён.']),
      },
    )
  }

  function setStatus(status: 'open' | 'closed') {
    setNotice([])
    update.mutate(
      { resource: HOURS_PERIOD_RESOURCE, id, values: { status } },
      { onSuccess: () => setNotice([status === 'open' ? 'Период открыт.' : 'Период закрыт.']) },
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant={period.status === 'open' ? 'secondary' : 'outline'}>
              {period.status === 'open' ? 'Открыт' : 'Закрыт'}
            </Badge>
            {period.locked ? <Badge variant="destructive">Публикация начата</Badge> : null}
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{period.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Параметры, жизненный цикл и самооценки периода.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || (period.status === 'closed' && period.locked)}
            onClick={() => setStatus(period.status === 'open' ? 'closed' : 'open')}
          >
            {period.status === 'open' ? 'Закрыть период' : 'Открыть период'}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || period.assessments.length > 0}
            title={period.assessments.length ? 'Нельзя удалить период с оценками' : undefined}
            onClick={() => {
              if (!window.confirm(`Удалить период «${period.label}»?`)) return
              remove.mutate(
                { resource: HOURS_PERIOD_RESOURCE, id },
                { onSuccess: () => navigation.list(HOURS_PERIOD_RESOURCE) },
              )
            }}
          >
            Удалить
          </Button>
        </div>
      </div>

      {period.locked ? (
        <Alert>
          <AlertTitle>Период заблокирован публикацией</AlertTitle>
          <AlertDescription>
            После начала публикации нельзя менять даты, название или переоткрывать период.
          </AlertDescription>
        </Alert>
      ) : null}
      {notice.length ? (
        <Alert>
          <AlertDescription>
            {notice.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(failure, 'Не удалось изменить период.')}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Параметры</CardTitle>
            <CardDescription>
              Изменение дат пересчитывает производные суммы сохранённых оценок.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HoursPeriodForm
              key={`${period.id}-${period.label}-${period.dateFrom}-${period.dateTo}`}
              initial={periodFormValue(period)}
              pending={busy}
              locked={period.locked}
              submitLabel="Сохранить период"
              onSubmit={save}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Самооценки</CardTitle>
            <CardDescription>
              Только просмотр: оценки сохраняют сами участники на странице «Часы».
            </CardDescription>
          </CardHeader>
          <CardContent>
            {period.assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">В этом периоде пока нет оценок.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Участник</TableHead>
                      <TableHead>Часы</TableHead>
                      <TableHead>Начисление</TableHead>
                      <TableHead>Сплит</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {period.assessments.map((assessment) => (
                      <TableRow key={assessment.email}>
                        <TableCell>
                          <span className="block font-medium">{assessment.name}</span>
                          <span className="text-xs text-muted-foreground">{assessment.email}</span>
                        </TableCell>
                        <TableCell>{assessment.hours}</TableCell>
                        <TableCell>{rubles(assessment.accrual)}</TableCell>
                        <TableCell>{assessment.splitPercent}% в проекте</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
