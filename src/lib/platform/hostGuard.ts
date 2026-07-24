// cms.bbm.academy serves CMS / static-site concerns ONLY. Platform modules
// (currently /okr) must never be reachable there — they carry team-member data
// with no auth gate yet and belong on the (not-yet-provisioned) platform host.
// Owner decision, issue #63.
const CMS_HOST = 'cms.bbm.academy'

/**
 * Pure decision for the middleware guard: should this request be blocked (404)?
 * True only when the Host resolves to cms.bbm.academy (exact, case-insensitive,
 * port ignored) AND the path is /okr or under /okr/. Everything else — other
 * hosts (localhost/dev included) and other paths — passes.
 */
export function isOkrBlockedOnHost(host: string | null | undefined, pathname: string): boolean {
  if (!host) return false
  // Strip the port, then a single trailing dot so an absolute-FQDN Host
  // (`cms.bbm.academy.`) can't slip past the exact-match guard.
  const hostname = host.split(':', 1)[0].trim().toLowerCase().replace(/\.$/, '')
  if (hostname !== CMS_HOST) return false
  return pathname === '/okr' || pathname.startsWith('/okr/')
}
