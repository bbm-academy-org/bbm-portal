import { z } from 'zod'

import { claimGateResponse, type SessionLike } from '@/lib/platform/authGate'

import { ownWriteOf, primePathMapCache, recordOwnWrite, resetPathMapCache } from './cache'
import { applyEdit, editCommandSchema, type EditCommand } from './edit'
import {
  PathMapConflictError,
  PathMapSourceError,
  type AnyPathMapSource,
  type PathMapOrigin,
} from './source'

/**
 * Saving one UI edit of the map (#539): re-read the file, refuse when it moved
 * since the member loaded it, apply the command (`./edit.ts`), and commit it to
 * the SAME YAML file in `bbm-academy-org/path-maps` with the member's name in
 * the message. Git is the history and the audit trail — no database.
 *
 * Concurrency is optimistic and never forced: the member's page carries the
 * blob sha it was drawn from (`baseSha`); a different sha on the re-read, or a
 * 409/422 on the PUT, is `stale` — the UI asks to re-read and keeps the form.
 */

export const EDIT_DISABLED_REASON = 'редактирование доступно только для живой карты'
export const EDIT_UNKNOWN_VERSION_REASON =
  'версия файла карты неизвестна — обновите страницу, чтобы править'

/**
 * Whether the page offers «Править», and why not (#541 review: the button is
 * never disabled without a reason). Live map with a known blob sha → on.
 */
export function editAvailability(loaded: { origin: PathMapOrigin['kind']; sha: string | null }): {
  enabled: boolean
  reason?: string
} {
  if (loaded.origin !== 'github') return { enabled: false, reason: EDIT_DISABLED_REASON }
  if (!loaded.sha) return { enabled: false, reason: EDIT_UNKNOWN_VERSION_REASON }
  return { enabled: true }
}

/** A commit subject is one line: no title can add a body or forged trailers. */
const COMMIT_MESSAGE_MAX = 200
const COMMIT_SUFFIX = ' (/p/path)'

export type PathMapEditOutcome =
  | { status: 'ok'; sha: string; commit: string; summary: string }
  | { status: 'stale' }
  | { status: 'invalid'; errors: string[] }
  | { status: 'disabled'; reason: string }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string }

/**
 * `<Имя>: <действие> «<название>» (/p/path)` — ONE line of at most 200
 * characters, whatever the name or the titles hold (#541 review): every run
 * of whitespace, line breaks included, is one space, so a title cannot start
 * a commit body or forge a `Co-authored-by:` trailer.
 */
export function commitMessage(actor: string, summary: string): string {
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim()
  const head = `${flat(actor) || 'Участник'}: ${flat(summary)}`
  const room = COMMIT_MESSAGE_MAX - COMMIT_SUFFIX.length
  const body = head.length > room ? `${head.slice(0, room - 1).trimEnd()}…` : head
  return `${body}${COMMIT_SUFFIX}`
}

export async function savePathMapEdit(args: {
  source: AnyPathMapSource
  command: EditCommand
  baseSha: string
  actor: string
}): Promise<PathMapEditOutcome> {
  const { source, command, baseSha, actor } = args
  if (source.kind !== 'github') return { status: 'disabled', reason: EDIT_DISABLED_REASON }

  try {
    const fresh = await source.read()
    let base = fresh
    if (fresh.sha !== baseSha) {
      const own = ownWriteOf(source.origin)
      if (own && own.sha === baseSha) {
        // GitHub's read can lag behind the portal's OWN last write for a
        // moment: that write IS the base the member saw. Only our own write
        // counts — a cached read proves nothing. The PUT's sha check decides.
        base = { ...fresh, content: own.content, sha: own.sha }
      } else {
        // The member is about to «Перечитать»: hand the page the newer file
        // now — unless the read is merely the version our own write replaced
        // (GitHub lagging), which must not roll the cache back.
        if (!own || fresh.sha !== own.parentSha) {
          primePathMapCache(source.origin, { content: fresh.content, sha: fresh.sha })
        }
        return { status: 'stale' }
      }
    }

    const edited = applyEdit(base.content, command)
    if (!edited.ok) return { status: 'invalid', errors: edited.errors }

    const written = await source.write(edited.text, base.sha, commitMessage(actor, edited.summary))
    recordOwnWrite(source.origin, {
      content: edited.text,
      sha: written.sha,
      parentSha: base.sha,
    })
    return { status: 'ok', sha: written.sha, commit: written.commit, summary: edited.summary }
  } catch (error) {
    if (error instanceof PathMapConflictError) {
      // The PUT knows the file moved but not to what: the next read goes to GitHub.
      resetPathMapCache()
      return { status: 'stale' }
    }
    console.error('[path-map] edit not saved:', error)
    return {
      status: 'error',
      message:
        error instanceof PathMapSourceError
          ? error.message
          : 'правка не сохранена — внутренняя ошибка, попробуйте ещё раз',
    }
  }
}

const editRequestSchema = z.strictObject({
  command: editCommandSchema,
  // A git blob sha; only its shape is checked here — GitHub compares it.
  baseSha: z.string().regex(/^[\w-]{1,100}$/, 'неверная версия карты'),
})

/** The member's name for the commit: display name, else the email. */
function actorOf(session: SessionLike | null | undefined): string {
  const user = (session?.user ?? {}) as { name?: unknown; email?: unknown }
  if (typeof user.name === 'string' && user.name.trim()) return user.name
  if (typeof user.email === 'string' && user.email.trim()) return user.email
  return 'Участник'
}

/**
 * The whole server side of one edit, minus `auth()` and the env: the
 * `platform-user` gate (the same as `/p/layout.tsx` — a Server Action endpoint
 * is a boundary of its own, EARS-462), the request shape, then the save.
 */
export async function runPathMapEdit(args: {
  session: SessionLike | null | undefined
  input: unknown
  source: AnyPathMapSource
}): Promise<PathMapEditOutcome> {
  if (claimGateResponse(args.session)) {
    return { status: 'forbidden', message: 'Нет доступа к правке карты — войдите заново' }
  }
  const request = editRequestSchema.safeParse(args.input)
  if (!request.success) {
    return {
      status: 'invalid',
      errors: ['запрос правки не распознан — перечитайте карту и попробуйте ещё раз'],
    }
  }
  return savePathMapEdit({
    source: args.source,
    command: request.data.command,
    baseSha: request.data.baseSha,
    actor: actorOf(args.session),
  })
}
