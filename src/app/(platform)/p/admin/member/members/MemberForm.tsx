'use client'

import React from 'react'

import type { MemberRecord, MemberUpdateInput } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

import { MEMBER_TIMEZONE_OPTIONS, withSavedReference } from './constants'

export interface MemberFormValue {
  name: string
  email: string
  role: string
  timezone: string
  status: MemberRecord['status']
}

export function memberFormValue(member?: MemberRecord): MemberFormValue {
  return {
    name: member?.name ?? '',
    email: member?.email ?? '',
    role: member?.role ?? '',
    timezone: member?.timezone ?? 'Europe/Moscow',
    status: member?.status ?? 'active',
  }
}

export function memberUpdateValue(value: MemberFormValue): MemberUpdateInput {
  return {
    name: value.name.trim(),
    role: value.role.trim() || null,
    timezone: value.timezone.trim(),
    status: value.status,
  }
}

export function MemberForm({
  initial,
  emailReadOnly,
  canEditStatus,
  submitLabel,
  pending,
  failure,
  readOnly = false,
  onChange,
  onSubmit,
}: {
  initial: MemberFormValue
  emailReadOnly: boolean
  canEditStatus: boolean
  submitLabel: string
  pending: boolean
  failure?: string
  readOnly?: boolean
  onChange?: () => void
  onSubmit: (value: MemberFormValue) => void
}) {
  const [value, setValue] = React.useState(initial)
  const [validation, setValidation] = React.useState<string[]>([])
  const timezoneOptions = withSavedReference(
    MEMBER_TIMEZONE_OPTIONS,
    value.timezone,
    'Сохранённый пояс',
  )

  function change(next: MemberFormValue) {
    setValue(next)
    onChange?.()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const issues: string[] = []
    if (!value.name.trim()) issues.push('Укажите имя.')
    if (!/^\S+@\S+\.\S+$/.test(value.email.trim())) issues.push('Укажите корректный email.')
    if (!value.timezone.trim()) issues.push('Укажите часовой пояс.')
    setValidation(issues)
    if (issues.length === 0) onSubmit(value)
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      {failure ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      {validation.length ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {validation.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="member-name">Имя</Label>
        <Input
          id="member-name"
          value={value.name}
          readOnly={readOnly}
          disabled={pending}
          onChange={(event) => change({ ...value, name: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="member-email">Email</Label>
        <Input
          id="member-email"
          type="email"
          value={value.email}
          readOnly={readOnly || emailReadOnly}
          disabled={pending}
          aria-describedby={emailReadOnly ? 'member-email-hint' : undefined}
          onChange={(event) => change({ ...value, email: event.target.value })}
        />
        {emailReadOnly ? (
          <p id="member-email-hint" className="text-xs text-muted-foreground">
            Email связывает участника с Zitadel и историей часов, поэтому здесь не меняется.
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="member-role">Роль</Label>
        <Input
          id="member-role"
          value={value.role}
          readOnly={readOnly}
          disabled={pending}
          onChange={(event) => change({ ...value, role: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="member-timezone">Часовой пояс</Label>
        <Select
          value={value.timezone}
          disabled={pending || readOnly}
          onValueChange={(timezone) => change({ ...value, timezone })}
        >
          <SelectTrigger id="member-timezone" className="w-full">
            <SelectValue placeholder="Выберите часовой пояс" />
          </SelectTrigger>
          <SelectContent data-bbm-ui>
            {timezoneOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {canEditStatus ? (
        <div className="grid gap-2">
          <Label htmlFor="member-status">Статус</Label>
          <Select
            value={value.status}
            disabled={pending || readOnly}
            onValueChange={(status) =>
              change({ ...value, status: status as MemberRecord['status'] })
            }
          >
            <SelectTrigger id="member-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-bbm-ui>
              <SelectItem value="active">Активен</SelectItem>
              <SelectItem value="inactive">Неактивен</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!readOnly ? (
        <Button type="submit" disabled={pending}>
          {pending ? 'Сохраняем…' : submitLabel}
        </Button>
      ) : null}
    </form>
  )
}
