/**
 * Доступ к переменным модели. Единственная дверь к снапшоту: всё остальное в
 * модуле принимает значения аргументами, а не читает файл само.
 *
 * Читается обычным JSON-импортом, а не через `node:fs`: модуль обязан
 * собираться и в серверном, и в клиентском бандле — калькуляторы треков живут
 * в браузере, а ходить за переменными в сеть значило бы отдать публичной
 * странице право показать НЕ то, что зафиксировано в снапшоте.
 */

import snapshot from './snapshot/finmodel.json'
import meta from './snapshot/meta.json'
import type { FinmodelVariables, SnapshotMeta } from './types'

/**
 * Переменные модели из закоммиченного снапшота мастера.
 *
 * Приведение типа здесь честно потому, что форму проверяет машина, а не
 * договорённость: `findInvariantViolations` (tools/ssot/pull-finmodel.mjs)
 * перечисляет все обязательные листы и роняет `ssot:pull` / `ssot:check` на
 * переименованном или выпавшем поле мастера, а тот же вызов на закоммиченном
 * файле стоит в `tests/unit/finmodel-ssot-snapshot.spec.ts`.
 */
export function getVariables(): FinmodelVariables {
  return snapshot as FinmodelVariables
}

/**
 * Точечные пути значений, помеченных в мастере как `model_example`. Снимаются
 * из комментариев мастера при `pnpm ssot:pull` — руками этот список не ведётся.
 */
export const MODEL_EXAMPLE_PATHS: readonly string[] = getVariables().model_example

/**
 * Модельное ли это значение — вопрос, который задаёт любая поверхность перед
 * тем, как показать число: помеченное публикуется с пометкой (спека §9 п.5).
 */
export function isModelExample(path: string): boolean {
  return MODEL_EXAMPLE_PATHS.includes(path)
}

/**
 * Паспорт снапшота — им подписывается любая публичная страница, которая
 * показывает модельные значения: читатель должен видеть, из какого коммита
 * мастера взяты числа.
 */
export const SNAPSHOT_META: SnapshotMeta = meta
