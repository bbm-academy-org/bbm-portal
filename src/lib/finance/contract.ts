import { z } from 'zod'

import type { WorkspaceAdminSection } from '@/lib/workspace/contract'

const requiredText = z.string().trim().min(1)
const positiveId = z.coerce.number().int().positive()
const retiredAt = z.iso.datetime().nullable()
const retirePatch = { retire: z.literal(true).optional() }

function patch<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...shape, ...retirePatch })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Укажите хотя бы одно изменение.')
}

export const financeCurrencyRecordSchema = z
  .object({
    id: requiredText,
    code: requiredText,
    name: requiredText,
    precision: z.number().int().min(0).max(18),
    retiredAt,
  })
  .strict()
export const financeCurrencyCreateSchema = z
  .object({
    code: requiredText,
    name: requiredText,
    precision: z.coerce.number().int().min(0).max(18),
  })
  .strict()
export const financeCurrencyUpdateSchema = patch({
  name: requiredText.optional(),
  precision: z.coerce.number().int().min(0).max(18).optional(),
})

export const financeMoneyAccountKindSchema = z.enum(['bank', 'card', 'crypto', 'cash'])
export const financeAccountKindSchema = z.enum([
  'bank',
  'card',
  'crypto',
  'cash',
  'income',
  'expense',
  'conversion',
  'fx_result',
  'liability',
])
export const financeAccountRecordSchema = z
  .object({
    id: positiveId,
    name: requiredText,
    kind: financeAccountKindSchema,
    currency: requiredText,
    isSystem: z.boolean(),
    retiredAt,
  })
  .strict()
export const financeAccountCreateSchema = z
  .object({ name: requiredText, kind: financeMoneyAccountKindSchema, currency: requiredText })
  .strict()
export const financeAccountUpdateSchema = patch({ name: requiredText.optional() })

export const financeProjectRecordSchema = z
  .object({
    id: positiveId,
    name: requiredText,
    isFund: z.boolean(),
    retiredAt,
  })
  .strict()
export const financeProjectCreateSchema = z.object({ name: requiredText }).strict()
export const financeProjectUpdateSchema = patch({ name: requiredText.optional() })

const nullableMoney = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Укажите сумму в минимальных единицах.')
  .nullable()
export const financeProductRecordSchema = z
  .object({
    id: positiveId,
    projectId: positiveId,
    name: requiredText,
    salePrice: nullableMoney,
    salePriceCurrency: requiredText.nullable(),
    retiredAt,
  })
  .strict()
export const financeProductCreateSchema = z
  .object({
    projectId: positiveId,
    name: requiredText,
    salePrice: nullableMoney.optional(),
    salePriceCurrency: requiredText.nullable().optional(),
  })
  .strict()
export const financeProductUpdateSchema = patch({
  name: requiredText.optional(),
  salePrice: nullableMoney.optional(),
  salePriceCurrency: requiredText.nullable().optional(),
})

export const financeProductBindingSchema = z.enum(['required', 'forbidden', 'optional'])
export const financePurposeRecordSchema = z
  .object({
    id: positiveId,
    name: requiredText,
    categoryId: positiveId.nullable(),
    productBinding: financeProductBindingSchema,
    retiredAt,
  })
  .strict()
export const financePurposeCreateSchema = z
  .object({
    name: requiredText,
    categoryId: positiveId.nullable().optional(),
    productBinding: financeProductBindingSchema,
  })
  .strict()
export const financePurposeUpdateSchema = patch({
  name: requiredText.optional(),
  categoryId: positiveId.nullable().optional(),
  productBinding: financeProductBindingSchema.optional(),
})

export const financeCategoryRecordSchema = z
  .object({
    id: positiveId,
    name: requiredText,
    allocable: z.boolean(),
    retiredAt,
  })
  .strict()
export const financeCategoryCreateSchema = z
  .object({ name: requiredText, allocable: z.boolean() })
  .strict()
export const financeCategoryUpdateSchema = patch({
  name: requiredText.optional(),
  allocable: z.boolean().optional(),
})

/** The one response schema shared by the dynamic finance cabinet route files. */
export const financeReferenceRecordSchema = z.union([
  financeCurrencyRecordSchema,
  financeAccountRecordSchema,
  financeProjectRecordSchema,
  financeProductRecordSchema,
  financePurposeRecordSchema,
  financeCategoryRecordSchema,
])

export const financeReferenceContracts = {
  currencies: {
    label: 'Валюты',
    table: 'currency',
    record: financeCurrencyRecordSchema,
    create: financeCurrencyCreateSchema,
    update: financeCurrencyUpdateSchema,
  },
  accounts: {
    label: 'Счета',
    table: 'account',
    record: financeAccountRecordSchema,
    create: financeAccountCreateSchema,
    update: financeAccountUpdateSchema,
  },
  projects: {
    label: 'Проекты',
    table: 'project',
    record: financeProjectRecordSchema,
    create: financeProjectCreateSchema,
    update: financeProjectUpdateSchema,
  },
  products: {
    label: 'Продукты',
    table: 'product',
    record: financeProductRecordSchema,
    create: financeProductCreateSchema,
    update: financeProductUpdateSchema,
  },
  purposes: {
    label: 'Назначения расходов',
    table: 'purpose',
    record: financePurposeRecordSchema,
    create: financePurposeCreateSchema,
    update: financePurposeUpdateSchema,
  },
  categories: {
    label: 'Статьи расходов',
    table: 'category',
    record: financeCategoryRecordSchema,
    create: financeCategoryCreateSchema,
    update: financeCategoryUpdateSchema,
  },
} as const

export type FinanceReferenceResource = keyof typeof financeReferenceContracts
export type FinanceReferenceRecord = z.infer<typeof financeReferenceRecordSchema>

export function isFinanceReferenceResource(value: string): value is FinanceReferenceResource {
  return Object.hasOwn(financeReferenceContracts, value)
}

export const financeAdminSection: WorkspaceAdminSection = {
  label: 'Финансы',
  resources: Object.entries(financeReferenceContracts).map(([name, contract]) => ({
    name,
    label: contract.label,
    operations: ['list', 'show', 'create', 'edit', 'delete'],
    schema: contract.record,
  })),
}
