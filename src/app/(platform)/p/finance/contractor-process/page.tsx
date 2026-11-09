import React from 'react'

import { getContractorProcess } from '@/lib/contractor-process'
import { ContractorProcessLayout } from '@/modules/contractor-process/view/ContractorProcessLayout'
import {
  ContractorProcessParseError,
  ContractorProcessReadError,
  ContractorProcessSourceNotice,
} from '@/modules/contractor-process/view/ContractorProcessNotices'
import { ContractorProcessView } from '@/modules/contractor-process/view/ContractorProcessView'

// «Как работаем с исполнителями» (#545): a read-only map of how the team
// works with contractors, from the decision to engage one to the closing
// documents. The process is one JSON file in the private repo
// `bbm-academy-org/path-maps` (`processes/contractors.json`, GitHub contents
// API, ~60s server cache, stale copy on a GitHub failure); without
// `PATH_MAPS_GITHUB_TOKEN` the public example
// `content/finance/contractor-process.example.json` is drawn with a notice.
// Auth is the (platform) root layout plus `/p/layout.tsx` (workspace
// membership, `platform-user`); nothing here writes. Dynamic: read per
// request, so an invalid file shows its errors instead of failing the build.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Как работаем с исполнителями · BBM',
}

export default async function ContractorProcessPage() {
  const loaded = await getContractorProcess()
  return (
    <ContractorProcessLayout interactive={loaded.ok}>
      <div className="cp-notices">
        <ContractorProcessSourceNotice
          origin={loaded.origin.kind}
          stale={loaded.stale}
          staleReason={loaded.staleReason}
          asOf={loaded.asOf}
        />
        {/* A failed READ is not a broken file: its own state, never «the file has errors». */}
        {loaded.failure?.kind === 'read' ? (
          <ContractorProcessReadError reason={loaded.failure.reason} file={loaded.file} />
        ) : !loaded.ok ? (
          <ContractorProcessParseError errors={loaded.errors} file={loaded.file} />
        ) : null}
      </div>
      {loaded.ok ? <ContractorProcessView process={loaded.process} /> : null}
    </ContractorProcessLayout>
  )
}
