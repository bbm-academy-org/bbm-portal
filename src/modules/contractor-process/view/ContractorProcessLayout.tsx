import Link from 'next/link'
import React from 'react'

import './contractor-process.css'

/**
 * The «Как работаем с исполнителями» surface root (#545): the `.cp-root`
 * element that carries the approved visual's own palette
 * (`./contractor-process.css`), with the visual's header — title and one-line
 * description — plus a way back to the finance overview the section is
 * opened from. The hint about clicking is shown only when there is a diagram
 * to click.
 */
export function ContractorProcessLayout({
  interactive,
  children,
}: {
  interactive: boolean
  children: React.ReactNode
}) {
  return (
    <div className="cp-root" data-contractor-process="">
      <header className="cp-header">
        <Link href="/p/finance" className="cp-back">
          ← Финансы
        </Link>
        <h1>Как работаем с исполнителями</h1>
        <span className="cp-sub">
          от решения привлечь до закрывающих · дорожки по ролям
          {interactive ? ' · нажмите на шаг или дорожку, чтобы увидеть детали и вопросы' : ''}
        </span>
      </header>
      {children}
    </div>
  )
}
