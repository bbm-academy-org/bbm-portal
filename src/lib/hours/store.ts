/**
 * Хранилище модуля часов (спека 081 пп. 12, 13, 17): один JSON-документ на
 * диске, без БД.
 *
 * - Путь — env `HOURS_DATA_FILE`; dev-дефолт `data/hours.json` от корня процесса
 *   (каталог в .gitignore). На проде это файл на примонтированном volume, чтобы
 *   данные пережили redeploy (п.18).
 * - Читаем файл на КАЖДЫЙ запрос (страницы `force-dynamic`, кэшей нет).
 * - Мутация — атомарная операция read-modify-write ЦЕЛОГО документа под общим
 *   внутрипроцессным мьютексом (очередь промисов). Процесс один (Node
 *   standalone, кластера нет), поэтому очереди достаточно: двое сохранивших
 *   одновременно не теряют записи друг друга.
 * - Запись — tmp-файл + rename, чтобы на диске никогда не оказалось половины
 *   документа.
 * - Отсутствующий файл — НЕ ошибка (первый запуск на чистом volume). Битый файл
 *   — ошибка вслух: страница скажет «данные недоступны», и файл не будет
 *   перезаписан молча, иначе одна опечатка в JSON стёрла бы все оценки.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { MutationResult } from './document'
import { emptyHoursDocument, type HoursDocument } from './types'

/** Данные на диске нечитаемы — наверх, чтобы страница сказала это вслух. */
export class HoursDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HoursDataError'
  }
}

const DEFAULT_DATA_FILE = 'data/hours.json'

/** Абсолютный путь к документу. Пустая переменная считается незаданной. */
export function resolveDataFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = typeof env.HOURS_DATA_FILE === 'string' ? env.HOURS_DATA_FILE.trim() : ''
  const target = configured || DEFAULT_DATA_FILE
  return isAbsolute(target) ? target : resolve(process.cwd(), target)
}

function normalizeDocument(raw: unknown): HoursDocument {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HoursDataError('Файл данных модуля часов имеет неожиданную структуру.')
  }
  const value = raw as Partial<HoursDocument>
  const document = emptyHoursDocument()
  if (Array.isArray(value.participants)) document.participants = value.participants
  if (Array.isArray(value.periods)) document.periods = value.periods
  if (Array.isArray(value.assessments)) document.assessments = value.assessments
  return document
}

async function readFromDisk(file: string): Promise<HoursDocument> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyHoursDocument()
    throw new HoursDataError(`Не удалось прочитать файл данных ${file}.`, { cause: error })
  }
  if (text.trim() === '') return emptyHoursDocument()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new HoursDataError(`Файл данных ${file} содержит битый JSON.`, { cause: error })
  }
  return normalizeDocument(parsed)
}

async function writeToDisk(file: string, doc: HoursDocument): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * Общий внутрипроцессный мьютекс: очередь промисов. Все мутации — через неё,
 * поэтому read-modify-write целого документа никогда не перекрывается.
 */
let queue: Promise<unknown> = Promise.resolve()

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  // Хвост очереди не должен «залипнуть» на отказе предыдущей задачи.
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Читает документ с диска. Отсутствующий файл — пустая структура (п.17). */
export async function readHoursDocument(): Promise<HoursDocument> {
  return readFromDisk(resolveDataFile())
}

/**
 * Атомарно применяет мутацию к целому документу. Отказ мутации ничего не пишет
 * на диск; результат (включая warnings) возвращается вызывающему как есть.
 */
export async function mutateHoursDocument<T>(
  mutator: (doc: HoursDocument) => MutationResult<T>,
): Promise<MutationResult<T>> {
  const file = resolveDataFile()
  return withLock(async () => {
    const current = await readFromDisk(file)
    const result = mutator(current)
    if (result.ok) await writeToDisk(file, result.doc)
    return result
  })
}
