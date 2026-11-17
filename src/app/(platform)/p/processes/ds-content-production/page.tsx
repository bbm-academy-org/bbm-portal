import React from 'react'

import { getProcessModel, processBySlug } from '@/lib/processes'
import { ProcessModelScreen } from '@/modules/processes/view/ProcessModelScreen'

// «Производство контента DS» (#553, spec 553): the IDEF0 model read at request
// time from bbm-kb main (`src/lib/processes`, ~60 s server cache, stale copy on
// a GitHub failure) and drawn by the viewer ported from bbm-kb. Auth: the
// (platform) root layout (Zitadel) and `/p/layout.tsx` (workspace membership).
// Dynamic: read per request, so a change merged to bbm-kb shows without a deploy.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Производство контента DS · Процессы · BBM',
}

const ENTRY = processBySlug('ds-content-production')!

export default async function DsContentProductionPage() {
  const loaded = await getProcessModel(ENTRY)
  return <ProcessModelScreen entry={ENTRY} loaded={loaded} />
}
