'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import React from 'react'
import { useForm } from 'react-hook-form'

import { Alert, AlertDescription } from '@/ui/alert'
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
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Separator } from '@/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet'
import { Textarea } from '@/ui/textarea'

import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import {
  createRequestFormSchema,
  productOptions,
  requestFormDefaults,
  type RequestFormValue,
} from './request-form-model'

const NONE = '—'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

/**
 * «Новая заявка» — the EARS-508 field contract as a form, in the SAME sheet the
 * board reads records in.
 *
 * GROUPING IS THE DECISION HERE (owner ruling 2026-09-02; the defect #433 filed
 * against the previous version was «eleven ungrouped fields»). The reader
 * answers two questions and then makes one declaration: WHAT was bought and
 * for what (purpose, project, product, note), HOW MUCH and to whom (amount,
 * currency, counterparty) — and then «как оплачено», which is a declaration
 * rather than another field, because it changes what the rest MEANS.
 *
 * A REQUEST IS AN INTENT (owner ruling, Антон, 2026-09-03, #388 — EARS-508/533),
 * and that is why the money facts now live INSIDE «Как оплачено» instead of in
 * the sections above: the paying account, the date money moved and the
 * account-side amount only exist once «Уже потрачено» is ticked. Unticked, the
 * member is not asked to guess them and the form says who fills them in
 * instead. Revealing them under the checkbox rather than disabling them is the
 * choice: a disabled field still reads as something you owe an answer to.
 *
 * CONTROLS ARE THE KIT'S. Every field is `@/ui/form` + the kit control that
 * matches its type — the hand-rolled `NativeSelect` beside `src/ui/select.tsx`
 * is exactly what `pnpm lint:primitives-first` was filed for. Field state is
 * react-hook-form's, and the rules are one zod schema (`request-form-model.ts`)
 * whose messages land under the field that is wrong instead of in a summary
 * Alert above the form.
 */
