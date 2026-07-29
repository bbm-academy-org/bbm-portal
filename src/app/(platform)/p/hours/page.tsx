import React from 'react'

import { auth } from '@/auth'
import {
  describePeriod,
  effectiveHourlyRate,
  findAssessment,
  findOpenPeriod,
  findParticipant,
  HoursDataError,
  isHoursAdmin,
  maxDeclarableHours,
  pickSummaryPeriod,
  readHoursDocument,
  sessionEmail,
} from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import { Calculator } from '@/modules/hours/view/Calculator'
import {
  DataUnavailable,
  NoPeriodsNotice,
  NotAParticipantNotice,
  ParticipantsTable,
  PeriodHeader,
  SavedCard,
  SignedInAs,
  SummaryTable,
} from '@/modules/hours/view/components'
import { HoursLayout } from '@/modules/hours/view/HoursLayout'
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
  const admin = isHoursAdmin(email, process.env.HOURS_ADMIN_EMAILS)

  let doc: HoursDocument
  try {
    doc = await readHoursDocument()
  } catch (cause) {
    if (!(cause instanceof HoursDataError)) throw cause
    return (
      <HoursLayout>
        <Header email={email} admin={admin} />
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

  const existing =
    openPeriod && email ? (findAssessment(doc, openPeriod.id, email) ?? null) : null
  const calendar = openPeriod ? describePeriod(openPeriod.date_from, openPeriod.date_to) : null

  let disabledReason = ''
  if (!email) disabledReason = 'В сессии нет email — сохранить оценку нельзя.'
  else if (!participant) disabledReason = 'Тебя нет в списке участников — сохранить оценку нельзя.'

  return (
    <HoursLayout>
      <Header email={email} admin={admin} />

      <section className="hours-band">
        <div className="hours-wrap">
          <h2>Участники</h2>
          <ParticipantsTable participants={doc.participants} />
          {email && !participant ? <NotAParticipantNotice /> : null}
        </div>
      </section>

      <section className="hours-band hours-band--alt">
        <div className="hours-wrap">
          <h2>Самооценка за период</h2>
          {openPeriod && calendar ? (
            <>
              <PeriodHeader period={openPeriod} calendar={calendar} />
              <Calculator
                period={openPeriod}
                calendar={calendar}
                monthlyRate={participant?.monthly_rate ?? null}
                effectiveHourly={effectiveHourlyRate(participant?.monthly_rate ?? null, calendar)}
                email={email}
                existing={existing}
                maxHours={maxDeclarableHours(calendar)}
                disabledReason={disabledReason}
              />
              {existing ? (
                <>
                  <p className="hours-note">Последняя сохранённая оценка за этот период:</p>
                  <SavedCard assessment={existing} periodLabel={openPeriod.label} />
                </>
              ) : null}
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
          <ul className="hours-tl">
            <li>
              <span className="hours-tl__when">1-е число</span>
              <p>Самооценка часов за период + сплит «деньгами / доинвестиция».</p>
            </li>
            <li>
              <span className="hours-tl__when">2-е число</span>
              <p>Открытая peer-верификация: часы видны всем, любой может оспорить.</p>
            </li>
            <li>
              <span className="hours-tl__when">3-е число</span>
              <p>Выплата денежной части, инвестиционная — в долю 4X по номиналу.</p>
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

function Header({ email, admin }: { email: string; admin: boolean }) {
  return (
    <header className="hours-hero">
      <div className="hours-wrap">
        <div className="hours-eyebrow">BBM · механика выплат · раз в период</div>
        <h1 className="hours-display">Сколько ты отработал?</h1>
        <p className="hours-lead">
          Оцени фактические часы любым удобным способом — тайм-трекера нет и не будет.
          Оплачиваются фактические часы: отработал 10 — получил за 10, отработал 200 — за 200.
        </p>
        <SignedInAs email={email} />
        {admin ? (
          <p className="hours-session">
            <a href="/p/hours/admin">Админка часов →</a>
          </p>
        ) : null}
      </div>
    </header>
  )
}
