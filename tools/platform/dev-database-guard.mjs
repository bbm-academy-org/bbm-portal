#!/usr/bin/env node
/**
 * «Is this a dev platform database?» — the one predicate `pnpm dev:seed` writes
 * behind (#436).
 *
 * The seed's whole job is to put dozens of synthetic people, synthetic requests
 * and synthetic ledger operations into a database. Doing that once against a
 * real book is not a bug that gets fixed by a later commit, so this file is
 * deliberately the boring, closed half of the feature: it recognises the small
 * set of URLs that ARE dev stands and refuses everything else, including
 * everything it merely fails to understand.
 *
 * **Two independent locks, both required.**
 *
 *  1. the environment must not be marked production — the same four markers
 *     `tools/platform/finance-acceptance-seed.ts` already refuses on
 *     (`NODE_ENV`, `VERCEL_ENV`, `APP_ENV`, `DEPLOY_ENV`), so a stand and a
 *     deployment do not disagree about what «production» means;
 *  2. the URL must name a **dev host** and a database in the **platform
 *     family** — `platform` itself, or a per-worktree branch `platform_<N>`
 *     (`tools/platform/branch-database.mjs`).
 *
 * **How prod differs, concretely.** Production reaches Postgres by the compose
 * SERVICE NAME — `postgres://bbm_platform_app:…@postgres:5432/platform`
 * (`deploy/.env.prod.example`) — a bare hostname resolvable only inside the
 * production network. This box's dev stand, by contrast, answers on
 * `192.168.1.115:5444` and CI's on loopback. So the host test is not an
 * allowlist of known dev machines (which would have refused this very box) but
 * the class «cannot be a routable production endpoint»: loopback, a private
 * address literal, or one of the reserved never-routable name suffixes. The
 * database name is the second lock, and it is not redundant: `cms` — Payload's
 * own database — lives on the SAME dev host and must never receive this seed.
 *
 * **Fail closed, and say why.** Every refusal names the offending part — the
 * marker, the host, or the database — and NEVER echoes the connection string:
 * a refusal message is printed to a session log, and the string carries a
 * password.
 */

/** The markers a deployment sets; any of them reading `production` is a refusal. */
export const PRODUCTION_ENV_MARKERS = ['NODE_ENV', 'VERCEL_ENV', 'APP_ENV', 'DEPLOY_ENV']

/**
 * The names that always mean «this machine».
 *
 * `host.docker.internal` is here because the dev stand's Postgres is reached
 * under that name from inside a container on this box; it is a loopback alias,
 * not a route off the machine.
 */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']

/**
 * Private IPv4 space — RFC 1918, loopback, link-local and the CGNAT block a
 * mesh VPN hands out. An address in here cannot be a routable production
 * endpoint, which is the whole reason it is the accepted class.
 */
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
]

/** ULA and link-local IPv6, plus loopback. */
const PRIVATE_IPV6 = [/^::1$/i, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i]

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Is this host one the seed may write to?
 *
 * The accepted class is «cannot be production», not «is on an allowlist», and
 * the distinction is what makes the guard survive the estate it runs in: this
 * box's own dev stand answers on `192.168.1.115:5444`, while PRODUCTION reaches
 * Postgres by the compose SERVICE NAME `postgres`
 * (`deploy/.env.prod.example`) — a bare name, resolvable only inside the
 * production network. So a bare hostname is refused and an address literal in
 * private space is accepted, which is exactly the right way round.
 */
