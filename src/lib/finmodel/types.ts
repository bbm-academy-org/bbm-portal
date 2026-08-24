/**
 * Контракт снапшота `ssot/finmodel.yaml` (мастер — репо bbm-kb, снимается
 * `pnpm ssot:pull`).
 *
 * Структура намеренно двухуровневая: `policy` — универсальная политика BBM,
 * одинаковая для всех проектов компании; `projects.<slug>` — предметные
 * величины конкретного проекта. Правило BBM никогда не описывается в терминах
 * отдельного проекта, и одно поле не может лежать на обоих уровнях сразу —
 * тип держит это разделение вместо договорённости.
 *
 * Числа с пометкой `model_example` в мастере — МОДЕЛЬНЫЕ значения: параметры
 * калькулятора, которые публикуются и уточняются, а не зафиксированные цифры.
 * Список помеченных путей НЕ переписывается здесь руками: он снимается из
 * комментариев мастера при `pnpm ssot:pull` и лежит в снапшоте полем
 * `model_example` (`MODEL_EXAMPLE_PATHS` / `isModelExample` в `variables.ts`).
 * Иначе перевод числа из модельного в фикс канона правился бы в двух местах.
 */

/** Доли распределения прибыли: «4x инвесторам / 2x автору / 1x соавторам». */
export interface ProfitShares {
  investors: number
  author: number
  coauthors: number
}

/**
 * Роялти с чистой прибыли: `total` = `mission_fund` + `bbm_holders`.
 * Адресат — фонд эволюционной цели и держатели BBM; доля автора считается
 * отдельно, из базы распределения.
 */
export interface RoyaltyPercent {
  total: number
  mission_fund: number
  bbm_holders: number
}

/** Уровень политики BBM. */
export interface PolicyVariables {
  profit_shares: ProfitShares
  royalty_percent: RoyaltyPercent
  /** Доля каждой входящей суммы, уходящая в резерв. */
  reserve_percent: number
  /** Цена первичной эмиссии токена. */
  emission_price_rub: number
  /** Значения для публичных примеров треков. */
  examples: {
    team_monthly_rate_rub: number
    team_hours_norm: number
  }
}

/** Веса майнинга внимания w_p : w_b : w_c. */
export interface MiningWeights {
  pul: number
  bre: number
  con: number
}

/** Уровень проекта. */
export interface ProjectVariables {
  /** Цена юнита продукта проекта. */
  unit_price_rub: number
  mining_weights: MiningWeights
}

export interface FinmodelVariables {
  policy: PolicyVariables
  projects: {
    doctor_school: ProjectVariables
  }
  /**
   * Точечные пути значений, помеченных в мастере как `model_example`, — снятые
   * из его комментариев, а не перечисленные здесь. Публичная страница, которая
   * показывает такое число, обязана показать и пометку.
   */
  model_example: string[]
}

/** Паспорт снапшота: чей мастер, какой ref и какой коммит сняли. */
export interface SnapshotMeta {
  source_repo: string
  ref: string
  source_path: string
  commit_sha: string
  /**
   * sha256 СЫРЫХ байт мастера. Свежесть считается по нему, а не только по
   * разобранным значениям: правка одних комментариев (пометка, подпись под
   * весами майнинга) иначе давала бы нулевой дрейф.
   */
  source_sha256: string
  pulled_at: string
}
