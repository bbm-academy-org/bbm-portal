import React from 'react'

import { auth } from '@/auth'
import {
  describePeriod,
  effectiveHourlyRate,
  findAssessment,
  findOpenPeriod,
  findParticipant,
  HoursDataError,
  maxDeclarableHours,
  participantMonthlyRate,
  pickSummaryPeriod,
  readHoursDocument,
  sessionEmail,
} from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import { Calculator } from '@/modules/hours/view/Calculator'
import {
  DataUnavailable,
  FormulaBreakdown,
  NoPeriodsNotice,
  NotAParticipantNotice,
  PeriodHeader,
  SignedInAs,
  SummaryTable,
} from '@/modules/hours/view/components'
import { HoursLayout } from '@/modules/hours/view/HoursLayout'
import { ParticipantsTable } from '@/modules/hours/view/ParticipantsTable'
import { PeriodSelect } from '@/modules/hours/view/PeriodSelect'

/**
 * `/p/hours` — калькулятор самооценки часов (спека 081 пп. 19–22).
 *
 * Монтаж тонкий, как у `/p/okr`: аутентификация уже сделана OIDC-гейтом группы
 * `(platform)` (Zitadel, id.bbm.academy), host-allowlist держит поверхность вне
 * CMS-хоста. Здесь решается только, ЧТО показать этому email'у.
 *
 * Страница видна каждому залогиненному целиком — это сознательное решение
 * владельца: часы, ставки и начисления открыты всей команде (механика открытой
 * верификации 2-го числа).
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Часы · BBM',
}

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  const email = sessionEmail(session)

  let doc: HoursDocument
  try {
    doc = await readHoursDocument()
  } catch (cause) {
    if (!(cause instanceof HoursDataError)) throw cause
    return (
      <HoursLayout>
        {/* Документ нечитаем — участника не найти, под заголовком email. */}
        <Header email={email} person={email} />
        <section className="hours-band">
          <div className="hours-wrap">
            <DataUnavailable />
          </div>
        </section>
      </HoursLayout>
    )
  }

  const params = await searchParams
  const requestedPeriod = typeof params.period === 'string' ? params.period : undefined

  const participant = findParticipant(doc, email) ?? null
  const openPeriod = findOpenPeriod(doc)
  const summaryPeriod = pickSummaryPeriod(doc, requestedPeriod)

  const summaryRows = summaryPeriod
    ? doc.assessments
        .filter((assessment) => assessment.period_id === summaryPeriod.id)
        .map((assessment) => ({
          name: findParticipant(doc, assessment.email)?.name ?? null,
          assessment,
        }))
    : []

  const existing = openPeriod && email ? (findAssessment(doc, openPeriod.id, email) ?? null) : null
  const calendar = openPeriod ? describePeriod(openPeriod.date_from, openPeriod.date_to) : null

  // Ставка вычисляется из вилки и грейда (решение владельца 2026-07-30);
  // участник без вилки — режим «только часы», но сохранять оценку он МОЖЕТ.
  const monthlyRate = participantMonthlyRate(participant)

  let disabledReason = ''
  if (!email) disabledReason = 'В сессии нет email — сохранить оценку нельзя.'
  else if (!participant) disabledReason = 'Тебя нет в списке участников — сохранить оценку нельзя.'

  return (
    <HoursLayout>
      {/* Имя под заголовком берёт на себя приёмочную роль «Вошёл как»
          (проверка email-claim, спека п.8): нет в participants — email. */}
      <Header email={email} person={participant?.name ?? email} />

      <section className="hours-band">
        <div className="hours-wrap">
          <h2>Участники</h2>
          <ParticipantsTable participants={doc.participants} summaryPeriod={summaryPeriod} />
          {email && !participant ? <NotAParticipantNotice /> : null}
        </div>
      </section>

      <section className="hours-band hours-band--alt">
        <div className="hours-wrap">
          <h2>Самооценка за период</h2>
          {openPeriod && calendar ? (
            <>
              <PeriodHeader period={openPeriod} calendar={calendar} />
              {/* Формула показывается честно и ДО калькулятора (п.20): для
                  многомесячного периода — с помесячной разбивкой, потому что
                  ставка часа считается по полному календарному месяцу (п.2).
                  Участник должен видеть, откуда взялась его часовая, а не
                  только результат. */}
              <FormulaBreakdown calendar={calendar} monthlyRate={monthlyRate} />
              <Calculator
                period={openPeriod}
                calendar={calendar}
                monthlyRate={monthlyRate}
                effectiveHourly={effectiveHourlyRate(monthlyRate, calendar)}
                email={email}
                existing={existing}
                maxHours={maxDeclarableHours(calendar)}
                disabledReason={disabledReason}
              />
            </>
          ) : doc.periods.length === 0 ? (
            <NoPeriodsNotice />
          ) : (
            <p className="hours-notice">
              Открытого периода сейчас нет — самооценка откроется, когда администратор откроет
              следующий период.
            </p>
          )}
        </div>
      </section>

      <section className="hours-band">
        <div className="hours-wrap">
          <h2>Сводка оценок</h2>
          {summaryPeriod ? (
            <>
              <PeriodSelect
                periods={doc.periods}
                selectedId={summaryPeriod.id}
                basePath="/p/hours"
              />
              <PeriodHeader
                period={summaryPeriod}
                calendar={describePeriod(summaryPeriod.date_from, summaryPeriod.date_to)}
              />
              <SummaryTable rows={summaryRows} />
            </>
          ) : (
            <NoPeriodsNotice />
          )}
        </div>
      </section>

      <section className="hours-band hours-band--alt">
        <div className="hours-wrap">
          <p className="hours-lead">
            <b>Часы видны всей команде.</b> На верификации 2-го числа любой может оспорить оценку —
            тогда обсуждаем. Заниженная оценка — тоже искажение, а не скромность: декларируй
            столько, сколько отработал.
          </p>
          {/* Лексика сплита (issue #83 п.9): ведущая формулировка — «оставляю
              в проекте, увеличивая свою долю»; 4X по номиналу — вторичное
              упоминание механизма учёта. */}
          <ul className="hours-tl">
            <li>
              <span className="hours-tl__when">1-е число</span>
              <p>Самооценка часов за период + сплит «деньгами / оставить в проекте».</p>
            </li>
            <li>
              <span className="hours-tl__when">2-е число</span>
              <p>Открытая peer-верификация: часы видны всем, любой может оспорить.</p>
            </li>
            <li>
              <span className="hours-tl__when">3-е число</span>
              <p>
                Выплата денежной части; оставленное в проекте увеличивает твою долю (учитывается в
                4X по номиналу).
              </p>
            </li>
          </ul>
        </div>
      </section>

      <footer className="hours-footer">
        <div className="hours-wrap">BBM · калькулятор самооценки часов · внутренний инструмент</div>
      </footer>
    </HoursLayout>
  )
}

/**
 * Хиро без лид-абзаца, «Вошёл как» и ссылки на админку (решение владельца
 * 2026-07-30, issue #83 пп.2–3): только заголовок и крупно — имя авторизованного
 * участника (нет в participants — email). Именно оно теперь подтверждает
 * email-claim на приёмке; админы ходят в админку по прямому URL. Сессия без
 * email — прежняя предупреждающая строка: сохранить оценку не выйдет.
 */
function Header({ email, person }: { email: string; person: string }) {
  return (
    <header className="hours-hero">
      <div className="hours-wrap">
        <div className="hours-eyebrow">BBM · механика выплат · раз в период</div>
        <h1 className="hours-display">Сколько было отработано</h1>
        {email ? <p className="hours-person">{person}</p> : <SignedInAs email="" />}
      </div>
    </header>
  )
}
