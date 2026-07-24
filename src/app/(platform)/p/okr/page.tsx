import React from 'react'

import { OkrLayout } from '@/modules/okr/view/OkrLayout'
import { OkrView } from '@/modules/okr/view/OkrView'

// OKR dashboard re-mounted at /p/okr (spec 059 req.1) — a re-wire of the
// preserved src/modules/okr/view components, not a redesign. Auth is enforced by
// the (platform) root layout (Zitadel OIDC gate); the host allowlist (middleware)
// keeps this off the CMS host. Dynamic: OkrView reads live Plane data per request.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'OKR · BBM',
}

export default function OkrPage() {
  return (
    <OkrLayout>
      <OkrView />
    </OkrLayout>
  )
}
