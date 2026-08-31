import { currentMoneyOverview, listCurrencies } from '@/lib/finance'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

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
      <div>
        <h1 id="finance-heading" className="font-heading text-2xl font-semibold tracking-tight">
          Финансы
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Фактические остатки по денежным счетам BBM.
        </p>
      </div>

      <Card role="region" aria-label="Деньги сейчас">
        <CardHeader>
          <CardTitle>Деньги сейчас</CardTitle>
          <CardDescription>
            По счетам, каждый остаток в своей валюте. Все суммы рассчитаны из проводок.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {overview.accounts.length === 0 ? (
              <Card size="sm" className="sm:col-span-2 xl:col-span-4">
                <CardContent className="text-sm text-muted-foreground">
                  Денежных счетов пока нет. Их можно добавить в финансовых справочниках.
                </CardContent>
              </Card>
            ) : (
              overview.accounts.map((account) => (
                <Card
                  key={account.accountId}
                  size="sm"
                  role="group"
                  aria-label={account.name}
                  className="min-w-0"
                >
                  <CardContent className="space-y-2">
                    <p className="truncate text-sm text-muted-foreground">{account.name}</p>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-heading text-xl font-semibold tabular-nums">
                        {formatMinorUnits(
                          account.balance,
                          precisionByCurrency.get(account.currency) ?? 0,
                        )}
                      </span>
                      <Badge variant="outline">{account.currency}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}

            <Card
              size="sm"
              role="group"
              aria-label="Итого"
              className="min-w-0 sm:col-span-2 xl:col-span-1"
            >
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Итого</p>
                  <ReportingCurrencySelect
                    value={overview.reportingCurrency}
                    currencies={availableCurrencies}
                  />
                </div>

                {overview.status === 'complete' && overview.total !== null ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-heading text-xl font-semibold tabular-nums">
                        {formatMinorUnits(
                          overview.total,
                          precisionByCurrency.get(overview.reportingCurrency) ?? 0,
                        )}
                      </span>
                      <Badge variant="outline">{overview.reportingCurrency}</Badge>
                    </div>
                    <p className="text-sm">По фактическим курсам операций</p>
                    <p className="text-sm text-muted-foreground">
                      Из операций и конвертаций; текущий рыночный курс не используется.
                    </p>
                  </div>
                ) : (
                  <Alert>
                    <AlertTitle>Итого пока не рассчитано</AlertTitle>
                    <AlertDescription>
                      Нет полной записанной стоимости: {overview.missingCurrencies.join(', ')}.
                      Остатки по счетам выше остаются точными.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
