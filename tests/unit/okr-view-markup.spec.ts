import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { KrRow, ObjectiveCard } from '@/modules/okr/view/components'
import type { OkrAction, OkrKr, OkrObjective } from '@/lib/okr'

/**
 * Markup contract of the OKR dashboard rows (spec 075, issue #75). The page
 * ships zero client JS, so every interaction rule below is a *markup* rule:
 * a row expands because it is <details>/<summary>, and it must not navigate
 * because its title is plain text — never an <a>. Plane is reachable only via
 * an explicit icon link.
 */

const REPO_ROOT = join(__dirname, '..', '..')

function action(over: Partial<OkrAction> = {}): OkrAction {
  return {
    id: 'a1',
    title: 'Действие один',
    stateGroup: 'started',
    done: 1,
    total: 3,
    planeUrl: 'https://plane.bbm.academy/bbm/projects/p1/issues/a1',
    tasks: [],
    ...over,
  }
}

function kr(over: Partial<OkrKr> = {}): OkrKr {
  return {
    krId: 'kr-1',
    moduleId: 'm1',
    title: 'KR: довести охват до 10 000',
    q4: false,
    counts: { done: 1, total: 3 },
    metric: null,
    pct: 33,
    pctSource: 'execution',
    health: 'on',
    note: null,
    leadId: '6cd7f33c-fb90-4f46-b668-bf385804ac7f',
    planeUrl: 'https://plane.bbm.academy/bbm/projects/p1/issues/kr-1',
    actions: [action()],
    ...over,
  }
}

function objective(over: Partial<OkrObjective> = {}): OkrObjective {
  return {
    id: 'o1',
    ident: 'DSG1',
    projectId: 'p1',
    title: 'Objective: собрать аудиторию',
    mission: 'social',
    order: 1,
    q4: false,
    krs: [kr()],
    pct: 33,
    health: 'on',
    note: null,
    planeUrl: 'https://plane.bbm.academy/bbm/projects/p1/issues/o1',
    ...over,
  }
}

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(element)
  return host
}

/** Text owned by the element itself, i.e. not nested inside a link. */
function textOutsideLinks(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('a').forEach((a) => a.remove())
  return clone.textContent?.trim() ?? ''
}

function expectPlaneIconLink(scope: Element, href: string, titleText: string): HTMLAnchorElement {
  const link = scope.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)
  expect(link, `expected an explicit Plane link to ${href}`).not.toBeNull()
  expect(link!.getAttribute('target')).toBe('_blank')
  expect(link!.getAttribute('rel')).toContain('noopener')
  expect(link!.getAttribute('rel')).toContain('noreferrer')
  const label = link!.getAttribute('aria-label') ?? ''
  expect(label, 'the icon link needs an accessible name').not.toBe('')
  // The accessible name of the container (<summary>/<h2>) is computed from its
  // contents and swallows this label, so repeating the row title here makes a
  // screen reader announce the title twice. The icon names only its own action.
  expect(label).toBe('Открыть в Plane')
  expect(label, 'the row title must not be repeated in the icon name').not.toContain(titleText)
  // An icon, not a text link: no title text of its own to click through.
  expect(link!.textContent?.trim() ?? '').not.toContain(titleText)
  return link!
}

describe('KR row markup (spec 075 req.2)', () => {
  it('expands in place: <details>/<summary>, and the title is not a link', () => {
    const data = kr()
    const host = render(React.createElement(KrRow, { kr: data }))

    const details = host.querySelector('details.okr-kr')
    expect(details, 'a KR with actions must be a native <details>').not.toBeNull()
    const summary = details!.querySelector('summary.okr-kr__head')
    expect(summary).not.toBeNull()

    const title = summary!.querySelector('.okr-kr__t')!
    expect(textOutsideLinks(title)).toContain(data.title)
    title.querySelectorAll('a').forEach((a) => {
      expect(a.textContent?.trim() ?? '').not.toContain(data.title)
    })
  })

  it('offers Plane as an explicit icon link opening in a new tab', () => {
    const data = kr()
    const host = render(React.createElement(KrRow, { kr: data }))
    expectPlaneIconLink(host.querySelector('summary.okr-kr__head')!, data.planeUrl, data.title)
  })

  it('keeps the Plane link on an action-less KR row and hides its chevron', () => {
    const data = kr({ actions: [] })
    const host = render(React.createElement(KrRow, { kr: data }))

    expect(host.querySelector('details')).toBeNull()
    expect(host.querySelector('summary')).toBeNull()
    expectPlaneIconLink(host.querySelector('.okr-kr__head')!, data.planeUrl, data.title)

    const chev = host.querySelector<HTMLElement>('.okr-kr__chev')
    expect(chev, 'the chevron column stays for alignment, just invisible').not.toBeNull()
    expect(chev!.style.visibility).toBe('hidden')
  })

  it('nests the chevron inside the <summary> that the stylesheet rotates', () => {
    // Pairs with the `details[open]>summary .okr-kr__chev` contract below:
    // re-nesting the chevron elsewhere would silently kill the open indicator.
    const host = render(React.createElement(KrRow, { kr: kr() }))
    expect(host.querySelector('details.okr-kr > summary .okr-kr__chev')).not.toBeNull()
  })

  it('renders action rows with a plain-text title plus an icon link', () => {
    const act = action()
    const host = render(React.createElement(KrRow, { kr: kr({ actions: [act] }) }))

    const row = host.querySelector('.okr-act')!
    const title = row.querySelector('.okr-act__t')!
    expect(textOutsideLinks(title)).toContain(act.title)
    expectPlaneIconLink(row, act.planeUrl, act.title)
  })

  it('keeps the state badge of a childless action (FR-2)', () => {
    const done = action({ id: 'a2', title: 'Готовое действие', stateGroup: 'completed', done: 0, total: 0 })
    const open = action({ id: 'a3', title: 'Открытое действие', stateGroup: 'started', done: 0, total: 0 })
    const host = render(React.createElement(KrRow, { kr: kr({ actions: [done, open] }) }))

    const states = host.querySelectorAll('.okr-act__state')
    expect(states).toHaveLength(2)
    expect(states[0].className).toContain('okr-act__state--done')
    expect(states[1].className).toContain('okr-act__state--open')
    expect(host.querySelectorAll('.okr-act__bar')).toHaveLength(0)
  })
})

