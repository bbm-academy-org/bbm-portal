import { describe, expect, it } from 'vitest'

import { initials } from '@/app/(platform)/p/TopBar'

/**
 * The avatar fallback of the shared top bar (spec 311 EARS-425).
 *
 * `initials()` is the one piece of real branching on that surface, and the piece
 * most likely to produce a visibly wrong glyph: the member label the session
 * carries is a display name for some accounts and a bare email for others.
 */

describe('initials() — the top bar avatar fallback', () => {
  it('takes the first letter of the first two words of a name', () => {
    expect(initials('Анна Ковалёва')).toBe('АК')
  })

  it('caps at two letters however many words the label has', () => {
    expect(initials('Анна Мария Ковалёва')).toBe('АМ')
  })

  it('gives a single word a single letter', () => {
    expect(initials('Антон')).toBe('А')
  })

  it('strips the domain of an email and splits the local part', () => {
    expect(initials('anna.kovaleva@bbm.academy')).toBe('AK')
    expect(initials('anton@bbm.academy')).toBe('A')
    expect(initials('a_b-c@bbm.academy')).toBe('AB')
  })

  it('upper-cases in the Russian locale', () => {
    expect(initials('анна ковалёва')).toBe('АК')
  })

  it('falls back to an em dash for an empty or whitespace-only label', () => {
    expect(initials('')).toBe('—')
    expect(initials('   ')).toBe('—')
    expect(initials('@bbm.academy')).toBe('—')
  })

  it('is code-point safe: a surrogate pair yields the whole character', () => {
    expect(initials('𝒜nna')).toBe('𝒜')
  })
})
