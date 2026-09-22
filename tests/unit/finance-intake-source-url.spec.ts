import { describe, expect, it } from 'vitest'

import { sourceRefLabel, sourceRefToUrl } from '@/lib/finance/intake/source-url'

/**
 * `(source, source_ref, provenance)` → a URL (#517, spec 339 EARS-535).
 *
 * Pure with respect to its env argument, so every branch — including «this
 * stand has no Mattermost configured» — is a unit test rather than an
 * environment somebody has to reproduce.
 */
const ENV = { MATTERMOST_ORIGIN: 'https://chat.bbm.academy', MATTERMOST_TEAM: 'bbm' }

const MATTERMOST = { source: 'request', provenance: { source_system: 'mattermost' } }

describe('sourceRefToUrl', () => {
  it('returns a pasted http(s) link unchanged — it IS the source', () => {
    const ref = 'https://t.me/bbm_finance/482'
    expect(sourceRefToUrl({ source: 'request', sourceRef: ref, provenance: null }, ENV)).toBe(ref)
    expect(
      sourceRefToUrl({ source: 'request', sourceRef: 'http://x.test/1', provenance: null }, ENV),
    ).toBe('http://x.test/1')
  })

  it('composes the Mattermost permalink from the env origin and team', () => {
    expect(sourceRefToUrl({ ...MATTERMOST, sourceRef: 'q41r3h4nxjnozgft493okar9tw' }, ENV)).toBe(
      'https://chat.bbm.academy/bbm/pl/q41r3h4nxjnozgft493okar9tw',
    )
  })

  it('drops the `#<source_item>` split suffix — it is an index key, not a post id', () => {
    expect(
      sourceRefToUrl({ ...MATTERMOST, sourceRef: 'dhyq4p4yepgwzy9qk5p5iw65uc#higgsfield' }, ENV),
    ).toBe('https://chat.bbm.academy/bbm/pl/dhyq4p4yepgwzy9qk5p5iw65uc')
  })

  it('tolerates a trailing slash on the configured origin', () => {
    expect(
      sourceRefToUrl(
        { ...MATTERMOST, sourceRef: 'abc' },
        { ...ENV, MATTERMOST_ORIGIN: 'https://chat.bbm.academy/' },
      ),
    ).toBe('https://chat.bbm.academy/bbm/pl/abc')
  })

  it('answers null for an unknown source system, an empty ref and an unconfigured stand', () => {
    expect(
      sourceRefToUrl({ source: 'request', sourceRef: 'MM-1', provenance: null }, ENV),
    ).toBeNull()
    expect(
      sourceRefToUrl(
        { source: 'request', sourceRef: 'x', provenance: { source_system: 'jira' } },
        ENV,
      ),
    ).toBeNull()
    expect(sourceRefToUrl({ source: 'request', sourceRef: null, provenance: null }, ENV)).toBeNull()
    expect(sourceRefToUrl({ ...MATTERMOST, sourceRef: 'abc' }, {})).toBeNull()
  })
})

describe('sourceRefLabel', () => {
  it('names the system for a Mattermost ref and the host for a pasted link', () => {
    expect(sourceRefLabel({ ...MATTERMOST, sourceRef: 'abc#x' })).toBe('Mattermost')
    expect(
      sourceRefLabel({ source: 'request', sourceRef: 'https://t.me/bbm/1', provenance: null }),
    ).toBe('t.me')
  })

  it('falls back to the ref itself when there is nothing better to call it', () => {
    expect(sourceRefLabel({ source: 'backfill', sourceRef: 'INV-42', provenance: null })).toBe(
      'INV-42',
    )
    expect(sourceRefLabel({ source: 'request', sourceRef: null, provenance: null })).toBeNull()
  })
})
