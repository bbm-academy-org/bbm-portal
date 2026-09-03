'use client'

import { useNavigation, useOne, useUpdate, type HttpError } from '@refinedev/core'
import React from 'react'

import type { MemberRecord, MemberUpdateInput } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { EditView } from '@/ui/refine-ui/views/edit-view'
import { ShowView } from '@/ui/refine-ui/views/show-view'
import { Skeleton } from '@/ui/skeleton'

import { AliasPanel } from './AliasPanel'
import { errorMessage, MEMBER_RESOURCE } from './constants'
import { MemberForm, memberFormValue, memberUpdateValue, type MemberFormValue } from './MemberForm'

/**
 * The member record — read (`show`) and edit (`edit`) — rebuilt on the kit's
 * blocks (#434). The owner's Option A layout of #316 is unchanged: profile
 * left, aliases right, stacking on a narrow viewport.
 *
 * FEEDBACK. The «Профиль сохранён.» acknowledgement used to be an inline
 * `<Alert>` that appeared above the form and stayed there until the next
 * keystroke — a success message competing for the same space as the form it
 * describes. It is now a toast, through the shell's one notification channel,
 * so a successful save reports in the same place a successful save anywhere
 * else in the cabinet does. A FAILED save still renders inline, because that is
 * the one a reader has to keep looking at while fixing it.
 */
export function MemberRecordScreen({ id, mode }: { id: number; mode: 'show' | 'edit' }) {
  const navigation = useNavigation()
  const update = useUpdate<MemberRecord, HttpError, MemberUpdateInput>()
  const { query, result } = useOne<MemberRecord, HttpError>({ resource: MEMBER_RESOURCE, id })

  const View = mode === 'edit' ? EditView : ShowView

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
    update.mutate({
      resource: MEMBER_RESOURCE,
      id,
      values: memberUpdateValue(value),
      successNotification: {
        type: 'success',
        message: 'Профиль сохранён.',
        description: value.name,
      },
      errorNotification: (error) => ({
        type: 'error',
        message: 'Не удалось сохранить профиль.',
        description: errorMessage(error, value.name),
      }),
    })
  }

  return (
    <View>
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{member.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{member.email}</p>
          </div>
          {mode === 'show' ? (
            <Button onClick={() => navigation.edit(MEMBER_RESOURCE, id)}>Редактировать</Button>
          ) : (
            <Button variant="outline" onClick={() => navigation.show(MEMBER_RESOURCE, id)}>
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
            <CardContent>
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
                onSubmit={save}
              />
            </CardContent>
          </Card>
          <AliasPanel memberId={id} editable={mode === 'edit'} />
        </div>
      </section>
    </View>
  )
}
