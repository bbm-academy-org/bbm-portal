/**
 * Модуль финансовой модели BBM (ADR-002) — публичная поверхность домена.
 *
 * Всё, что снаружи (будущие `src/modules/finmodel/view` и публичные страницы
 * раздела), импортирует ТОЛЬКО отсюда; внутренности модуля никто не тянет —
 * граница машинно проверяется dependency-cruiser'ом (`pnpm boundaries`).
 *
 * Ничто здесь не импортирует ни CMS, ни внутренности соседних модулей (hours,
 * okr) — тем же правилом.
 *
 * Мастер переменных живёт вне репо: `ssot/finmodel.yaml` в bbm-kb, снимается
 * `pnpm ssot:pull`, свежесть снапшота стережёт CI-джоба `ssot-freshness`.
 */

export { formatInt, formatPercent, formatRub, formatShare } from './format'

export {
  distributeProfit,
  miningScore,
  perTokenPayout,
  projectTimeline,
  royaltySplit,
  splitReserve,
} from './formula'
export type {
  InvestmentInput,
  MiningActions,
  PeriodInput,
  ProfitDistribution,
  ProjectPhase,
  ReserveSplit,
  RoyaltyAmounts,
  TimelinePoint,
} from './formula'

export { getVariables, SNAPSHOT_META } from './variables'
export type {
  FinmodelVariables,
  MiningWeights,
  PolicyVariables,
  ProfitShares,
  ProjectVariables,
  RoyaltyPercent,
  SnapshotMeta,
} from './types'
