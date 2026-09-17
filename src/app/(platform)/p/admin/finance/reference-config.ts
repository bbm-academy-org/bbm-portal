import type { FinanceReferenceResource } from '@/lib/finance'

export type FinanceReferenceRow = Record<string, unknown> & {
  id: string | number
  name: string
  retiredAt: string | null
}

type Column = { key: string; label: string }

export const financeReferenceUi: Record<
  FinanceReferenceResource,
  {
    title: string
    singular: string
    created: string
    saved: string
    description: string
    empty: string
    columns: Column[]
  }
> = {
  currencies: {
    title: 'Валюты',
    singular: 'валюту',
    created: 'Валюта добавлена.',
    saved: 'Валюта сохранена.',
    description: 'Коды валют и точность сумм в минимальных единицах.',
    empty: 'Валют пока нет.',
    columns: [
      { key: 'code', label: 'Код' },
      { key: 'name', label: 'Название' },
      { key: 'precision', label: 'Точность' },
    ],
  },
  accounts: {
    title: 'Счета',
    singular: 'счёт',
    created: 'Счёт добавлен.',
    saved: 'Счёт сохранён.',
    description: 'Денежные и системные счета финансового контура.',
    empty: 'Счетов пока нет.',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'kind', label: 'Тип' },
      { key: 'currency', label: 'Валюта' },
    ],
  },
  projects: {
    title: 'Проекты',
    singular: 'проект',
    created: 'Проект добавлен.',
    saved: 'Проект сохранён.',
    description: 'Проекты, к которым относятся финансовые факты.',
    empty: 'Проектов пока нет.',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'isFund', label: 'Фонд' },
    ],
  },
  products: {
    title: 'Продукты',
    singular: 'продукт',
    created: 'Продукт добавлен.',
    saved: 'Продукт сохранён.',
    description: 'Продукты проектов и их базовые цены.',
    empty: 'Продуктов пока нет.',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'projectId', label: 'Проект' },
      { key: 'salePrice', label: 'Цена' },
      { key: 'salePriceCurrency', label: 'Валюта' },
    ],
  },
  purposes: {
    title: 'Назначения расходов',
    singular: 'назначение',
    created: 'Назначение расхода добавлено.',
    saved: 'Назначение расхода сохранено.',
    description: 'Правила назначения категории и продукта при расходе.',
    empty: 'Назначений расходов пока нет.',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'categoryId', label: 'Статья' },
      { key: 'productBinding', label: 'Продукт' },
    ],
  },
  categories: {
    title: 'Статьи расходов',
    singular: 'статью расходов',
    created: 'Статья расходов добавлена.',
    saved: 'Статья расходов сохранена.',
    description: 'Управленческие статьи для классификации расходов.',
    empty: 'Статей расходов пока нет — список намеренно пуст до первой настройки.',
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'allocable', label: 'Распределяемая' },
    ],
  },
}

export function financeResourceName(resource: FinanceReferenceResource) {
  return `finance.${resource}`
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  const labels: Record<string, string> = {
    bank: 'Банк',
    card: 'Карта',
    crypto: 'Криптовалюта',
    cash: 'Наличные',
    required: 'Обязателен',
    forbidden: 'Запрещён',
    optional: 'Необязателен',
  }
  return labels[String(value)] ?? String(value)
}

export type FinanceReferenceAct = 'create' | 'update' | 'retire' | 'delete'

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

/**
 * ONE feedback channel for every finance reference table (#479).
 *
 * The cabinet reports a mutation through Refine's notification provider —
 * `docs/design/ui-whitelist.md` → Feedback — and Refine's own defaults are
 * English («Successfully updated finance.purpose»), so every mutation names its
 * own Russian copy. The copy lives HERE, beside the rest of each table's
 * Russian labels, so all six tables (`[resource]` routes over one form) inherit
 * the same wording instead of each screen inventing its own.
 */
export function referenceSuccessNotification(
  resource: FinanceReferenceResource,
  act: FinanceReferenceAct,
  name?: string,
): { type: 'success'; message: string; description?: string } {
  const config = financeReferenceUi[resource]
  switch (act) {
    case 'create':
      return { type: 'success', message: config.created, description: name || config.title }
    case 'update':
      return { type: 'success', message: config.saved, description: name || config.title }
    case 'retire':
      return {
        type: 'success',
        message: 'Запись отправлена в архив.',
        description: name || config.title,
      }
    case 'delete':
      return { type: 'success', message: 'Запись удалена.', description: name || config.title }
  }
}

export function referenceErrorNotification(
  resource: FinanceReferenceResource,
  act: FinanceReferenceAct,
  name?: string,
): (error: unknown) => { type: 'error'; message: string; description: string } {
  const config = financeReferenceUi[resource]
  const message =
    act === 'create'
      ? `Не удалось добавить ${config.singular}.`
      : act === 'update'
        ? `Не удалось сохранить ${config.singular}.`
        : act === 'retire'
          ? `Не удалось отправить ${config.singular} в архив.`
          : `Не удалось удалить ${config.singular}.`
  return (error: unknown) => ({
    type: 'error',
    message,
    description: errorMessage(error, name || config.title),
  })
}
