'use client'

import React from 'react'

import type { HoursPeriodCreate, HoursPeriodRecord } from '@/lib/hours'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'

export function periodFormValue(period?: HoursPeriodRecord): HoursPeriodCreate {
  return {
    label: period?.label ?? '',
    dateFrom: period?.dateFrom ?? '',
    dateTo: period?.dateTo ?? '',
  }
}

export function HoursPeriodForm({
  initial,
  pending,
  locked = false,
  failure,
  submitLabel,
  onSubmit,
}: {
  initial: HoursPeriodCreate
  pending: boolean
  locked?: boolean
  failure?: string
  submitLabel: string
  onSubmit: (value: HoursPeriodCreate) => void
}) {
  const [value, setValue] = React.useState(initial)
  const [issues, setIssues] = React.useState<string[]>([])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: string[] = []
    if (!value.label.trim()) next.push('Укажите название периода.')
    if (!value.dateFrom) next.push('Укажите дату начала.')
    if (!value.dateTo) next.push('Укажите дату окончания.')
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      next.push('Дата начала не может быть позже даты окончания.')
    }
    setIssues(next)
    if (next.length === 0) onSubmit({ ...value, label: value.label.trim() })
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      {failure ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      {issues.length ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="hours-period-label">Название</Label>
        <Input
          id="hours-period-label"
          value={value.label}
          disabled={pending || locked}
          onChange={(event) => setValue({ ...value, label: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="hours-period-from">Начало</Label>
          <Input
            id="hours-period-from"
            type="date"
            value={value.dateFrom}
            disabled={pending || locked}
            onChange={(event) => setValue({ ...value, dateFrom: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hours-period-to">Окончание</Label>
          <Input
            id="hours-period-to"
            type="date"
            value={value.dateTo}
            disabled={pending || locked}
            onChange={(event) => setValue({ ...value, dateTo: event.target.value })}
          />
        </div>
      </div>
      <Button type="submit" disabled={pending || locked}>
        {pending ? 'Сохраняем…' : submitLabel}
      </Button>
    </form>
  )
}
