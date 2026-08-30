'use client'

import { useCreate, useNavigation, type HttpError } from '@refinedev/core'

import type { HoursPeriodCreate, HoursPeriodRecord } from '@/lib/hours'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

import { errorMessage, HOURS_PERIOD_RESOURCE } from '../constants'
import { HoursPeriodForm, periodFormValue } from './HoursPeriodForm'

export function HoursPeriodCreateScreen() {
  const create = useCreate<HoursPeriodRecord, HttpError, HoursPeriodCreate>()
  const navigation = useNavigation()

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Новый период</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          После создания период останется закрытым.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Параметры периода</CardTitle>
          <CardDescription>В диапазоне должен быть хотя бы один будний день.</CardDescription>
        </CardHeader>
        <CardContent>
          <HoursPeriodForm
            initial={periodFormValue()}
            pending={create.mutation.isPending}
            failure={
              create.mutation.error
                ? errorMessage(create.mutation.error, 'Не удалось создать период.')
                : undefined
            }
            submitLabel="Создать период"
            onSubmit={(values) =>
              create.mutate(
                { resource: HOURS_PERIOD_RESOURCE, values },
                { onSuccess: ({ data }) => navigation.edit(HOURS_PERIOD_RESOURCE, data.id) },
              )
            }
          />
        </CardContent>
      </Card>
    </section>
  )
}
