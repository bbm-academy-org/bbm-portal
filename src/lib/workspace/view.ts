import type {
  InternalWorkspaceEntry,
  OpenableWorkspaceEntry,
  WorkspaceEntry,
  WorkspaceStatusProvider,
} from './contract'
import { entryTarget, isOpenable } from './contract'

/**
 * The launcher's view model (spec 311 §A/§C).
 *
 * Everything a session-dependent decision touches happens HERE, on the server,
 * before any markup exists (D-7): a claim-gated entry the session may not see is
 * absent from the view model, therefore absent from the response body, therefore
 * invisible to «View source». Hiding it with CSS would leak the workspace's
 * inventory to anyone who can press Ctrl+U.
 *
 * The launcher component consumes this and decides nothing.
 */

/** Per-provider deadline (EARS-406, D-6). A module's pulse may be slow; it may not be blocking. */
export const STATUS_DEADLINE_MS = 1000

/** «Does this session hold `claim`?» — supplied by the caller, so this file knows nothing about auth. */
export type ClaimPredicate = (claim: string) => boolean

/** The four tile forms of EARS-468, and the only four. */
export type LauncherTileForm = 'internal' | 'external' | 'admin' | 'planned'

export interface LauncherTile {
  /** Stable react key: the slug for an openable entry, the name for a placeholder (it has no slug). */
  key: string
  form: LauncherTileForm
  name: string
  /** The tile's description slot. What that slot MEANS is the form's business (see the launcher). */
  description: string
  /** Absent for a placeholder — and that absence is the whole of EARS-478. */
  href?: string
  /** The module's resolved pulse, or `null` when there is none to show. */
  status: string | null
}

/**
 * The entries this session may see (EARS-404).
 *
 * A `planned` placeholder carries no `requiredClaim` and is never filtered — it
 * is shown identically to every session that reaches `/p` (EARS-478). The two
 * treatments stay distinct on purpose: a placeholder says «not built yet» to
 * everyone, while a claim-gated entry says nothing at all to anyone who lacks
 * the claim, because it is not in the response.
 */
export function visibleEntries(
  entries: readonly WorkspaceEntry[],
  hasClaim: ClaimPredicate,
): WorkspaceEntry[] {
  return entries.filter((entry) => {
    if (entry.kind === 'planned') return true
    return entry.requiredClaim ? hasClaim(entry.requiredClaim) : true
  })
}

/**
 * What the top-bar switcher offers (EARS-427, EARS-478).
 *
 * The same list, filtered the same way, minus the placeholders — a switcher is a
 * navigation control and a placeholder has nowhere to switch to. That is a
 * difference in what the two surfaces are FOR, not a disagreement about the
 * inventory: both read the one registry, and neither holds a list of its own.
 */
export function switcherEntries(
  entries: readonly WorkspaceEntry[],
  hasClaim: ClaimPredicate,
): OpenableWorkspaceEntry[] {
  return visibleEntries(entries, hasClaim).filter(isOpenable)
}

/**
 * Which registry entry the request is inside (EARS-469): longest matching `href`
 * prefix wins, so `/p/hours/admin` resolves to Часы and not to some entry whose
 * href happens to be a shorter prefix. `/p` itself matches nothing — the home is
 * not an app (EARS-470).
 */
export function currentEntry(
  entries: readonly WorkspaceEntry[],
  pathname: string,
): InternalWorkspaceEntry | null {
  let best: InternalWorkspaceEntry | null = null
  for (const entry of entries) {
    if (entry.kind !== 'internal') continue
    const href = entry.href
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue
    if (!best || href.length > best.href.length) best = entry
  }
  return best
}

/**
 * Run one provider under the deadline, converting every failure into «no line».
 *
 * EARS-407: a provider that rejects, throws or runs long yields no line and the
 * tile renders in its static form. There is deliberately no error surface for
 * this — a module's pulse is a courtesy, and a member who came to open Часы is
 * not served by a red box explaining that a status query timed out.
 *
 * The timer is cleared on both paths: a 1-second handle left pending in a Node
 * server keeps the event loop alive for a second past the render.
 */
export async function resolveStatus(
  provider: WorkspaceStatusProvider,
  deadlineMs: number = STATUS_DEADLINE_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const line = await Promise.race([
      (async () => provider())(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs)
      }),
    ])
    return typeof line === 'string' && line.length > 0 ? line : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The tile form an entry takes (EARS-468). */
export function tileForm(entry: WorkspaceEntry): LauncherTileForm {
  if (entry.kind === 'planned') return 'planned'
  if (entry.kind === 'external') return 'external'
  // A claim-gated INTERNAL entry is the admin form: dashed border, and its
  // description read as the «только администратор» flag. Keying on the presence
  // of a claim rather than on the literal `platform-admin` is what makes
  // EARS-466 true — a further claim introduced later needs no edit here.
  return entry.requiredClaim ? 'admin' : 'internal'
}

/**
 * The whole home, for one session.
 *
 * Every declared provider is invoked CONCURRENTLY (EARS-406): the home costs one
 * slow module, not the sum of them. `Promise.all` is safe here only because
 * `resolveStatus` never rejects — that is the contract that keeps EARS-407's
 * «the remainder of the home is unaffected» true by construction rather than by
 * a try/catch somewhere up the tree.
 */
export async function buildLauncherView(
  entries: readonly WorkspaceEntry[],
  hasClaim: ClaimPredicate,
  deadlineMs: number = STATUS_DEADLINE_MS,
): Promise<LauncherTile[]> {
  const visible = visibleEntries(entries, hasClaim)
  return Promise.all(
    visible.map(async (entry) => ({
      key: entry.kind === 'planned' ? `planned:${entry.name}` : entry.slug,
      form: tileForm(entry),
      name: entry.name,
      description: entry.description,
      href: isOpenable(entry) ? entryTarget(entry) : undefined,
      status:
        entry.kind === 'internal' && entry.status
          ? await resolveStatus(entry.status, deadlineMs)
          : null,
    })),
  )
}
