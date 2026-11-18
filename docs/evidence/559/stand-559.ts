/* Stand data for #559 acceptance (the §J cases on top of dev:seed). Run from the worktree:
 *   pnpm exec tsx <this file>
 * Writes through the module API only, into platform_559 (guarded). */
import {
  createAccount,
  createExpenseRequest,
  listAccounts,
  listCounterparties,
  listExpenseRequests,
  listProjects,
  listPurposes,
  markExpenseRequestPaid,
  markExpenseRequestReimbursed,
  submitExpenseRequest,
  recordConversion,
  type FinanceActor,
} from '@/lib/finance'
import { syncCbrRates } from '@/lib/finance/fx/store'
import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'
import { closePlatformDb } from '@/lib/platform/db/client'
import { FINANCE_APPROVE_ROLE, FINANCE_ENTRY_ROLE } from '@/lib/finance'

import { assertDevPlatformDatabase } from '../../../tools/platform/dev-database-guard.mjs'
import { DEV_SEED_MEMBERS } from '../../../tools/platform/dev-seed-plan'
import { loadPlatformToolEnv } from '../../../tools/platform/load-env.mjs'

const TAG = '[stand-559]'

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** No CBR quote between these dates: the «без курса» window. */
const GAP = { from: '2026-09-01', to: '2026-09-18' }

function usdOn(date: string): string {
  if (date >= '2026-11-01') return '92.0000'
  if (date >= '2026-10-01') return '92.5000'
  if (date >= '2026-09-01') return '93.1000'
  return '91.4000'
}
function eurOn(date: string): string {
  if (date === '2026-09-22') return '100.0000'
  if (date >= '2026-09-19' && date < '2026-10-01') return '100.0000'
  return '99.2000'
}

