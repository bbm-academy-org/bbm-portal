/**
 * The kit's one utility: join class names, dropping the falsy ones.
 *
 * Deliberately three lines rather than a `clsx` dependency. `src/ui` is the one
 * place in `src/` that may import nothing (spec 311 EARS-458), and a kit whose
 * first act is to add a runtime dependency to the app bundle for string
 * concatenation has spent that budget badly.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
