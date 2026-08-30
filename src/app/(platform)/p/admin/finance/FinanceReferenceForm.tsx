'use client'

import React from 'react'

import type { FinanceReferenceResource } from '@/lib/finance'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

import type { FinanceReferenceRow } from './reference-config'

export type ReferenceOptions = {
  currencies: FinanceReferenceRow[]
  projects: FinanceReferenceRow[]
  categories: FinanceReferenceRow[]
}

type FormValue = {
  code: string
  name: string
  precision: string
  kind: string
  currency: string
  projectId: string
  salePrice: string
  salePriceCurrency: string
  categoryId: string
  productBinding: string
  allocable: string
}

function initialValue(row?: FinanceReferenceRow): FormValue {
  return {
    code: String(row?.code ?? ''),
    name: String(row?.name ?? ''),
    precision: String(row?.precision ?? '2'),
    kind: String(row?.kind ?? 'bank'),
    currency: String(row?.currency ?? ''),
    projectId: String(row?.projectId ?? ''),
    salePrice: String(row?.salePrice ?? ''),
    salePriceCurrency: String(row?.salePriceCurrency ?? ''),
    categoryId: String(row?.categoryId ?? 'none'),
    productBinding: String(row?.productBinding ?? 'optional'),
    allocable: String(row?.allocable ?? 'false'),
  }
}

function formPayload(resource: FinanceReferenceResource, value: FormValue, creating: boolean) {
  switch (resource) {
    case 'currencies':
      return {
        ...(creating ? { code: value.code.trim().toUpperCase() } : {}),
        name: value.name.trim(),
        precision: Number(value.precision),
      }
    case 'accounts':
      return {
        name: value.name.trim(),
        ...(creating ? { kind: value.kind, currency: value.currency } : {}),
      }
    case 'projects':
      return { name: value.name.trim() }
    case 'products':
      return {
        ...(creating ? { projectId: Number(value.projectId) } : {}),
        name: value.name.trim(),
        salePrice: value.salePrice.trim() || null,
        salePriceCurrency: value.salePrice.trim() ? value.salePriceCurrency || null : null,
      }
    case 'purposes':
      return {
        name: value.name.trim(),
        categoryId: value.categoryId === 'none' ? null : Number(value.categoryId),
        productBinding: value.productBinding,
      }
    case 'categories':
      return { name: value.name.trim(), allocable: value.allocable === 'true' }
  }
}

