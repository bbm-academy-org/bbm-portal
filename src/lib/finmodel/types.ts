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
  /** Модельное значение: доля каждой входящей суммы, уходящая в резерв. */
  reserve_percent: number
  /** Модельное значение: цена первичной эмиссии токена. */
  emission_price_rub: number
  /** Модельные значения для публичных примеров треков. */
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
  /** Модельное значение: цена юнита продукта проекта. */
  unit_price_rub: number
  mining_weights: MiningWeights
}

export interface FinmodelVariables {
  policy: PolicyVariables
  projects: {
    doctor_school: ProjectVariables
  }
}

/** Паспорт снапшота: чей мастер, какой ref и какой коммит сняли. */
export interface SnapshotMeta {
  source_repo: string
  ref: string
  source_path: string
  commit_sha: string
  pulled_at: string
}
