import { describe, expect, it } from 'vitest'
import { requiresSignIn, resolvePlatformGate, signInRedirect } from '@/lib/platform/authGate'

// Auth-decision logic for the (platform) layout gate (spec 059 req.2 / scenario
// 1 & 3). Pure functions so the "unauthenticated -> redirect, authenticated ->
// render, no data to anonymous" contract is unit-testable without a browser.

describe('requiresSignIn', () => {
  it('requires sign-in when there is no session', () => {
    expect(requiresSignIn(null)).toBe(true)
    expect(requiresSignIn(undefined)).toBe(true)
  })

  it('requires sign-in when the session carries no user', () => {
    expect(requiresSignIn({})).toBe(true)
    expect(requiresSignIn({ user: null })).toBe(true)
    expect(requiresSignIn({ user: undefined })).toBe(true)
  })

  it('passes an authenticated session with a user', () => {
    expect(requiresSignIn({ user: { email: 'bbm-test@bbm.local' } })).toBe(false)
  })
})

describe('signInRedirect', () => {
  it('targets the Auth.js sign-in route and preserves the callback path', () => {
    expect(signInRedirect('/p/okr')).toBe('/api/auth/signin?callbackUrl=%2Fp%2Fokr')
  })

  it('encodes callback paths with query strings', () => {
    expect(signInRedirect('/p/okr?tab=social')).toBe(
      '/api/auth/signin?callbackUrl=%2Fp%2Fokr%3Ftab%3Dsocial',
    )
  })
})

describe('resolvePlatformGate', () => {
  it('redirects an unauthenticated request to sign-in (never renders data)', () => {
    expect(resolvePlatformGate(null, '/p/okr')).toEqual({
      type: 'redirect',
      to: '/api/auth/signin?callbackUrl=%2Fp%2Fokr',
    })
  })

  it('renders for an authenticated session', () => {
    expect(resolvePlatformGate({ user: { email: 'bbm-test@bbm.local' } }, '/p/okr')).toEqual({
      type: 'render',
    })
  })
})
