/**
 * The fixture plan of `pnpm dev:seed` (#436) — WHAT is seeded, with no idea HOW.
 *
 * This file is pure data. It imports no module API, opens no connection and
 * reads no clock, which is what makes the two properties the owner's 2026-09-02
 * ruling actually asks for checkable without a Postgres:
 *
 *  - **volume** — dozens of rows and EVERY lifecycle status, so that
 *    composition, density, sorting, pagination and overflow are visible on the
 *    stand at review time rather than discovered after the owner opens it;
 *  - **determinism** — two agents running the seed see the same rows, so
 *    screenshots taken in different sessions are comparable. Every date here is
 *    a literal, every name is fixed, and nothing is generated.
 *
 * `tests/unit/platform-dev-seed-plan.spec.ts` asserts both, plus the internal
 * consistency of the cross-references below (a request whose submitter is not a
 * seeded member, an assessment for a non-participant).
 *
 * **Symbolic references, resolved by the applier.** The plan cannot know the
 * `serial` id a purpose or an account will get, so it names them by role
 * (`purpose: 'ops'`, `account: 'bank'`) and `tools/platform/dev-seed.ts` maps
 * those onto the rows `seedFinanceAcceptance` creates. That indirection is why
 * this file has no `number` foreign keys in it at all.
 */

/** The slug marker a rerun recognises its own rows by, inside a free-text note. */
export const DEV_SEED_NOTE_PREFIX = 'seed:'

/**
 * The instant every derived snapshot is computed at.
 *
 * An hours assessment freezes the participant's rate at save time, so a seed
 * that passed `new Date()` would write a different `saved_at` on every run and
 * make «run twice, same state» false by construction.
 */
export const DEV_SEED_NOW = '2026-09-01T09:00:00.000Z'

/** `[seed:<slug>] <text>` — the note a seeded intake row carries. */
export function devSeedNote(slug: string, text: string): string {
  return `[${DEV_SEED_NOTE_PREFIX}${slug}] ${text}`
}

/** The slug of a seeded row, or `null` for a note a human wrote. */
export function devSeedSlugFromNote(note: string | null | undefined): string | null {
  const match = /^\[seed:([a-z0-9-]+)\]/.exec((note ?? '').trim())
  return match === null ? null : match[1]
}

// ── members ─────────────────────────────────────────────────────────────────

export type DevSeedMember = {
  slug: string
  email: string
  name: string
  role: string | null
  status: 'active' | 'inactive'
  aliases?: readonly { kind: string; value: string; note: string | null }[]
}

/**
 * The synthetic registry: obviously fake people on a `.invalid` domain, which is
 * reserved by RFC 2606 and can never route mail anywhere.
 *
 * 34 rows rather than the 30 the acceptance criterion names, and both numbers
 * matter: 30 is the floor the ruling sets, and going past it is what makes the
 * members list PAGINATE on a 25-row page instead of merely being long.
 */
const MEMBER_NAMES: readonly (readonly [string, string, 'active' | 'inactive'])[] = [
  ['Анна Ковалёва', 'Продюсер', 'active'],
  ['Борис Литвинов', 'Методист', 'active'],
  ['Вера Мельник', 'Куратор', 'active'],
  ['Глеб Орлов', 'Разработчик', 'active'],
  ['Дарья Полякова', 'Дизайнер', 'active'],
  ['Егор Рыбаков', 'Аналитик', 'active'],
  ['Жанна Соколова', 'Маркетолог', 'active'],
  ['Захар Тимофеев', 'Разработчик', 'active'],
  ['Ирина Устинова', 'Редактор', 'active'],
  ['Кирилл Фомин', 'Продюсер', 'active'],
  ['Лариса Харитонова', 'Куратор', 'active'],
  ['Марк Цветков', 'Разработчик', 'active'],
  ['Нина Чернова', 'Методист', 'active'],
  ['Олег Шилов', 'Аналитик', 'active'],
  ['Полина Щербак', 'Дизайнер', 'active'],
  ['Роман Юдин', 'Маркетолог', 'active'],
  ['Светлана Яковлева', 'Редактор', 'active'],
  ['Тимур Абрамов', 'Разработчик', 'active'],
  ['Ульяна Белова', 'Куратор', 'active'],
  ['Фёдор Волков', 'Продюсер', 'active'],
  ['Юлия Гаврилова', 'Методист', 'active'],
  ['Яков Дьяконов', 'Аналитик', 'active'],
  ['Алиса Ершова', 'Дизайнер', 'active'],
  ['Богдан Жуков', 'Разработчик', 'active'],
  ['Виктория Зимина', 'Маркетолог', 'active'],
  ['Григорий Ильин', 'Редактор', 'active'],
  ['Диана Кузьмина', 'Куратор', 'active'],
  ['Евгений Лапин', 'Продюсер', 'active'],
  ['Зоя Макарова', 'Методист', 'active'],
  ['Илья Никитин', 'Аналитик', 'active'],
  ['Ксения Панова', 'Дизайнер', 'inactive'],
  ['Леонид Романов', 'Разработчик', 'inactive'],
  ['Мария Савельева', 'Куратор', 'inactive'],
  ['Никита Тарасов', null as unknown as string, 'inactive'],
]

