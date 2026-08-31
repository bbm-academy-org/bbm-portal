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
              <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">
                Денежных счетов пока нет. Их можно добавить в финансовых справочниках.
              </div>
            ) : (
              overview.accounts.map((account) => (
                <div
                  key={account.accountId}
                  role="group"
                  aria-label={account.name}
                  className="min-w-0 rounded-lg bg-muted/40 p-3"
                >
                  <p className="truncate text-xs font-medium text-muted-foreground">
                    {account.name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <span className="font-heading text-xl font-semibold tabular-nums">
                      {formatMinorUnits(
                        account.balance,
                        precisionByCurrency.get(account.currency) ?? 0,
                      )}
                    </span>
                    <Badge variant="outline">{account.currency}</Badge>
                  </div>
                </div>
              ))
            )}

            <div
              role="group"
              aria-label="Итого"
              className="min-w-0 border-t pt-3 sm:col-span-2 xl:col-span-1 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Итого</p>
                <ReportingCurrencySelect
                  value={overview.reportingCurrency}
                  currencies={currencies.map(({ code, name }) => ({ code, name }))}
                />
              </div>

              {overview.status === 'complete' && overview.total !== null ? (
                <div className="mt-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-heading text-xl font-semibold tabular-nums">
                      {formatMinorUnits(
                        overview.total,
                        precisionByCurrency.get(overview.reportingCurrency) ?? 0,
                      )}
                    </span>
                    <Badge variant="outline">{overview.reportingCurrency}</Badge>
                  </div>
                  <p className="mt-2 text-xs font-medium text-foreground">
                    По записанной стоимости
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Из операций и конвертаций; текущий рыночный курс не используется.
                  </p>
                </div>
              ) : (
                <Alert className="mt-2 py-2">
                  <AlertTitle>Итого пока не рассчитано</AlertTitle>
                  <AlertDescription>
                    Нет полной записанной стоимости: {overview.missingCurrencies.join(', ')}.
                    Остатки по счетам выше остаются точными.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
