import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return {
    ...actual,
    accountBalances: async () => [
      {
        accountId: 1,
        name: 'Банк RUB',
        kind: 'bank',
        currency: 'RUB',
        isSystem: false,
        retiredAt: null,
        balance: 1_284_500n,
      },
      {
        accountId: 2,
        name: 'expense:RUB',
        kind: 'expense',
        currency: 'RUB',
        isSystem: true,
        retiredAt: null,
        balance: 0n,
      },
    ],
    listCurrencies: async () => [
      { code: 'RUB', name: 'Российский рубль', precision: 2, retiredAt: null },
    ],
  }
})

describe('/p/finance F1b overview (spec 338 EARS-325)', () => {
  it('EARS-325: renders only the live balances card, in each account currency', async () => {
    const page = await import('@/app/(platform)/p/finance/page')
    const html = renderToStaticMarkup(await page.default())

    expect(html).toContain('Деньги сейчас')
    expect(html).toContain('Банк RUB')
    expect(html).toContain('12 845,00')
    expect(html).toContain('RUB')
    expect(html).not.toContain('expense:RUB')
    for (const deferred of ['P&amp;L', 'Обязательства', 'Заявки', 'Сверка', 'Сценарии']) {
      expect(html).not.toContain(deferred)
    }
  })
})
