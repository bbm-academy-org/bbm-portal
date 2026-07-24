import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import React from 'react'

import { auth } from '@/auth'
import { resolvePlatformGate } from '@/lib/platform/authGate'

export const metadata = {
  title: 'BBM Platform',
  description: 'BBM Platform surface — behind Zitadel OIDC.',
}

/**
 * Root layout of the (platform) route group (ADR-003 §3(b)): the single place
 * the Zitadel OIDC gate lives, so every current and future platform page
 * inherits it. An unauthenticated request is redirected to the Auth.js sign-in
 * route (which forwards to the Zitadel login) BEFORE any child renders — no
 * dashboard, no team PII, ever reaches an anonymous caller (spec 059 req.2,
 * 152-FZ). This group is a separate root layout (there is no app/layout.tsx;
 * the CMS groups own their own), so it renders <html>/<body>.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const requestHeaders = await headers()
  const currentPath = requestHeaders.get('x-platform-pathname') ?? '/p/okr'

  const decision = resolvePlatformGate(session, currentPath)
  if (decision.type === 'redirect') {
    redirect(decision.to)
  }

  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
