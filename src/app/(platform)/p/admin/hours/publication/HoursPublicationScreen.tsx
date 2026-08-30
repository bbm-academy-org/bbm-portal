'use client'

import { useList, type HttpError } from '@refinedev/core'
import React from 'react'
import { z } from 'zod'

import {
  hoursPublicationRecordSchema,
  type HoursPeriodRecord,
  type HoursPublicationRecord,
} from '@/lib/hours/admin-contract'
import { plural } from '@/lib/hours/format'
import { pickDefaultPeriod } from '@/lib/hours/calendar'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'

import { errorMessage, HOURS_PERIOD_RESOURCE } from '../constants'

const envelopeSchema = z.object({ data: hoursPublicationRecordSchema })

async function responseData(response: Response): Promise<HoursPublicationRecord> {
  const raw: unknown = await response.json()
  if (!response.ok) {
    const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(raw)
    throw new Error(message.success ? message.data.error.message : 'Запрос публикации отклонён.')
  }
  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Ответ публикации не соответствует контракту модуля.')
  return parsed.data.data
}

async function publicationData(periodId: string, signal?: AbortSignal) {
  return responseData(
    await fetch(`/api/p/hours/admin/publication?periodId=${encodeURIComponent(periodId)}`, {
      signal,
    }),
  )
}

function publicationTime(value: string): string {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Moscow',
      }).format(instant)
}

function deliveryLabel(delivery: HoursPublicationRecord['messages'][number]['delivery']) {
  switch (delivery) {
    case 'sent':
      return 'Отправлено'
    case 'failed':
      return 'Не доставлено'
    case 'unknown':
      return 'Результат неизвестен'
    case 'pending':
      return 'Ожидает отправки'
    default:
      return null
  }
}

function assessmentCount(count: number): string {
  return `${count} ${plural(
    count,
    'сохранённая оценка',
    'сохранённые оценки',
    'сохранённых оценок',
  )}`
}

function sendLabel(count: number): string {
  return `Отправить ${count} ${plural(count, 'сообщение', 'сообщения', 'сообщений')} в „BBM Финансы“`
}

