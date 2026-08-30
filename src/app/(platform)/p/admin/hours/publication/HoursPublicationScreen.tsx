'use client'

import { useList, type HttpError } from '@refinedev/core'
import React from 'react'
import { z } from 'zod'

import {
  hoursPublicationRecordSchema,
  type HoursPeriodRecord,
  type HoursPublicationRecord,
} from '@/lib/hours/admin-contract'
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

export function HoursPublicationScreen() {
  const { query, result } = useList<HoursPeriodRecord, HttpError>({
    resource: HOURS_PERIOD_RESOURCE,
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: 'dateFrom', order: 'desc' }],
  })
  const [periodId, setPeriodId] = React.useState('')
  const [preview, setPreview] = React.useState<HoursPublicationRecord | null>(null)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const effectivePeriodId = periodId || result.data[0]?.id || ''
  const visiblePreview = preview?.periodId === effectivePeriodId ? preview : null

  React.useEffect(() => {
    if (!effectivePeriodId) return
    const controller = new AbortController()
    async function loadPreview() {
      setLoadingPreview(true)
      setFailure(null)
      setSuccess(null)
      try {
        const response = await fetch(
          `/api/p/hours/admin/publication?periodId=${encodeURIComponent(effectivePeriodId)}`,
          { signal: controller.signal },
        )
        const value = await responseData(response)
        if (!controller.signal.aborted) setPreview(value)
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailure(error instanceof Error ? error.message : 'Не удалось собрать предпросмотр.')
        }
      } finally {
        if (!controller.signal.aborted) setLoadingPreview(false)
      }
    }
    void loadPreview()
    return () => controller.abort()
  }, [effectivePeriodId])

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
      setFailure(error instanceof Error ? error.message : 'Не удалось опубликовать сообщения.')
    } finally {
      setPublishing(false)
    }
  }

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
              onValueChange={setPeriodId}
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
      {loadingPreview ? <Skeleton className="h-64 w-full" /> : null}
      {!loadingPreview && visiblePreview ? (
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
                {visiblePreview.eligibility.canPublish ? 'Готово' : 'Недоступно'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {visiblePreview.eligibility.reason ? (
              <Alert>
                <AlertTitle>Публикация недоступна</AlertTitle>
                <AlertDescription>{visiblePreview.eligibility.reason}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {visiblePreview.messages.map((message) => (
                <article key={message.email} className="min-w-0 rounded-md border bg-muted/20 p-4">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">{message.email}</p>
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
              {publishing ? 'Публикуем…' : 'Опубликовать в Mattermost'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
