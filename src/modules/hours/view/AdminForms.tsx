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
import { ParticipantsTable } from './ParticipantsTable'

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
          className={state.status === 'error' ? 'hours-notice hours-notice--error' : 'hours-notice'}
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

/**
 * Добавление/правка участника (п.23).
 *
 * `editing` — участник, выбранный кнопкой «Изменить» в таблице (issue #85):
 * поля заполняются его значениями, и правка одного грейда перестаёт требовать
 * перенабора всей карточки. Форма НЕ контролируемая: значения задаются через
 * `defaultValue`, а смена участника делается перемонтированием по `key` в
 * `ParticipantsAdmin` — так после сохранения не приходится синхронизировать
 * стейт с ответом сервера.
 *
 * `undefined` вместо `''` в `defaultValue` осознанно: пустой атрибут `value`
 * превратил бы поле в «пустое значение», а не в «значения нет».
 */
export function ParticipantForm({
  participants,
  editing = null,
  onCancel,
}: {
  participants: Participant[]
  editing?: Participant | null
  /** Выход из режима правки — вернуться к заведению нового участника. */
  onCancel?: () => void
}) {
  const [state, formAction, pending] = useActionState(saveParticipantAction, IDLE_STATE)
  return (
    <form className="hours-form" action={formAction}>
      {editing ? (
        <p className="hours-note">
          Правим участника: <b>{editing.name}</b> ({editing.email})
        </p>
      ) : null}
      <div className="hours-fields">
        <label className="hours-field">
          <span>Email (ключ)</span>
          {/* В режиме правки email только показывается: он ключ записи, и его
              смена создала бы дубль вместо правки на месте (п.16). readOnly, а
              не disabled — иначе поле не попало бы в FormData; подсказка
              datalist там же отключается — предлагать варианты для поля,
              которое не изменить, бессмысленно. */}
          <input
            type="email"
            name="email"
            required
            list={editing ? undefined : 'hours-participant-emails'}
            defaultValue={editing?.email}
            readOnly={editing != null}
          />
        </label>
        {/* Подсказка по существующим email остаётся: она бережёт от опечатки
            при ЗАВЕДЕНИИ (опечатка = новая запись вместо правки). */}
        <datalist id="hours-participant-emails">
          {participants.map((participant) => (
            <option key={participant.email} value={participant.email} />
          ))}
        </datalist>
        <label className="hours-field">
          <span>Имя</span>
          {/* autoFocus только в режиме правки: форма перемонтируется по key,
              поэтому фокус (и скролл к нему) переезжает на неё сразу после
              клика «Изменить» — при длинном списке иначе не видно, что вообще
              что-то произошло. На первой загрузке страницы editing === null,
              так что фокус ни у кого не отбирается. */}
          <input
            type="text"
            name="name"
            required
            defaultValue={editing?.name}
            autoFocus={editing != null}
          />
        </label>
        {/* Роль, вилка и грейд необязательны (решение владельца 2026-07-30):
            участника можно завести только с именем и email. Поля «Ставка»
            нет — ставка вычисляется из вилки и грейда (середина трети). */}
        <label className="hours-field">
          <span>Роль (необязательно)</span>
          <input type="text" name="role" defaultValue={editing?.role ?? undefined} />
        </label>
        <label className="hours-field">
          <span>Вилка min, ₽/мес (необязательно)</span>
          <input
            type="number"
            name="forkMin"
            min={0}
            step={1000}
            defaultValue={editing?.fork_min ?? undefined}
          />
        </label>
        <label className="hours-field">
          <span>Вилка max, ₽/мес (необязательно)</span>
          <input
            type="number"
            name="forkMax"
            min={0}
            step={1000}
            defaultValue={editing?.fork_max ?? undefined}
          />
        </label>
        <label className="hours-field">
          <span>Грейд (необязательно)</span>
          <select name="grade" defaultValue={editing?.grade ?? ''}>
            <option value="">—</option>
            <option value="I">I</option>
            <option value="II">II</option>
            <option value="III">III</option>
          </select>
        </label>
      </div>
      <div className="hours-actions">
        <button type="submit" className="hours-btn" disabled={pending}>
          {pending ? 'Сохраняю…' : editing ? 'Сохранить изменения' : 'Сохранить участника'}
        </button>
        {editing ? (
          <button type="button" className="hours-btn hours-btn--ghost" onClick={onCancel}>
            Отмена
          </button>
        ) : null}
        <span className="hours-note">
          {editing
            ? 'Email — ключ записи и не меняется; смена email и удаление участника — правит владелец в JSON.'
            : 'Кнопка «Изменить» в таблице заполняет эту форму — перенабирать поля не нужно.'}
        </span>
      </div>
      <Feedback state={state} />
    </form>
  )
}

