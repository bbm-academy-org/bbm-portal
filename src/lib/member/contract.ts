import { z } from 'zod'

import type { WorkspaceAdminSection } from '@/lib/workspace/contract'

const requiredText = z.string().trim().min(1)
const nullableText = requiredText.nullable()

export const memberStatusSchema = z.enum(['active', 'inactive'])

export const memberRecordSchema = z.object({
  id: z.number().int().positive(),
  slug: requiredText,
  email: z.email(),
  name: requiredText,
  role: z.string().nullable(),
  status: memberStatusSchema,
  timezone: requiredText,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type MemberRecord = z.infer<typeof memberRecordSchema>

export const memberCreateSchema = z
  .object({
    name: requiredText,
    email: z.email(),
    role: nullableText.optional(),
    timezone: requiredText.default('Europe/Moscow'),
  })
  .strict()

export type MemberCreateInput = z.input<typeof memberCreateSchema>
export type ParsedMemberCreateInput = z.output<typeof memberCreateSchema>

export const memberUpdateSchema = z
  .object({
    name: requiredText.optional(),
    role: nullableText.optional(),
    timezone: requiredText.optional(),
    status: memberStatusSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Укажите хотя бы одно изменение.')

export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>

export const memberAliasSchema = z.object({
  id: z.number().int().positive(),
  memberId: z.number().int().positive(),
  kind: requiredText.regex(/^[a-z][a-z0-9_]*$/, 'Используйте lower_snake_case.'),
  value: requiredText,
  note: z.string().nullable(),
})

export type MemberAliasRecord = z.infer<typeof memberAliasSchema>

export const memberAliasCreateSchema = z
  .object({
    kind: requiredText.regex(/^[a-z][a-z0-9_]*$/, 'Используйте lower_snake_case.'),
    value: requiredText,
    note: z.string().trim().min(1).nullable().optional(),
  })
  .strict()

export const memberAliasUpdateSchema = memberAliasCreateSchema

export type MemberAliasInput = z.infer<typeof memberAliasCreateSchema>

export const memberAdminSection: WorkspaceAdminSection = {
  label: 'Участники',
  resources: [
    {
      name: 'members',
      label: 'Участники',
      operations: ['list', 'show', 'create', 'edit'],
      schema: memberRecordSchema,
    },
  ],
}
