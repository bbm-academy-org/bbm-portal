import { describe, expect, it } from 'vitest'

import { isOwnEmail, normalizeEmail, sessionEmail } from '@/lib/hours/access'

describe('hours participant identity gate', () => {
  it('normalizes session and target email consistently', () => {
    expect(normalizeEmail('  Anton@BBM.Academy ')).toBe('anton@bbm.academy')
    expect(sessionEmail({ user: { email: ' Anton@BBM.Academy ' } })).toBe('anton@bbm.academy')
  })

  it('allows a participant to write only their own assessment', () => {
    expect(isOwnEmail(' Anton@BBM.Academy ', 'anton@bbm.academy')).toBe(true)
    expect(isOwnEmail('anton@bbm.academy', 'other@bbm.academy')).toBe(false)
    expect(isOwnEmail('', '')).toBe(false)
  })
})
