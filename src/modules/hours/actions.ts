'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import {
  HoursDataError,
  isOwnEmail,
  mutateHoursDocument,
  saveAssessment,
  sessionEmail,
} from '@/lib/hours'
import type { Assessment, AssessmentMethod, AuditContext, MutationResult } from '@/lib/hours'

import type { HoursActionState } from './actionState'

function error(message: string): HoursActionState {
  return { status: 'error', message, warnings: [], saved: null }
}

function success(
  message: string,
  warnings: string[],
  saved: Assessment | null = null,
): HoursActionState {
  return { status: 'ok', message, warnings, saved }
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function number(formData: FormData, key: string): number {
  const raw = text(formData, key).replace(',', '.')
  return raw === '' ? Number.NaN : Number(raw)
}

async function requireEmail(): Promise<{ email: string } | HoursActionState> {
  const session = await auth()
  if (!session?.user) return error('Сессия истекла — войди заново.')
  const email = sessionEmail(session)
  if (!email) {
    return error(
      'В сессии нет email — сохранять нельзя. Нужен claim email у клиента Zitadel; войди заново после его выдачи.',
    )
  }
  return { email }
}

function actorOf(gate: { email: string }): AuditContext {
  return { actorEmail: gate.email, source: 'portal' }
}

function refresh(): void {
  revalidatePath('/p/hours')
}

function toState<T>(
  result: MutationResult<T>,
  okMessage: string,
  saved: (value: T) => Assessment | null = () => null,
): HoursActionState {
  if (!result.ok) return error(result.error)
  refresh()
  return success(okMessage, result.warnings, saved(result.saved))
}

async function guarded(run: () => Promise<HoursActionState>): Promise<HoursActionState> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof HoursDataError) {
      return error(
        'Данные недоступны: база модуля часов не отвечает. Оценки не тронуты — позови администратора.',
      )
    }
    throw cause
  }
}

/** Saves only the signed-in member's assessment for an open period. */
export async function saveAssessmentAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireEmail()
    if ('status' in gate) return gate

    const target = text(formData, 'email')
    if (!isOwnEmail(gate.email, target)) {
      return error('Оценку можно сохранять только за себя.')
    }

    const result = await mutateHoursDocument(actorOf(gate), (doc) =>
      saveAssessment(
        doc,
        {
          periodId: text(formData, 'periodId'),
          email: gate.email,
          hours: number(formData, 'hours'),
          method: text(formData, 'method') as AssessmentMethod,
          weekendHours: number(formData, 'weekendHours'),
          splitPercent: number(formData, 'splitPercent'),
        },
        new Date().toISOString(),
      ),
    )
    return toState(result, 'Оценка сохранена.', (assessment) => assessment)
  })
}
