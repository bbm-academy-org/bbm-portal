'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

export function ReportingCurrencySelect({
  currencies,
  value,
  className,
}: {
  currencies: { code: string; name: string }[]
  value: string
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(currency) => {
        startTransition(() => router.replace(`/p/finance?currency=${encodeURIComponent(currency)}`))
      }}
    >
      <SelectTrigger size="sm" aria-label="Валюта итога" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-bbm-ui align="end">
        {currencies.map((currency) => (
          <SelectItem key={currency.code} value={currency.code}>
            {currency.code} — {currency.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
