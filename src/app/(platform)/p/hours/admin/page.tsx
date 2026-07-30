import React from 'react'

import { auth } from '@/auth'
import {
  describePeriod,
  formatIsoDate,
  HoursDataError,
  isHoursAdmin,
  pickSummaryPeriod,
  readHoursDocument,
  sessionEmail,
} from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import {
  DataUnavailable,
  NoPeriodsNotice,
  PeriodHeader,
  SignedInAs,
  SummaryTable,
} from '@/modules/hours/view/components'
import { HoursLayout } from '@/modules/hours/view/HoursLayout'
import { ParticipantsAdmin, PeriodForm, PeriodRowActions } from '@/modules/hours/view/AdminForms'
import { PeriodSelect } from '@/modules/hours/view/PeriodSelect'

/**
 * `/p/hours/admin` — админка модуля часов (спека 081 пп. 23–25).
 *
 * Доступ по allowlist'у `HOURS_ADMIN_EMAILS` (fail-closed: нет переменной — нет
 * админов). Тот же предикат применяется в КАЖДОЙ мутации и в выгрузке JSON, так
 * что «не показали страницу» — это удобство, а не защита (п.10).
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Часы · админка · BBM',
}

export default async function HoursAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  const email = sessionEmail(session)

  if (!isHoursAdmin(email, process.env.HOURS_ADMIN_EMAILS)) {
    return (
      <HoursLayout>
        <section className="hours-band">
          <div className="hours-wrap">
            <h1 className="hours-display">Админка часов</h1>
            <p className="hours-notice hours-notice--error">
              Доступ к админке часов есть только у администраторов.
            </p>
            <SignedInAs email={email} />
            <p className="hours-note">
              <a href="/p/hours">← к калькулятору</a>
            </p>
          </div>
        </section>
      </HoursLayout>
    )
  }

  let doc: HoursDocument
  try {
    doc = await readHoursDocument()
  } catch (cause) {
    if (!(cause instanceof HoursDataError)) throw cause
    return (
      <HoursLayout>
        <section className="hours-band">
          <div className="hours-wrap">
            <h1 className="hours-display">Админка часов</h1>
            <DataUnavailable />
          </div>
        </section>
      </HoursLayout>
    )
  }

  const params = await searchParams
  const requestedPeriod = typeof params.period === 'string' ? params.period : undefined
  const summaryPeriod = pickSummaryPeriod(doc, requestedPeriod)
  const summaryRows = summaryPeriod
    ? doc.assessments
        .filter((assessment) => assessment.period_id === summaryPeriod.id)
        .map((assessment) => ({
          name: doc.participants.find((p) => p.email === assessment.email)?.name ?? null,
          assessment,
        }))
    : []

  return (
    <HoursLayout>
      <header className="hours-hero">
        <div className="hours-wrap hours-wrap--wide">
          <div className="hours-eyebrow">BBM · часы · администрирование</div>
          <h1 className="hours-display">Админка часов</h1>
          <SignedInAs email={email} />
          <p className="hours-note">
            <a href="/p/hours">← к калькулятору</a>
          </p>
        </div>
      </header>

      <section className="hours-band">
        <div className="hours-wrap hours-wrap--wide">
          <h2>Участники</h2>
          {/* Таблица и форма связаны одним клиентским стейтом (issue #85):
              «Изменить» в строке заполняет форму, перенабора полей нет. */}
          <ParticipantsAdmin participants={doc.participants} />
        </div>
      </section>

      <section className="hours-band hours-band--alt">
        <div className="hours-wrap hours-wrap--wide">
          <h2>Периоды</h2>
          <PeriodForm />
          {doc.periods.length === 0 ? (
            <NoPeriodsNotice />
          ) : (
            <ul className="hours-months">
              {doc.periods.map((period) => {
                const calendar = describePeriod(period.date_from, period.date_to)
                const hasAssessments = doc.assessments.some((a) => a.period_id === period.id)
                return (
                  <li key={period.id}>
                    <PeriodHeader period={period} calendar={calendar} />
                    <p className="hours-note">
                      {formatIsoDate(period.date_from)}—{formatIsoDate(period.date_to)} ·{' '}
                      {hasAssessments ? 'оценки есть' : 'оценок нет'}
                    </p>
                    <PeriodRowActions period={period} hasAssessments={hasAssessments} />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="hours-band">
        <div className="hours-wrap hours-wrap--wide">
          <h2>Сводка оценок</h2>
          {summaryPeriod ? (
            <>
              <PeriodSelect
                periods={doc.periods}
                selectedId={summaryPeriod.id}
                basePath="/p/hours/admin"
              />
              <SummaryTable rows={summaryRows} />
            </>
          ) : (
            <NoPeriodsNotice />
          )}
          <p className="hours-actions">
            <a className="hours-btn" href="/p/hours/admin/export" download>
              Скачать данные (JSON)
            </a>
          </p>
          <p className="hours-note">
            В выгрузке есть всё для рассылки: имя, период, часы, способ, ставки, начисление, сплит в
            ₽ и %, время сохранения.
          </p>
        </div>
      </section>
    </HoursLayout>
  )
}
