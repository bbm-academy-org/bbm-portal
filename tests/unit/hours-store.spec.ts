import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { saveAssessment } from '@/lib/hours/document'
import {
  HoursDataError,
  mutateHoursDocument,
  readHoursDocument,
  resolveDataFile,
} from '@/lib/hours/store'
import type { HoursDocument } from '@/lib/hours/types'

/**
 * Хранилище (спека 081 пп. 12, 13, 17): один JSON-документ на диске, путь из
 * `HOURS_DATA_FILE`, чтение на каждый запрос, мутация — read-modify-write целого
 * документа под общим внутрипроцессным мьютексом, запись через tmp + rename.
 *
 * Отсутствующий файл — не ошибка (первый запуск на чистом volume); БИТЫЙ файл —
 * ошибка вслух, и он никогда не перезаписывается молча.
 */

let dir: string
let file: string
const original = process.env.HOURS_DATA_FILE

const seed: HoursDocument = {
  participants: [
    {
      email: 'anton@bbm.academy',
      name: 'Антон',
      role: 'Продукт',
      fork_min: 150_000,
      fork_max: 250_000,
      grade: 'II',
      monthly_rate: 200_000,
    },
    {
      email: 'eduard@bbm.academy',
      name: 'Эдуард',
      role: 'Операции',
      fork_min: 100_000,
      fork_max: 200_000,
      grade: 'I',
      monthly_rate: 150_000,
    },
  ],
  periods: [
    {
      id: 'p-july',
      label: 'Июль 2026',
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      status: 'open',
    },
  ],
  assessments: [],
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bbm-hours-'))
  file = join(dir, 'nested', 'hours.json')
  process.env.HOURS_DATA_FILE = file
})

afterEach(() => {
  if (original === undefined) delete process.env.HOURS_DATA_FILE
  else process.env.HOURS_DATA_FILE = original
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveDataFile', () => {
  it('берёт путь из HOURS_DATA_FILE', () => {
    expect(resolveDataFile({ HOURS_DATA_FILE: file })).toBe(file)
  })

  it('без переменной падает на dev-дефолт data/hours.json от корня процесса', () => {
    const resolved = resolveDataFile({})
    expect(resolved.replace(/\\/g, '/')).toContain('/data/hours.json')
  })

  it('пустая переменная считается незаданной', () => {
    expect(resolveDataFile({ HOURS_DATA_FILE: '   ' }).replace(/\\/g, '/')).toContain(
      '/data/hours.json',
    )
  })
})

describe('readHoursDocument', () => {
  it('отсутствующий файл — пустая структура, модуль работает (п.17)', async () => {
    await expect(readHoursDocument()).resolves.toEqual({
      participants: [],
      periods: [],
      assessments: [],
    })
  })

  it('читает сохранённый документ', async () => {
    await mutateHoursDocument(() => ({ ok: true, doc: seed, warnings: [], saved: null }))
    await expect(readHoursDocument()).resolves.toEqual(seed)
  })

  it('битый JSON — ошибка вслух, файл не перезаписывается (п.17)', async () => {
    await mutateHoursDocument(() => ({ ok: true, doc: seed, warnings: [], saved: null }))
    writeFileSync(file, '{ это не json', 'utf8')

    await expect(readHoursDocument()).rejects.toBeInstanceOf(HoursDataError)
    expect(readFileSync(file, 'utf8')).toBe('{ это не json')
  })

  it('JSON не того вида — тоже ошибка вслух', async () => {
    await mutateHoursDocument(() => ({ ok: true, doc: seed, warnings: [], saved: null }))
    writeFileSync(file, '[1,2,3]', 'utf8')
    await expect(readHoursDocument()).rejects.toBeInstanceOf(HoursDataError)
  })

  it('нормализует email при чтении — ручная правка JSON на хосте штатна (п.16)', async () => {
    await mutateHoursDocument(() => ({ ok: true, doc: seed, warnings: [], saved: null }))
    writeFileSync(
      file,
      JSON.stringify({
        participants: [{ ...seed.participants[0], email: '  Anton@BBM.Academy ' }],
        periods: seed.periods,
        assessments: [
          {
            period_id: 'p-july',
            email: 'ANTON@bbm.academy',
            hours: 160,
            method: 'period',
            weekend_hours: 0,
            split_percent: 0,
            monthly_rate: 200_000,
            hourly_rate: 200_000 / 184,
            accrual: 173_913,
            cash_amount: 173_913,
            invest_amount: 0,
            weekday_count: 23,
            saved_at: '2026-08-01T09:00:00.000Z',
          },
        ],
      }),
      'utf8',
    )
    const doc = await readHoursDocument()
    expect(doc.participants[0].email).toBe('anton@bbm.academy')
    expect(doc.assessments[0].email).toBe('anton@bbm.academy')
  })

  it('недостающие секции дополняются пустыми (документ старой версии)', async () => {
    await mutateHoursDocument(() => ({ ok: true, doc: seed, warnings: [], saved: null }))
    writeFileSync(file, JSON.stringify({ participants: seed.participants }), 'utf8')
    await expect(readHoursDocument()).resolves.toEqual({
      participants: seed.participants,
      periods: [],
      assessments: [],
    })
  })
})

