'use client'

import { Download } from 'lucide-react'

import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

export function HoursExportScreen() {
  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Экспорт</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Полная резервная копия данных модуля часов.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>JSON-документ</CardTitle>
          <CardDescription>
            Формат не изменён: участники, периоды, оценки и публикации в одном файле.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Файл формируется из актуального состояния базы в момент скачивания.
          </p>
          <Button asChild>
            <a href="/api/p/hours/admin/export" download>
              <Download aria-hidden="true" />
              Скачать JSON
            </a>
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
