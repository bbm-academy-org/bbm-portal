'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useNotification } from '@refinedev/core'
import React, { useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { POLL_KIND_LABELS, POLL_KINDS, parseOptions } from '@/lib/vote/rules'
import { createPollAction } from '@/modules/vote/actions'
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
import { Textarea } from '@/ui/textarea'

/**
 * «Новое голосование» (#575) on the kit `Form` block. The poll is created as
 * a draft; the server (`createPoll`) re-checks everything checked here.
 * Outcomes go through Refine's notification provider — the cabinet's one
 * feedback channel (`docs/design/ui-whitelist.md` → Feedback).
 */

const schema = z
  .object({
    title: z.string().refine((v) => v.trim() !== '', 'Укажите название.'),
    kind: z.enum(POLL_KINDS),
    options: z.string(),
  })
  .refine((v) => v.kind !== 'rating' || parseOptions(v.options).length >= 2, {
    path: ['options'],
    message: 'Для рейтинга нужно не меньше двух вариантов.',
  })

type Values = z.infer<typeof schema>

export function PollCreateForm() {
  const [pending, startTransition] = useTransition()
  const { open } = useNotification()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', kind: 'rating', options: '' },
  })
  const kind = useWatch({ control: form.control, name: 'kind' })

  const onSubmit = (values: Values) =>
    startTransition(async () => {
      const result = await createPollAction(values)
      if (result.ok) {
        form.reset({ title: '', kind: values.kind, options: '' })
        open?.({ type: 'success', message: 'Черновик создан' })
      } else {
        open?.({ type: 'error', message: result.error })
      }
    })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-2xl gap-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl>
                <Input disabled={pending} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Тип</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                <FormControl>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {POLL_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {POLL_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {kind === 'rating' ? (
          <FormField
            control={form.control}
            name="options"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Варианты</FormLabel>
                <FormControl>
                  <Textarea rows={6} disabled={pending} {...field} />
                </FormControl>
                <FormDescription>
                  По одному в строке, пустые строки не считаются. Участник выбирает до двух.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            У согласия нет вариантов: формулировка — это название, ответы фиксированы.
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Создаём…' : 'Создать черновик'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
