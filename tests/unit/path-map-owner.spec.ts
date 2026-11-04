import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import { OWNER_CHIP, ownerInitials } from '@/modules/path-map/view/labels'
import { OwnerChip } from '@/modules/path-map/view/OwnerChip'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

/**
 * «Карта пути» owner chip (#538). The real map writes owners as full names
 * («Эдуард», «Антон Сидоров»); the chip is a fixed circle, so it shows 1–2
 * initials and carries the full name in `title` and its accessible name. Where
 * there is room (the «Что внутри» header, task rows) the full name is text too.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
const fullNames = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/full-name-owners.yaml'), 'utf8'),
)
const css = readFileSync(join(repoRoot, 'src/modules/path-map/view/path-map.css'), 'utf8')

afterEach(cleanup)

describe('ownerInitials', () => {
  it.each([
    ['Эдуард', 'Э'],
    ['Антон Сидоров', 'АС'],
    ['ДС', 'ДС'],
    ['ЕВ', 'ЕВ'],
    ['  Эдуард  ', 'Э'],
    ['антон   сидоров', 'АС'],
    ['Anton', 'A'],
    ['Anton Sidorov', 'AS'],
    ['DS', 'DS'],
    ['Мария Ивановна Петрова', 'МИ'],
    ['Д. С.', 'ДС'],
    ['Анна-Мария', 'А'],
    ['🚀 Эдуард', 'Э'],
    ['Эдуард 🚀', 'Э'],
    ['ßtraße', 'ß'],
    ['ß Müller', 'ßM'],
  ])('%j → %j', (owner, initials) => {
    expect(ownerInitials(owner)).toBe(initials)
  })

  it('never splits an emoji: a letterless owner shows its first whole grapheme', () => {
    expect(ownerInitials('🚀')).toBe('🚀')
    expect(ownerInitials('👩‍💻 🚀')).toBe('👩‍💻')
  })

  it('an empty or blank owner has no initials', () => {
    expect(ownerInitials('')).toBe('')
    expect(ownerInitials('   ')).toBe('')
  })

  it('is at most two letters', () => {
    for (const owner of ['ИТМО', 'Антон Сидоров Петрович', 'ABC DEF GHI']) {
      expect([...ownerInitials(owner)].length).toBeLessThanOrEqual(2)
    }
  })
})

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('owner chip colours', () => {
  it('one colour pair for every chip: ink initials on the light disc at ≥4.5:1', () => {
    expect(contrast(OWNER_CHIP.background, OWNER_CHIP.ink)).toBeGreaterThanOrEqual(4.5)
  })

  it('the circle is the chip background, the initials are ink and cannot overflow', () => {
    const rule = css.match(/\.pm-owner\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/width:\s*26px/)
    expect(rule).toMatch(/height:\s*26px/)
    expect(rule).toMatch(/color:\s*var\(--pm-ink\)/)
    expect(rule).toMatch(/background:\s*var\(--pm-text\)/)
    expect(rule).toMatch(/overflow:\s*hidden/)
  })
})

function renderFullNames() {
  return render(el(PathMapView, { result: fullNames, file: PATH_MAP_FILE }))
}

function barrier(title: RegExp) {
  const found = screen.getAllByRole('button', { name: title }).filter((b) => !b.closest('nav'))
  expect(found).toHaveLength(1)
  return found[0]
}

describe('owner chip with full-name owners', () => {
  it('the barrier chip shows initials, the full name is its title and accessible name', () => {
    renderFullNames()
    // The disclosure button is stretched over the card; the chip lives in the card itself.
    const studio = barrier(/Довести студию/).closest('article')!
    const chip = studio.querySelector('.pm-owner')!
    expect(chip.getAttribute('title')).toBe('Эдуард')
    expect(chip.querySelector('[aria-hidden="true"]')?.textContent).toBe('Э')
    expect(chip.textContent).toMatch(/исполнитель Эдуард/)

    const experts = barrier(/Каталог экспертов/).closest('article')!
    expect(experts.querySelector('.pm-owner [aria-hidden="true"]')?.textContent).toBe('ЕВ')
  })

  it('the «Что внутри» header shows the chip and the full name as text', () => {
    renderFullNames()
    fireEvent.click(barrier(/Довести студию/))
    const p = screen.getByRole('complementary', { name: 'Что внутри' })
    const meta = p.querySelector('.pm-inside-meta')!
    expect(meta.querySelector('.pm-owner [aria-hidden="true"]')?.textContent).toBe('Э')
    expect(meta.querySelector('.pm-owner-name')?.textContent).toMatch(/Эдуард/)
  })

  it('task rows show the chip and the full name; already-initials stay as they are', () => {
    renderFullNames()
    fireEvent.click(barrier(/Довести студию/))
    const p = screen.getByRole('complementary', { name: 'Что внутри' })
    const site = within(p).getByText('Площадка').closest('li')!
    expect(site.querySelector('.pm-owner [aria-hidden="true"]')?.textContent).toBe('АС')
    expect(site.querySelector('.pm-owner-name')?.textContent).toMatch(/Антон Сидоров/)
    const editor = within(p).getByText('Монтажёр на поток').closest('li')!
    expect(editor.querySelector('.pm-owner [aria-hidden="true"]')?.textContent).toBe('ЕВ')
    expect(editor.querySelector('.pm-owner-name')?.textContent).toMatch(/ЕВ/)
  })
})

describe('one chip look for every owner (#538: no per-person colours)', () => {
  it('every rendered chip — card, panel header, task rows — has no inline colour', () => {
    renderFullNames()
    fireEvent.click(barrier(/Довести студию/))
    const chips = [...document.querySelectorAll<HTMLElement>('.pm-owner')]
    expect(chips.length).toBeGreaterThan(3)
    const owners = new Set(chips.map((c) => c.getAttribute('title')))
    expect(owners.size).toBeGreaterThan(1)
    for (const chip of chips) {
      expect(chip.getAttribute('style')).toBeNull()
      expect(chip.className).toBe('pm-owner')
    }
  })

  it('the chip trims the owner for its title and accessible name', () => {
    render(el(OwnerChip, { owner: '  Эдуард  ' }))
    const chip = document.querySelector('.pm-owner')!
    expect(chip.getAttribute('title')).toBe('Эдуард')
    expect(chip.textContent).toBe('исполнитель ЭдуардЭ')
  })
})

describe('the barrier card with tasks: the full name is reachable', () => {
  it('the stretched disclosure button — the hover target over the chip — carries the owner', () => {
    renderFullNames()
    const button = barrier(/Довести студию/)
    // The stretch button covers the card (and its chip), so its own tooltip names the owner.
    expect(button.getAttribute('title')).toBe('Что внутри: Довести студию до готовности · Эдуард')
    expect(button.getAttribute('aria-label')).toBe('Что внутри: Довести студию до готовности')
    expect(button.closest('article')!.querySelector('.pm-owner')?.getAttribute('title')).toBe(
      'Эдуард',
    )
  })
})

describe('legend: «Не знаем — туман»', () => {
  it('the fog swatch draws its glow inside its own box, so the scrolling panel cannot clip it', () => {
    const rule = css.match(/\.pm-swatch\[data-kind='fog'\]\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/box-shadow/)
    expect(rule).not.toMatch(/filter:\s*blur/)
    expect(rule).toMatch(/radial-gradient/)
  })
})
