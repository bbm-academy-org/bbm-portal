import { buildHealthBody } from '@/lib/platform/health'

/**
 * `GET /api/health` — liveness + build identity of the running app (#137).
 *
 * Answers on BOTH vhosts (`cms.bbm.academy` and `portal.bbm.academy`): the
 * host allowlist treats it as infrastructure, like `/_next/*`, so the deploy
 * smoke can prove each vhost really routes into the freshly deployed container
 * (`src/lib/platform/hostAllowlist.ts`).
 *
 * It lives in the `(payload)` group only because that group owns the `/api/*`
 * segment; a static segment wins over Payload's `/api/[...slug]` catch-all, so
 * this handler answers and Payload never sees the request. It touches neither
 * Payload nor the database on purpose — the check must stay green while the DB
 * is briefly unavailable during a migrate, and must never be a way to probe the
 * CMS without auth.
 *
 * `dynamic = 'force-dynamic'`: the timestamp (and the truth of "this process is
 * answering right now") must not be baked into a static page at build time.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  const body = buildHealthBody({
    sha: process.env.DEPLOY_SHA,
    nowIso: new Date().toISOString(),
  })
  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
