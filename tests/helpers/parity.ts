/**
 * Shape-parity assertions shared by the content contract suites (BBMP-28 / #24).
 *
 * Framework-agnostic on purpose: they THROW on mismatch rather than calling a
 * runner's `expect`, so the SAME helper backs the vitest Local-API parity spec
 * AND the Playwright REST parity spec (mixing two runners' `expect` would not
 * work). A thrown error fails either test naturally.
 *
 * Together they stand in for the SITE's `schema.parse(...)` WITHOUT importing
 * the site's Zod schemas into this producer repo. That import would be a
 * wrong-direction dependency: the schemas pull `typograf`/`astro` (the
 * consumer's build-time toolchain), and a backend must not couple to one
 * consumer's validator. So the proof is split by ownership:
 *
 *  - Producer (this repo) proves SHAPE: the REST/Local output equals the golden
 *    fixture leaf-for-leaf, plain text preserved, no nulls (omit-not-null).
 *  - Consumer (bbm-public-website #61) proves VALIDATION: its own schemas parse
 *    the fixtures (its existing content.test.ts). Composed with exact shape
 *    equality here, `schema.parse(<portal REST output>)` holds transitively.
 *
 * The two assertions:
 *  1. `expectSubset(fixture, output)` — every fixture leaf appears identically in
 *     the output (no dropped/renamed/typographed field; plain text preserved).
 *  2. `expectNoNulls(output)` — the output contains no `null` (invariant #6:
 *     "optional means omit, not null"); a `null` would fail the schemas'
 *     non-nullable `.optional()`.
 */

export const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

const fail = (message: string): never => {
  throw new Error(`content parity: ${message}`)
}

const show = (v: unknown): string => {
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 120 ? `${s.slice(0, 117)}…` : s
}

/** Assert every leaf of `expected` (a fixture) appears identically in `actual`. */
export function expectSubset(expected: unknown, actual: unknown, at = '$'): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) fail(`${at} should be an array, got ${show(actual)}`)
    const arr = actual as unknown[]
    if (arr.length !== expected.length) {
      fail(`${at} length ${arr.length} !== expected ${expected.length}`)
    }
    expected.forEach((item, i) => expectSubset(item, arr[i], `${at}[${i}]`))
  } else if (isObject(expected)) {
    if (!isObject(actual)) fail(`${at} should be an object, got ${show(actual)}`)
    for (const key of Object.keys(expected)) {
      expectSubset(expected[key], (actual as Record<string, unknown>)[key], `${at}.${key}`)
    }
  } else if (!Object.is(expected, actual)) {
    fail(`${at} mismatch: expected ${show(expected)}, got ${show(actual)}`)
  }
}

/** Assert `value` contains no `null` anywhere (omit-not-null invariant). */
export function expectNoNulls(value: unknown, at = '$'): void {
  if (value === null) fail(`${at} must not be null`)
  if (Array.isArray(value)) value.forEach((v, i) => expectNoNulls(v, `${at}[${i}]`))
  else if (isObject(value))
    for (const k of Object.keys(value)) expectNoNulls(value[k], `${at}.${k}`)
}
