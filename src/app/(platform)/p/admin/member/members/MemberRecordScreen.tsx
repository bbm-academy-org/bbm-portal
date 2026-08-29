'use client'

import { useNavigation, useOne, useUpdate, type HttpError } from '@refinedev/core'
import React from 'react'

import type { MemberRecord, MemberUpdateInput } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'

import { AliasPanel } from './AliasPanel'
import { errorMessage, MEMBER_RESOURCE } from './constants'
import { MemberForm, memberFormValue, memberUpdateValue, type MemberFormValue } from './MemberForm'

export function MemberRecordScreen({ id, mode }: { id: number; mode: 'show' | 'edit' }) {
  const navigation = useNavigation()
  const update = useUpdate<MemberRecord, HttpError, MemberUpdateInput>()
  const { query, result } = useOne<MemberRecord, HttpError>({ resource: MEMBER_RESOURCE, id })
  const [saved, setSaved] = React.useState(false)

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }
  if (query.error || !result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {errorMessage(query.error, 'Не удалось прочитать профиль участника.')}
        </AlertDescription>
      </Alert>
    )
  }

  const member = result
  function save(value: MemberFormValue) {
    setSaved(false)
    update.mutate(
      { resource: MEMBER_RESOURCE, id, values: memberUpdateValue(value) },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{member.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{member.email}</p>
        </div>
        {mode === 'show' ? (
          <Button
            onClick={() => {
              setSaved(false)
              navigation.edit(MEMBER_RESOURCE, id)
            }}
          >
            Редактировать
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setSaved(false)
              navigation.show(MEMBER_RESOURCE, id)
            }}
          >
            Открыть карточку
          </Button>
        )}
      </div>
      <div
        data-member-composition
        className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Профиль</h2>
            </CardTitle>
            <CardDescription>Основная запись в реестре участников.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {saved ? (
              <Alert>
                <AlertDescription>Профиль сохранён.</AlertDescription>
              </Alert>
            ) : null}
            <MemberForm
              key={`${member.id}-${member.updatedAt}-${mode}`}
              initial={memberFormValue(member)}
              emailReadOnly
              canEditStatus
              readOnly={mode === 'show'}
              submitLabel="Сохранить профиль"
              pending={update.mutation.isPending}
              failure={
                update.mutation.error
                  ? errorMessage(update.mutation.error, 'Не удалось сохранить профиль.')
                  : undefined
              }
              onChange={() => setSaved(false)}
              onSubmit={save}
            />
          </CardContent>
        </Card>
        <AliasPanel memberId={id} editable={mode === 'edit'} />
      </div>
    </section>
  )
}
