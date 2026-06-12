import type { CollectionAfterReadHook, GlobalAfterReadHook } from 'payload'

/**
 * Recursively drop "empty" values so every API surface mirrors the site's
 * fixture shape, where an absent optional field is OMITTED — never returned as
 * `null` / `{}` / `[]`.
 *
 * WHY: the consumer (`bbm-public-website`) validates each surface with Zod
 * schemas whose optionals are `T | undefined` — NOT nullable. A Payload `null`
 * (an unset textarea / group / relationship), an all-empty group
 * (`nextStep: { label: null }`), or a default `[]` would fail `.optional()` or a
 * required inner field. Stripping `null`/`undefined` and the empty containers
 * they leave behind makes "optional means omit" hold (spec invariant #6).
 *
 * Empty STRINGS are preserved on purpose: a few REQUIRED prose tokens are
 * legitimately `""` (e.g. `philosophy.roles[].extra` for roles with no royalty),
 * and the contract requires them present. Dropping `""` would break `parse`.
 */
function clean(value: unknown): unknown {
  // Dates (createdAt/updatedAt) are objects with no own enumerable keys — guard
  // them so they are not mistaken for an empty object and dropped mid-traversal.
  if (value instanceof Date) return value

  if (Array.isArray(value)) {
    const out = value.map(clean).filter((v) => v !== undefined)
    return out.length > 0 ? out : undefined
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = clean(raw)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  if (value === null) return undefined
  return value
}

/** afterRead for collections — replace the doc with its emptiness-stripped shape. */
export const omitEmptyCollection: CollectionAfterReadHook = ({ doc }) =>
  (clean(doc) as typeof doc | undefined) ?? doc

/** afterRead for globals — same, for singletons. */
export const omitEmptyGlobal: GlobalAfterReadHook = ({ doc }) =>
  (clean(doc) as typeof doc | undefined) ?? doc
