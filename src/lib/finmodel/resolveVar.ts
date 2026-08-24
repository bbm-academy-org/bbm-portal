import type { FinmodelVariables } from './types'

/**
 * Значение снапшота по точечному пути — тот же путь, которым нормативный
 * документ зовёт переменную: `<V k="policy.reserve_percent" />`.
 *
 * Живёт в домене, а не в слое отображения, намеренно: с отменой портальной
 * страницы (владелец, 2026-08-24 — документ рендерит KB) единственный
 * потребитель этой функции — сверка текста с кодом
 * (`tests/unit/finmodel-rules-consistency.spec.ts`). Разрешение ключа мастера
 * — вопрос домена в любом случае; слой отображения его только звал.
 *
 * Оборванный путь — ИСКЛЮЧЕНИЕ, а не прочерк: подстановка, которая не
 * разрешилась, обязана уронить тест, а не показать читателю нормативного
 * документа «—» на месте ставки резерва.
 */
export function resolveVar(variables: FinmodelVariables, key: string): number {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      variables,
    )
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `нормативный документ: <V k="${key}" /> не разрешается в число снапшота ` +
        '(мастер значений — ssot/finmodel.yaml в bbm-kb, снимается `pnpm ssot:pull`)',
    )
  }
  return value
}