export function isDevDatabaseHost(host) {
  const normalized = String(host ?? '')
    .trim()
    .toLowerCase()
  if (normalized === '') return false
  if (LOOPBACK_HOSTS.includes(normalized)) return true
  if (IPV4.test(normalized)) {
    const octets = normalized.split('.').map(Number)
    if (octets.some((octet) => octet > 255)) return false
    return PRIVATE_IPV4.some((range) => range.test(normalized))
  }
  if (normalized.includes(':')) return PRIVATE_IPV6.some((range) => range.test(normalized))
  // A NAME. Only the reserved, never-routable suffixes (RFC 2606 / RFC 6762);
  // a bare `postgres` — production's own spelling — falls through to a refusal.
  //
  // `.internal` is deliberately NOT here (review of PR #451): it is reserved
  // nowhere, and it is how several hosting stacks spell PRIVATE PRODUCTION DNS.
  // The database-name lock is no help there — production's database is also
  // called `platform` (`deploy/.env.prod.example`) — so accepting it left the
  // env marker as the only lock, on a class of names that means the opposite of
  // «dev». `host.docker.internal` is unaffected: it is matched exactly, by
  // LOOPBACK_HOSTS, above.
  //
  // `.local` stays. It is mDNS (RFC 6762), resolvable only on the link, and it
  // is the spelling THIS estate's reference recipe uses for the dev stand's
  // Postgres host — `truenas.local:${POSTGRES_PORT}` in
  // `infra/dev-stand/compose.core.yml`. Refusing it would refuse a real dev
  // stand; refusing `.internal` refuses nothing that exists here.
  return /\.(local|localhost|test|invalid|example)$/.test(normalized)
}

/** `platform`, or a per-worktree branch database `platform_<N>` with N ≥ 1. */
export const DEV_DATABASE_NAME_RE = /^platform(_[1-9][0-9]*)?$/

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:'])

/** A database this guard refuses to let the seed write to. */
export class DevDatabaseRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = 'DevDatabaseRefusal'
  }
}

function productionMarker(env) {
  return PRODUCTION_ENV_MARKERS.find(
    (marker) =>
      String(env?.[marker] ?? '')
        .trim()
        .toLowerCase() === 'production',
  )
}

/**
 * Classify a connection string. Never throws — `{ ok: false, reason }` is the
 * answer for every input, including the ones that are not URLs at all.
 */
export function classifyDevDatabase(connectionString, env = {}) {
  const marker = productionMarker(env)
  if (marker !== undefined) {
    return {
      ok: false,
      reason:
        `${marker}=production — representative dev data is never seeded into a ` +
        'production environment, whatever the connection string says.',
    }
  }

  const raw = String(connectionString ?? '').trim()
  if (raw === '') {
    return {
      ok: false,
      reason:
        'PLATFORM_DATABASE_URL is empty. The seed refuses to guess a target; ' +
        'run `pnpm dev:db:branch` in this worktree first.',
    }
  }

  let url
  try {
    url = new URL(raw)
  } catch {
    return {
      ok: false,
      reason:
        'PLATFORM_DATABASE_URL is not a parseable URL, so the seed cannot tell ' +
        'which database it would write to. Refusing rather than guessing.',
    }
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `«${url.protocol}» is not a Postgres connection scheme; the platform database is Postgres.`,
    }
  }

  // `URL` keeps the brackets of an IPv6 authority; the allowlist holds bare hosts.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!isDevDatabaseHost(host)) {
    return {
      ok: false,
      reason:
        `«${host}» is not a dev host: only loopback, a private address literal and the ` +
        'reserved never-routable name suffixes are accepted (`.internal` is not one of them — ' +
        'it is how private production DNS is spelled). Production reaches Postgres by its ' +
        'compose service name, so a bare hostname is refused by design.',
    }
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!DEV_DATABASE_NAME_RE.test(database)) {
    return {
      ok: false,
      reason:
        `database «${database}» is outside the dev platform family ` +
        '(`platform`, or a worktree branch `platform_<N>`). Nothing else is seeded — ' +
        "Payload's own `cms` lives on this same host.",
    }
  }

  return { ok: true, host, database }
}

/**
 * The same decision as a gate: the classified target, or a `DevDatabaseRefusal`
 * whose message names the offending part and never the connection string.
 *
 * @param {unknown} connectionString
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ host: string, database: string }}
 */
export function assertDevPlatformDatabase(connectionString, env = {}) {
  const verdict = classifyDevDatabase(connectionString, env)
  if (!verdict.ok) {
    throw new DevDatabaseRefusal(`refusing to seed: ${verdict.reason}`)
  }
  return { host: String(verdict.host), database: String(verdict.database) }
}
