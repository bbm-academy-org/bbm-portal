'use client'

import { useList, useNavigation, type HttpError } from '@refinedev/core'
import React from 'react'

import type { HoursPeriodRecord } from '@/lib/hours'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

import { dateLabel, errorMessage, HOURS_PERIOD_RESOURCE } from '../constants'

export function HoursPeriodsScreen() {
  const { create, edit } = useNavigation()
  const { query, result } = useList<HoursPeriodRecord, HttpError>({
    resource: HOURS_PERIOD_RESOURCE,
    pagination: { mode: 'off' },
  })

  return (
    <section aria-labelledby="hours-periods-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            id="hours-periods-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            Периоды
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Расчётные интервалы, их статус и сохранённые самооценки.
          </p>
        </div>
        <Button onClick={() => create(HOURS_PERIOD_RESOURCE)}>Создать период</Button>
      </div>

      {query.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(query.error, 'Не удалось прочитать периоды.')}
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Загружаем периоды…</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ) : !query.error && result.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Периодов пока нет</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Создайте первый период. Новый период будет закрыт, пока вы не откроете его отдельно.
          </CardContent>
        </Card>
      ) : !query.error ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Период</TableHead>
                <TableHead>Даты</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Оценки</TableHead>
                <TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((period) => (
                <TableRow key={period.id}>
                  <TableCell className="font-medium">{period.label}</TableCell>
                  <TableCell>
                    {dateLabel(period.dateFrom)} — {dateLabel(period.dateTo)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={period.status === 'open' ? 'secondary' : 'outline'}>
                      {period.status === 'open' ? 'Открыт' : 'Закрыт'}
                    </Badge>
                  </TableCell>
                  <TableCell>{period.assessments.length}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit(HOURS_PERIOD_RESOURCE, period.id)}
                    >
                      Открыть
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  )
}
