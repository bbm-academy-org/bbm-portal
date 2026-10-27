import React from 'react'

import { loadPathMap } from '@/lib/path-map'
import { PathMapLayout } from '@/modules/path-map/view/PathMapLayout'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

// «Карта пути» (#530): a read-only strategy map rendered from ONE committed YAML
// file (`content/path-map/doctor-school.yaml`). Auth is enforced by the
// (platform) root layout (Zitadel OIDC gate) and `/p/layout.tsx` (workspace
// membership); the host allowlist keeps `/p/*` off the CMS host. Dynamic: the
// file is read per request, so a redeploy is the only edit path and an invalid
// file shows its errors instead of failing the build.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Карта пути · BBM',
}

export default function PathMapPage() {
  const loaded = loadPathMap()
  return (
    <PathMapLayout>
      <PathMapView result={loaded} file={loaded.file} />
    </PathMapLayout>
  )
}
