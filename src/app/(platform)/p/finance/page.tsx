import Link from 'next/link'

import { currentMoneyOverview, listCurrencies } from '@/lib/finance'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

import { ReportingCurrencySelect } from './reporting-currency-select'

function formatMinorUnits(amount: bigint, precision: number): string {
  const sign = amount < 0n ? '−' : ''
  const digits = (amount < 0n ? -amount : amount).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, -precision)
  const fraction = precision === 0 ? '' : `,${digits.slice(-precision)}`
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction}`
}

export default async function FinancePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ currency?: string | string[] }>
}) {
  const currencies = await listCurrencies()
  const query = await searchParams
  const requestedCurrency = Array.isArray(query.currency) ? query.currency[0] : query.currency
  const reportingCurrency = currencies.some((currency) => currency.code === requestedCurrency)
    ? requestedCurrency!
    : 'RUB'
  const overview = await currentMoneyOverview(reportingCurrency)
  const precisionByCurrency = new Map(
    currencies.map((currency) => [currency.code, currency.precision]),
  )
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]))
  const availableCurrencies = overview.availableReportingCurrencies.map((code) => {
    const currency = currencyByCode.get(code)
    return { code, name: currency?.name ?? code }
  })

  return (
    <section aria-labelledby="finance-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="finance-heading" className="font-heading text-2xl font-semibold tracking-tight">
            Финансы
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Фактические остатки по денежным счетам BBM.
          </p>
        </div>
        {/* The overview answers «сколько денег»; the board answers «что с ними
            собираются сделать». One is never read without reaching for the
            other, so the link lives at the title's right edge (#388). */}
        <Button asChild variant="outline">
          <Link href="/p/finance/requests">Заявки</Link>
        </Button>
      </div>

      <Card role="group" aria-label="Итого" className="bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle className="text-primary-foreground/80 text-sm font-medium">Итого</CardTitle>
          <CardAction>
            <ReportingCurrencySelect
              value={overview.reportingCurrency}
              currencies={availableCurrencies}
              className="border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 dark:bg-transparent dark:hover:bg-primary-foreground/10 [&_svg]:text-primary-foreground/70"
            />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.status === 'complete' && overview.total !== null ? (
            <>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-heading text-4xl font-semibold tracking-tight tabular-nums">
                  {formatMinorUnits(
                    overview.total,
                    precisionByCurrency.get(overview.reportingCurrency) ?? 0,
                  )}
                </span>
                <span className="text-primary-foreground/80 font-heading text-xl font-medium">
                  {overview.reportingCurrency}
                </span>
              </div>
              <div className="text-primary-foreground/75 space-y-0.5 text-sm">
                <p>По фактическим курсам операций</p>
                <p>Из операций и конвертаций; текущий рыночный курс не используется.</p>
              </div>
            </>
          ) : (
            <Alert>
              <AlertTitle>Итого пока не рассчитано</AlertTitle>
              <AlertDescription>
                Нет полной записанной стоимости: {overview.missingCurrencies.join(', ')}. Остатки по
                счетам ниже остаются точными.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-label="Деньги сейчас">
        <CardHeader>
          <CardTitle>Деньги сейчас</CardTitle>
          <CardDescription>
            По счетам, каждый остаток в своей валюте. Все суммы рассчитаны из проводок.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {overview.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">
                Денежных счетов пока нет. Их можно добавить в финансовых справочниках.
              </p>
            ) : (
              overview.accounts.map((account) => (
                <div
                  key={account.accountId}
                  role="group"
                  aria-label={account.name}
                  className={
                    account.retired === true
                      ? 'min-w-0 space-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-muted-foreground ring-1 ring-foreground/5'
                      : 'min-w-0 space-y-1 rounded-lg px-3 py-2.5 ring-1 ring-foreground/10'
                  }
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm text-muted-foreground">{account.name}</p>
                    {account.retired === true ? <Badge variant="secondary">архивный</Badge> : null}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span
                      className={
                        account.retired === true
                          ? 'font-heading text-xl font-medium text-muted-foreground tabular-nums'
                          : 'font-heading text-xl font-semibold tabular-nums'
                      }
                    >
                      {formatMinorUnits(
                        account.balance,
                        precisionByCurrency.get(account.currency) ?? 0,
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">{account.currency}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
