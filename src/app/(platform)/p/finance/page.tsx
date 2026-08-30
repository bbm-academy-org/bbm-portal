import { accountBalances, listCurrencies } from '@/lib/finance'
import { Badge } from '@/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

function formatMinorUnits(amount: bigint, precision: number): string {
  const sign = amount < 0n ? '−' : ''
  const digits = (amount < 0n ? -amount : amount).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, -precision)
  const fraction = precision === 0 ? '' : `,${digits.slice(-precision)}`
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction}`
}

export default async function FinancePage() {
  const [balances, currencies] = await Promise.all([accountBalances(), listCurrencies()])
  const precisionByCurrency = new Map(
    currencies.map((currency) => [currency.code, currency.precision]),
  )
  const money = balances.filter((account) => !account.isSystem)

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

      <Card>
        <CardHeader>
          <CardTitle>Деньги сейчас</CardTitle>
          <CardDescription>Каждый остаток показан в валюте своего счёта.</CardDescription>
        </CardHeader>
        <CardContent>
          {money.length === 0 ? (
            <p className="text-sm text-muted-foreground">Денежных счетов пока нет.</p>
          ) : (
            <div className="divide-y">
              {money.map((account) => (
                <div
                  key={account.accountId}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-sm text-muted-foreground">{account.kind}</p>
                  </div>
                  <div className="flex items-baseline gap-2 text-right">
                    <span className="font-heading text-2xl font-semibold tabular-nums">
                      {formatMinorUnits(
                        account.balance,
                        precisionByCurrency.get(account.currency) ?? 0,
                      )}
                    </span>
                    <Badge variant="outline">{account.currency}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
