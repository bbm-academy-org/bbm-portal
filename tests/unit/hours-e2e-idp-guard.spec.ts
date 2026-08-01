import { describe, expect, it } from 'vitest'

import { isAllowedE2EIdpOrigin } from '../e2e/support/idp-origin'

describe('hours E2E IdP credential origin guard', () => {
  it('allows only the canonical HTTPS production IdP by default', () => {
    expect(isAllowedE2EIdpOrigin('https://id.bbm.academy/ui/login', undefined)).toBe(true)
    expect(isAllowedE2EIdpOrigin('http://id.bbm.academy/ui/login', undefined)).toBe(false)
    expect(isAllowedE2EIdpOrigin('https://id.bbm.academy.evil.test/ui/login', undefined)).toBe(
      false,
    )
  })

  it('allows an exact explicitly configured dev host, including its port', () => {
    expect(isAllowedE2EIdpOrigin('http://truenas.local:9180/ui/login', 'truenas.local:9180')).toBe(
      true,
    )
    expect(isAllowedE2EIdpOrigin('http://truenas.local/ui/login', 'truenas.local:9180')).toBe(false)
    expect(isAllowedE2EIdpOrigin('http://other.local:9180/ui/login', 'truenas.local:9180')).toBe(
      false,
    )
  })

  it('fails closed for malformed configured hosts and non-HTTP origins', () => {
    expect(isAllowedE2EIdpOrigin('https://evil.test/login', 'https://evil.test')).toBe(false)
    expect(isAllowedE2EIdpOrigin('https://evil.test/login', 'evil.test/path')).toBe(false)
    expect(isAllowedE2EIdpOrigin('file:///tmp/login.html', 'tmp')).toBe(false)
    expect(isAllowedE2EIdpOrigin('not a url', 'truenas.local:9180')).toBe(false)
  })
})