describe('objective card markup (spec 075 req.2)', () => {
  it('heading is plain text; Plane sits behind the icon link', () => {
    const data = objective()
    const host = render(React.createElement(ObjectiveCard, { objective: data }))

    const heading = host.querySelector('h2.okr-card__t')!
    expect(textOutsideLinks(heading)).toContain(data.title)
    expectPlaneIconLink(heading, data.planeUrl, data.title)
  })

  it('applies the same rule to a card without KRs', () => {
    const data = objective({ krs: [], pct: null, note: 'KR не заданы' })
    const host = render(React.createElement(ObjectiveCard, { objective: data }))

    const heading = host.querySelector('h2.okr-card__t')!
    expect(textOutsideLinks(heading)).toContain(data.title)
    expectPlaneIconLink(heading, data.planeUrl, data.title)
  })
})

describe('OKR stylesheet contract (spec 075 req.3, req.5)', () => {
  const css = readFileSync(join(REPO_ROOT, 'src', 'modules', 'okr', 'view', 'okr.css'), 'utf8')

  it('sizes the KR row as border-box so hover cannot reflow it', () => {
    // The hover trick widens the row by its own padding (`width:calc(100% + 16px)`);
    // under content-box that grows the *content* width and re-wraps the text.
    const row = /\.okr-kr__head\s*\{([^}]*)\}/.exec(css)
    expect(row, '.okr-kr__head rule missing').not.toBeNull()
    expect(row![1]).toContain('box-sizing:border-box')
  })

  it('keeps the design-system focus ring and selection colours (colors_and_type.css)', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--ink\)/)
    expect(css).toMatch(/::selection\s*\{[^}]*background:\s*var\(--accent\)/)
  })

  it('lets the focus ring follow the element it rings, not square it off', () => {
    // `.okr-root :focus-visible` (0,2,0) outranks `.okr-kr__head` (0,1,0), so a
    // blanket `border-radius:3px` there flattens the row's own 8px ring.
    const ring = /\.okr-root\s+:focus-visible\s*\{([^}]*)\}/.exec(css)
    expect(ring, '.okr-root :focus-visible rule missing').not.toBeNull()
    expect(ring![1], 'the shared ring must not impose a radius').not.toContain('border-radius')
    const row = /\.okr-kr__head\s*\{([^}]*)\}/.exec(css)
    expect(row![1]).toContain('border-radius:8px')
  })

  it('mutes the Plane icon at rest despite `.okr-root a{color:inherit}`', () => {
    // `.okr-ext` alone is 0,1,0 and loses to `.okr-root a` (0,1,1): the icon
    // would inherit the heading ink instead of the muted --ink-3.
    expect(css).toMatch(/\.okr-root\s+\.okr-ext\s*\{[^}]*color:\s*var\(--ink-3\)/)
    expect(css).toMatch(/\.okr-root\s+\.okr-ext:hover\s*\{[^}]*color:\s*var\(--accent-ink\)/)
  })

  it('lets the lane tracks shrink below their min-content width (scenario 6)', () => {
    // A bare `1fr` track has an automatic minimum of min-content, which the
    // nowrap health badges (widest: «цель 500 · измерение не подключено», 282px)
    // prop open — the page then scrolled sideways at 375px (scrollWidth 570)
    // and at 901..~1010px. `minmax(0,1fr)` removes that floor. The reference
    // prototype has the same defect; spec 075 scenario 6 outranks it.
    const lanes = /\.okr-lanes\s*\{([^}]*)\}/.exec(css)
    expect(lanes, '.okr-lanes rule missing').not.toBeNull()
    expect(lanes![1]).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)')

    const narrow = /@media\s*\(max-width:900px\)\s*\{\s*\.okr-lanes\s*\{([^}]*)\}/.exec(css)
    expect(narrow, 'the single-column media query for .okr-lanes is missing').not.toBeNull()
    expect(narrow![1]).toContain('grid-template-columns:minmax(0,1fr)')
  })

  it('pins the chevron rotation to an open KR row', () => {
    expect(css).toMatch(/details\[open\]\s*>\s*summary\s+\.okr-kr__chev\s*\{[^}]*transform:\s*rotate\(90deg\)/)
  })
})

describe('(platform) root layout reset (spec 075 req.1)', () => {
  const layoutDir = join(REPO_ROOT, 'src', 'app', '(platform)')
  const layout = readFileSync(join(layoutDir, 'layout.tsx'), 'utf8')

  it('imports a global stylesheet for the route group', () => {
    // This group owns <html>/<body> (no src/app/layout.tsx), so nothing else
    // can neutralise the UA `body { margin: 8px }` — it framed the dashboard
    // in white (#75).
    const importMatch = /import\s+'(\.\/[\w.-]+\.css)'/.exec(layout)
    expect(importMatch, 'the (platform) layout must import a global stylesheet').not.toBeNull()

    const global = readFileSync(join(layoutDir, importMatch![1]), 'utf8')
    expect(global).toMatch(/body\s*\{[^}]*margin:\s*0/)
    expect(global).toMatch(/body\s*\{[^}]*background:/)
  })
})
