'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import React, { useState, useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import type { PollRecord, VoterBallot } from '@/lib/vote'
// Values from the pure rules file, not the barrel: the barrel also carries
// the storage door, which must never reach a client bundle.
import {
  CONSENT_ANSWER_LABELS,
  CONSENT_ANSWERS,
  CONSENT_ANSWERS_NEEDING_COMMENT,
  RATING_MAX_CHOICES,
} from '@/lib/vote/rules'
import { submitBallotAction } from '@/modules/vote/actions'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/ui/form'
import { Textarea } from '@/ui/textarea'

/**
 * One open poll's ballot (#575) on the kit `Form` block
 * (`docs/design/ui-whitelist.md` → Form). The browser checks the same limits
 * the server enforces — at most two choices, a comment for a wish or an
 * objection — so a member sees the reason before submitting; the server
 * (`@/lib/vote` → `submitBallot`) is still the only judge.
 */

const ratingSchema = z.object({
  choices: z
    .array(z.number())
    .min(1, 'Выберите хотя бы один вариант.')
    .max(RATING_MAX_CHOICES, `Можно выбрать не больше ${RATING_MAX_CHOICES} вариантов.`),
})

const consentSchema = z
  .object({
    answer: z.enum(CONSENT_ANSWERS, { message: 'Выберите ответ.' }),
    comment: z.string(),
  })
  .refine((v) => !CONSENT_ANSWERS_NEEDING_COMMENT.includes(v.answer) || v.comment.trim() !== '', {
    path: ['comment'],
    message: 'Для этого ответа комментарий обязателен.',
  })

type Outcome = { kind: 'saved' } | { kind: 'error'; message: string } | null

function SavedNotice({ text }: { text: string }) {
  return (
    <Alert role="status">
      <AlertTitle>Голос принят</AlertTitle>
      <AlertDescription>
        Ваш ответ: {text}. Пока голосование открыто, его можно изменить.
      </AlertDescription>
    </Alert>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function RatingBallot({ poll, myBallot }: { poll: PollRecord; myBallot: VoterBallot | null }) {
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const form = useForm<z.infer<typeof ratingSchema>>({
    resolver: zodResolver(ratingSchema),
    defaultValues: { choices: myBallot?.choices ?? [] },
  })
  const chosen = useWatch({ control: form.control, name: 'choices' })

  const onSubmit = (values: z.infer<typeof ratingSchema>) =>
    startTransition(async () => {
      const result = await submitBallotAction({ pollId: poll.id, choices: values.choices })
      setOutcome(result.ok ? { kind: 'saved' } : { kind: 'error', message: result.error })
    })

  const current = myBallot?.choices.map((i) => poll.options[i]).join('; ')

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="choices"
          render={({ field }) => (
            <FormItem>
              <FormDescription>
                Выберите один или два варианта (выбрано {chosen.length} из {RATING_MAX_CHOICES}).
              </FormDescription>
              <div className="space-y-3">
                {poll.options.map((option, index) => {
                  const checked = field.value.includes(index)
                  const full = !checked && field.value.length >= RATING_MAX_CHOICES
                  return (
                    <FormItem key={option} className="flex items-start gap-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={checked}
                          disabled={full || pending}
                          onCheckedChange={(next) =>
                            field.onChange(
                              next
                                ? [...field.value, index]
                                : field.value.filter((value) => value !== index),
                            )
                          }
                        />
                      </FormControl>
                      <FormLabel className="text-base leading-snug font-normal">{option}</FormLabel>
                    </FormItem>
                  )
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Отправляем…' : myBallot ? 'Изменить голос' : 'Проголосовать'}
        </Button>
        {outcome?.kind === 'error' ? <ErrorNotice message={outcome.message} /> : null}
        {current && outcome?.kind !== 'error' ? <SavedNotice text={current} /> : null}
      </form>
    </Form>
  )
}

function ConsentBallot({ poll, myBallot }: { poll: PollRecord; myBallot: VoterBallot | null }) {
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const form = useForm<z.input<typeof consentSchema>>({
    resolver: zodResolver(consentSchema),
    defaultValues: {
      answer: myBallot?.consentAnswer ?? undefined,
      comment: myBallot?.comment ?? '',
    },
  })
  const answer = useWatch({ control: form.control, name: 'answer' })
  const needsComment = answer !== undefined && CONSENT_ANSWERS_NEEDING_COMMENT.includes(answer)

  const onSubmit = (values: z.input<typeof consentSchema>) =>
    startTransition(async () => {
      const result = await submitBallotAction({
        pollId: poll.id,
        answer: values.answer,
        comment: values.comment,
      })
      setOutcome(result.ok ? { kind: 'saved' } : { kind: 'error', message: result.error })
    })

  const current = myBallot?.consentAnswer
    ? `${CONSENT_ANSWER_LABELS[myBallot.consentAnswer]}${myBallot.comment ? ` — «${myBallot.comment}»` : ''}`
    : null

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="answer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ваш ответ</FormLabel>
              <div role="radiogroup" aria-label="Ваш ответ" className="flex flex-wrap gap-2">
                {CONSENT_ANSWERS.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={field.value === value}
                    variant={field.value === value ? 'default' : 'outline'}
                    disabled={pending}
                    onClick={() => field.onChange(value)}
                  >
                    {CONSENT_ANSWER_LABELS[value]}
                  </Button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Комментарий{needsComment ? ' (обязательно)' : ' (необязательно)'}
              </FormLabel>
              <FormControl>
                <Textarea rows={3} disabled={pending} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Отправляем…' : myBallot ? 'Изменить ответ' : 'Ответить'}
        </Button>
        {outcome?.kind === 'error' ? <ErrorNotice message={outcome.message} /> : null}
        {current && outcome?.kind !== 'error' ? <SavedNotice text={current} /> : null}
      </form>
    </Form>
  )
}

export function BallotForm({ poll, myBallot }: { poll: PollRecord; myBallot: VoterBallot | null }) {
  return poll.kind === 'rating' ? (
    <RatingBallot poll={poll} myBallot={myBallot} />
  ) : (
    <ConsentBallot poll={poll} myBallot={myBallot} />
  )
}
