/**
 * Нормативный документ «Смарт-контракт BBM» — единственная дверь к его снимку.
 *
 * Мастер документа живёт вне репо: `content/finmodel/index.mdx` в bbm-kb,
 * снимается `pnpm ssot:pull` байт в байт, свежесть стережёт та же джоба
 * `ssot-freshness` (сравнивается sha256 сырых байт, `meta.rules`). Здесь текст
 * НЕ правится: правка идёт в мастер и приезжает снятием.
 *
 * Отдаётся строкой, а не разобранным деревом: разбор — дело рендерера
 * (`src/modules/finmodel/view/RulesDocument.tsx`), а тест согласованности
 * (`tests/unit/finmodel-rules-consistency.spec.ts`) читает ровно тот же текст,
 * который увидит читатель.
 */

import raw from './snapshot/rules.mdx'
import meta from './snapshot/meta.json'

export const RULES_MDX: string = raw

/**
 * Паспорт снимка ДОКУМЕНТА — отдельно от паспорта yaml-снапшота.
 *
 * `commit_sha` здесь — последний коммит самого файла документа, а не HEAD
 * bbm-kb на момент снятия (решение по round-2 ревью PR #320): подпись под
 * документом читает человек, и «версия» для него — когда менялся ЭТОТ текст.
 */
export const RULES_META: {
  source_path: string
  commit_sha: string
  commit_date: string
  source_sha256: string
  pulled_at: string
} = meta.rules
