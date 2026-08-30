'use client'

import { useCreate, useNavigation, type HttpError } from '@refinedev/core'

import type { HoursParticipantCreate, HoursParticipantRecord } from '@/lib/hours'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

import { errorMessage, HOURS_PARTICIPANT_RESOURCE } from '../constants'
import {
  HoursParticipantForm,
  participantFormValue,
  participantPayload,
} from './HoursParticipantForm'

export function HoursParticipantCreateScreen() {
  const create = useCreate<HoursParticipantRecord, HttpError, HoursParticipantCreate>()
  const navigation = useNavigation()
  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Новый участник</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Если email новый, базовая запись участника будет создана автоматически.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Ставка и грейд</CardTitle>
          <CardDescription>Роль, вилка и грейд можно оставить пустыми.</CardDescription>
        </CardHeader>
        <CardContent>
          <HoursParticipantForm
            initial={participantFormValue()}
            emailReadOnly={false}
            pending={create.mutation.isPending}
            failure={
              create.mutation.error
                ? errorMessage(create.mutation.error, 'Не удалось сохранить участника.')
                : undefined
            }
            submitLabel="Создать участника"
            onSubmit={(value) =>
              create.mutate(
                { resource: HOURS_PARTICIPANT_RESOURCE, values: participantPayload(value) },
                {
                  onSuccess: ({ data }) => navigation.edit(HOURS_PARTICIPANT_RESOURCE, data.email),
                },
              )
            }
          />
        </CardContent>
      </Card>
    </section>
  )
}
