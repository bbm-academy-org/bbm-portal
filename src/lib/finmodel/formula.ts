/**
 * Расчётная математика финансовой модели BBM.
 *
 * Чистые функции: переменные приходят АРГУМЕНТАМИ, а не читаются из снапшота
 * внутри. Так один и тот же расчёт годится и для модельных значений публичных
 * примеров, и для сценария, который считает владелец, а тест не зависит от
 * того, что сегодня записано в мастере.
 *
 * Уровни разделены так же, как в снапшоте: всё здесь — политика BBM, одинаковая
 * для любого проекта компании. Единственная функция, знающая про предметный
 * уровень, — `miningScore`, и веса ей передаёт вызывающий.
 *
 * Числа в комментариях ниже — модельные значения примеров, а не фиксированные
 * величины: их мастер — `ssot/finmodel.yaml` в bbm-kb.
 */

import type { MiningWeights, PolicyVariables, RoyaltyPercent } from './types'

export interface RoyaltyAmounts {
  /** Роялти целиком. */
  total: number
  /** Доля фонда эволюционной цели. */
  missionFund: number
  /** Доля держателей BBM. */
  bbmHolders: number
}

export interface ProfitDistribution {
  royalty: RoyaltyAmounts
  /** Чистая прибыль за вычетом роялти — то, что делится на доли. */
  base: number
  /** Одна доля («1x»). */
  x: number
  investors: number
  author: number
  coauthors: number
}

export interface ReserveSplit {
  reserve: number
  toProject: number
}

/**
 * Резерв пополняется ПРОПОРЦИОНАЛЬНЫМ сплитом каждой входящей суммы: от любого
 * поступления сразу отделяется своя доля, и дальше в проект идёт остаток. Это
 * не «сектор, который заполняется первым» — резерв не имеет очереди и не
 * конкурирует с расходами проекта за один и тот же рубль.
 *
 * Округление одностороннее: округляется резерв, остаток считается вычитанием,
 * поэтому сумма частей всегда равна исходной — рубли не теряются и не
 * появляются.
 */
export function splitReserve(amountRub: number, reservePercent: number): ReserveSplit {
  const reserve = Math.round(amountRub * (reservePercent / 100))
  return { reserve, toProject: amountRub - reserve }
}

/**
 * Роялти с чистой прибыли и его адресаты. Округляется целое и доля фонда,
 * доля держателей BBM считается вычитанием — по той же причине, что и в
 * резерве: два независимых округления разошлись бы с общей суммой.
 *
 * Адресат роялти — фонд эволюционной цели и держатели BBM, НЕ автор: доля
 * автора считается отдельно, из базы распределения (`distributeProfit`).
 */
export function royaltySplit(netProfitRub: number, royalty: RoyaltyPercent): RoyaltyAmounts {
  const total = Math.round(netProfitRub * (royalty.total / 100))
  const missionFund = Math.round(netProfitRub * (royalty.mission_fund / 100))
  return { total, missionFund, bbmHolders: total - missionFund }
}

/**
 * Распределение чистой прибыли: сначала роялти, остаток («база») делится на
 * доли между инвесторами, автором и соавторами.
 *
 * Доля `x` НЕ округляется: округление допустимо только при отображении
 * (`format.ts`), а промежуточное округление доли ушло бы в каждую из семи
 * позиций и разошлось бы с базой.
 */
export function distributeProfit(
  netProfitRub: number,
  policy: PolicyVariables,
): ProfitDistribution {
  const royalty = royaltySplit(netProfitRub, policy.royalty_percent)
  const base = netProfitRub - royalty.total
  const shares = policy.profit_shares
  const totalShares = shares.investors + shares.author + shares.coauthors
  const x = totalShares > 0 ? base / totalShares : 0
  return {
    royalty,
    base,
    x,
    investors: x * shares.investors,
    author: x * shares.author,
    coauthors: x * shares.coauthors,
  }
}

