// bbm-portal — `.env` loading for the platform DB tools (#125).
//
// `pnpm platform:*` scripts run as plain `node tools/platform/*.mjs`, which
// reads `process.env` and nothing else. Meanwhile `.env.example`, the platform
// DB README and `config.ts`'s error text all instruct the developer to put
// `PLATFORM_DATABASE_URL` in `.env`, and `drizzle-kit`'s CLI bundles
// `dotenv/config` so the drizzle half of the pipeline honours that. Without this
// helper the two halves disagree: `platform:db:ensure` aborts naming the exact
// variable the developer has already set, and `platform:migrate` never reaches
// the half that would have read it.
//
// `process.loadEnvFile` (Node 22) rather than the `dotenv` dependency: it is the
// same parser `node --env-file` uses, it needs no import, and — the property
// that matters here — it does NOT overwrite a variable already present in the
// environment. So an exported `PLATFORM_DATABASE_URL=… pnpm platform:migrate`
// still wins over `.env`, which is how the dev stand and CI drive these tools.
//
// Never throws. A missing `.env` is the normal state in prod and CI, and a
// malformed one must degrade to "no .env" so the caller's own fail-closed check
// produces the diagnostic instead of a stack trace from the loader.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

/**
 * Load `<cwd>/.env` into `process.env` if it is there.
 *
 * @param {string} [cwd] directory holding the `.env` (default: `process.cwd()`)
 * @returns {{ loaded: boolean, path: string, error?: string }}
 */
export function loadDotEnv(cwd = process.cwd()) {
  const path = resolve(cwd, '.env')
  try {
    process.loadEnvFile(path)
    return { loaded: true, path }
  } catch (err) {
    return { loaded: false, path, error: err?.message ?? String(err) }
  }
}

export function findPrimaryCheckoutRoot(cwd = process.cwd()) {
  const res = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  })
  if (res.status !== 0) return null

  const commonDir = res.stdout.trim()
  if (!commonDir) return null
  return dirname(resolve(cwd, commonDir))
}

export function loadPlatformToolEnv(cwd = process.cwd()) {
  const roots = [cwd]
  const primary = findPrimaryCheckoutRoot(cwd)
  if (primary && resolve(primary) !== resolve(cwd)) roots.push(primary)

  const seen = new Set()
  const results = []
  for (const root of roots) {
    const key = resolve(root).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push(loadDotEnv(root))
  }
  return results
}
