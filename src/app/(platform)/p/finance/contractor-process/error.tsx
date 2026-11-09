'use client'

import React from 'react'

import { ContractorProcessLayout } from '@/modules/contractor-process/view/ContractorProcessLayout'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'

/**
 * The route-level error of `/p/finance/contractor-process` (#545): a render
 * error in the map, worded for this section — not the finance overview's
 * «Остатки временно недоступны», which the route inherited without it. A
 * failed READ of the process never lands here: the page shows it as its own
 * state (`ContractorProcessReadError`). The raw error is not shown.
 */
export default function ContractorProcessError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ContractorProcessLayout interactive={false}>
      <div className="cp-notices">
        <Alert variant="destructive" role="alert">
          <AlertTitle>Схема процесса не показана</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Не удалось нарисовать схему работы с исполнителями. Повторите попытку.</p>
            <Button variant="outline" onClick={reset}>
              Попробовать снова
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </ContractorProcessLayout>
  )
}