/** Выплата на один токен из суммы, причитающейся держателям BBM. */
export function perTokenPayout(bbmHoldersRub: number, tokensOutstanding: number): number {
  return tokensOutstanding > 0 ? bbmHoldersRub / tokensOutstanding : 0
}

/** Действия аудитории, из которых складывается майнинг внимания. */
export interface MiningActions {
  pul: number
  bre: number
  con: number
}

/**
 * Score майнинга внимания — взвешенная сумма действий. Денежного вывода из
 * score здесь нет намеренно: динамика майнингового пула в каноне не
 * финализирована, и придумывать её в коде значило бы обогнать договорённость.
 */
export function miningScore(actions: MiningActions, weights: MiningWeights): number {
  return actions.pul * weights.pul + actions.bre * weights.bre + actions.con * weights.con
}

/** Период P&L проекта: выручка и расходы. */
export interface PeriodInput {
  revenue: number
  costs: number
}

/** Вложение инвестора, подлежащее возврату. */
export interface InvestmentInput {
  amountRub: number
}

/**
 * Фаза периода:
 * - `loss` — накопленный убыток ещё не покрыт;
 * - `payback` — идёт возврат вложенного инвесторам;
 * - `profit_sharing` — вложенное возвращено, прибыль делится по долям.
 */
export type ProjectPhase = 'loss' | 'payback' | 'profit_sharing'

export interface TimelinePoint {
  /** Прибыль периода: выручка − расходы (может быть отрицательной). */
  netProfit: number
  /** Накопленный непокрытый убыток на конец периода. */
  cumLoss: number
  phase: ProjectPhase
  /** Сколько вложенного вернулось инвесторам в этом периоде. */
  investorReturn: number
  /** Остаток, ушедший в распределение; `null`, если распределять было нечего. */
  distribution: ProfitDistribution | null
  /** Сколько вложенного осталось вернуть на конец периода. */
  remainingInvestment: number
}

/**
 * Таймлайн P&L проекта с каскадом возврата.
 *
 * РАБОЧЕЕ ПРОЧТЕНИЕ состава и порядка тиров (спека §11.7; сверяется с текстом
 * нормативного документа, и при расхождении синхронно правятся код, тесты и
 * документ):
 *
 *   1. прибыль периода сначала покрывает накопленный убыток проекта
 *      (loss carry-forward);
 *   2. затем — возврат вложенного инвесторам, до 100% суммы вложений; резерв в
 *      этом каскаде не участвует, он отделён ещё на входе (`splitReserve`);
 *   3. остаток делится по долям (`distributeProfit`).
 *
 * Возврат идёт частями через столько периодов, сколько нужно; уже возвращённое
 * повторно не гасится. Убыточный период распределения не даёт — но и не
 * отменяет ничего начисленного: начисленное командой в расходах периода уже
 * учтено и остаётся обязательством проекта.
 */
export function projectTimeline(
  periods: PeriodInput[],
  policy: PolicyVariables,
  invested: InvestmentInput[],
): TimelinePoint[] {
  let cumLoss = 0
  let remainingInvestment = invested.reduce((sum, item) => sum + item.amountRub, 0)

  return periods.map((period) => {
    const netProfit = period.revenue - period.costs

    if (netProfit <= 0) {
      cumLoss += -netProfit
      return {
        netProfit,
        cumLoss,
        phase: 'loss' as const,
        investorReturn: 0,
        distribution: null,
        remainingInvestment,
      }
    }

    const covered = Math.min(cumLoss, netProfit)
    cumLoss -= covered
    let distributable = netProfit - covered

    const investorReturn = Math.min(remainingInvestment, distributable)
    remainingInvestment -= investorReturn
    distributable -= investorReturn

    const distribution = distributable > 0 ? distributeProfit(distributable, policy) : null

    const phase: ProjectPhase =
      cumLoss > 0
        ? 'loss'
        : investorReturn > 0 || remainingInvestment > 0
          ? 'payback'
          : 'profit_sharing'

    return { netProfit, cumLoss, phase, investorReturn, distribution, remainingInvestment }
  })
}