export const DEV_SEED_MEMBERS: readonly DevSeedMember[] = MEMBER_NAMES.map(
  ([name, role, status], index) => {
    const ordinal = String(index + 1).padStart(2, '0')
    const slug = `seed-member-${ordinal}`
    return {
      slug,
      email: `seed-${ordinal}@dev.bbm.invalid`,
      name,
      role: role ?? null,
      status,
      // Two people carry a Mattermost handle and the rest do not — the alias
      // list is optional in the registry, and a stand where every row looks the
      // same hides exactly that.
      ...(index < 2
        ? {
            aliases: [
              { kind: 'mattermost_id', value: `seed.${ordinal}`, note: 'seeded dev alias' },
            ],
          }
        : {}),
    }
  },
)

/** The people the seed acts AS. Both are seeded members, so every write is attributable. */
export const DEV_SEED_SUBMITTER_SLUG = 'seed-member-01'
export const DEV_SEED_APPROVER_SLUG = 'seed-member-02'

// ── hours ───────────────────────────────────────────────────────────────────

export type DevSeedHoursParticipant = {
  memberSlug: string
  role: string
  forkMin: number | null
  forkMax: number | null
  grade: 'I' | 'II' | 'III' | null
}

export type DevSeedHoursAssessment = {
  memberSlug: string
  hours: number
  method: 'period' | 'week' | 'day'
  weekendHours: number
  splitPercent: number
}

export type DevSeedHoursPeriod = {
  id: string
  label: string
  dateFrom: string
  dateTo: string
  status: 'open' | 'closed'
  assessments: readonly DevSeedHoursAssessment[]
}

const PARTICIPANT_FORKS: readonly (readonly [number | null, number | null, 'I' | 'II' | 'III' | null])[] =
  [
    [180_000, 260_000, 'II'],
    [220_000, 320_000, 'III'],
    [150_000, 210_000, 'I'],
    [240_000, 360_000, 'III'],
    [160_000, 230_000, 'II'],
    [200_000, 280_000, 'II'],
    [140_000, 200_000, 'I'],
    [260_000, 380_000, 'III'],
    [170_000, 240_000, 'II'],
    [190_000, 270_000, 'I'],
    // The «hours only» mode of the module: no fork, no grade, hence no rate.
    [null, null, null],
    [null, null, null],
  ]

export const DEV_SEED_HOURS_PARTICIPANTS: readonly DevSeedHoursParticipant[] =
  PARTICIPANT_FORKS.map(([forkMin, forkMax, grade], index) => {
    const member = DEV_SEED_MEMBERS[index]
    return {
      memberSlug: member.slug,
      role: member.role ?? 'Участник',
      forkMin,
      forkMax,
      grade,
    }
  })

