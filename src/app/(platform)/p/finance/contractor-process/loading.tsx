import React from 'react'

import {
  ContractorProcessLayout,
  ContractorProcessPlaceholder,
} from '@/modules/contractor-process/view/ContractorProcessLayout'

/**
 * The route-level frame while the process is read (#545): this section's own
 * header and the map's «Схема рисуется…» placeholder. Without it the route
 * inherited `/p/finance/loading.tsx` — the balances skeleton — and swapped it
 * for the swimlane map (the #388 «defect C» pattern).
 */
export default function ContractorProcessLoading() {
  return (
    <ContractorProcessLayout interactive={false}>
      <ContractorProcessPlaceholder />
    </ContractorProcessLayout>
  )
}