async function main() {
  loadPlatformToolEnv()
  assertDevPlatformDatabase(process.env.PLATFORM_DATABASE_URL, process.env)
  const approver: FinanceActor = {
    email: DEV_SEED_MEMBERS.find((m) => m.slug === 'seed-member-02')!.email,
    roles: [PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE, FINANCE_APPROVE_ROLE, FINANCE_ENTRY_ROLE],
  }
  const member: FinanceActor = {
    email: DEV_SEED_MEMBERS[5].email,
    roles: [PLATFORM_USER_ROLE],
  }

  const summary = await syncCbrRates({
    from: '2025-12-01',
    to: '2026-11-18',
    today: '2026-11-18',
    fetchDaily: async (date) => {
      if (date >= GAP.from && date <= GAP.to) {
        // CBR publishes nothing new: the effective date stays before the gap.
        return { effectiveDate: addDays(GAP.from, -1), rates: [] }
      }
      return {
        effectiveDate: date,
        rates: [
          { currency: 'USD', nominal: 1, valueRub: usdOn(date) },
          { currency: 'EUR', nominal: 1, valueRub: eurOn(date) },
        ],
      }
    },
  })
  console.log(TAG, 'rates', summary)

  const accounts = await listAccounts()
  const bank = accounts.find((a) => a.name === 'Основной банк')!
  let usd = accounts.find((a) => a.name === 'Счёт USD')
  usd ??= await createAccount(approver, { name: 'Счёт USD', kind: 'bank', currency: 'USD' })
  const purpose = (await listPurposes()).find((p) => p.name === 'Операционные расходы')!
  const project = (await listProjects()).find((p) => p.name === 'BBM Academy')!
  const counterparties = await listCounterparties()
  const cp = (name: string) => counterparties.find((c) => c.name === name)!.id

  async function snapshotOf(id: number): Promise<string> {
    const all = await listExpenseRequests(approver)
    const row = all.find((r) => r.id === id)
    if (row === undefined || row.snapshot === null)
      throw new Error(`${TAG}: request ${id} not visible`)
    return row.snapshot
  }

  async function paid(
    note: string,
    occurredOn: string,
    amount: bigint,
    currency: string,
    paidAmount: bigint,
    counterparty: string,
  ) {
    const created = await createExpenseRequest(member, {
      occurredOn: null,
      accountId: null,
      amount,
      currency,
      purposeId: purpose.id,
      projectId: project.id,
      counterpartyId: cp(counterparty),
      note: `[stand-559] ${note}`,
    })
    await submitExpenseRequest(member, created.id)
    await markExpenseRequestPaid(approver, created.id, {
      snapshot: await snapshotOf(created.id),
      occurredOn,
      accountId: bank.id,
      paidAmount,
      paidCurrency: 'RUB',
    })
    console.log(TAG, 'paid', created.id, note)
  }

  // Chronological per pair (EARS-328 write order).
  await paid(
    'Figma на год, оплата в долларах',
    '2026-08-28',
    1_250_00n,
    'USD',
    114_000_00n,
    'Figma Inc.',
  )
  await paid('Домен, в окно без курса', '2026-09-16', 45_00n, 'USD', 4_200_00n, 'Yandex Cloud')
  await paid(
    'Регистрация на конференцию, евро',
    '2026-09-22',
    840_00n,
    'EUR',
    84_000_00n,
    'ИП Гончаров А. В.',
  )
  await paid(
    'Аренда GPU, счёт в USDT',
    '2026-10-20',
    (500_000_000n / 1_000_000n) * 100n,
    'USDT',
    46_500_00n,
    'Yandex Cloud',
  )
  await paid('Монтаж ролика, USDC', '2026-11-05', 300_00n, 'USDC', 27_900_00n, 'ИП Гончаров А. В.')
  await paid(
    'Claude Team, USD 100 с комиссией 50 ₽',
    '2026-11-13',
    100_00n,
    'USD',
    9_384_00n,
    'Figma Inc.',
  )

  // Personal funds: USD 100 on the member's card, reimbursed 9 016 ₽.
  const own = await createExpenseRequest(member, {
    occurredOn: '2026-11-13',
    accountId: null,
    amount: 100_00n,
    currency: 'USD',
    purposeId: purpose.id,
    projectId: project.id,
    counterpartyId: cp('Yandex Cloud'),
    note: '[stand-559] Оплатил своей картой, вернуть в рублях',
    alreadyPaid: true,
    personalFunds: true,
  })
  await submitExpenseRequest(member, own.id)
  await markExpenseRequestReimbursed(approver, own.id, {
    snapshot: await snapshotOf(own.id),
    occurredOn: '2026-11-14',
    accountId: bank.id,
    amount: 9_016_00n,
  })
  console.log(TAG, 'reimbursed', own.id)

  // Chains — backfill source: chronological reconstruction is not under test here.
  await recordConversion(approver, {
    occurredOn: '2026-09-17',
    sourceAccountId: bank.id,
    targetAccountId: usd.id,
    source: 'backfill',
    steps: [
      {
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 9_400_00n,
        toAmount: 100_00n,
        rate: '0.0106383',
      },
    ],
  })
  await recordConversion(approver, {
    occurredOn: '2026-10-05',
    sourceAccountId: bank.id,
    targetAccountId: usd.id,
    source: 'backfill',
    steps: [
      {
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 46_000_00n,
        toAmount: 500_00n,
        rate: '0.0108696',
        fee: { amount: 1_00n, currency: 'USD' },
      },
    ],
  })
  await recordConversion(approver, {
    occurredOn: '2026-11-10',
    sourceAccountId: bank.id,
    targetAccountId: usd.id,
    source: 'backfill',
    steps: [
      {
        fromCurrency: 'RUB',
        toCurrency: 'USDT',
        fromAmount: 100_000_00n,
        toAmount: 1_060_00n,
        rate: '0.0106',
        fee: { amount: 500_00n, currency: 'RUB' },
      },
      {
        fromCurrency: 'USDT',
        toCurrency: 'USD',
        fromAmount: 1_060_00n,
        toAmount: 1_050_00n,
        rate: '0.990566',
      },
    ],
  })
  console.log(TAG, 'chains recorded')
}

main()
  .catch((error) => {
    console.error(TAG, error)
    process.exitCode = 1
  })
  .finally(() => closePlatformDb())
