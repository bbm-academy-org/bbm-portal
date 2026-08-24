import React from 'react'

import { formatInt, formatPercent, formatRub, isModelExample } from '@/lib/finmodel'
import type { FinmodelVariables } from '@/lib/finmodel'

/**
 * `<V/>` — единственный способ, которым число попадает в нормативный документ.
 *
 * Компонент приезжает в MDX через components-map рендерера, а НЕ импортом: в
 * мастере документа import-деклараций нет по контракту (`next-mdx-remote` их
 * не поддерживает), и это записано в самом мастере.
 *
 * Форматирование выбирает `unit`, а не автор текста: так «5%» и «1 000 ₽»
 * выглядят одинаково на всех поверхностях модуля и меняются в одном месте
 * (`src/lib/finmodel/format.ts`).
 */

/**
 * Значение снапшота по точечному пути. Оборванный путь — ИСКЛЮЧЕНИЕ, а не
 * прочерк: подстановка, которая не разрешилась, обязана уронить сборку и тест
 * (`tests/unit/finmodel-rules-consistency.spec.ts`), а не показать читателю
 * нормативного документа «—» на месте ставки резерва.
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

/** Единицы, в которых документ просит показать значение. */
export type VUnit = '%' | 'rub'

export function formatVar(value: number, unit?: VUnit): string {
  if (unit === '%') return formatPercent(value)
  if (unit === 'rub') return formatRub(value)
  return formatInt(value)
}

export function V({
  k,
  unit,
  variables,
}: {
  k: string
  unit?: VUnit
  variables: FinmodelVariables
}) {
  const value = resolveVar(variables, k)
  const modelExample = isModelExample(k)
  return (
    <span
      className="rules-var"
      data-model-example={modelExample ? 'true' : undefined}
      // Пометка модельного значения (спека финмодели §9 п.5) едет из снапшота,
      // а не из текста: владелец переводит число из модельного в фикс канона в
      // bbm-kb, и пометка исчезает здесь сама.
      title={
        modelExample
          ? `${k} — модельное значение: настраивается в калькуляторе и финализируется при запуске`
          : k
      }
    >
      {formatVar(value, unit)}
      {modelExample ? <span className="rules-var__mark"> ⚙</span> : null}
    </span>
  )
}
