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
 * **How prod differs, concretely.** The production platform database is reached
 * over the network at a real hostname (`deploy/README.md`; the compose stack
 * names its service, never `localhost`), and CI reaches its service container
 * the same way. No production string in this repo resolves to a loopback host,
 * and no dev string points anywhere else — which is why the host allowlist,
 * rather than the database name alone, is the load-bearing half. The name check
 * is the second lock: `cms` (Payload's own database, on the SAME dev host) must
 * never receive this seed either.
 *
 * **Fail closed, and say why.** Every refusal names the offending part — the
 * marker, the host, or the database — and NEVER echoes the connection string:
 * a refusal message is printed to a session log, and the string carries a
 * password.
 */

/** The markers a deployment sets; any of them reading `production` is a refusal. */
export const PRODUCTION_ENV_MARKERS = ['NODE_ENV', 'VERCEL_ENV', 'APP_ENV', 'DEPLOY_ENV']

/**
 * Where a dev platform database can live.
 *
 * `host.docker.internal` is here because the dev stand's Postgres is reached
 * under that name from inside a container on this box; it is a loopback alias,
 * not a route off the machine.
 */
export const DEV_DATABASE_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']

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
    (marker) => String(env?.[marker] ?? '').trim().toLowerCase() === 'production',
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
  if (!DEV_DATABASE_HOSTS.includes(host)) {
    return {
      ok: false,
      reason:
        `«${host}» is not a known dev host (${DEV_DATABASE_HOSTS.join(', ')}). ` +
        'A platform database reached over the network is a real stand, and this seed writes synthetic data.',
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
 */
export function assertDevPlatformDatabase(connectionString, env = {}) {
  const verdict = classifyDevDatabase(connectionString, env)
  if (!verdict.ok) {
    throw new DevDatabaseRefusal(`refusing to seed: ${verdict.reason}`)
  }
  return { host: verdict.host, database: verdict.database }
}