export function RequestFormSheet({
  references,
  request,
  pending,
  failure,
  onSubmit,
  onClose,
}: {
  references: RequestBoardReferences
  request?: RequestBoardItem
  pending: boolean
  failure?: string
  onSubmit: (value: RequestFormValue) => void
  onClose: () => void
}) {
  const schema = React.useMemo(() => createRequestFormSchema(references), [references])
  const form = useForm<RequestFormValue>({
    resolver: zodResolver(schema),
    defaultValues: requestFormDefaults(references, request),
    mode: 'onSubmit',
  })

  const [currency, accountId, purposeId, projectId, alreadyPaid, personalFunds] = form.watch([
    'currency',
    'accountId',
    'purposeId',
    'projectId',
    'alreadyPaid',
    'personalFunds',
  ])
  const account = references.accounts.find((row) => String(row.id) === accountId) ?? null
  const crossCurrency = account !== null && account.currency !== currency
  const products = productOptions(references, purposeId, projectId)

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        data-bbm-ui
        side="right"
        showCloseButton={false}
        className="w-full overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>
            {request === undefined ? 'Новая заявка' : `Заявка №${request.id}`}
          </SheetTitle>
          <SheetDescription>
            Заявка на расход: что купили, сколько и кому. Документ прикладывается к карточке после
            сохранения.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form className="space-y-6 px-4 pb-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            {failure ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}

            <Section title="Что и зачем">
              <FormField
                control={form.control}
                name="purposeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Назначение</FormLabel>
                    <Select
                      value={field.value === '' ? NONE : field.value}
                      disabled={pending}
                      onValueChange={(value) => field.onChange(value === NONE ? '' : value)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите назначение" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent data-bbm-ui>
                        <SelectItem value={NONE}>Нет подходящего — предложу новое</SelectItem>
                        {references.purposes.map((purpose) => (
                          <SelectItem key={purpose.id} value={String(purpose.id)}>
                            {purpose.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {purposeId === '' ? (
                <FormField
                  control={form.control}
                  name="purposeProposal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Предложение назначения</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={pending}
                          placeholder="Например: аренда студии"
                        />
                      </FormControl>
                      <FormDescription>
                        Предложение уйдёт админу в справочники; заявка ждёт, пока назначение не
                        появится.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Проект</FormLabel>
                    <Select value={field.value} disabled={pending} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите проект" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent data-bbm-ui>
                        {references.projects.map((project) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {products.length > 0 ? (
                <FormField
                  control={form.control}
                  name="productId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Продукт</FormLabel>
                      <Select
                        value={field.value === '' ? NONE : field.value}
                        disabled={pending}
                        onValueChange={(value) => field.onChange(value === NONE ? '' : value)}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите продукт" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent data-bbm-ui>
                          <SelectItem value={NONE}>Без продукта</SelectItem>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={String(product.id)}>
                              {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Комментарий</FormLabel>
                    <FormControl>
                      <Textarea {...field} disabled={pending} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Section>

            <Section title="Сколько и кому">
              <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Сумма документа</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          disabled={pending}
                          placeholder="0,00"
                        />
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
                      <FormLabel>Валюта</FormLabel>
                      <Select value={field.value} disabled={pending} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent data-bbm-ui>
                          {references.currencies.map((row) => (
                            <SelectItem key={row.code} value={row.code}>
                              {row.code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="counterpartyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Контрагент</FormLabel>
                    <Select
                      value={field.value === '' ? NONE : field.value}
                      disabled={pending}
                      onValueChange={(value) => field.onChange(value === NONE ? '' : value)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите контрагента" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent data-bbm-ui>
                        <SelectItem value={NONE}>Нет в списке — впишу нового</SelectItem>
                        {references.counterparties.map((row) => (
                          <SelectItem key={row.id} value={String(row.id)}>
                            {row.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="counterpartyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Новый контрагент</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={pending} placeholder="Название" />
                    </FormControl>
                    <FormDescription>
                      Заполняется, только когда подходящего контрагента нет в справочнике.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Section>

            <Separator />

            <Section title="Как оплачено">
              <FormField
                control={form.control}
                name="alreadyPaid"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        disabled={pending}
                        onCheckedChange={(checked) => {
                          const on = checked === true
                          field.onChange(on)
                          // Unticking must not leave a paying account and a date
                          // behind in hidden fields — a pre-spend request carries
                          // neither (EARS-533), and the body it files says so.
                          if (!on) {
                            form.setValue('occurredOn', '')
                            form.setValue('accountId', '')
                            form.setValue('paidAmount', '')
                            form.setValue('personalFunds', false)
                          }
                        }}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel>Уже потрачено</FormLabel>
                      <FormDescription>
                        {alreadyPaid
                          ? 'Деньги уже ушли; это подтверждение траты — назовите счёт и дату.'
                          : 'Деньги ещё не двигались. Счёт списания и дату впишет финансовая роль в момент проведения.'}
                      </FormDescription>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              {alreadyPaid ? (
                <div className="space-y-4 border-l-2 pl-4">
                  <FormField
                    control={form.control}
                    name="personalFunds"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start gap-3">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            disabled={pending}
                            onCheckedChange={(checked) => {
                              field.onChange(checked === true)
                              if (checked === true) form.setValue('accountId', '')
                            }}
                          />
                        </FormControl>
                        <div className="space-y-1">
                          <FormLabel>Оплачено своими средствами</FormLabel>
                          <FormDescription>
                            BBM останется должен эту сумму — долг попадёт в «Обязательства».
                          </FormDescription>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />

                  {personalFunds ? null : (
                    <FormField
                      control={form.control}
                      name="accountId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Счёт списания</FormLabel>
                          <Select
                            value={field.value === '' ? NONE : field.value}
                            disabled={pending}
                            onValueChange={(value) => field.onChange(value === NONE ? '' : value)}
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Выберите счёт" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent data-bbm-ui>
                              <SelectItem value={NONE}>Не выбран</SelectItem>
                              {references.accounts.map((row) => (
                                <SelectItem key={row.id} value={String(row.id)}>
                                  {row.name} · {row.currency}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {crossCurrency ? (
                    <FormField
                      control={form.control}
                      name="paidAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Списано со счёта, {account.currency}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              inputMode="decimal"
                              disabled={pending}
                              placeholder="0,00"
                            />
                          </FormControl>
                          <FormDescription>
                            Счёт в {account.currency}, документ в {currency} — нужна фактически
                            списанная сумма.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}

                  <FormField
                    control={form.control}
                    name="occurredOn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Дата движения денег</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" disabled={pending} />
                        </FormControl>
                        <FormDescription>
                          День, когда деньги действительно ушли, — не дата документа.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
            </Section>

            <SheetFooter className="flex-row gap-2 px-0">
              <Button type="submit" disabled={pending}>
                {pending ? 'Сохраняем…' : 'Подать заявку'}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                Отмена
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
