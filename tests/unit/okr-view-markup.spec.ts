import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { KrRow, ObjectiveCard } from '@/modules/okr/view/components'
import type { OkrAction, OkrKr, OkrObjective, OkrTask } from '@/lib/okr'

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

  it('groups the metric cluster into one wrappable unit (scenario 6)', () => {
    // Everything nowrap or fixed-width travels together, so the row can drop
    // the whole cluster onto a second line instead of being clipped by
    // `.okr-card{overflow:hidden}`. The title column must stay outside it.
    const host = render(React.createElement(KrRow, { kr: kr() }))
    const head = host.querySelector('summary.okr-kr__head')!
    expect(Array.from(head.children).map((c) => c.className)).toEqual([
      'okr-kr__main',
      'okr-kr__meta',
    ])

    const meta = head.querySelector('.okr-kr__meta')!
    for (const cls of ['.okr-av', '.okr-kr__n', '.okr-kr__v', '.okr-kr__bar']) {
      expect(meta.querySelector(cls), `${cls} belongs to the metric cluster`).not.toBeNull()
    }
    expect(meta.querySelector('.okr-kr__t'), 'the title must reflow independently').toBeNull()
  })

  it('keeps a note badge inside that same cluster', () => {
    const data = kr({ note: 'цель 500 · измерение не подключено', pct: null })
    const host = render(React.createElement(KrRow, { kr: data }))
    const meta = host.querySelector('.okr-kr__head > .okr-kr__meta')!
    expect(meta.querySelector('.okr-badge')).not.toBeNull()
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
    const done = action({
      id: 'a2',
      title: 'Готовое действие',
      stateGroup: 'completed',
      done: 1,
      total: 1,
      tasks: [],
    })
    const open = action({
      id: 'a3',
      title: 'Открытое действие',
      stateGroup: 'started',
      done: 0,
      total: 1,
      tasks: [],
    })
    const host = render(React.createElement(KrRow, { kr: kr({ actions: [done, open] }) }))

    const states = host.querySelectorAll('.okr-act__state')
    expect(states).toHaveLength(2)
    expect(states[0].className).toContain('okr-act__state--done')
    expect(states[1].className).toContain('okr-act__state--started')
    // spec 077 req.5: a childless row stays a chip — «0/1» says less than «в работе»
    expect(host.querySelectorAll('.okr-act__bar')).toHaveLength(0)
    expect(host.querySelectorAll('.okr-act__c')).toHaveLength(0)
  })
})

