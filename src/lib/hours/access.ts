/**
 * Гейты модуля часов (спека 081 пп. 8–10) — чистые предикаты, отделённые от
 * Auth.js-обвязки и от роутов, чтобы правила доступа были юнит-тестируемы без
 * браузера и живого IdP.
 *
 * Два разных решения не путать:
 *   - OIDC-гейт группы `(platform)` (src/lib/platform/authGate.ts) решает,
 *     пускать ли вообще на `/p/*`;
 *   - здесь решается, можно ли сохранять самооценку за указанный email.
 * Административный доступ теперь принадлежит общей роли `platform-admin` и
 * проверяется на каждой кабинетной HTTP-границе.
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

/** Оценку можно сохранять только за себя (п.9). Пустая сторона не совпадает. */
export function isOwnEmail(sessionEmailValue: unknown, targetEmail: unknown): boolean {
  const a = normalizeEmail(sessionEmailValue)
  const b = normalizeEmail(targetEmail)
  return a !== '' && a === b
}
