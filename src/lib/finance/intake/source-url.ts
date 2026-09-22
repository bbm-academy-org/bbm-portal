/**
 * From `(source, source_ref, provenance)` to a URL a reader can open (#517,
 * spec 339 §B EARS-535).
 *
 * **Why this is a function and not a column.** A permalink is composed of two
 * halves that age differently: the POST's identity, which is a permanent fact
 * of the row, and the SERVER's address, which is a deployment fact that moves
 * when a self-hosted Mattermost changes origin or a team is renamed. Storing
 * the whole URL would freeze the second half into 47 rows and make a rename a
 * data migration. So the row keeps the identity and this function supplies the
 * address, from `MATTERMOST_ORIGIN` / `MATTERMOST_TEAM`.
 *
 * **Why it runs on the SERVER only.** The screen receives a resolved
 * `sourceUrl` string, never the origin plus the rule: two implementations of
 * one permalink shape is how they start disagreeing, and the browser has no
 * business knowing the env at all.
 *
 * **Three answers, and `null` is one of them.** A ref that is already an
 * http(s) URL — what the request form collects — IS the link and is returned
 * unchanged. A Mattermost ref becomes a permalink. Anything else, including a
 * ref whose source system is unknown and a Mattermost ref on a stand with no
 * origin configured, resolves to nothing: the sheet then shows the ref as text
 * rather than a link that would 404, because a dead link is a worse answer
 * than an honest identifier.
 */

/** What the resolver reads from the environment; a plain record, not `process.env`. */
export type FinanceIntakeSourceUrlEnv = {
  MATTERMOST_ORIGIN?: string
  MATTERMOST_TEAM?: string
}

/** Everything the resolver is allowed to look at. Column names, not a row. */
export type FinanceIntakeSourceUrlInput = {
  source: string
  sourceRef: string | null
  provenance: Record<string, string> | null
}

function trimmed(value: string | undefined | null): string {
  return (value ?? '').trim()
}

/**
 * The Mattermost permalink shape, fixed by the product itself:
 * `<origin>/<team>/pl/<post id>`.
 *
 * The id is the part BEFORE `#`. Migration `0017` writes
 * `<post_id>#<source_item>` for the ten reconstructed rows where one post was
 * split into several intake items — the suffix exists to keep EARS-504's
 * unique index true across those splits, and it is not part of the post's
 * identity. Sending it to Mattermost would produce a 404.
 */
function mattermostPermalink(origin: string, team: string, ref: string): string | null {
  const postId = ref.split('#')[0]?.trim() ?? ''
  if (postId === '' || origin === '' || team === '') return null
  return `${origin.replace(/\/+$/, '')}/${team}/pl/${postId}`
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function sourceRefToUrl(
  input: FinanceIntakeSourceUrlInput,
  env: FinanceIntakeSourceUrlEnv = process.env as FinanceIntakeSourceUrlEnv,
): string | null {
  const ref = trimmed(input.sourceRef)
  if (ref === '') return null
  // A link the submitter pasted is already the answer; nothing composes it.
  if (isHttpUrl(ref)) return ref
  if (trimmed(input.provenance?.source_system) !== 'mattermost') return null
  return mattermostPermalink(trimmed(env.MATTERMOST_ORIGIN), trimmed(env.MATTERMOST_TEAM), ref)
}

/**
 * What to CALL the link on screen — the host, or the system that produced it.
 *
 * A raw permalink is 60 characters of base-32 nobody reads; «Mattermost» says
 * what the reader will find there. For a pasted URL the HOST is the honest
 * label, because the portal has no idea what the site is otherwise.
 */
export function sourceRefLabel(input: FinanceIntakeSourceUrlInput): string | null {
  const ref = trimmed(input.sourceRef)
  if (ref === '') return null
  if (trimmed(input.provenance?.source_system) === 'mattermost') return 'Mattermost'
  if (isHttpUrl(ref)) return new URL(ref).host
  return ref
}
