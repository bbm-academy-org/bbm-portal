'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet'
import { Toaster } from '@/ui/sonner'

import { limitText, parseLimitAmount } from './budget-view'

/**
 * The budget limit form of spec 584 §H (EARS-723…727): «Задать бюджет»,
 * «Изменить лимит», «Закрыть бюджет», shown only to a `finance-approve`
 * session. The whitelist's Form row in a Sheet; the outcome is its Feedback
 * row — a sonner toast — and the page re-reads every figure (EARS-727).
 */

export type BudgetLimitCurrent = {
  id: number
  name: string
  limitAmount: string
  currency: string
  startsOn: string
}

export type BudgetLimitActionsProps = {
  current: BudgetLimitCurrent | null
  currencies: { code: string; name: string; precision: number }[]
  /** EARS-724 — BBM's first operation, or today on an empty ledger. */
  defaultStartsOn: string
}

const schema = z.object({
  name: z.string().trim().min(1, 'Укажите название бюджета.'),
  limit: z.string().trim().min(1, 'Укажите лимит.'),
  currency: z.string().min(1, 'Укажите валюту бюджета.'),
  startsOn: z.iso.date({ error: 'Укажите дату начала бюджета.' }),
})
type Values = z.infer<typeof schema>

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.ok) return null
  return (await response.text()) || 'Бюджет не записан.'
}

export function BudgetLimitActions({
  current,
  currencies,
  defaultStartsOn,
}: BudgetLimitActionsProps) {
  const [open, setOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [retiring, setRetiring] = React.useState(false)
  const router = useRouter()

  async function retire() {
    if (current === null) return
    setRetiring(true)
    const refusal = await send(`/p/finance/api/budget/${current.id}/retire`, 'POST')
    setRetiring(false)
    setConfirming(false)
    if (refusal !== null) {
      toast.error(refusal)
      return
    }
    toast.success('Бюджет закрыт')
    router.refresh()
  }

  return (
    <div className="flex gap-2">
      <Toaster position="bottom-right" richColors closeButton />
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {current === null ? 'Задать бюджет' : 'Изменить лимит'}
      </Button>
      {current !== null && (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Закрыть бюджет
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {open && (
            <LimitForm
              current={current}
              currencies={currencies}
              defaultStartsOn={defaultStartsOn}
              onDone={() => {
                setOpen(false)
                router.refresh()
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть бюджет?</AlertDialogTitle>
            <AlertDialogDescription>
              Цифры дашборда исчезнут, пока бюджет не задан снова. Изменение останется в журнале
              аудита; бюджет не удаляется.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retiring}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={retiring}
              onClick={(event) => {
                event.preventDefault()
                void retire()
              }}
            >
              Закрыть бюджет
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function LimitForm({
  current,
  currencies,
  defaultStartsOn,
  onDone,
}: BudgetLimitActionsProps & { onDone: () => void }) {
  const precisionOf = (code: string) => currencies.find((c) => c.code === code)?.precision ?? 2
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues:
      current === null
        ? { name: '', limit: '', currency: 'RUB', startsOn: defaultStartsOn }
        : {
            name: current.name,
            limit: limitText(BigInt(current.limitAmount), precisionOf(current.currency)),
            currency: current.currency,
            startsOn: current.startsOn,
          },
  })
  const [refusal, setRefusal] = React.useState<string | null>(null)
  const pending = form.formState.isSubmitting

  async function submit(values: Values) {
    setRefusal(null)
    const limitAmount = parseLimitAmount(values.limit, precisionOf(values.currency))
    if (limitAmount === null) {
      form.setError('limit', {
        message: 'Лимит — положительная сумма, не точнее минимальной единицы валюты.',
      })
      return
    }
    const body = {
      name: values.name,
      limitAmount: limitAmount.toString(),
      currency: values.currency,
      startsOn: values.startsOn,
    }
    const result =
      current === null
        ? await send('/p/finance/api/budget', 'POST', body)
        : await send(`/p/finance/api/budget/${current.id}`, 'PATCH', body)
    if (result !== null) {
      setRefusal(result)
      return
    }
    toast.success(current === null ? 'Бюджет задан' : 'Бюджет изменён')
    onDone()
  }

  const ordered = [...currencies].sort((a, b) =>
    a.code === 'RUB' ? -1 : b.code === 'RUB' ? 1 : a.code.localeCompare(b.code),
  )
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex h-full flex-col">
        <SheetHeader>
          <SheetTitle>{current === null ? 'Задать бюджет' : 'Изменить лимит'}</SheetTitle>
          <SheetDescription>
            Лимит — план расходов BBM. Каждое изменение записывается в журнал аудита.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          {refusal !== null && (
            <Alert variant="destructive">
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          )}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Название</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Операционный бюджет" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="limit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Лимит</FormLabel>
                <FormControl>
                  <Input {...field} inputMode="decimal" placeholder="1 000 000" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Валюта бюджета</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ordered.map((currency) => (
                      <SelectItem key={currency.code} value={currency.code}>
                        {currency.code} — {currency.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {current !== null && (
                  <FormDescription>
                    Смена валюты ничего не пересчитывает: лимит — введённая сумма в новой валюте.
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="startsOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Начало бюджета</FormLabel>
                <FormControl>
                  <Input {...field} type="date" />
                </FormControl>
                <FormDescription>
                  По умолчанию — дата первой операции BBM. Более поздняя дата оставляет прежние
                  расходы вне стакана.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <SheetFooter>
          <Button type="submit" disabled={pending}>
            {pending ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  )
}
