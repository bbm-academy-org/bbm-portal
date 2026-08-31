'use client'

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'

export default function FinanceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>Остатки временно недоступны</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>Не удалось прочитать финансовый контур. Повторите запрос.</p>
        <Button variant="outline" onClick={reset}>
          Попробовать снова
        </Button>
      </AlertDescription>
    </Alert>
  )
}
