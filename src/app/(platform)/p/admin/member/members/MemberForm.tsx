'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import React from 'react'
import { useForm } from 'react-hook-form'

import type { MemberRecord, MemberUpdateInput } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/ui/form'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Separator } from '@/ui/separator'

import {
  MEMBER_TIMEZONE_OPTIONS,
  memberFormSchema,
  withSavedReference,
  type MemberFormValue,
} from './constants'

export type { MemberFormValue }

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

/**
 * The member profile form (#316), rebuilt on the kit's `form` block (#434).
 *
 * WHAT CHANGED AND WHY. The previous version held its five fields in one
 * `useState<MemberFormValue>`, validated them in an `if` ladder on submit, and
 * reported every problem as a bullet list in a destructive `<Alert>` above the
 * form — so a reader with a bad email had to map a sentence at the top of the
 * card back to the field at the bottom. `react-hook-form` + `zodResolver` over
 * `memberFormSchema` puts each message under the field it belongs to
 * (`<FormMessage>`), gives the invalid control `aria-invalid`, and makes the
 * schema the one place the rules are written.
 *
 * GROUPING (the agent's call, owner ruling 2026-09-02). Five fields is not
 * eleven, so this is not a case for sections with headings — but the fields are
 * not one list either: three of them say WHO the person is (name, email, role)
 * and two say how the workspace TREATS them (timezone, status). A `Separator`
 * between the two runs is the smallest device that carries that, and it costs
 * no vertical rhythm.
 *
 * FEEDBACK. Success is a toast — the shell's one notification channel
 * (`CabinetShell`). The destructive Alert that remains is only for a save that
 * FAILED while the form is still on screen: the toast says it happened, the
 * Alert is what the reader keeps looking at while fixing it.
 */
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
  const form = useForm<MemberFormValue>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: initial,
    mode: 'onSubmit',
  })
  const timezone = form.watch('timezone')
  const timezoneOptions = withSavedReference(MEMBER_TIMEZONE_OPTIONS, timezone, 'Сохранённый пояс')

  // One place to tell the parent «the record on screen is no longer the record
  // that was saved», rather than an `onChange` on every control.
  const { isDirty } = form.formState
  React.useEffect(() => {
    if (isDirty) onChange?.()
  }, [isDirty, onChange])

  return (
    <Form {...form}>
      <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {failure ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Имя</FormLabel>
              <FormControl>
                <Input {...field} readOnly={readOnly} disabled={pending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  readOnly={readOnly || emailReadOnly}
                  disabled={pending}
                />
              </FormControl>
              {emailReadOnly ? (
                <FormDescription>
                  Email связывает участника с Zitadel и историей часов, поэтому здесь не меняется.
                </FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Роль</FormLabel>
              <FormControl>
                <Input {...field} readOnly={readOnly} disabled={pending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Часовой пояс</FormLabel>
              <Select
                value={field.value}
                disabled={pending || readOnly}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите часовой пояс" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent data-bbm-ui>
                  {timezoneOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {canEditStatus ? (
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Статус</FormLabel>
                <Select
                  value={field.value}
                  disabled={pending || readOnly}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent data-bbm-ui>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="inactive">Неактивен</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {!readOnly ? (
          <Button type="submit" disabled={pending}>
            {pending ? 'Сохраняем…' : submitLabel}
          </Button>
        ) : null}
      </form>
    </Form>
  )
}
