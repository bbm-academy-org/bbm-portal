'use client'

import React from 'react'
import { useActionState } from 'react'

import type { Participant, Period } from '@/lib/hours/types'
import {
  createPeriodAction,
  deletePeriodAction,
  saveParticipantAction,
  setPeriodStatusAction,
  updatePeriodAction,
} from '@/modules/hours/actions'
import { IDLE_STATE } from '@/modules/hours/actionState'
import type { HoursActionState } from '@/modules/hours/actionState'

/**
 * Формы админки (спека 081 пп. 23, 24). Клиентские только ради обратной связи
 * (`useActionState`): и жёсткий отказ, и мягкое предупреждение («даты
 * пересекаются») должны быть видны там же, где нажали кнопку.
 *
 * Гейт админа применяется на сервере в каждом action — эти формы просто не
 * рисуются не-админу, но безопасность держится не на этом (п.10).
 */

function Feedback({ state }: { state: HoursActionState }) {
  if (state.status === 'idle') return null
  return (
    <div>
      {state.message ? (
        <p
          className={
            state.status === 'error'
              ? 'hours-notice hours-notice--error'
              : 'hours-notice'
          }
        >
          {state.message}
        </p>
      ) : null}
      {state.warnings.map((warning) => (
        <p key={warning} className="hours-notice hours-notice--warn">
          {warning}
        </p>
      ))}
    </div>
  )
}

/** Добавление/правка участника (п.23). */
export function ParticipantForm({ participants }: { participants: Participant[] }) {
  const [state, formAction, pending] = useActionState(saveParticipantAction, IDLE_STATE)
  return (
    <form className="hours-form" action={formAction}>
      <div className="hours-fields">
        <label className="hours-field">
          <span>Email (ключ)</span>
          <input type="email" name="email" required list="hours-participant-emails" />
        </label>
        <datalist id="hours-participant-emails">
          {participants.map((participant) => (
            <option key={participant.email} value={participant.email} />
          ))}
        </datalist>
        <label className="hours-field">
          <span>Имя</span>
          <input type="text" name="name" required />
        </label>
        {/* Роль, вилка и грейд необязательны (решение владельца 2026-07-30):
            участника можно завести только с именем и email. Поля «Ставка»
            нет — ставка вычисляется из вилки и грейда (середина трети). */}
        <label className="hours-field">
          <span>Роль (необязательно)</span>
          <input type="text" name="role" />
        </label>
        <label className="hours-field">
          <span>Вилка min, ₽/мес (необязательно)</span>
          <input type="number" name="forkMin" min={0} step={1000} />
        </label>
        <label className="hours-field">
          <span>Вилка max, ₽/мес (необязательно)</span>
          <input type="number" name="forkMax" min={0} step={1000} />
        </label>
        <label className="hours-field">
          <span>Грейд (необязательно)</span>
          <select name="grade" defaultValue="">
            <option value="">—</option>
            <option value="I">I</option>
            <option value="II">II</option>
            <option value="III">III</option>
          </select>
        </label>
      </div>
      <div className="hours-actions">
        <button type="submit" className="hours-btn" disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить участника'}
        </button>
        <span className="hours-note">
          Существующий email правится на месте; смена email и удаление — через владельца.
        </span>
      </div>
      <Feedback state={state} />
    </form>
  )
}

/** Создание периода (п.24). Новый период создаётся закрытым. */
export function PeriodForm() {
  const [state, formAction, pending] = useActionState(createPeriodAction, IDLE_STATE)
  return (
    <form className="hours-form" action={formAction}>
      <div className="hours-fields">
        <label className="hours-field">
          <span>Название</span>
          <input type="text" name="label" required placeholder="Май–июнь 2026" />
        </label>
        <label className="hours-field">
          <span>Начало</span>
          <input type="date" name="dateFrom" required />
        </label>
        <label className="hours-field">
          <span>Конец</span>
          <input type="date" name="dateTo" required />
        </label>
      </div>
      <div className="hours-actions">
        <button type="submit" className="hours-btn" disabled={pending}>
          {pending ? 'Создаю…' : 'Создать период'}
        </button>
        <span className="hours-note">Диапазон произвольный; открыть — отдельной кнопкой.</span>
      </div>
      <Feedback state={state} />
    </form>
  )
}

/** Открыть / закрыть / править / удалить период (пп. 16, 24). */
export function PeriodRowActions({
  period,
  editable,
}: {
  period: Period
  /** По периоду ещё нет оценок — значит, можно править и удалять (п.16). */
  editable: boolean
}) {
  const [statusState, statusAction, statusPending] = useActionState(
    setPeriodStatusAction,
    IDLE_STATE,
  )
  const [editState, editAction, editPending] = useActionState(updatePeriodAction, IDLE_STATE)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePeriodAction, IDLE_STATE)

  return (
    <div>
      <div className="hours-actions">
        <form action={statusAction} className="hours-inline-form">
          <input type="hidden" name="periodId" value={period.id} />
          <input
            type="hidden"
            name="status"
            value={period.status === 'open' ? 'closed' : 'open'}
          />
          <button type="submit" className="hours-btn hours-btn--ghost" disabled={statusPending}>
            {period.status === 'open' ? 'Закрыть' : 'Открыть'}
          </button>
        </form>
        {editable ? (
          <form action={deleteAction} className="hours-inline-form">
            <input type="hidden" name="periodId" value={period.id} />
            <button type="submit" className="hours-btn hours-btn--ghost" disabled={deletePending}>
              Удалить
            </button>
          </form>
        ) : null}
      </div>

      {editable ? (
        <form className="hours-form" action={editAction}>
          <input type="hidden" name="periodId" value={period.id} />
          <div className="hours-fields">
            <label className="hours-field">
              <span>Название</span>
              <input type="text" name="label" defaultValue={period.label} required />
            </label>
            <label className="hours-field">
              <span>Начало</span>
              <input type="date" name="dateFrom" defaultValue={period.date_from} required />
            </label>
            <label className="hours-field">
              <span>Конец</span>
              <input type="date" name="dateTo" defaultValue={period.date_to} required />
            </label>
          </div>
          <div className="hours-actions">
            <button type="submit" className="hours-btn hours-btn--ghost" disabled={editPending}>
              Сохранить правку
            </button>
          </div>
          <Feedback state={editState} />
        </form>
      ) : (
        <p className="hours-note">
          По периоду уже есть оценки — правка дат и удаление закрыты (правит владелец в JSON).
        </p>
      )}

      <Feedback state={statusState} />
      <Feedback state={deleteState} />
    </div>
  )
}
