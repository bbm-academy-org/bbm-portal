'use client'

import { useCreate, useNavigation, type HttpError } from '@refinedev/core'

import type { MemberCreateInput, MemberRecord } from '@/lib/member'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

import { errorMessage, MEMBER_RESOURCE } from './constants'
import { MemberForm, memberFormValue, type MemberFormValue } from './MemberForm'

export function MemberCreateScreen() {
  const create = useCreate<MemberRecord, HttpError, MemberCreateInput>()
  const navigation = useNavigation()

  function submit(value: MemberFormValue) {
    create.mutate(
      {
        resource: MEMBER_RESOURCE,
        values: {
          name: value.name.trim(),
          email: value.email.trim(),
          role: value.role.trim() || null,
          timezone: value.timezone.trim(),
        },
      },
      { onSuccess: ({ data }) => navigation.edit(MEMBER_RESOURCE, data.id) },
    )
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Новый участник</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Сначала сохраните профиль. Алиасы появятся на экране редактирования.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Профиль</CardTitle>
          <CardDescription>Основные данные участника реестра.</CardDescription>
        </CardHeader>
        <CardContent>
          <MemberForm
            initial={memberFormValue()}
            emailReadOnly={false}
            canEditStatus={false}
            submitLabel="Создать участника"
            pending={create.mutation.isPending}
            failure={
              create.mutation.error
                ? errorMessage(create.mutation.error, 'Не удалось создать участника.')
                : undefined
            }
            onSubmit={submit}
          />
        </CardContent>
      </Card>
    </section>
  )
}
