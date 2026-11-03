import React from 'react'

import { getPathMap } from '@/lib/path-map'
import { PathMapLayout } from '@/modules/path-map/view/PathMapLayout'
import { PathMapSourceNotice } from '@/modules/path-map/view/PathMapSourceNotice'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

// «Карта пути» (#530): a read-only strategy map. Since #533 its YAML is read
// from the private repo `bbm-academy-org/path-maps` (GitHub contents API, ~60s
// server cache, stale copy on a GitHub failure); without
// `PATH_MAPS_GITHUB_TOKEN` the public example `content/path-map/doctor-school.yaml`
// is shown with a notice. Auth is enforced by the (platform) root layout
// (Zitadel OIDC gate) and `/p/layout.tsx` (workspace membership); the host
// allowlist keeps `/p/*` off the CMS host. Dynamic: read per request, so an
// invalid file shows its errors instead of failing the build.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Карта пути · BBM',
}

export default async function PathMapPage() {
  const loaded = await getPathMap()
  return (
    <PathMapLayout>
      <PathMapSourceNotice origin={loaded.origin.kind} stale={loaded.stale} asOf={loaded.asOf} />
      <PathMapView result={loaded} file={loaded.file} />
    </PathMapLayout>
  )
}
