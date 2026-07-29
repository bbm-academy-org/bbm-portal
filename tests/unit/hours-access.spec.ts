import { describe, expect, it } from 'vitest'

import {
  isHoursAdmin,
  isOwnEmail,
  normalizeEmail,
  parseAdminEmails,
  sessionEmail,
} from '@/lib/hours/access'

/**
 * Гейты модуля часов (спека 081 пп. 8–10). Чистые предикаты: те же функции
 * вызывает и рендер страницы, и КАЖДАЯ серверная мутация — гейт не живёт в
 * layout'е.
 *
 * Fail-closed: пустая или незаданная `HOURS_ADMIN_EMAILS` ⇒ админов нет ни у
 * кого. Сравнение — после нормализации (lowercase + trim).
 */

describe('normalizeEmail', () => {
  it('приводит к lowercase и обрезает пробелы', () => {
    expect(normalizeEmail('  Anton@BBM.Academy  ')).toBe('anton@bbm.academy')
    expect(normalizeEmail('A@B.C')).toBe('a@b.c')
  })

  it('всё, что не строка, — пустая строка (никогда не undefined)', () => {
    expect(normalizeEmail(undefined)).toBe('')
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(42)).toBe('')
    expect(normalizeEmail('   ')).toBe('')
  })
})

describe('sessionEmail', () => {
  it('берёт email из claim сессии Auth.js, нормализуя его', () => {
    expect(sessionEmail({ user: { email: ' Anton@BBM.Academy ' } })).toBe('anton@bbm.academy')
  })

  it('сессия без email — пустая строка (мутации откажут, чтение работает — п.8)', () => {
    expect(sessionEmail(null)).toBe('')
    expect(sessionEmail(undefined)).toBe('')
    expect(sessionEmail({})).toBe('')
    expect(sessionEmail({ user: {} })).toBe('')
    expect(sessionEmail({ user: { email: null } })).toBe('')
  })
})

describe('parseAdminEmails', () => {
  it('разбирает comma-separated список с нормализацией', () => {
    expect(parseAdminEmails(' Anton@bbm.academy , EDUARD@bbm.academy ')).toEqual([
      'anton@bbm.academy',
      'eduard@bbm.academy',
    ])
  })

  it('игнорирует пустые элементы и дубли', () => {
    expect(parseAdminEmails('a@b.c,,  ,a@b.c')).toEqual(['a@b.c'])
  })

  it('пустая или незаданная переменная — пустой список (fail-closed)', () => {
    expect(parseAdminEmails(undefined)).toEqual([])
    expect(parseAdminEmails('')).toEqual([])
    expect(parseAdminEmails('   ')).toEqual([])
    expect(parseAdminEmails(',,,')).toEqual([])
  })
})

describe('isHoursAdmin (fail-closed)', () => {
  const allowlist = 'Anton@bbm.academy, eduard@bbm.academy'

  it('пускает email из allowlist в любом регистре', () => {
    expect(isHoursAdmin('anton@bbm.academy', allowlist)).toBe(true)
    expect(isHoursAdmin('  EDUARD@BBM.academy ', allowlist)).toBe(true)
  })

  it('не пускает никого постороннего', () => {
    expect(isHoursAdmin('someone@bbm.academy', allowlist)).toBe(false)
    expect(isHoursAdmin('anton@evil.example', allowlist)).toBe(false)
  })

  it('без переменной админов нет ни у кого — включая перечисленных', () => {
    expect(isHoursAdmin('anton@bbm.academy', undefined)).toBe(false)
    expect(isHoursAdmin('anton@bbm.academy', '')).toBe(false)
    expect(isHoursAdmin('anton@bbm.academy', '   ')).toBe(false)
  })

  it('сессия без email никогда не админ', () => {
    expect(isHoursAdmin('', allowlist)).toBe(false)
    expect(isHoursAdmin(undefined, allowlist)).toBe(false)
    expect(isHoursAdmin(null, allowlist)).toBe(false)
  })
})

describe('isOwnEmail (п.9 — оценка только за себя)', () => {
  it('сравнивает после нормализации', () => {
    expect(isOwnEmail('Anton@bbm.academy', ' anton@BBM.academy ')).toBe(true)
  })

  it('чужой email отклоняется', () => {
    expect(isOwnEmail('anton@bbm.academy', 'eduard@bbm.academy')).toBe(false)
  })

  it('пустая сторона никогда не совпадает (сессия без email не сохраняет)', () => {
    expect(isOwnEmail('', '')).toBe(false)
    expect(isOwnEmail('anton@bbm.academy', '')).toBe(false)
    expect(isOwnEmail('', 'anton@bbm.academy')).toBe(false)
  })
})
