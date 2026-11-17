import React from 'react'

import type { ProcessCatalogEntry, ProcessFailureKind, ProcessModelLoad } from '@/lib/processes'
import { describeProcessOrigin } from '@/lib/processes'
import { Idef0ViewerClient } from '@/modules/processes/idef0/Idef0ViewerClient'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'

/**
 * The IDEF0 page of one process (#553): the bbm-kb page's head (title, the
 * one-line «how to read» hint, a link to the model package in the KB) in the
 * portal's kit, then the PORTED viewer in its own accepted look. Around it the
 * states the KB page never had, because it was a static export: a stale copy
 * (EARS-606), no model at all (EARS-607) and the invented example (EARS-608).
 */

const TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

/** What to do about a failure, by kind — a rate limit is not «GitHub is down». */
const CAUSE: Record<ProcessFailureKind, string> = {
  auth: 'GitHub отказал в доступе — проверьте токен на сервере (PROCESS_MODELS_GITHUB_TOKEN)',
  'not-found': 'файла модели нет по ожидаемому пути',
  'rate-limit': 'превышен лимит запросов к GitHub',
  network: 'GitHub сейчас не отвечает',
  invalid: 'новая версия модели в базе знаний не разобрана',
  local: 'пример модели не прочитан',
}

function Notice({ loaded }: { loaded: ProcessModelLoad & { ok: true } }) {
  if (loaded.origin.kind === 'example') {
    return (
      <p role="status" className="mt-2 text-sm text-muted-foreground">
        Показан выдуманный пример из кода портала — это не рабочая модель
        (PROCESS_MODELS_SOURCE=example).
      </p>
    )
  }
  if (!loaded.stale) return null
  return (
    <p role="status" className="mt-2 text-sm text-destructive">
      Данные могли устареть: {CAUSE[loaded.staleReason ?? 'network']}
      {loaded.staleMessage ? ` (${loaded.staleMessage})` : ''}. Показана копия от{' '}
      {TIME.format(new Date(loaded.asOf))} МСК.
    </p>
  )
}

export function ProcessModelScreen({
  entry,
  loaded,
}: {
  entry: ProcessCatalogEntry
  loaded: ProcessModelLoad
}) {
  return (
    <main className="processes-page">
      <div data-bbm-ui className="bg-background px-4 pt-5 pb-3 sm:px-6">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
          {entry.name}: IDEF0-модель
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Двойной щелчок по блоку с ▼ — раскрыть уровень; щелчок — пояснение в панели справа;
          уровень — в адресе (#A-0, #A0, #A31…).{' '}
          <a
            href={entry.kbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            Пакет модели в базе знаний
          </a>
        </p>
        {loaded.ok ? <Notice loaded={loaded} /> : null}
      </div>
      <div className="px-4 pb-4 sm:px-6">
        {loaded.ok ? (
          <Idef0ViewerClient model={loaded.model} />
        ) : (
          <div data-bbm-ui>
            <Alert variant="destructive">
              <AlertTitle>Не удалось прочитать модель</AlertTitle>
              <AlertDescription>
                <p>
                  {CAUSE[loaded.failure.reason]}: {loaded.failure.message}.
                </p>
                <p>
                  Источник: {describeProcessOrigin(loaded.origin)}. Страница повторит чтение не
                  раньше чем через минуту; модель можно прочитать в базе знаний по ссылке выше.
                </p>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </main>
  )
}
