import { describe, expect, it } from 'vitest'
import { isOkrBlockedOnHost } from '@/lib/platform/hostGuard'

describe('isOkrBlockedOnHost (middleware guard, #63)', () => {
  it('blocks /okr and /okr/* on the CMS host', () => {
    expect(isOkrBlockedOnHost('cms.bbm.academy', '/okr')).toBe(true)
    expect(isOkrBlockedOnHost('cms.bbm.academy', '/okr/')).toBe(true)
    expect(isOkrBlockedOnHost('cms.bbm.academy', '/okr/tree')).toBe(true)
  })

  it('matches the host case-insensitively and ignores the port', () => {
    expect(isOkrBlockedOnHost('CMS.BBM.Academy', '/okr')).toBe(true)
    expect(isOkrBlockedOnHost('cms.bbm.academy:443', '/okr')).toBe(true)
  })

  it('passes non-/okr paths on the CMS host (admin, api, static)', () => {
    expect(isOkrBlockedOnHost('cms.bbm.academy', '/admin')).toBe(false)
    expect(isOkrBlockedOnHost('cms.bbm.academy', '/api/media/file/x.png')).toBe(false)
    // /okr must be a full segment — no prefix false-positives
    expect(isOkrBlockedOnHost('cms.bbm.academy', '/okra')).toBe(false)
  })

  it('passes every other host, including localhost/dev', () => {
    expect(isOkrBlockedOnHost('localhost:3000', '/okr')).toBe(false)
    expect(isOkrBlockedOnHost('portal.bbm.academy', '/okr')).toBe(false)
    expect(isOkrBlockedOnHost(null, '/okr')).toBe(false)
    expect(isOkrBlockedOnHost(undefined, '/okr')).toBe(false)
  })
})