describe('mutateHoursDocument', () => {
  const assessment = {
    periodId: 'p-july',
    method: 'period' as const,
    weekendHours: 0,
    splitPercent: 0,
  }

  beforeEach(async () => {
    await mutateHoursDocument(() => ({ ok: true, doc: seed, warnings: [], saved: null }))
  })

  it('пишет результат и отдаёт его вызывающему', async () => {
    const result = await mutateHoursDocument((doc) =>
      saveAssessment(doc, { ...assessment, email: 'anton@bbm.academy', hours: 160 }, '2026-08-01T09:00:00.000Z'),
    )
    expect(result.ok).toBe(true)
    const persisted = await readHoursDocument()
    expect(persisted.assessments).toHaveLength(1)
    expect(persisted.assessments[0].accrual).toBe(173_913)
  })

  it('отказ мутации ничего не пишет на диск', async () => {
    const before = readFileSync(file, 'utf8')
    const result = await mutateHoursDocument((doc) =>
      saveAssessment(doc, { ...assessment, email: 'stranger@bbm.academy', hours: 10 }, '2026-08-01T09:00:00.000Z'),
    )
    expect(result.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('двое сохранили одновременно — обе записи на месте (п.13)', async () => {
    const [first, second] = await Promise.all([
      mutateHoursDocument((doc) =>
        saveAssessment(doc, { ...assessment, email: 'anton@bbm.academy', hours: 160 }, '2026-08-01T09:00:00.000Z'),
      ),
      mutateHoursDocument((doc) =>
        saveAssessment(doc, { ...assessment, email: 'eduard@bbm.academy', hours: 80 }, '2026-08-01T09:00:01.000Z'),
      ),
    ])
    expect(first.ok && second.ok).toBe(true)

    const persisted = await readHoursDocument()
    expect(persisted.assessments).toHaveLength(2)
    expect(persisted.assessments.map((a) => a.email).sort()).toEqual([
      'anton@bbm.academy',
      'eduard@bbm.academy',
    ])
  })

  it('не оставляет за собой временных файлов (запись через tmp + rename)', async () => {
    await mutateHoursDocument((doc) =>
      saveAssessment(doc, { ...assessment, email: 'anton@bbm.academy', hours: 10 }, '2026-08-01T09:00:00.000Z'),
    )
    expect(readdirSync(join(dir, 'nested'))).toEqual(['hours.json'])
  })

  it('битый файл не даёт мутировать вслепую — сначала ошибка', async () => {
    writeFileSync(file, 'сломано', 'utf8')
    await expect(
      mutateHoursDocument((doc) =>
        saveAssessment(doc, { ...assessment, email: 'anton@bbm.academy', hours: 10 }, '2026-08-01T09:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(HoursDataError)
    expect(readFileSync(file, 'utf8')).toBe('сломано')
  })
})
