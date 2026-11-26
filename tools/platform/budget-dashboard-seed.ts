/**
 * Synthetic budget-dashboard data for a branch stand (issue #586, spec 584):
 * contributions, half a year of monthly spend over three categories and two
 * projects, and the fund's budget starting on BBM's first operation. Every
 * amount is invented (EARS-338: no real figure in the repo). Idempotent by
 * `sourceRef` prefix `budget-seed:`; writes only through `@/lib/finance`.
 */
import {
  createBudget,
  createCategory,
  createPurpose,
  getFirstOperationOn,
  getLiveBudget,
  listAccounts,
  listCategories,
  listProjects,
  listPurposes,
  listRegister,
  recordOperation,
  systemAccount,
  type FinanceActor,
} from '@/lib/finance'

export type BudgetSeedSummary = { operationsCreated: number; budgetCreated: boolean }

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
const TEAM = [380_000, 395_000, 410_000, 405_000, 420_000, 430_000, 215_000]
const ADS = [90_000, 140_000, 210_000, 175_000, 160_000, 120_000, 60_000]
const SERVICES = [24_000, 26_500, 31_000, 28_000, 33_500, 29_000, 18_000]

export async function seedBudgetDashboard(actor: FinanceActor): Promise<BudgetSeedSummary> {
  const summary: BudgetSeedSummary = { operationsCreated: 0, budgetCreated: false }
  const projects = await listProjects({ includeRetired: true })
  const fund = projects.find((project) => project.isFund)
  const doctor = projects.find((project) => project.name === 'Doctor School')
  const bank = (await listAccounts({ includeRetired: true })).find(
    (account) => account.name === 'Основной банк',
  )
  if (fund === undefined || doctor === undefined || bank === undefined) {
    throw new Error('budget-seed: run after the finance acceptance seed (fund, project, bank)')
  }

  const categories = await listCategories({ includeRetired: true })
  const purposes = await listPurposes({ includeRetired: true })
  async function purposeFor(name: string, category: string) {
    const found = purposes.find((purpose) => purpose.name === name)
    if (found !== undefined) return found
    const categoryRow =
      categories.find((row) => row.name === category) ??
      (await createCategory(actor, { name: category, allocable: false }))
    return createPurpose(actor, { name, productBinding: 'forbidden', categoryId: categoryRow.id })
  }
  const team = await purposeFor('Зарплаты команды', 'Команда')
  const ads = await purposeFor('Реклама в соцсетях', 'Реклама')
  const services = await purposeFor('Подписки и сервисы', 'Сервисы')

  const register = await listRegister({ limit: 50_000 })
  const seen = new Set(register.map((entry) => entry.sourceRef))
  const equity = await systemAccount(actor, 'equity', 'RUB')
  const expense = await systemAccount(actor, 'expense', 'RUB')
  const rub = (whole: number) => BigInt(whole) * 100n

  async function once(sourceRef: string, write: () => Promise<unknown>) {
    if (seen.has(sourceRef)) return
    await write()
    summary.operationsCreated += 1
  }
  for (const [date, amount] of [
    ['2026-05-04', 3_000_000],
    ['2026-08-03', 2_000_000],
  ] as const) {
    await once(`budget-seed:contribution:${date}`, () =>
      recordOperation(actor, {
        occurredOn: date,
        source: 'manual',
        sourceRef: `budget-seed:contribution:${date}`,
        postings: [
          { accountId: bank.id, amount: rub(amount), currency: 'RUB' },
          { accountId: equity.id, amount: -rub(amount), currency: 'RUB', projectId: fund.id },
        ],
      }),
    )
  }
  const lines = [
    { key: 'team', purpose: team, project: fund, day: '10', amounts: TEAM },
    { key: 'ads', purpose: ads, project: doctor, day: '15', amounts: ADS },
    { key: 'services', purpose: services, project: fund, day: '05', amounts: SERVICES },
  ]
  for (const line of lines) {
    for (const [index, month] of MONTHS.entries()) {
      const sourceRef = `budget-seed:${line.key}:${month}`
      const amount = rub(line.amounts[index]!)
      await once(sourceRef, () =>
        recordOperation(actor, {
          occurredOn: `${month}-${line.day}`,
          source: 'manual',
          sourceRef,
          purposeId: line.purpose.id,
          postings: [
            { accountId: bank.id, amount: -amount, currency: 'RUB' },
            { accountId: expense.id, amount, currency: 'RUB', projectId: line.project.id },
          ],
        }),
      )
    }
  }

  if ((await getLiveBudget(actor)) === null) {
    await createBudget(actor, {
      name: 'Операционный бюджет 2026',
      limitAmount: rub(5_000_000),
      currency: 'RUB',
      startsOn: (await getFirstOperationOn(actor)) ?? MONTHS[0]! + '-01',
    })
    summary.budgetCreated = true
  }
  return summary
}