function Field({
  id,
  label,
  value,
  pending,
  readOnly,
  type = 'text',
  onChange,
}: {
  id: string
  label: string
  value: string
  pending: boolean
  readOnly: boolean
  type?: React.HTMLInputTypeAttribute
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        readOnly={readOnly}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function Choice({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-bbm-ui>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function FinanceReferenceForm({
  resource,
  row,
  options,
  readOnly,
  pending,
  failure,
  submitLabel,
  onChange,
  onSubmit,
}: {
  resource: FinanceReferenceResource
  row?: FinanceReferenceRow
  options: ReferenceOptions
  readOnly: boolean
  pending: boolean
  failure?: string
  submitLabel: string
  onChange?: () => void
  onSubmit: (value: Record<string, unknown>) => void
}) {
  const [value, setValue] = React.useState(() => initialValue(row))
  const [validation, setValidation] = React.useState<string[]>([])
  const creating = row === undefined

  function change<K extends keyof FormValue>(key: K, next: FormValue[K]) {
    setValue((current) => ({ ...current, [key]: next }))
    onChange?.()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const issues: string[] = []
    if (!value.name.trim()) issues.push('Укажите название.')
    if (resource === 'currencies' && creating && !value.code.trim())
      issues.push('Укажите код валюты.')
    if (resource === 'currencies' && !/^\d+$/.test(value.precision)) {
      issues.push('Точность должна быть целым числом от 0 до 18.')
    }
    if (resource === 'accounts' && creating && !value.currency) issues.push('Выберите валюту.')
    if (resource === 'products' && creating && !value.projectId) issues.push('Выберите проект.')
    if (resource === 'products' && value.salePrice && !/^\d+$/.test(value.salePrice)) {
      issues.push('Цена задаётся целым числом минимальных единиц.')
    }
    if (resource === 'products' && value.salePrice && !value.salePriceCurrency) {
      issues.push('Выберите валюту цены.')
    }
    setValidation(issues)
    if (issues.length === 0) onSubmit(formPayload(resource, value, creating))
  }

  const currencyOptions = options.currencies.map((item) => ({
    value: String(item.code),
    label: `${item.code} — ${item.name}`,
  }))
  const projectOptions = options.projects.map((item) => ({
    value: String(item.id),
    label: item.name,
  }))
  const categoryOptions = [
    { value: 'none', label: 'Без статьи' },
    ...options.categories.map((item) => ({ value: String(item.id), label: item.name })),
  ]
  const locked = readOnly || pending

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

      {resource === 'currencies' ? (
        <>
          <Field
            id="finance-code"
            label="Код"
            value={value.code}
            pending={pending}
            readOnly={readOnly || !creating}
            onChange={(next) => change('code', next)}
          />
          <Field
            id="finance-name"
            label="Название"
            value={value.name}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('name', next)}
          />
          <Field
            id="finance-precision"
            label="Точность"
            type="number"
            value={value.precision}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('precision', next)}
          />
        </>
      ) : null}
      {resource === 'accounts' ? (
        <>
          <Field
            id="finance-name"
            label="Название"
            value={value.name}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('name', next)}
          />
          {creating ? (
            <>
              <Choice
                id="finance-kind"
                label="Тип"
                value={value.kind}
                disabled={locked}
                onChange={(next) => change('kind', next)}
                options={[
                  { value: 'bank', label: 'Банк' },
                  { value: 'card', label: 'Карта' },
                  { value: 'crypto', label: 'Криптовалюта' },
                  { value: 'cash', label: 'Наличные' },
                ]}
              />
              <Choice
                id="finance-currency"
                label="Валюта"
                value={value.currency}
                disabled={locked}
                onChange={(next) => change('currency', next)}
                options={currencyOptions}
              />
            </>
          ) : null}
        </>
      ) : null}
      {resource === 'projects' ? (
        <Field
          id="finance-name"
          label="Название"
          value={value.name}
          pending={pending}
          readOnly={readOnly}
          onChange={(next) => change('name', next)}
        />
      ) : null}
      {resource === 'products' ? (
        <>
          <Field
            id="finance-name"
            label="Название"
            value={value.name}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('name', next)}
          />
          {creating ? (
            <Choice
              id="finance-project"
              label="Проект"
              value={value.projectId}
              disabled={locked}
              onChange={(next) => change('projectId', next)}
              options={projectOptions}
            />
          ) : null}
          <Field
            id="finance-price"
            label="Цена в минимальных единицах"
            value={value.salePrice}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('salePrice', next)}
          />
          <Choice
            id="finance-price-currency"
            label="Валюта цены"
            value={value.salePriceCurrency}
            disabled={locked || !value.salePrice}
            onChange={(next) => change('salePriceCurrency', next)}
            options={currencyOptions}
          />
        </>
      ) : null}
      {resource === 'purposes' ? (
        <>
          <Field
            id="finance-name"
            label="Название"
            value={value.name}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('name', next)}
          />
          <Choice
            id="finance-category"
            label="Статья расходов"
            value={value.categoryId}
            disabled={locked}
            onChange={(next) => change('categoryId', next)}
            options={categoryOptions}
          />
          <Choice
            id="finance-product-binding"
            label="Привязка продукта"
            value={value.productBinding}
            disabled={locked}
            onChange={(next) => change('productBinding', next)}
            options={[
              { value: 'required', label: 'Обязательна' },
              { value: 'optional', label: 'Необязательна' },
              { value: 'forbidden', label: 'Запрещена' },
            ]}
          />
        </>
      ) : null}
      {resource === 'categories' ? (
        <>
          <Field
            id="finance-name"
            label="Название"
            value={value.name}
            pending={pending}
            readOnly={readOnly}
            onChange={(next) => change('name', next)}
          />
          <Choice
            id="finance-allocable"
            label="Можно распределять"
            value={value.allocable}
            disabled={locked}
            onChange={(next) => change('allocable', next)}
            options={[
              { value: 'false', label: 'Нет' },
              { value: 'true', label: 'Да' },
            ]}
          />
        </>
      ) : null}

      {!readOnly ? (
        <Button type="submit" disabled={pending}>
          {pending ? 'Сохраняем…' : submitLabel}
        </Button>
      ) : null}
    </form>
  )
}
