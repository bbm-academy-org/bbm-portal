'use client'

import {
  useCreate,
  useList,
  useNavigation,
  useOne,
  useUpdate,
  type HttpError,
} from '@refinedev/core'
import React from 'react'

import type { FinanceReferenceResource } from '@/lib/finance'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'

import { FinanceReferenceForm, type ReferenceOptions } from './FinanceReferenceForm'
import {
  financeReferenceUi,
  financeResourceName,
  type FinanceReferenceRow,
} from './reference-config'

function message(error: HttpError | null | undefined, fallback: string) {
  return error?.message || fallback
}

function useReferenceOptions(): { options: ReferenceOptions; error?: HttpError } {
  const currencies = useList<FinanceReferenceRow, HttpError>({
    resource: 'finance.currencies',
    pagination: { currentPage: 1, pageSize: 100 },
  })
  const projects = useList<FinanceReferenceRow, HttpError>({
    resource: 'finance.projects',
    pagination: { currentPage: 1, pageSize: 100 },
  })
  const categories = useList<FinanceReferenceRow, HttpError>({
    resource: 'finance.categories',
    pagination: { currentPage: 1, pageSize: 100 },
  })
  return {
    options: {
      currencies: currencies.result.data.filter((row) => row.retiredAt === null),
      projects: projects.result.data.filter((row) => row.retiredAt === null),
      categories: categories.result.data.filter((row) => row.retiredAt === null),
    },
    error: currencies.query.error ?? projects.query.error ?? categories.query.error ?? undefined,
  }
}

export function FinanceReferenceCreateScreen({ resource }: { resource: FinanceReferenceResource }) {
  const config = financeReferenceUi[resource]
  const resourceName = financeResourceName(resource)
  const create = useCreate<FinanceReferenceRow, HttpError, Record<string, unknown>>()
  const { options, error } = useReferenceOptions()
  const [saved, setSaved] = React.useState(false)

  function submit(values: Record<string, unknown>) {
    setSaved(false)
    create.mutate({ resource: resourceName, values }, { onSuccess: () => setSaved(true) })
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Добавить {config.singular}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{config.description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Новая запись</CardTitle>
          <CardDescription>Поля проверяются до записи в финансовый контур.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {saved ? (
            <Alert role="status">
              <AlertDescription>Запись сохранена и добавлена в справочник.</AlertDescription>
            </Alert>
          ) : null}
          <FinanceReferenceForm
            resource={resource}
            options={options}
            readOnly={false}
            pending={create.mutation.isPending}
            submitLabel="Сохранить"
            failure={
              error
                ? message(error, 'Не удалось загрузить связанные справочники.')
                : create.mutation.error
                  ? message(create.mutation.error, 'Не удалось сохранить запись.')
                  : undefined
            }
            onChange={() => setSaved(false)}
            onSubmit={submit}
          />
        </CardContent>
      </Card>
    </section>
  )
}

export function FinanceReferenceRecordScreen({
  resource,
  id,
  mode,
}: {
  resource: FinanceReferenceResource
  id: string
  mode: 'show' | 'edit'
}) {
  const config = financeReferenceUi[resource]
  const resourceName = financeResourceName(resource)
  const navigation = useNavigation()
  const update = useUpdate<FinanceReferenceRow, HttpError, Record<string, unknown>>()
  const { query, result } = useOne<FinanceReferenceRow, HttpError>({ resource: resourceName, id })
  const { options, error: optionsError } = useReferenceOptions()
  const [saved, setSaved] = React.useState(false)

  if (query.isLoading) return <Skeleton className="h-96 w-full" />
  if (query.error || !result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{message(query.error, 'Не удалось прочитать запись.')}</AlertDescription>
      </Alert>
    )
  }

  const row = result
  const systemAccount = resource === 'accounts' && row.isSystem === true
  const retired = row.retiredAt !== null
  const editable = mode === 'edit' && !systemAccount && !retired

  function save(values: Record<string, unknown>) {
    setSaved(false)
    update.mutate({ resource: resourceName, id, values }, { onSuccess: () => setSaved(true) })
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{row.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{config.title}</p>
        </div>
        {mode === 'show' && !systemAccount && !retired ? (
          <Button onClick={() => navigation.edit(resourceName, id)}>Редактировать</Button>
        ) : mode === 'edit' ? (
          <Button variant="outline" onClick={() => navigation.show(resourceName, id)}>
            Открыть карточку
          </Button>
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Карточка справочника</CardTitle>
          <CardDescription>
            {systemAccount
              ? 'Системный счёт ведёт модуль: редактирование недоступно.'
              : retired
                ? 'Запись находится в архиве и доступна только для чтения.'
                : 'Изменения фиксируются с автором и временем.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {saved ? (
            <Alert role="status">
              <AlertDescription>Изменения сохранены.</AlertDescription>
            </Alert>
          ) : null}
          <FinanceReferenceForm
            key={`${resource}-${id}-${mode}`}
            resource={resource}
            row={row}
            options={options}
            readOnly={!editable}
            pending={update.mutation.isPending}
            submitLabel="Сохранить изменения"
            failure={
              optionsError
                ? message(optionsError, 'Не удалось загрузить связанные справочники.')
                : update.mutation.error
                  ? message(update.mutation.error, 'Не удалось сохранить изменения.')
                  : undefined
            }
            onChange={() => setSaved(false)}
            onSubmit={save}
          />
        </CardContent>
      </Card>
    </section>
  )
}
