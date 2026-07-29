/**
 * Гейты модуля часов (спека 081 пп. 8–10) — чистые предикаты, отделённые от
 * Auth.js-обвязки и от роутов, чтобы правила доступа были юнит-тестируемы без
 * браузера и живого IdP.
 *
 * Два разных решения не путать:
 *   - OIDC-гейт группы `(platform)` (src/lib/platform/authGate.ts) решает,
 *     пускать ли вообще на `/p/*`;
 *   - здесь решается, ЧТО залогиненный может менять: за себя (email сессии) и
 *     администратор ли он (env-allowlist до появления ролей в Zitadel).
 *
 * Fail-closed: незаданная или пустая `HOURS_ADMIN_EMAILS` ⇒ администраторов нет
 * ни у кого. Предикат применяется и к странице админки, и к КАЖДОЙ мутации —
 * на layout не полагаемся (п.11).
 */

/** Минимальный вид сессии Auth.js — достаточный для решения. */
export interface HoursSessionLike {
  user?: { email?: string | null } | null
}

/** lowercase + trim; всё, что не строка, — пустая строка. */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Нормализованный email из сессии. Пустая строка означает «идентифицировать
 * участника нечем»: страницы читаются, любая мутация обязана отказать (п.8).
 */
export function sessionEmail(session: HoursSessionLike | null | undefined): string {
  return normalizeEmail(session?.user?.email)
}

/** Разбирает `HOURS_ADMIN_EMAILS` (comma-separated) в нормализованный список. */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  if (typeof raw !== 'string') return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const email = normalizeEmail(part)
    if (email) seen.add(email)
  }
  return [...seen]
}

/** Админ ли этот email по allowlist'у. Без allowlist'а — никто (fail-closed). */
export function isHoursAdmin(email: unknown, raw: string | undefined | null): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return parseAdminEmails(raw).includes(normalized)
}

/** Оценку можно сохранять только за себя (п.9). Пустая сторона не совпадает. */
export function isOwnEmail(sessionEmailValue: unknown, targetEmail: unknown): boolean {
  const a = normalizeEmail(sessionEmailValue)
  const b = normalizeEmail(targetEmail)
  return a !== '' && a === b
}
