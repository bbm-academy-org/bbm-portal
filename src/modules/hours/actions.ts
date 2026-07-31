'use server'

/**
 * Server Actions модуля часов (спека 081 п.11) — единственный способ что-либо
 * изменить. Same-origin, Auth.js/`AUTH_URL` за Caddy уже настроены (#60).
 *
 * КАЖДЫЙ action сам вызывает `auth()` и сам применяет свои гейты (сессия, email,
 * админство) — на `(platform)/layout.tsx` здесь НЕ полагаемся: layout защищает
 * рендер страницы, а action вызывается напрямую, минуя её.
 *
 * Это первые Server Actions репозитория на проде за реверс-прокси. Если
 * origin-check Next (Origin vs X-Forwarded-Host) за Caddy не пройдёт — лечится
 * `serverActions.allowedOrigins` в next.config.ts; первая мутация на проде —
 * явный шаг приёмки, не допущение.
 */

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import {
  createPublicationBatch,
  createPeriod,
  deletePeriod,
  HoursDataError,
  isHoursAdmin,
  isOwnEmail,
  mutateHoursDocument,
  recordPublicationDelivery,
  saveAssessment,
  sessionEmail,
  setPeriodStatus,
  updatePeriod,
  upsertParticipant,
} from '@/lib/hours'
import type { Assessment, AssessmentMethod, Grade, MutationResult, PeriodStatus } from '@/lib/hours'

import type { HoursActionState } from './actionState'

const MATTERMOST_DELIVERY_TIMEOUT_MS = 10_000

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

/** Число из формы; запятая как разделитель принимается наравне с точкой. */
function number(formData: FormData, key: string): number {
  const raw = text(formData, key).replace(',', '.')
  if (raw === '') return Number.NaN
  return Number(raw)
}

/**
 * Необязательное число: пустое поле — осознанный null («не задано»), мусор —
 * NaN, который доменная валидация отвергнет вслух (пустое ≠ ошибка ввода).
 */
function optionalNumber(formData: FormData, key: string): number | null {
  const raw = text(formData, key)
  if (raw === '') return null
  return Number(raw.replace(',', '.'))
}

/** Необязательный текст: пустое поле — null. */
function optionalText(formData: FormData, key: string): string | null {
  const raw = text(formData, key)
  return raw === '' ? null : raw
}

/**
 * Общий предбанник любой мутации: сессия есть и в ней есть email. Сессия без
 * email читать страницы может, менять — нет (п.8).
 */
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

/** Тот же предбанник плюс allowlist администраторов (п.10, fail-closed). */
async function requireAdmin(): Promise<{ email: string } | HoursActionState> {
  const gate = await requireEmail()
  if ('status' in gate) return gate
  if (!isHoursAdmin(gate.email, process.env.HOURS_ADMIN_EMAILS)) {
    return error('Доступ к админке часов есть только у администраторов.')
  }
  return gate
}

function refresh(): void {
  revalidatePath('/p/hours')
  revalidatePath('/p/hours/admin')
}

/** Приводит результат доменной операции к состоянию формы. */
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
      return error('Данные модуля часов не читаются — файл не тронут, позови администратора.')
    }
    throw cause
  }
}

/** Сохранение самооценки (п.21). Только за себя (п.9) и только в открытый период. */
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

    const result = await mutateHoursDocument((doc) =>
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

/** Добавление/правка участника (п.23) — только админ. */
export async function saveParticipantAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireAdmin()
    if ('status' in gate) return gate

    // Роль, вилка и грейд необязательны (решение владельца 2026-07-30);
    // ставка не передаётся вовсе — она вычисляется из вилки и грейда.
    const result = await mutateHoursDocument((doc) =>
      upsertParticipant(doc, {
        email: text(formData, 'email'),
        name: text(formData, 'name'),
        role: optionalText(formData, 'role'),
        forkMin: optionalNumber(formData, 'forkMin'),
        forkMax: optionalNumber(formData, 'forkMax'),
        grade: optionalText(formData, 'grade') as Grade | null,
      }),
    )
    return toState(result, 'Участник сохранён.')
  })
}

