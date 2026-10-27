import { parseDocument } from 'yaml'
import { z } from 'zod'

import { plural } from './derive'
import { BEACON_ID, pathMapSchema, type PathMap } from './schema'

/**
 * YAML text → a validated map, or the list of reasons it is not one (#530).
 *
 * Pure (no I/O) so the page, the tests and any future CLI share one judgement.
 * Two severities, and the split is the contract the file's header promises:
 *
 *   - `errors`   — the page refuses to draw the map and lists them: YAML syntax,
 *                  schema violations, duplicate ids, the reserved id;
 *   - `warnings` — the map draws and carries a badge: more focus tracks than
 *                  `limits.focus_tracks` («фокус переполнен»).
 *
 * A dangling `opens` is neither — it is a «разрыв», drawn by the check mode.
 */

export type ParseResult =
  { ok: true; map: PathMap; warnings: string[] } | { ok: false; errors: string[] }

function formatPath(path: PropertyKey[]): string {
  return path
    .map((segment, i) =>
      typeof segment === 'number' ? `[${segment}]` : `${i === 0 ? '' : '.'}${String(segment)}`,
    )
    .join('')
}

const TYPE_RU: Record<string, string> = {
  array: 'список',
  object: 'набор полей',
  string: 'текст',
  number: 'число',
  boolean: 'да/нет',
  null: 'пустое значение',
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Russian fallback for zod's built-in messages; the schema's own messages win. */
const ruErrors = z.locales.ru().localeError

function formatIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? formatPath(issue.path) : '(корень файла)'
  if (issue.code === 'invalid_type') {
    const input = (issue as { input?: unknown }).input
    if (input === undefined) return `${where}: обязательное поле не заполнено`
    const expected = TYPE_RU[issue.expected] ?? issue.expected
    const got = TYPE_RU[typeOf(input)] ?? typeOf(input)
    return `${where}: ожидается ${expected}, а в файле — ${got}`
  }
  if (issue.code === 'unrecognized_keys') {
    return `${where}: неизвестное поле ${issue.keys.map((k) => `«${k}»`).join(', ')}`
  }
  if (issue.code === 'invalid_union' && 'discriminator' in issue && issue.discriminator) {
    return `${where}: type должен быть одним из obstacle | station | fog`
  }
  return `${where}: ${issue.message}`
}

/** Ids must be unique across the whole map: `opens` may point into another track. */
function crossChecks(map: PathMap): string[] {
  const errors: string[] = []

  const trackIds = new Set<string>()
  for (const track of map.tracks) {
    if (trackIds.has(track.id)) errors.push(`tracks: id трека «${track.id}» повторяется`)
    trackIds.add(track.id)
  }

  const seen = new Map<string, string>()
  map.tracks.forEach((track, t) => {
    track.nodes.forEach((node, n) => {
      const where = `tracks[${t}].nodes[${n}]`
      if (node.id === BEACON_ID) {
        errors.push(`${where}: id «${BEACON_ID}» зарезервирован за маяком`)
        return
      }
      const first = seen.get(node.id)
      if (first) errors.push(`${where}: id «${node.id}» уже занят (${first})`)
      else seen.set(node.id, where)
    })
  })

  return errors
}

export function parsePathMap(source: string): ParseResult {
  const doc = parseDocument(source, { prettyErrors: true })
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((e) => {
        const line = e.linePos?.[0]?.line
        return `YAML: ${e.message.split('\n')[0]}${line ? ` (строка ${line})` : ''}`
      }),
    }
  }

  const data: unknown = doc.toJS()
  if (data === null || data === undefined) {
    return {
      ok: false,
      errors: [
        'файл пуст: нужны как минимум title и beacon.title — пример в content/path-map/README.md',
      ],
    }
  }

  const parsed = pathMapSchema.safeParse(data, { reportInput: true, error: ruErrors })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map(formatIssue) }
  }

  const errors = crossChecks(parsed.data)
  if (errors.length > 0) return { ok: false, errors }

  const warnings: string[] = []
  const focus = parsed.data.tracks.filter((t) => t.status === 'focus').length
  if (focus > parsed.data.limits.focus_tracks) {
    warnings.push(
      `фокус переполнен: в фокусе ${focus} ${plural(focus, 'трек', 'трека', 'треков')} при лимите ${parsed.data.limits.focus_tracks}`,
    )
  }

  return { ok: true, map: parsed.data, warnings }
}
