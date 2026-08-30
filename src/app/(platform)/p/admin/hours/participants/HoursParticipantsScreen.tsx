'use client'

import { useList, useNavigation, type HttpError } from '@refinedev/core'
import React from 'react'

import type { HoursParticipantRecord } from '@/lib/hours'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

import { errorMessage, HOURS_PARTICIPANT_RESOURCE, rubles } from '../constants'

export function HoursParticipantsScreen() {
  const [search, setSearch] = React.useState('')
  const { create, edit } = useNavigation()
  const { query, result } = useList<HoursParticipantRecord, HttpError>({
    resource: HOURS_PARTICIPANT_RESOURCE,
    pagination: { mode: 'off' },
    filters: search ? [{ field: 'q', operator: 'contains', value: search }] : [],
  })

  return (
    <section aria-labelledby="hours-participants-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            id="hours-participants-heading"
            className="font-heading text-2xl font-semibold tracking-tight"
          >
            Ставки и грейды
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Параметры, из которых рассчитывается месячная ставка.
          </p>
        </div>
        <Button onClick={() => create(HOURS_PARTICIPANT_RESOURCE)}>Добавить участника</Button>
      </div>
      <Input
        type="search"
        role="searchbox"
        aria-label="Поиск участников"
        placeholder="Имя, email, роль или грейд"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-md"
      />
      {query.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(query.error, 'Не удалось прочитать ставки.')}
          </AlertDescription>
        </Alert>
      ) : null}
      {query.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Загружаем ставки…</CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : !query.error && result.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Участников пока нет</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Добавьте участника, чтобы задать вилку и грейд.
          </CardContent>
        </Card>
      ) : !query.error ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Участник</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Вилка</TableHead>
                <TableHead>Грейд</TableHead>
                <TableHead>Ставка</TableHead>
                <TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((participant) => (
                <TableRow key={participant.email}>
                  <TableCell>
                    <span className="block font-medium">{participant.name}</span>
                    <span className="text-xs text-muted-foreground">{participant.email}</span>
                  </TableCell>
                  <TableCell>{participant.role ?? '—'}</TableCell>
                  <TableCell>
                    {participant.forkMin == null || participant.forkMax == null
                      ? '—'
                      : `${rubles(participant.forkMin)} — ${rubles(participant.forkMax)}`}
                  </TableCell>
                  <TableCell>{participant.grade ?? '—'}</TableCell>
                  <TableCell>{rubles(participant.monthlyRate)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit(HOURS_PARTICIPANT_RESOURCE, participant.email)}
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
