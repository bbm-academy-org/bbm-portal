import React from 'react'

import { EDIT_DISABLED_REASON, getPathMap } from '@/lib/path-map'
import { PathMapLayout } from '@/modules/path-map/view/PathMapLayout'
import { PathMapReadError } from '@/modules/path-map/view/PathMapReadError'
import { PathMapSourceNotice } from '@/modules/path-map/view/PathMapSourceNotice'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

import { savePathMapEditAction } from './actions'

// «Карта пути» (#530): a read-only strategy map. Since #533 its YAML is read
// from the private repo `bbm-academy-org/path-maps` (GitHub contents API, ~60s
// server cache, stale copy on a GitHub failure); without
// `PATH_MAPS_GITHUB_TOKEN` the public example `content/path-map/doctor-school.yaml`
// is shown with a notice. Auth is enforced by the (platform) root layout
// (Zitadel OIDC gate) and `/p/layout.tsx` (workspace membership); the host
// allowlist keeps `/p/*` off the CMS host. Since #539 the live map is editable
// in the UI: «Править» calls `./actions.ts` (its own platform-user gate), each
// save a commit to the same YAML file. Dynamic: read per request, so an
// invalid file shows its errors instead of failing the build.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Карта пути · BBM',
}

export default async function PathMapPage() {
  const loaded = await getPathMap()
  return (
    <PathMapLayout>
      <PathMapSourceNotice
        origin={loaded.origin.kind}
        stale={loaded.stale}
        staleReason={loaded.staleReason}
        asOf={loaded.asOf}
      />
      {/* A failed READ is not a broken file (#534 review): its own state, not «the file has errors». */}
      {loaded.failure?.kind === 'read' ? (
        <PathMapReadError
          reason={loaded.failure.reason}
          message={loaded.failure.message}
          file={loaded.file}
        />
      ) : (
        <PathMapView
          result={loaded}
          file={loaded.file}
          editing={{
            enabled: loaded.origin.kind === 'github' && loaded.sha !== null,
            reason: loaded.origin.kind === 'github' ? undefined : EDIT_DISABLED_REASON,
            sha: loaded.sha,
            save: savePathMapEditAction,
          }}
        />
      )}
    </PathMapLayout>
  )
}