/** Hours declared per period, fixed per participant so a rerun writes the same numbers. */
function assessments(
  hours: readonly number[],
  splits: readonly number[],
): readonly DevSeedHoursAssessment[] {
  return hours.map((value, index) => ({
    memberSlug: DEV_SEED_HOURS_PARTICIPANTS[index].memberSlug,
    hours: value,
    method: (['period', 'week', 'day'] as const)[index % 3],
    weekendHours: index % 4 === 0 ? 4 : 0,
    splitPercent: splits[index % splits.length],
  }))
}

export const DEV_SEED_HOURS_PERIODS: readonly DevSeedHoursPeriod[] = [
  {
    id: 'seed-period-2026-06',
    label: 'Июнь 2026',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    status: 'closed',
    assessments: assessments(
      [152, 168, 96, 176, 120, 144, 88, 180, 132, 160, 104, 72],
      [0, 20, 50, 100],
    ),
  },
  {
    id: 'seed-period-2026-07',
    label: 'Июль 2026',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    status: 'closed',
    assessments: assessments(
      [160, 176, 112, 168, 128, 152, 96, 184, 140, 156, 100, 80],
      [0, 30, 60, 100],
    ),
  },
  {
    // The one open period — the module allows exactly one, and a stand with
    // none shows no «declare your hours» surface at all. Deliberately partial:
    // seven of the twelve have declared, so «who has not yet» is visible.
    id: 'seed-period-2026-08',
    label: 'Август 2026',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    status: 'open',
    assessments: assessments([148, 172, 104, 164, 116, 140, 92], [0, 25, 50, 75]),
  },
]

// ── finance: counterparties ─────────────────────────────────────────────────

/** Who is being paid (EARS-532). Ordered — the request plan references them by index. */
export const DEV_SEED_COUNTERPARTIES: readonly string[] = [
  'ООО «Мосарендасервис»',
  'ИП Гончаров А. В.',
  'Yandex Cloud',
  'ООО «Типография Печатник»',
  'Figma Inc.',
  'ООО «Курьер Экспресс»',
]

// ── finance: expense requests, one per lifecycle state plus volume ──────────

export type DevSeedRequestStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'refused'
  | 'cancelled'
  | 'posted'

export type DevSeedRequest = {
  slug: string
  status: DevSeedRequestStatus
  submitterSlug: string
  occurredOn: string
  /** Minor units of `currency` (spec 338 EARS-310). */
  amount: bigint
  currency: string
  /** Symbolic — resolved against the accounts `seedFinanceAcceptance` creates. */
  account: 'bank' | 'cash' | 'card' | null
  counterparty: number
  note: string
  alreadyPaid: boolean
  personalFunds: boolean
  refusalReason?: string
  /** A confirming document; MANDATORY for a request that has to reach `posted`. */
  document?: { filename: string; kind: string }
}

type RequestSpec = readonly [
  DevSeedRequestStatus,
  string,
  number,
  bigint,
  number,
  string,
  ('bank' | 'cash' | 'card' | null)?,
]

/**
 * The distribution is the point.
 *
 * A stand with one card per column answers «does the board render», not «does
 * the board read»: the widest column has to overflow, the narrow ones have to
 * stay narrow, and the whole thing has to sort. Hence 30 requests spread
 * 5/8/5/4/3/5 across the six states rather than six.
 */