/**
 * Участники админки целиком: таблица с кнопкой «Изменить» и форма под ней
 * (issue #85). В состоянии лежит email правимого участника, а не сам объект:
 * после сохранения серверное дерево перерисовывается, и по email из свежих
 * `participants` всегда достаётся актуальная запись; удалили участника из
 * JSON — режим правки просто гаснет, а не показывает призрака.
 *
 * Рядом с email — счётчик нажатий `pick`. Он существует ровно ради повторного
 * клика по УЖЕ правимому участнику: без него `setState` получал бы то же
 * значение, React отсекал бы ре-рендер, `key` не менялся бы и форма не
 * перемонтировалась — то есть «Изменить» не откатывало бы набранное к
 * сохранённому, хотя пользователь ждёт именно этого (ревью PR #86).
 *
 * `key` на форме перемонтирует её при смене выбора — это и есть механизм
 * подстановки `defaultValue` без контролируемых полей.
 */
export function ParticipantsAdmin({ participants }: { participants: Participant[] }) {
  const [selection, setSelection] = React.useState<{ email: string; pick: number } | null>(null)
  const editing = participants.find((participant) => participant.email === selection?.email) ?? null

  return (
    <>
      <ParticipantsTable
        participants={participants}
        onEdit={(participant) =>
          setSelection((previous) => ({
            email: participant.email,
            pick: (previous?.pick ?? 0) + 1,
          }))
        }
      />
      <p className="hours-note">
        Ставка вычисляется из вилки и грейда (середина трети вилки: I — ⅙, II — ½, III — ⅚) и не
        вводится руками. Участник без вилки и грейда считает только часы — без денег.
      </p>
      <ParticipantForm
        key={editing && selection ? `${selection.email}#${selection.pick}` : '__new__'}
        participants={participants}
        editing={editing}
        onCancel={() => setSelection(null)}
      />
    </>
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

/**
 * Открыть / закрыть / править / удалить период (пп. 16, 24).
 *
 * Правка label и дат доступна ВСЕГДА (issue #85) — в том числе по периоду с
 * оценками: опечатка в дате иначе оставалась неисправимой из UI. Что смена дат
 * пересчитает производные поля оценок, сказано до нажатия, а не после.
 * Удаление периода с оценками закрыто по-прежнему: у него обратного хода нет.
 */
export function PeriodRowActions({
  period,
  hasAssessments,
}: {
  period: Period
  /** По периоду уже есть оценки: удаление закрыто, правка — предупреждает. */
  hasAssessments: boolean
}) {
  const [statusState, statusAction, statusPending] = useActionState(
    setPeriodStatusAction,
    IDLE_STATE,
  )
  const [editState, editAction, editPending] = useActionState(updatePeriodAction, IDLE_STATE)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePeriodAction, IDLE_STATE)
  // id периода уникален в документе — годится и как якорь aria-describedby.
  const noticeId = `hours-period-notice-${period.id}`

  return (
    <div>
      <div className="hours-actions">
        <form action={statusAction} className="hours-inline-form">
          <input type="hidden" name="periodId" value={period.id} />
          <input type="hidden" name="status" value={period.status === 'open' ? 'closed' : 'open'} />
          <button type="submit" className="hours-btn hours-btn--ghost" disabled={statusPending}>
            {period.status === 'open' ? 'Закрыть' : 'Открыть'}
          </button>
        </form>
        {hasAssessments ? null : (
          <form action={deleteAction} className="hours-inline-form">
            <input type="hidden" name="periodId" value={period.id} />
            <button type="submit" className="hours-btn hours-btn--ghost" disabled={deletePending}>
              Удалить
            </button>
          </form>
        )}
      </div>

      <form className="hours-form" action={editAction}>
        <input type="hidden" name="periodId" value={period.id} />
        <div className="hours-fields">
          <label className="hours-field">
            <span>Название</span>
            <input type="text" name="label" defaultValue={period.label} required />
          </label>
          <label className="hours-field">
            <span>Начало</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={period.date_from}
              required
              aria-describedby={hasAssessments ? noticeId : undefined}
            />
          </label>
          <label className="hours-field">
            <span>Конец</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={period.date_to}
              required
              aria-describedby={hasAssessments ? noticeId : undefined}
            />
          </label>
        </div>
        {/* Предостережение стоит ДО кнопки: под ней его читают уже постфактум.
            aria-describedby с полей дат — чтобы оно доехало и до скринридера,
            а не только до глаз. Формулировка разводит две ставки: месячная —
            снэпшот и не меняется, часовая выводится из календаря (п.15/п.2);
            «ставку пересчитаем и сохраним» в одной фразе читалось наоборот. */}
        {hasAssessments ? (
          <p className="hours-note" id={noticeId}>
            По периоду уже есть оценки. Месячная ставка на момент декларации у каждой сохранится, а
            часовая ставка, начисление, сплит и число будней сразу пересчитаются по новым датам.
            Удалить период с оценками из админки нельзя: удаляет владелец в JSON.
          </p>
        ) : null}
        <div className="hours-actions">
          <button type="submit" className="hours-btn hours-btn--ghost" disabled={editPending}>
            Сохранить правку
          </button>
        </div>
        <Feedback state={editState} />
      </form>

      <Feedback state={statusState} />
      <Feedback state={deleteState} />
    </div>
  )
}