describe('action row state (spec 077, issue #77)', () => {
  const task = (over: Partial<OkrTask> = {}): OkrTask => ({
    id: 't1',
    title: 'Подзадача',
    stateGroup: 'completed',
    planeUrl: 'https://plane.bbm.academy/doctor-school/browse/DSG2-24/',
    ...over,
  })

  it('shows the parent state chip even when the action has sub-tasks (req.1)', () => {
    // The #77 case: a started parent whose only sub-task is closed used to render
    // as «1/1» with a full bar — its own state was nowhere on the screen.
    const congress = action({
      title: 'Организовать сайт конгресса ортобиологии, перелив трафика',
      stateGroup: 'started',
      done: 1,
      total: 2,
      tasks: [task()],
    })
    const host = render(React.createElement(KrRow, { kr: kr({ actions: [congress] }) }))

    const row = host.querySelector('.okr-act')!
    const chip = row.querySelector('.okr-act__state')
    expect(chip, 'an action with sub-tasks must still name its own state').not.toBeNull()
    expect(chip!.className).toContain('okr-act__state--started')
    expect(row.querySelector('.okr-act__c')!.textContent).toBe('1/2')
  })

  it('names all three Plane state groups, not just done/not-done (req.2)', () => {
    const rows = [
      action({ id: 'a-done', stateGroup: 'completed', done: 1, total: 1, tasks: [] }),
      action({ id: 'a-started', stateGroup: 'started', done: 0, total: 1, tasks: [] }),
      action({ id: 'a-todo', stateGroup: 'unstarted', done: 0, total: 1, tasks: [] }),
      action({ id: 'a-backlog', stateGroup: 'backlog', done: 0, total: 1, tasks: [] }),
    ]
    const host = render(React.createElement(KrRow, { kr: kr({ actions: rows }) }))
    const chips = Array.from(host.querySelectorAll('.okr-act__state'))

    expect(chips.map((c) => c.textContent)).toEqual([
      '✓ готово',
      '◐ в работе',
      '○ не начато',
      '○ не начато',
    ])
    expect(chips.map((c) => c.className.replace('okr-act__state ', ''))).toEqual([
      'okr-act__state--done',
      'okr-act__state--started',
      'okr-act__state--todo',
      'okr-act__state--todo',
    ])
  })

  it('fills the bar to exactly the number next to it (req.6)', () => {
    const half = action({ stateGroup: 'started', done: 1, total: 2, tasks: [task()] })
    const host = render(React.createElement(KrRow, { kr: kr({ actions: [half] }) }))

    const fill = host.querySelector<HTMLElement>('.okr-act__bar .okr-bar__fill')
    expect(fill, 'a row with sub-tasks carries a progress bar').not.toBeNull()
    expect(fill!.style.width).toBe('50%')
  })

  it('decides counter vs chip-only by sub-tasks, not by the counter itself (req.5)', () => {
    // `total` is never 0 any more (the action counts itself), so the old
    // `total > 0` switch would have put a bar on every single row.
    const childless = action({ stateGroup: 'started', done: 0, total: 1, tasks: [] })
    const host = render(React.createElement(KrRow, { kr: kr({ actions: [childless] }) }))

    expect(host.querySelector('.okr-act__c')).toBeNull()
    expect(host.querySelector('.okr-act__bar')).toBeNull()
    expect(host.querySelector('.okr-act__state')!.className).toContain('okr-act__state--started')
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
    expect(row![1]).toContain('box-sizing: border-box')
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
    expect(row![1]).toContain('border-radius: 8px')
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
    expect(lanes![1]).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')

    const narrow = /@media\s*\(max-width:\s*900px\)\s*\{\s*\.okr-lanes\s*\{([^}]*)\}/.exec(css)
    expect(narrow, 'the single-column media query for .okr-lanes is missing').not.toBeNull()
    expect(narrow![1]).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('reflows the KR row instead of letting the card clip it (scenario 6)', () => {
    // `minmax(0,1fr)` stopped the document scroll but moved the overflow inside
    // `.okr-card{overflow:hidden}`, where the metric cluster was silently cut
    // off (~195px at 375px, ~45px at 1024px). The single-line flex row had a
    // ~460px floor: nowrap counters/values/badges plus an 88px bar.
    const head = /\.okr-kr__head\s*\{([^}]*)\}/.exec(css)
    expect(head![1]).toContain('flex-wrap: wrap')
    // Inert while the row fits (the title column absorbs all free space), so
    // wide screens stay pixel-identical; it only right-aligns the second line.
    expect(head![1]).toContain('justify-content: flex-end')

    // The wrap trigger is the floor on `.okr-kr__main` (pinned in its own test
    // below, issue #79): with `min-width:0` the title column's hypothetical size
    // is 0, the cluster never wraps and the row overflows instead.
    const main = /\.okr-kr__main\s*\{([^}]*)\}/.exec(css)
    expect(main, '.okr-kr__main rule missing').not.toBeNull()
    expect(main![1]).not.toContain('min-width: 0')

    // The cluster itself must be able to shrink and wrap on that second line.
    const meta = /\.okr-kr__meta\s*\{([^}]*)\}/.exec(css)
    expect(meta, '.okr-kr__meta rule missing').not.toBeNull()
    expect(meta![1]).toContain('flex-wrap: wrap')
    expect(meta![1]).toContain('min-width: 0')
  })

  it('lets a long badge wrap its text while staying a pill', () => {
    // «цель 500 · измерение не подключено» is 282px of nowrap text — wider than
    // the 271px row at 375px. Wrapping keeps the stadium shape (--rad-pill), so
    // nothing changes where the badge already fits on one line.
    const badge = /\.okr-badge\s*\{([^}]*)\}/.exec(css)
    expect(badge, '.okr-badge rule missing').not.toBeNull()
    expect(badge![1]).toContain('white-space: normal')
    expect(badge![1]).not.toContain('white-space: nowrap')
    expect(badge![1]).toContain('border-radius: var(--rad-pill)')
  })

  it('pins the status dot to the first line of a wrapped badge', () => {
    // `align-items:center` on the badge centres the 7px dot against the whole
    // text block, so on two lines it floats into the gap between them.
    const dot = /\.okr-badge i\s*\{([^}]*)\}/.exec(css)
    expect(dot, '.okr-badge i rule missing').not.toBeNull()
    expect(dot![1]).toContain('align-self: flex-start')
    // Offset to the optical centre of the first line. `(1lh - 7px)/2` is by
    // definition what align-items:center produced for a single-line badge,
    // so the ordinary case stays pixel-identical whatever `line-height:normal`
    // resolves to; the plain-px declaration is the pre-`lh` fallback.
    expect(dot![1]).toMatch(/margin-top:\s*calc\(\(1lh - 7px\)\s*\/\s*2\)/)
  })

  it('breaks unbreakable tokens rather than clipping them', () => {
    // Only `anywhere` lowers min-content: a long Plane id or URL in a title
    // would otherwise keep the column wide and be cut off by the card. It also
    // sharpens the row's wrap trigger. Visually identical for ordinary text.
    for (const sel of ['.okr-kr__t', '.okr-act__t', '.okr-card__t']) {
      const rule = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css)
      expect(rule, `${sel} rule missing`).not.toBeNull()
      expect(rule![1], `${sel} must break anywhere`).toContain('overflow-wrap: anywhere')
    }
    expect(css).not.toContain('overflow-wrap: break-word')
  })

  it('keeps the border-box hover trick working across the wrap', () => {
    // `width:calc(100% + 16px)` may not change the row's *content* width, or
    // hovering would re-run the line breaking and reflow the row under cursor.
    const hover = /summary\.okr-kr__head:hover\s*\{([^}]*)\}/.exec(css)
    expect(hover, 'the hover rule is missing').not.toBeNull()
    expect(hover![1]).toContain('width: calc(100% + 16px)')
    expect(/\.okr-kr__head\s*\{([^}]*)\}/.exec(css)![1]).toContain('box-sizing: border-box')
  })

  it('styles all three action-state chips (spec 077 req.2)', () => {
    // The markup contract above emits these three classes; a chip with no rule
    // of its own would silently inherit the row ink and stop reading as a state.
    for (const mod of ['done', 'started', 'todo']) {
      expect(css, `.okr-act__state--${mod} has no colour rule`).toMatch(
        new RegExp(`\\.okr-act__state--${mod}\\s*\\{[^}]*color:`),
      )
    }
    expect(css, 'the old binary --open chip is gone').not.toContain('.okr-act__state--open')
  })

  it('lets the action row wrap its indicator cluster instead of clipping it (spec 077 req.7)', () => {
    // The row now carries a chip AND (with sub-tasks) a counter plus a 64px bar.
    // They travel as one unit, exactly like the KR row's `.okr-kr__meta`.
    const meta = /\.okr-act__meta\s*\{([^}]*)\}/.exec(css)
    expect(meta, '.okr-act__meta rule missing').not.toBeNull()
    expect(meta![1]).toContain('flex-wrap: wrap')
    expect(meta![1]).toContain('min-width: 0')

    // `flex-wrap` on the cluster is inert on its own: with `min-width:0` the
    // title column's hypothetical size is 0, the line never breaks, and the
    // title shreds into a 4-character column instead — the exact trap already
    // documented on `.okr-kr__main` above. The floor is the actual wrap trigger,
    // so pin it (and pin that nobody "tidies" it back to 0).
    const title = /\.okr-act__t\s*\{([^}]*)\}/.exec(css)
    expect(title, '.okr-act__t rule missing').not.toBeNull()
    expect(title![1]).toMatch(/min-width:\s*min\(100%,\s*\d+ch\)/)
    expect(title![1]).not.toContain('min-width: 0')
  })

  it('floors the KR heading on both flex levels so the cluster wraps (issue #79)', () => {
    // Measured on `main` at 375px: the KR headings rendered as vertical columns
    // ~20px wide and up to 583px tall. The KR row is a *nested* flex, and that
    // is the whole difference from `.okr-act__t`: the line break is decided by
    // `.okr-kr__head` from the hypothetical size of `.okr-kr__main`, while the
    // title's own floor only ever reaches the inside of `.okr-kr__main`. With
    // the floor on the inner element alone the heading widened 24 → 46px and
    // `.okr-kr__meta` still never moved to its own line (PR #78's reviewer).
    // So the outer element carries the floor that triggers the wrap, and the
    // inner one keeps the title itself off zero.
    const main = /\.okr-kr__main\s*\{([^}]*)\}/.exec(css)
    expect(main, '.okr-kr__main rule missing').not.toBeNull()
    // The lead column both floors subtract must be DERIVED from the two lengths
    // it is made of — and those two must be the ones actually applied to the
    // chevron column and to the gap. A literal `22px` would keep matching after
    // someone resized the chevron to 16px, and both floors would be off by the
    // difference on every KR row while the test stayed green.
    expect(main![1], '--kr-chev must be declared, not inlined').toMatch(/--kr-chev:\s*[\d.]+px/)
    expect(main![1], '--kr-gap must be declared, not inlined').toMatch(/--kr-gap:\s*[\d.]+px/)
    expect(main![1], '--kr-lead must be derived from them, not written out').toMatch(
      /--kr-lead:\s*calc\(var\(--kr-chev\) \+ var\(--kr-gap\)\)/,
    )
    expect(main![1], 'the gap the lead counts must be the gap actually applied').toContain(
      'gap: var(--kr-gap)',
    )
    const chev = /\n\.okr-kr__chev\s*\{([^}]*)\}/.exec(css)
    expect(chev, '.okr-kr__chev rule missing').not.toBeNull()
    expect(chev![1], 'the chevron column must be the width the lead counts').toContain(
      'flex: 0 0 var(--kr-chev)',
    )
    // `var()` on a name that no longer exists is invalid-at-computed-value-time,
    // which for min-width means the initial `auto` — the pre-fix defect, silently.
    // The asserts above are what keeps that name alive.
    expect(main![1], 'the outer floor is the wrap trigger').toMatch(
      /min-width:\s*min\(100%,\s*calc\(14ch \+ var\(--kr-lead\)\)\)/,
    )
    expect(main![1]).not.toContain('min-width: 0')
    expect(main![1], 'the content-based minimum is a single character — never a floor').not.toMatch(
      /min-width:\s*auto/,
    )

    // The inner floor is DEFENSIVE and does not bind in today's markup: as the
    // only growing child beside a `flex:0 0` chevron, `.okr-kr__t` always gets
    // `main − lead` and never reaches its own minimum. It is pinned anyway, so
    // that a second flexible child in `.okr-kr__main` cannot reintroduce the
    // collapse — and so that nobody "tidies" it back to the `min-width:0` that
    // permitted it. `min(…)`, not a bare 14ch: on a row narrower than the floor
    // a hard value would bring back the horizontal overflow inside
    // `.okr-card{overflow:hidden}` that #76 removed.
    const title = /\.okr-kr__t\s*\{([^}]*)\}/.exec(css)
    expect(title, '.okr-kr__t rule missing').not.toBeNull()
    expect(title![1]).toMatch(/min-width:\s*min\(calc\(100% - var\(--kr-lead\)\),\s*14ch\)/)
    expect(title![1], 'the zeroed minimum is what collapsed the heading').not.toContain(
      'min-width: 0',
    )
  })

  it('keeps every action-state chip above the WCAG AA threshold', () => {
    // 12px bold is not «large text», so 4.5:1 applies. Pinning the token *name*
    // would only catch a swap back to --status-pos-dot (3.44:1); it would stay
    // green if the palette itself were lightened. So compute the real ratio —
    // both the chip colours and --surface live in this same stylesheet.
    const token = (name: string): string => {
      const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i').exec(css)
      expect(m, `token ${name} not found in okr.css`).not.toBeNull()
      return m![1]
    }
    const channel = (c: number) =>
      c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4
    const luminance = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16)
      return (
        0.2126 * channel((n >> 16) & 255) +
        0.7152 * channel((n >> 8) & 255) +
        0.0722 * channel(n & 255)
      )
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    const surface = token('--surface')
    for (const mod of ['done', 'started', 'todo']) {
      const rule = new RegExp(
        `\\.okr-act__state--${mod}\\s*\\{[^}]*color:\\s*var\\((--[\\w-]+)\\)`,
      ).exec(css)
      expect(rule, `.okr-act__state--${mod} must colour itself from a token`).not.toBeNull()
      const ratio = contrast(token(rule![1]), surface)
      expect(
        ratio,
        `чип «${mod}» (${rule![1]}) на --surface: ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('pins the chevron rotation to an open KR row', () => {
    expect(css).toMatch(
      /details\[open\]\s*>\s*summary\s+\.okr-kr__chev\s*\{[^}]*transform:\s*rotate\(90deg\)/,
    )
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
  })

  it('keeps the group-wide sheet palette-free — the surface paints its own canvas', () => {
    // Spec 081 req.29: /p/hours is the second page of this group, so the
    // background moved off the group-wide `body` rule onto a per-surface rule.
    // A blanket `body { background }` here would repaint every future surface
    // in the OKR palette.
    // Comments are stripped: this file documents the old rule in prose, and
    // prose must not be mistaken for a declaration.
    const global = readFileSync(join(layoutDir, 'platform.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    expect(/body\s*\{[^}]*background:/.test(global), 'no group-wide background').toBe(false)

    // …and the OKR page still looks exactly as before: its own stylesheet
    // paints the canvas with the same --paper value.
    const okrCss = readFileSync(join(REPO_ROOT, 'src', 'modules', 'okr', 'view', 'okr.css'), 'utf8')
    const canvas = /body:has\(\.okr-root\)\s*\{([^}]*)\}/.exec(okrCss)
    expect(canvas, 'okr.css must paint its own canvas').not.toBeNull()
    expect(canvas![1]).toContain('#eaf2f0')
    expect(/\.okr-root\s*\{([^}]*)\}/.exec(okrCss)![1]).toContain('--paper: #eaf2f0')
  })
})
