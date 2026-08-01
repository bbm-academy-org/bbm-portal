import React from 'react'

import { formatInt, formatIsoDate, formatRub } from '@/lib/hours/format'
import { describePeriod, effectiveHourlyRate, participantMonthlyRate } from '@/lib/hours/formula'
import type { Participant, Period } from '@/lib/hours/types'

/**
 * Список участников: имя, роль, вилка, грейд, ВЫЧИСЛЕННАЯ ставка (спека 081
 * п.19). Ставка не хранится — это `participantMonthlyRate` (решение владельца
 * 2026-07-30); незаполненные поля показываются прочерком: участник может быть
 * заведён только с именем и email.
 *
 * Живёт ОТДЕЛЬНЫМ файлом, а не в `components.tsx`, по той же причине, что и
 * `SavedCard.tsx`: таблицу тянет и серверная страница `/p/hours`, и клиентская
 * обвязка админки (`ParticipantsAdmin`, issue #85), а бандлер тянет модуль
 * целиком — импорт из `components.tsx` увёз бы в браузер всю страницу. Факт
 * проверяется тестом клиентского замыкания, а не соглашением.
 *
 * Сам файл серверно-нейтрален (ни состояния, ни эффектов) — на `/p/hours` он
 * рендерится как серверный компонент, в админке становится частью клиентского
 * дерева. `onEdit` появляется только там, где правка вообще разрешена: без
 * обработчика колонки действий нет, и `/p/hours` правку не предлагает.
 */
export function ParticipantsTable({
  participants,
  summaryPeriod,
  onEdit,
}: {
  participants: Participant[]
  /** Тот же период, который выбран в сводке оценок (spec 102). */
  summaryPeriod: Period | null | undefined
  /** Клик по «Изменить» отдаёт участника форме админки (issue #85). */
  onEdit?: (participant: Participant) => void
}) {
  const calendar = summaryPeriod
    ? describePeriod(summaryPeriod.date_from, summaryPeriod.date_to)
    : null
  const caption = summaryPeriod ? (
    <p className="hours-rate-period">
      Часовая ставка рассчитана для «{summaryPeriod.label}» (
      {formatIsoDate(summaryPeriod.date_from)}—{formatIsoDate(summaryPeriod.date_to)})
    </p>
  ) : (
    <p className="hours-rate-period">Нет периода для расчёта часовой ставки.</p>
  )

  if (participants.length === 0) {
    return (
      <>
        {caption}
        <p className="hours-notice">Ни одного участника ещё не завели.</p>
      </>
    )
  }
  return (
    <>
      {caption}
      <div className="hours-table-scroll">
        <table className="hours-table hours-participants-table" data-editable={Boolean(onEdit)}>
          <colgroup>
            <col className="hours-col-participant" />
            <col className="hours-col-fork" />
            <col className="hours-col-monthly" />
            <col className="hours-col-hourly" />
            {onEdit ? <col className="hours-col-edit" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Участник</th>
              <th scope="col">Вилка и грейд</th>
              <th scope="col" className="hours-num">
                Ставка, ₽/мес
              </th>
              <th scope="col" className="hours-num">
                Ставка, ₽/ч
              </th>
              {onEdit ? <th scope="col">Правка</th> : null}
            </tr>
          </thead>
          <tbody>
            {participants.map((participant) => {
              const monthlyRate = participantMonthlyRate(participant)
              const hourlyRate = calendar ? effectiveHourlyRate(monthlyRate, calendar) : null
              return (
                <tr key={participant.email}>
                  <td>
                    <span className="hours-cell-main hours-participant-name">
                      {participant.name}
                    </span>
                    <span className="hours-cell-secondary hours-participant-role">
                      {participant.role?.trim() || '—'}
                    </span>
                  </td>
                  <td>
                    <span className="hours-cell-main hours-fork">
                      {participant.fork_min == null && participant.fork_max == null
                        ? '—'
                        : `${formatInt(participant.fork_min)} — ${formatInt(participant.fork_max)}`}
                    </span>
                    <span className="hours-cell-secondary hours-grade">
                      {participant.grade ?? '—'}
                    </span>
                  </td>
                  <td className="hours-num">{formatRub(monthlyRate)}</td>
                  <td className="hours-num">{formatRub(hourlyRate)}</td>
                  {onEdit ? (
                    <td className="hours-edit-cell">
                      {/* type="button": кнопка ничего не отправляет, она только
                          заполняет форму ниже — сохранение остаётся за формой.
                          aria-label: три кнопки «Изменить» подряд для скринридера
                          неразличимы, имя строки обязано попасть в доступное имя. */}
                      <button
                        type="button"
                        className="hours-btn hours-btn--ghost"
                        aria-label={`Изменить ${participant.name}`}
                        onClick={() => onEdit(participant)}
                      >
                        Изменить
                      </button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
