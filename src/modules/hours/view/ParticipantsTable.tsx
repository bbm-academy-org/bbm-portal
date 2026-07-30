import React from 'react'

import { formatInt, formatRub } from '@/lib/hours/format'
import { participantMonthlyRate } from '@/lib/hours/formula'
import type { Participant } from '@/lib/hours/types'

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
  onEdit,
}: {
  participants: Participant[]
  /** Клик по «Изменить» отдаёт участника форме админки (issue #85). */
  onEdit?: (participant: Participant) => void
}) {
  if (participants.length === 0) {
    return <p className="hours-notice">Ни одного участника ещё не завели.</p>
  }
  return (
    <div className="hours-table-scroll">
      <table className="hours-table">
        <thead>
          <tr>
            <th scope="col">Имя</th>
            <th scope="col">Роль</th>
            <th scope="col">Вилка, ₽/мес</th>
            <th scope="col">Грейд</th>
            <th scope="col">Ставка, ₽/мес</th>
            {onEdit ? <th scope="col">Правка</th> : null}
          </tr>
        </thead>
        <tbody>
          {participants.map((participant) => (
            <tr key={participant.email}>
              <td>{participant.name}</td>
              <td>{participant.role ?? '—'}</td>
              <td className="hours-num">
                {participant.fork_min == null && participant.fork_max == null
                  ? '—'
                  : `${formatInt(participant.fork_min)} — ${formatInt(participant.fork_max)}`}
              </td>
              <td>{participant.grade ?? '—'}</td>
              <td className="hours-num">{formatRub(participantMonthlyRate(participant))}</td>
              {onEdit ? (
                <td>
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
