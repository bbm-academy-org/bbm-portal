import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import UiKitShowcasePage from '@/app/(platform)/p/ui-kit/page'
import { TOKEN_NAMES } from '@/ui'

/**
 * The component showcase (#312) — the second half of the trigger consolidation
 * spec §11 parks behind the start of `src/ui`.
 *
 * A showcase's whole value is that it is COMPLETE: one that quietly stops
 * covering the component added last is worse than none, because it is read as
 * evidence. So completeness is asserted rather than maintained by habit — every
 * token in the registry and every component the kit exports has to appear.
 */

const html = renderToStaticMarkup(React.createElement(UiKitShowcasePage))

describe('the showcase covers the whole kit', () => {
  it('shows every token the registry declares', () => {
    const missing = TOKEN_NAMES.filter((token) => !html.includes(token))
    expect(missing).toEqual([])
  })

  it('shows every component the kit exports', () => {
    // Keyed on the rendered class name rather than on the export list: the
    // class is what a component actually PUTS on the page, so a section that
    // silently rendered nothing would fail here.
    const classes = [
      'bbm-top-bar',
      'bbm-app-tile',
      'bbm-tile-grid',
      'bbm-page-header',
      'bbm-button',
      'bbm-tag',
      'bbm-eyebrow',
      'bbm-container',
    ]
    expect(classes.filter((c) => !html.includes(c))).toEqual([])
  })

  it('shows all four tile forms, not only the happy one', () => {
    for (const variant of ['internal', 'external', 'admin', 'planned']) {
      expect(html).toContain(`bbm-app-tile--${variant}`)
    }
  })

  it('shows the disabled state a wireframe never draws', () => {
    expect(html).toContain('disabled')
  })

  it('names the states a static page cannot show, instead of implying there are none', () => {
    expect(html).toContain('bbm-showcase__states')
    expect(html).toContain('фокус-видимый')
  })
})
