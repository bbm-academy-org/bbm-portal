import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { PathMapSourceNotice } from '@/modules/path-map/view/PathMapSourceNotice'

/**
 * The two small notices of `/p/path` (#533): nobody may mistake the public
 * design example for the team's live map, and a copy served while GitHub is
 * down says its data may be out of date. A fresh live map shows nothing.
 */

const el = React.createElement
afterEach(cleanup)

describe('PathMapSourceNotice', () => {
  it('says the local example is not the live map', () => {
    render(el(PathMapSourceNotice, { origin: 'local', stale: false, asOf: '2026-11-03T10:00:00Z' }))
    expect(screen.getByRole('status').textContent).toMatch(/пример/i)
    expect(screen.getByRole('status').textContent).toMatch(/не рабочая карта/)
  })

  it('says a stale copy may be out of date, with the time it was read', () => {
    render(el(PathMapSourceNotice, { origin: 'github', stale: true, asOf: '2026-11-03T10:05:00Z' }))
    const text = screen.getByRole('status').textContent ?? ''
    expect(text).toMatch(/данные могли устареть/i)
    // Moscow time — the team's clock.
    expect(text).toContain('13:05')
  })

  it('renders nothing for a fresh live map', () => {
    const { container } = render(
      el(PathMapSourceNotice, { origin: 'github', stale: false, asOf: '2026-11-03T10:00:00Z' }),
    )
    expect(container.innerHTML).toBe('')
  })
})
