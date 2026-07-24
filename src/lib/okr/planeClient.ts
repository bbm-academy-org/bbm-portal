import { OKR_PROJECTS, OKR_WORKSPACE, planeApiBaseUrl, planeApiToken } from './config'
import type { PlaneIssue, PlaneModule, PlaneProject, PlaneProjectSlice, PlaneState } from './types'

/**
 * Read-only Plane REST client (PRD §5.1). Strictly GET — the dashboard is a
 * consumer, Plane stays the single master (§5.3).
 */

export class PlaneApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'PlaneApiError'
  }
}

interface PaginatedResponse<T> {
  results: T[]
  next_cursor: string | null
  next_page_results: boolean
}

async function planeGet<T>(path: string): Promise<T> {
  const token = planeApiToken()
  if (!token) {
    throw new PlaneApiError('PLANE_API_TOKEN is not set — the OKR module cannot read Plane')
  }
  const url = `${planeApiBaseUrl()}${path}`
  const res = await fetch(url, {
    headers: { 'X-API-Key': token },
    // The module keeps its own TTL snapshot (cache.ts); Next must not add a second layer.
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new PlaneApiError(`Plane API ${res.status} on ${path}`, res.status)
  }
  return (await res.json()) as T
}

/** Follows Plane cursor pagination until exhausted. */
async function planeGetAll<T>(path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?'
  const all: T[] = []
  let cursor: string | null = null
  for (;;) {
    const page: PaginatedResponse<T> = await planeGet(
      `${path}${sep}per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
    all.push(...page.results)
    if (!page.next_page_results || !page.next_cursor) return all
    cursor = page.next_cursor
  }
}

const ws = `/workspaces/${OKR_WORKSPACE}`

export async function fetchProjectSlice(projectId: string): Promise<PlaneProjectSlice> {
  const base = `${ws}/projects/${projectId}`
  const [project, modules, states] = await Promise.all([
    planeGet<PlaneProject>(`${base}/`),
    planeGetAll<PlaneModule>(`${base}/modules/`),
    planeGetAll<PlaneState>(`${base}/states/`),
  ])
  const issuesByModule: Record<string, PlaneIssue[]> = {}
  await Promise.all(
    modules.map(async (m) => {
      issuesByModule[m.id] = await planeGetAll<PlaneIssue>(`${base}/modules/${m.id}/module-issues/`)
    }),
  )
  return { projectId, project, modules, issuesByModule, states }
}

export interface OkrSource {
  /** Slices for the configured projects that were actually readable. */
  slices: Map<string, PlaneProjectSlice>
  /** FR-7: configured projects Plane did not return → warning + «не определено» node. */
  missingProjects: string[]
}

/**
 * Fetches all configured DSG projects. A single unreadable project degrades to
 * a warning (FR-7); a fully unreachable Plane throws so the caller can fall
 * back to the stale snapshot.
 */
export async function fetchOkrSource(): Promise<OkrSource> {
  const slices = new Map<string, PlaneProjectSlice>()
  const missingProjects: string[] = []
  const results = await Promise.allSettled(
    OKR_PROJECTS.map(async (p) => ({ p, slice: await fetchProjectSlice(p.projectId) })),
  )
  for (const r of results) {
    if (r.status === 'fulfilled') {
      slices.set(r.value.p.projectId, r.value.slice)
    }
  }
  if (slices.size === 0) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    throw first ? first.reason : new PlaneApiError('Plane returned no OKR projects')
  }
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') missingProjects.push(OKR_PROJECTS[i].ident)
  }
  return { slices, missingProjects }
}
