import React from 'react'

import type {
  ContractorProcessOrigin,
  ContractorProcessReadFailureKind,
} from '@/lib/contractor-process'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'

/**
 * The states of `/p/finance/contractor-process` (#545) around the diagram,
 * built from the kit's `Alert` — this section's own copy, not the path map's:
 * those texts talk about «карта» and `PATH_MAPS_FILE`, which this file does
 * not read (the file is the constant `processes/contractors.json`).
 *
 *   - `ContractorProcessSourceNotice` — the public example is on screen, or
 *     GitHub failed and the last good copy is shown (worded by failure kind);
 *   - `ContractorProcessReadError` — nothing could be read and nothing is
 *     cached: what went wrong and where the fix is, with the source named;
 *   - `ContractorProcessParseError` — the file was read and is invalid: the
 *     parser's own Russian errors, each with the path of its field.
 *
 * The read-failure message of the shared GitHub client is deliberately NOT
 * shown: it is worded for the path map.
 */

const TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
})

const STALE_CAUSE: Record<ContractorProcessReadFailureKind, string> = {
  auth: 'нет доступа к репозиторию path-maps — проверьте токен на сервере (PATH_MAPS_GITHUB_TOKEN)',
  'not-found':
    'файл процесса не найден в репозитории — проверьте processes/contractors.json и доступ токена',
  'rate-limit': 'превышен лимит запросов к GitHub',
  network: 'GitHub сейчас не отвечает',
  config: 'источник настроен неверно — проверьте PATH_MAPS_REPO / PATH_MAPS_BRANCH',
  'not-a-file':
    'по пути processes/contractors.json в GitHub не файл процесса (папка или файл больше 1 МБ)',
  local: 'пример процесса не прочитан',
}

export function ContractorProcessSourceNotice({
  origin,
  stale,
  staleReason,
  asOf,
}: {
  origin: ContractorProcessOrigin['kind']
  stale: boolean
  staleReason?: ContractorProcessReadFailureKind
  asOf: string
}) {
  if (origin === 'local') {
    return (
      <Alert role="status" data-cp-notice="example">
        <AlertTitle>Показан пример</AlertTitle>
        <AlertDescription>
          Это выдуманная схема из кода портала, а не рабочий процесс команды.
        </AlertDescription>
      </Alert>
    )
  }
  if (stale) {
    return (
      <Alert role="status" data-cp-notice="stale">
        <AlertTitle>Данные могли устареть</AlertTitle>
        <AlertDescription>
          {STALE_CAUSE[staleReason ?? 'network']}. Показана копия от {TIME.format(new Date(asOf))}{' '}
          МСК.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

const READ_COPY: Record<ContractorProcessReadFailureKind, { title: string; next: string }> = {
  auth: {
    title: 'Нет доступа к репозиторию path-maps',
    next:
      'Проверьте токен на сервере (PATH_MAPS_GITHUB_TOKEN): он мог истечь или быть отозван, ' +
      'или у него нет права Contents: read на этот репозиторий. Сам файл процесса, скорее всего, в порядке.',
  },
  'not-found': {
    title: 'Файл процесса не найден',
    next:
      'Проверьте, что файл processes/contractors.json есть в репозитории (PATH_MAPS_REPO, ветка PATH_MAPS_BRANCH). ' +
      'GitHub отвечает «не найден» и тогда, когда токен не видит репозиторий.',
  },
  'rate-limit': {
    title: 'Превышен лимит запросов к GitHub',
    next: 'GitHub временно ограничил запросы портала — подождите и обновите страницу.',
  },
  network: {
    title: 'GitHub не отвечает',
    next: 'Обновите страницу через минуту. Если не проходит — проверьте, что сервер портала видит api.github.com.',
  },
  config: {
    title: 'Источник процесса настроен неверно',
    next: 'Исправьте PATH_MAPS_REPO / PATH_MAPS_BRANCH в окружении сервера портала.',
  },
  'not-a-file': {
    title: 'По пути процесса в GitHub не файл',
    next:
      'На месте processes/contractors.json в репозитории папка или файл больше 1 МБ — GitHub не отдаёт его содержимое. ' +
      'Это один JSON-файл процесса: верните его на этот путь и держите меньше 1 МБ. Настройки сервера здесь ни при чём.',
  },
  local: {
    title: 'Пример процесса не прочитан',
    next: 'Проверьте, что файл content/finance/contractor-process.example.json попал в сборку портала.',
  },
}

export function ContractorProcessReadError({
  reason,
  file,
}: {
  reason: ContractorProcessReadFailureKind
  file: string
}) {
  const copy = READ_COPY[reason]
  return (
    <Alert variant="destructive" data-cp-error="read">
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        <p>
          Схему процесса не удалось получить из <code>{file}</code>.
        </p>
        <p>{copy.next}</p>
      </AlertDescription>
    </Alert>
  )
}

export function ContractorProcessParseError({ errors, file }: { errors: string[]; file: string }) {
  return (
    <Alert variant="destructive" data-cp-error="parse">
      <AlertTitle>В файле процесса ошибки</AlertTitle>
      <AlertDescription>
        <p>
          Схему не нарисовать, пока в <code>{file}</code> не исправлено:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {errors.map((error, i) => (
            <li key={i}>
              <code>{error}</code>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
