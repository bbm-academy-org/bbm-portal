'use client'

import React from 'react'

import type { HoursParticipantCreate, HoursParticipantRecord } from '@/lib/hours'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

export interface ParticipantFormValue {
  email: string
  name: string
  role: string
  forkMin: string
  forkMax: string
  grade: 'none' | 'I' | 'II' | 'III'
}

export function participantFormValue(participant?: HoursParticipantRecord): ParticipantFormValue {
  return {
    email: participant?.email ?? '',
    name: participant?.name ?? '',
    role: participant?.role ?? '',
    forkMin: participant?.forkMin == null ? '' : String(participant.forkMin),
    forkMax: participant?.forkMax == null ? '' : String(participant.forkMax),
    grade: participant?.grade ?? 'none',
  }
}

export function participantPayload(value: ParticipantFormValue): HoursParticipantCreate {
  return {
    email: value.email.trim(),
    name: value.name.trim(),
    role: value.role.trim() || null,
    forkMin: value.forkMin === '' ? null : Number(value.forkMin),
    forkMax: value.forkMax === '' ? null : Number(value.forkMax),
    grade: value.grade === 'none' ? null : value.grade,
  }
}

export function HoursParticipantForm({
  initial,
  emailReadOnly,
  pending,
  failure,
  submitLabel,
  onSubmit,
}: {
  initial: ParticipantFormValue
  emailReadOnly: boolean
  pending: boolean
  failure?: string
  submitLabel: string
  onSubmit: (value: ParticipantFormValue) => void
}) {
  const [value, setValue] = React.useState(initial)
  const [issues, setIssues] = React.useState<string[]>([])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: string[] = []
    if (!/^\S+@\S+\.\S+$/.test(value.email.trim())) next.push('Укажите корректный email.')
    if (!value.name.trim()) next.push('Укажите имя.')
    const min = value.forkMin === '' ? null : Number(value.forkMin)
    const max = value.forkMax === '' ? null : Number(value.forkMax)
    if (min != null && (!Number.isFinite(min) || min < 0))
      next.push('Нижняя граница вилки должна быть не меньше нуля.')
    if (max != null && (!Number.isFinite(max) || max < 0))
      next.push('Верхняя граница вилки должна быть не меньше нуля.')
    if (min != null && max != null && min > max)
      next.push('Нижняя граница вилки не может быть выше верхней.')
    setIssues(next)
    if (next.length === 0) onSubmit(value)
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
        <Label htmlFor="hours-participant-email">Email</Label>
        <Input
          id="hours-participant-email"
          type="email"
          value={value.email}
          readOnly={emailReadOnly}
          disabled={pending}
          onChange={(event) => setValue({ ...value, email: event.target.value })}
        />
        {emailReadOnly ? (
          <p className="text-xs text-muted-foreground">
            Email — ключ истории часов и здесь не меняется.
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hours-participant-name">Имя</Label>
        <Input
          id="hours-participant-name"
          value={value.name}
          disabled={pending}
          onChange={(event) => setValue({ ...value, name: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hours-participant-role">Роль</Label>
        <Input
          id="hours-participant-role"
          value={value.role}
          disabled={pending}
          onChange={(event) => setValue({ ...value, role: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="hours-fork-min">Вилка от, ₽/мес</Label>
          <Input
            id="hours-fork-min"
            type="number"
            min="0"
            step="1000"
            value={value.forkMin}
            disabled={pending}
            onChange={(event) => setValue({ ...value, forkMin: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hours-fork-max">Вилка до, ₽/мес</Label>
          <Input
            id="hours-fork-max"
            type="number"
            min="0"
            step="1000"
            value={value.forkMax}
            disabled={pending}
            onChange={(event) => setValue({ ...value, forkMax: event.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hours-grade">Грейд</Label>
        <Select
          value={value.grade}
          disabled={pending}
          onValueChange={(grade) =>
            setValue({ ...value, grade: grade as ParticipantFormValue['grade'] })
          }
        >
          <SelectTrigger id="hours-grade" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent data-bbm-ui>
            <SelectItem value="none">Не задан</SelectItem>
            <SelectItem value="I">I — нижняя треть вилки</SelectItem>
            <SelectItem value="II">II — середина вилки</SelectItem>
            <SelectItem value="III">III — верхняя треть вилки</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Сохраняем…' : submitLabel}
      </Button>
    </form>
  )
}