/** Создание периода (п.24) — только админ; новый период закрыт. */
export async function createPeriodAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireAdmin()
    if ('status' in gate) return gate

    const result = await mutateHoursDocument((doc) =>
      createPeriod(
        doc,
        {
          label: text(formData, 'label'),
          dateFrom: text(formData, 'dateFrom'),
          dateTo: text(formData, 'dateTo'),
        },
        randomUUID(),
      ),
    )
    return toState(result, 'Период создан — открой его, когда будет пора.')
  })
}

/**
 * Правка label/дат периода (пп. 16, 24) — только админ. Оценки правку не
 * блокируют (issue #85); смена дат пересчитывает производные поля оценок
 * периода и возвращает предупреждение с их числом.
 */
export async function updatePeriodAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireAdmin()
    if ('status' in gate) return gate

    const result = await mutateHoursDocument((doc) =>
      updatePeriod(doc, {
        id: text(formData, 'periodId'),
        label: text(formData, 'label'),
        dateFrom: text(formData, 'dateFrom'),
        dateTo: text(formData, 'dateTo'),
      }),
    )
    return toState(result, 'Период обновлён.')
  })
}

/** Удаление периода, пока по нему нет оценок (п.16) — только админ. */
export async function deletePeriodAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireAdmin()
    if ('status' in gate) return gate

    const result = await mutateHoursDocument((doc) => deletePeriod(doc, text(formData, 'periodId')))
    return toState(result, 'Период удалён.')
  })
}

/** Открытие/закрытие периода (п.24) — только админ. */
export async function setPeriodStatusAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireAdmin()
    if ('status' in gate) return gate

    const status = text(formData, 'status') as PeriodStatus
    if (status !== 'open' && status !== 'closed') return error('Неизвестный статус периода.')

    const result = await mutateHoursDocument((doc) =>
      setPeriodStatus(doc, text(formData, 'periodId'), status),
    )
    return toState(result, status === 'open' ? 'Период открыт.' : 'Период закрыт.')
  })
}

/**
 * Publishes one immutable period batch to the channel-bound Mattermost
 * incoming webhook. Auth and configuration gates run before the atomic batch
 * write; every delivery result is persisted before the next request.
 */
export async function publishHoursToMattermostAction(
  _prev: HoursActionState,
  formData: FormData,
): Promise<HoursActionState> {
  return guarded(async () => {
    const gate = await requireAdmin()
    if ('status' in gate) return gate

    const webhookUrl = process.env.MATTERMOST_HOURS_WEBHOOK_URL?.trim()
    if (!webhookUrl) {
      return error('Публикация в Mattermost не настроена — позови администратора.')
    }

    const periodId = text(formData, 'periodId')
    const previewFingerprint = text(formData, 'previewFingerprint')
    if (!periodId || !previewFingerprint) {
      return error('Предпросмотр устарел — обнови страницу и проверь сообщения снова.')
    }

    const created = await mutateHoursDocument((doc) =>
      createPublicationBatch(doc, periodId, previewFingerprint, new Date().toISOString()),
    )
    if (!created.ok) return error(created.error)

    for (const [index, message] of created.saved.messages.entries()) {
      let delivery: 'sent' | 'failed' | 'unknown'
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: message.text }),
          signal: AbortSignal.timeout(MATTERMOST_DELIVERY_TIMEOUT_MS),
        })
        const responseBody = await response.text()
        delivery = response.status === 200 && responseBody.trim() === 'ok' ? 'sent' : 'failed'
      } catch {
        delivery = 'unknown'
      }

      const progressed = await mutateHoursDocument((doc) =>
        recordPublicationDelivery(doc, periodId, index, delivery, new Date().toISOString()),
      )
      if (!progressed.ok) {
        return error(
          'Не удалось сохранить прогресс публикации — автоматический повтор заблокирован.',
        )
      }

      if (delivery !== 'sent') {
        refresh()
        const sent = progressed.saved.messages.filter(
          (candidate) => candidate.delivery === 'sent',
        ).length
        return error(
          delivery === 'unknown'
            ? `Результат доставки неизвестен. Отправлено ${sent} из ${progressed.saved.messages.length}; автоматический повтор заблокирован.`
            : `Mattermost не подтвердил доставку. Отправлено ${sent} из ${progressed.saved.messages.length}; автоматический повтор заблокирован.`,
        )
      }
    }

    refresh()
    return success(`Опубликовано ${created.saved.messages.length} сообщений в Mattermost.`, [])
  })
}
