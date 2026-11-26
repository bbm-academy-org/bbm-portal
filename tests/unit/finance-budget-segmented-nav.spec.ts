// Specifies the budget page's segmented switch:
// src/app/(platform)/p/finance/reports/budget/SegmentedNav.tsx
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SegmentedNav } from '@/app/(platform)/p/finance/reports/budget/SegmentedNav'

function render(disabledReason: string | null) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(
    createElement(SegmentedNav, {
      label: 'Валюта итога',
      segments: [
        { key: 'RUB', label: '₽', href: '/p/finance/reports/budget', current: true },
        {
          key: 'USD',
          label: '$',
          href: '/p/finance/reports/budget?currency=USD',
          current: false,
          disabledReason,
        },
      ],
    }),
  )
  return host
}

describe('SegmentedNav — EARS-721 / EARS-729 item 4: a currency with no rate is shown disabled with its reason', () => {
  it('announces the inert segment as a disabled link, focusable, with the reason as its description', () => {
    const host = render('нет курса ЦБ для USD')
    const inert = host.querySelector('[aria-disabled="true"]')
    expect(inert).not.toBeNull()
    expect(inert!.getAttribute('role')).toBe('link')
    expect(inert!.getAttribute('tabindex')).toBe('0')
    expect(inert!.hasAttribute('href')).toBe(false)
    const describedBy = inert!.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const description = host.querySelector(`[id="${describedBy}"]`)
    expect(description?.textContent).toBe('нет курса ЦБ для USD')
    expect(inert!.textContent).toBe('$')
  })

  it('renders an available segment as a plain link, with no disabled or description attributes', () => {
    const host = render(null)
    const links = host.querySelectorAll('a')
    expect(links).toHaveLength(2)
    const usd = links[1]
    expect(usd.getAttribute('href')).toBe('/p/finance/reports/budget?currency=USD')
    expect(usd.hasAttribute('aria-disabled')).toBe(false)
    expect(usd.hasAttribute('aria-describedby')).toBe(false)
    expect(links[0].getAttribute('aria-current')).toBe('page')
  })
})
