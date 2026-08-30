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
    description: string
    empty: string
    columns: Column[]
  }
> = {
  currencies: {
    title: 'Валюты',
    singular: 'валюту',
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
