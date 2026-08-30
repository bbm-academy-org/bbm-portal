import { z } from 'zod'

import type { WorkspaceAdminSection } from '@/lib/workspace/contract'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату в формате ГГГГ-ММ-ДД.')
const nullableMoney = z.number().finite().nonnegative().nullable()

export const hoursAssessmentRecordSchema = z
  .object({
    email: z.string().email(),
    name: z.string(),
    hours: z.number().finite().nonnegative(),
    method: z.enum(['period', 'week', 'day']),
    weekendHours: z.number().finite().nonnegative(),
    splitPercent: z.number().finite().min(0).max(100),
    monthlyRate: nullableMoney,
    hourlyRate: nullableMoney,
    accrual: z.number().finite().nonnegative(),
    cashAmount: z.number().finite().nonnegative(),
    investAmount: z.number().finite().nonnegative(),
    weekdayCount: z.number().int().nonnegative(),
    savedAt: z.string(),
  })
  .strict()

export const hoursPeriodRecordSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    dateFrom: isoDate,
    dateTo: isoDate,
    status: z.enum(['open', 'closed']),
    locked: z.boolean(),
    assessments: z.array(hoursAssessmentRecordSchema),
    publicationStatus: z.enum(['sending', 'published', 'incomplete']).nullable(),
    warnings: z.array(z.string()).default([]),
  })
  .strict()

export const hoursPeriodCreateSchema = z
  .object({
    label: z.string().trim().min(1, 'Укажите название периода.'),
    dateFrom: isoDate,
    dateTo: isoDate,
  })
  .strict()

const hoursPeriodEditSchema = hoursPeriodCreateSchema.extend({}).strict()
const hoursPeriodStatusSchema = z.object({ status: z.enum(['open', 'closed']) }).strict()
export const hoursPeriodUpdateSchema = z.union([hoursPeriodEditSchema, hoursPeriodStatusSchema])

const participantProfile = {
  name: z.string().trim().min(1, 'Укажите имя участника.'),
  role: z.string().trim().nullable(),
  forkMin: nullableMoney,
  forkMax: nullableMoney,
  grade: z.enum(['I', 'II', 'III']).nullable(),
}

export const hoursParticipantRecordSchema = z
  .object({
    email: z.string().email(),
    ...participantProfile,
    monthlyRate: nullableMoney,
  })
  .strict()

export const hoursParticipantCreateSchema = z
  .object({ email: z.string().trim().email('Укажите корректный email.'), ...participantProfile })
  .strict()

export const hoursParticipantUpdateSchema = z.object(participantProfile).strict()

const publicationEligibilitySchema = z.object({
  status: z.enum(['eligible', 'open', 'empty', 'published', 'incomplete']),
  canPublish: z.boolean(),
  reason: z.string().nullable(),
})

export const hoursPublicationRecordSchema = z
  .object({
    id: z.literal('mattermost-publication'),
    periodId: z.string(),
    previewFingerprint: z.string(),
    messages: z.array(z.object({ email: z.string().email(), text: z.string() }).strict()),
    eligibility: publicationEligibilitySchema.strict(),
    publicationStatus: z.enum(['sending', 'published', 'incomplete']).nullable(),
  })
  .strict()

export const hoursPublicationRequestSchema = z
  .object({ periodId: z.string().min(1), previewFingerprint: z.string().min(1) })
  .strict()

export type HoursPeriodRecord = z.infer<typeof hoursPeriodRecordSchema>
export type HoursPeriodCreate = z.infer<typeof hoursPeriodCreateSchema>
export type HoursPeriodUpdate = z.infer<typeof hoursPeriodUpdateSchema>
export type HoursParticipantRecord = z.infer<typeof hoursParticipantRecordSchema>
export type HoursParticipantCreate = z.infer<typeof hoursParticipantCreateSchema>
export type HoursParticipantUpdate = z.infer<typeof hoursParticipantUpdateSchema>
export type HoursPublicationRecord = z.infer<typeof hoursPublicationRecordSchema>
export type HoursPublicationRequest = z.infer<typeof hoursPublicationRequestSchema>

export const hoursAdminSection: WorkspaceAdminSection = {
  label: 'Часы',
  resources: [
    {
      name: 'periods',
      label: 'Периоды',
      operations: ['list', 'create', 'edit', 'delete'],
      schema: hoursPeriodRecordSchema,
    },
    {
      name: 'participants',
      label: 'Ставки и грейды',
      operations: ['list', 'create', 'edit'],
      schema: hoursParticipantRecordSchema,
    },
    {
      name: 'publication',
      label: 'Публикация в Mattermost',
      operations: ['list'],
      schema: hoursPublicationRecordSchema,
    },
  ],
}