const REQUEST_SPECS: readonly RequestSpec[] = [
  ['draft', '2026-08-03', 3, 12_500_00n, 0, 'Аренда переговорной на воркшоп'],
  ['draft', '2026-08-05', 5, 4_300_00n, 5, 'Курьерская доставка макетов'],
  ['draft', '2026-08-07', 8, 89_000_00n, 3, 'Печать раздаточных материалов'],
  ['draft', '2026-08-09', 11, 2_150_00n, 1, 'Расходники для съёмки'],
  ['draft', '2026-08-11', 14, 31_900_00n, 2, 'Продление облачных ресурсов'],

  ['submitted', '2026-08-04', 2, 18_700_00n, 0, 'Аренда зала на запись курса'],
  ['submitted', '2026-08-06', 6, 7_450_00n, 5, 'Доставка оборудования в студию'],
  ['submitted', '2026-08-08', 9, 145_000_00n, 3, 'Тираж рабочих тетрадей'],
  ['submitted', '2026-08-10', 12, 5_990_00n, 1, 'Оплата подрядчика за монтаж'],
  ['submitted', '2026-08-12', 15, 24_300_00n, 2, 'Хранилище объектов за август'],
  ['submitted', '2026-08-14', 18, 9_800_00n, 4, 'Лицензия Figma на команду'],
  ['submitted', '2026-08-16', 21, 62_000_00n, 3, 'Печать баннеров для оффлайна'],
  ['submitted', '2026-08-18', 24, 3_400_00n, 5, 'Срочная доставка договоров'],

  ['approved', '2026-08-02', 4, 41_200_00n, 0, 'Аренда студии на две смены'],
  ['approved', '2026-08-13', 7, 15_600_00n, 1, 'Работа приглашённого методиста'],
  ['approved', '2026-08-15', 10, 78_500_00n, 3, 'Допечатка методичек'],
  ['approved', '2026-08-17', 13, 11_050_00n, 4, 'Годовая лицензия на дизайн-систему'],
  ['approved', '2026-08-19', 16, 27_800_00n, 2, 'Управляемая база данных за август'],

  ['refused', '2026-08-01', 17, 210_000_00n, 3, 'Печать сувенирной продукции'],
  ['refused', '2026-08-20', 19, 6_700_00n, 5, 'Доставка личных вещей'],
  ['refused', '2026-08-21', 22, 33_400_00n, 0, 'Аренда площадки на выходные'],
  ['refused', '2026-08-22', 25, 1_900_00n, 1, 'Разовая консультация без договора'],

  ['cancelled', '2026-08-23', 20, 8_250_00n, 2, 'Тестовый стенд, больше не нужен'],
  ['cancelled', '2026-08-24', 23, 14_700_00n, 4, 'Вторая лицензия, дублирует первую'],
  ['cancelled', '2026-08-25', 26, 5_100_00n, 5, 'Доставка отменена заказчиком'],

  ['posted', '2026-07-28', 1, 22_400_00n, 0, 'Аренда переговорной, июль'],
  ['posted', '2026-07-29', 27, 9_350_00n, 5, 'Курьерская доставка, июль'],
  ['posted', '2026-07-30', 28, 118_000_00n, 3, 'Тираж методичек, июль'],
  ['posted', '2026-07-31', 29, 16_900_00n, 4, 'Лицензии на дизайн-инструменты'],
  ['posted', '2026-08-01', 0, 45_600_00n, 2, 'Облачная инфраструктура, июль'],
]

const REFUSAL_REASONS: readonly string[] = [
  'Сумма выше лимита на разовый расход — нужен договор и согласование бюджета.',
  'Личные расходы не возмещаются: назначение не относится к проекту.',
  'Площадка не согласована с продюсером, мероприятие перенесено.',
  'Без договора и закрывающих документов расход не проводится.',
]

const DOCUMENT_KINDS: readonly string[] = [
  'ru_invoice',
  'fiscal_receipt',
  'payment_order',
  'foreign_invoice',
  'bank_screenshot',
]

export const DEV_SEED_REQUESTS: readonly DevSeedRequest[] = (() => {
  const counters: Record<string, number> = {}
  let refused = 0
  let posted = 0
  return REQUEST_SPECS.map(
    ([status, occurredOn, submitterIndex, amount, counterparty, note, account]) => {
      const ordinal = (counters[status] = (counters[status] ?? 0) + 1)
      const slug = `req-${status}-${String(ordinal).padStart(2, '0')}`
      const request: DevSeedRequest = {
        slug,
        status,
        submitterSlug: DEV_SEED_MEMBERS[submitterIndex].slug,
        occurredOn,
        amount,
        currency: 'RUB',
        account: account ?? 'bank',
        counterparty,
        note,
        alreadyPaid: status === 'posted',
        personalFunds: false,
      }
      if (status === 'refused') {
        return { ...request, refusalReason: REFUSAL_REASONS[refused++ % REFUSAL_REASONS.length] }
      }
      if (status === 'posted') {
        const index = posted++
        return {
          ...request,
          document: {
            filename: `${slug}-document.png`,
            kind: DOCUMENT_KINDS[index % DOCUMENT_KINDS.length],
          },
        }
      }
      return request
    },
  )
})()