export function HoursPublicationScreen() {
  const { query, result } = useList<HoursPeriodRecord, HttpError>({
    resource: HOURS_PERIOD_RESOURCE,
    pagination: { mode: 'off' },
  })
  const [periodId, setPeriodId] = React.useState('')
  const [preview, setPreview] = React.useState<HoursPublicationRecord | null>(null)
  const [previewExpanded, setPreviewExpanded] = React.useState(false)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const defaultPeriod = pickDefaultPeriod(result.data, (period) => period.dateTo)
  const effectivePeriodId = periodId || defaultPeriod?.id || ''
  const selectedPeriod = result.data.find((period) => period.id === effectivePeriodId)
  const visiblePreview = preview?.periodId === effectivePeriodId ? preview : null

  function selectPeriod(value: string) {
    setPeriodId(value)
    setPreview(null)
    setPreviewExpanded(false)
    setFailure(null)
    setSuccess(null)
  }

  async function togglePreview() {
    if (previewExpanded) {
      setPreviewExpanded(false)
      return
    }
    setPreviewExpanded(true)
    if (visiblePreview) return
    if (!effectivePeriodId) return
    const controller = new AbortController()
    setLoadingPreview(true)
    setFailure(null)
    setSuccess(null)
    try {
      const value = await publicationData(effectivePeriodId, controller.signal)
      if (!controller.signal.aborted) setPreview(value)
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(error instanceof Error ? error.message : 'Не удалось собрать предпросмотр.')
      }
    } finally {
      if (!controller.signal.aborted) setLoadingPreview(false)
    }
  }

  async function publish() {
    if (!visiblePreview) return
    setPublishing(true)
    setFailure(null)
    setSuccess(null)
    try {
      const next = await responseData(
        await fetch('/api/p/hours/admin/publication', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            periodId: visiblePreview.periodId,
            previewFingerprint: visiblePreview.previewFingerprint,
          }),
        }),
      )
      setPreview(next)
      setSuccess(`Опубликовано ${next.messages.length} сообщений в Mattermost.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось опубликовать сообщения.'
      try {
        setPreview(await publicationData(visiblePreview.periodId))
        setFailure(message)
      } catch {
        setPreview(null)
        setFailure(`${message} Обновите страницу перед любым следующим действием.`)
      }
    } finally {
      setPublishing(false)
    }
  }

  const sentCount = visiblePreview?.messages.filter((message) => message.delivery === 'sent').length
  const publicationTitle =
    visiblePreview?.publicationStatus === 'published'
      ? 'Опубликовано'
      : visiblePreview?.publicationStatus === 'incomplete'
        ? 'Публикация не завершена'
        : visiblePreview?.publicationStatus === 'sending'
          ? 'Публикация выполняется'
          : null
  const statusBadge =
    visiblePreview?.publicationStatus === 'published'
      ? 'Опубликовано'
      : visiblePreview?.publicationStatus === 'incomplete'
        ? 'Не завершено'
        : visiblePreview?.publicationStatus === 'sending'
          ? 'Отправка'
          : visiblePreview?.eligibility.canPublish
            ? 'Готово'
            : 'Недоступно'

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Публикация в Mattermost
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Сначала проверьте точные сообщения, затем запустите одну последовательную публикацию.
        </p>
      </div>

      {query.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(query.error, 'Не удалось прочитать периоды.')}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Период</CardTitle>
          <CardDescription>
            Открытый, пустой или уже опубликованный период будет честно заблокирован.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-md gap-2">
            <Label htmlFor="hours-publication-period">Период</Label>
            <Select
              value={effectivePeriodId}
              disabled={query.isLoading || result.data.length === 0}
              onValueChange={selectPeriod}
            >
              <SelectTrigger id="hours-publication-period" className="w-full">
                <SelectValue placeholder={query.isLoading ? 'Загружаем…' : 'Выберите период'} />
              </SelectTrigger>
              <SelectContent data-bbm-ui>
                {result.data.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!query.isLoading && !query.error && result.data.length === 0 ? (
            <Alert>
              <AlertDescription>
                Периодов пока нет — предпросмотр собрать не из чего.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {selectedPeriod ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Верификация в Mattermost</CardTitle>
                <CardDescription>
                  {assessmentCount(selectedPeriod.assessments.length)}
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => void togglePreview()}>
                {previewExpanded ? 'Скрыть предпросмотр сообщений' : 'Предпросмотр сообщений'}
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {failure ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}
      {previewExpanded && loadingPreview ? <Skeleton className="h-64 w-full" /> : null}
      {previewExpanded && !loadingPreview && visiblePreview ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Предпросмотр</CardTitle>
                <CardDescription>
                  {visiblePreview.messages.length} сообщений в неизменяемом порядке.
                </CardDescription>
              </div>
              <Badge variant={visiblePreview.eligibility.canPublish ? 'secondary' : 'outline'}>
                {statusBadge}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {publicationTitle ? (
              <Alert>
                <AlertTitle>{publicationTitle}</AlertTitle>
                <AlertDescription className="space-y-1">
                  <p>
                    Отправлено {sentCount} из {visiblePreview.messages.length} сообщений.
                  </p>
                  {visiblePreview.startedAt ? (
                    <p>
                      <span className="font-medium text-foreground">Начато</span>{' '}
                      <time dateTime={visiblePreview.startedAt}>
                        {publicationTime(visiblePreview.startedAt)}
                      </time>
                    </p>
                  ) : null}
                  {visiblePreview.publishedAt ? (
                    <p>
                      <span className="font-medium text-foreground">Завершено</span>{' '}
                      <time dateTime={visiblePreview.publishedAt}>
                        {publicationTime(visiblePreview.publishedAt)}
                      </time>
                    </p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {visiblePreview.eligibility.reason ? (
              <Alert>
                <AlertTitle>Публикация недоступна</AlertTitle>
                <AlertDescription>{visiblePreview.eligibility.reason}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {visiblePreview.messages.map((message, position) => (
                <article
                  key={`${position}:${message.email}`}
                  className="min-w-0 rounded-md border bg-muted/20 p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{message.email}</p>
                    {deliveryLabel(message.delivery) ? (
                      <Badge variant="outline">{deliveryLabel(message.delivery)}</Badge>
                    ) : null}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                    {message.text}
                  </pre>
                </article>
              ))}
            </div>
            <Button
              disabled={!visiblePreview.eligibility.canPublish || publishing}
              onClick={publish}
            >
              {publishing ? 'Отправляем…' : sendLabel(visiblePreview.messages.length)}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
