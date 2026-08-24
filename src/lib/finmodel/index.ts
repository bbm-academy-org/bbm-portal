/**
 * Модуль финансовой модели BBM (ADR-002) — публичная поверхность домена.
 *
 * Всё, что снаружи, импортирует ТОЛЬКО отсюда; внутренности модуля никто не
 * тянет — граница машинно проверяется dependency-cruiser'ом
 * (`pnpm boundaries`). Поверхности отображения у модуля сегодня НЕТ: владелец
 * 2026-08-24 отменил портальную страницу документа — его рендерит KB
 * (kb.bbm.academy/finmodel), а этот модуль остаётся домом снимка, расчётов и
 * машинной сверки текста с кодом.
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

export { resolveVar } from './resolveVar'

export { RULES_META } from './rulesDocument'

export { getVariables, isModelExample, MODEL_EXAMPLE_PATHS, SNAPSHOT_META } from './variables'
export type {
  FinmodelVariables,
  MiningWeights,
  PolicyVariables,
  ProfitShares,
  ProjectVariables,
  RoyaltyPercent,
  SnapshotMeta,
} from './types'
