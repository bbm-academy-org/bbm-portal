'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

/**
 * The reporting-currency switch: the choice travels in the page URL as
 * `currency`, the page's other query parameters kept. A candidate that cannot
 * be converted to is listed disabled with its reason (spec 584 EARS-721).
 */
export function ReportingCurrencySelect({
  currencies,
  value,
  className,
}: {
  currencies: { code: string; name: string; disabledReason?: string | null }[]
  value: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(currency) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('currency', currency)
        startTransition(() => router.replace(`${pathname}?${params.toString()}`))
      }}
    >
      <SelectTrigger size="sm" aria-label="Валюта итога" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-bbm-ui align="end">
        {currencies.map((currency) => (
          <SelectItem
            key={currency.code}
            value={currency.code}
            disabled={Boolean(currency.disabledReason)}
          >
            {currency.code} — {currency.name}
            {currency.disabledReason ? ` · ${currency.disabledReason}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