// ── finance: the non-request half of the intake list ────────────────────────

export type DevSeedIntakeItem = {
  slug: string
  source: 'manual' | 'backfill' | 'bank_import'
  kind: 'expense' | 'income' | 'transfer' | 'conversion'
  occurredOn: string
  amount: bigint
  currency: string
  account: 'bank' | 'cash' | 'card' | 'thb' | null
  counterAccount: 'bank' | 'cash' | 'card' | 'thb' | null
  paidAmount: bigint | null
  paidCurrency: string | null
  purpose: 'ops' | 'course-sales' | null
  note: string
}

/**
 * The intake list is not the requests board: it is where `backfill` and
 * `bank_import` lines land, and a stand that only ever shows `request` rows
 * hides the source column entirely. All four kinds appear, because the rebuild
 * from zero (decision 17) has to be representable.
 *
 * Every line here carries a `source_ref`, which is what makes IT idempotent for
 * free — `finance_intake_item_source_ref_unique` refuses a second copy.
 */
export const DEV_SEED_INTAKE_ITEMS: readonly DevSeedIntakeItem[] = [
  {
    slug: 'intake-backfill-01',
    source: 'backfill',
    kind: 'expense',
    occurredOn: '2026-06-03',
    amount: 34_500_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'ops',
    note: 'Восстановление истории: аренда, июнь',
  },
  {
    slug: 'intake-backfill-02',
    source: 'backfill',
    kind: 'expense',
    occurredOn: '2026-06-11',
    amount: 7_900_00n,
    currency: 'RUB',
    account: 'cash',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'ops',
    note: 'Восстановление истории: наличные расходы, июнь',
  },
  {
    slug: 'intake-backfill-03',
    source: 'backfill',
    kind: 'income',
    occurredOn: '2026-06-18',
    amount: 240_000_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'course-sales',
    note: 'Восстановление истории: поступление за курс',
  },
  {
    slug: 'intake-backfill-04',
    source: 'backfill',
    kind: 'transfer',
    occurredOn: '2026-06-24',
    amount: 50_000_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: 'cash',
    paidAmount: null,
    paidCurrency: null,
    purpose: null,
    note: 'Восстановление истории: снятие наличных',
  },
  {
    slug: 'intake-backfill-05',
    source: 'backfill',
    kind: 'conversion',
    occurredOn: '2026-06-27',
    amount: 30_000_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: 'card',
    paidAmount: 4_000_00n,
    paidCurrency: 'USD',
    purpose: null,
    note: 'Восстановление истории: покупка валюты',
  },
  {
    slug: 'intake-bank-01',
    source: 'bank_import',
    kind: 'expense',
    occurredOn: '2026-08-05',
    amount: 12_300_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'ops',
    note: 'Выписка банка: списание по карте',
  },
  {
    slug: 'intake-bank-02',
    source: 'bank_import',
    kind: 'expense',
    occurredOn: '2026-08-06',
    amount: 3_780_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'ops',
    note: 'Выписка банка: комиссия за обслуживание',
  },
  {
    slug: 'intake-bank-03',
    source: 'bank_import',
    kind: 'income',
    occurredOn: '2026-08-07',
    amount: 96_000_00n,
    currency: 'RUB',
    account: 'bank',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'course-sales',
    note: 'Выписка банка: поступление от эквайринга',
  },
  {
    slug: 'intake-manual-01',
    source: 'manual',
    kind: 'expense',
    occurredOn: '2026-08-13',
    amount: 5_250_00n,
    currency: 'RUB',
    account: 'cash',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'ops',
    note: 'Ручной ввод: мелкие расходы студии',
  },
  {
    slug: 'intake-manual-02',
    source: 'manual',
    kind: 'expense',
    occurredOn: '2026-08-14',
    amount: 1_100_00n,
    currency: 'RUB',
    account: 'cash',
    counterAccount: null,
    paidAmount: null,
    paidCurrency: null,
    purpose: 'ops',
    note: 'Ручной ввод: доставка воды в офис',
  },
]
