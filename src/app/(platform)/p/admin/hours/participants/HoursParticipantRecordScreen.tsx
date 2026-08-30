'use client'

import { useOne, useUpdate, type HttpError } from '@refinedev/core'
import React from 'react'

import type { HoursParticipantRecord, HoursParticipantUpdate } from '@/lib/hours'
import { Alert, AlertDescription } from '@/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'

import { errorMessage, HOURS_PARTICIPANT_RESOURCE, rubles } from '../constants'
import {
  HoursParticipantForm,
  participantFormValue,
  participantPayload,
} from './HoursParticipantForm'

export function HoursParticipantRecordScreen({ email }: { email: string }) {
  const { query, result } = useOne<HoursParticipantRecord, HttpError>({
    resource: HOURS_PARTICIPANT_RESOURCE,
    id: email,
  })
  const update = useUpdate<HoursParticipantRecord, HttpError, HoursParticipantUpdate>()
  const [saved, setSaved] = React.useState(false)

  if (query.isLoading) return <Skeleton className="mx-auto h-[36rem] w-full max-w-2xl" />
  if (query.error || !result)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {errorMessage(query.error, 'Не удалось прочитать ставку участника.')}
        </AlertDescription>
      </Alert>
    )

  const participant = result
  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{participant.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Текущая расчётная ставка: {rubles(participant.monthlyRate)} в месяц.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Ставка и грейд</CardTitle>
          <CardDescription>Сохранённые оценки прошлых периодов не пересчитываются.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {saved ? (
            <Alert>
              <AlertDescription>Параметры участника сохранены.</AlertDescription>
            </Alert>
          ) : null}
          <HoursParticipantForm
            key={`${participant.email}-${participant.name}-${participant.monthlyRate}`}
            initial={participantFormValue(participant)}
            emailReadOnly
            pending={update.mutation.isPending}
            failure={
              update.mutation.error
                ? errorMessage(update.mutation.error, 'Не удалось сохранить участника.')
                : undefined
            }
            submitLabel="Сохранить параметры"
            onSubmit={(value) => {
              setSaved(false)
              const { email: _email, ...values } = participantPayload(value)
              update.mutate(
                { resource: HOURS_PARTICIPANT_RESOURCE, id: email, values },
                { onSuccess: () => setSaved(true) },
              )
            }}
          />
        </CardContent>
      </Card>
    </section>
  )
}
