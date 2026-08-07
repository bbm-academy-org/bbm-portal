import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PORT_MAX, PORT_MIN } from '../../tools/dev/dev-ports.mjs'

/**
 * `infra/dev-stand/idp/provision.sh` — the redirect-URI (#93) and post-logout-URI
 * (#170) defaults.
 *
 * What is actually at stake: the dev Zitadel app accepts a login callback only
 * for a URI registered on it. Parallel sessions take a dev-stand port out of
 * 3000–3009 (`pnpm dev:ports`, tools/dev/dev-ports.mjs), so a default that
 * registers port 3000 alone means the NEXT provisioning run silently deletes the
 * other nine ports from the live app and every stand outside 3000 dies at login
 * with `400 invalid_request` — long after boot, where nobody looks.
 *
 * The post-logout set is the same failure one hop later: step 3 PUTs the WHOLE
 * `oidc_config`, so a single-port `postLogoutRedirectUris` default narrows the
 * live 20-URI set to 1 and sign-out stops redirecting on nine ports of ten
 * (#170). Both sets therefore hang off the same port × host axes and the same
 * bounds.
 *
 * The two sources of the range (this script and `pnpm dev:ports`) must therefore
 * agree, which is why the bounds are imported from dev-ports.mjs and not
 * retyped here: a widened prober range with an unwidened IdP registration is the
 * exact failure this pins down.
 *
 * The script is driven through its own `--print-redirect-uris` /
 * `--print-post-logout-uris` paths — the generation runs with no IdP, no PAT and
 * no mutation.
 */

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../infra/dev-stand/idp/provision.sh',
)

const HOSTS = ['localhost', '127.0.0.1']
const PATHS = ['/api/auth/callback/zitadel', '/auth/callback']

/**
 * bash is a hard dependency of the script itself, and CI runs on ubuntu where it
 * always exists — the skip only covers a Windows shell whose PATH has no Git
 * bash, so the assertion is never quietly lost on the enforcing plane.
 */
const hasBash = spawnSync('bash', ['-c', 'exit 0']).error === undefined

/**
 * The seam is hermetic: every `IDP_*` key is stripped from the inherited
 * environment, so a developer who has exported `IDP_REDIRECT_URIS` /
 * `IDP_DEV_PORT_MAX` for a real provisioning run does not get a spuriously red
 * suite. Only the per-case overrides below reach the script.
 */
const AMBIENT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('IDP_')),
) as NodeJS.ProcessEnv

function runPrint(flag: string, env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, flag], {
    encoding: 'utf8',
    env: { ...AMBIENT_ENV, ...env },
  })
}

function printUris(flag: string, env: Record<string, string> = {}): string[] {
  const res = runPrint(flag, env)
  expect(res.status, res.stderr).toBe(0)
  return res.stdout.trim().split('\n')
}

const runPrintRedirectUris = (env: Record<string, string> = {}) =>
  runPrint('--print-redirect-uris', env)
const printRedirectUris = (env: Record<string, string> = {}) =>
  printUris('--print-redirect-uris', env)
const runPrintPostLogoutUris = (env: Record<string, string> = {}) =>
  runPrint('--print-post-logout-uris', env)
const printPostLogoutUris = (env: Record<string, string> = {}) =>
  printUris('--print-post-logout-uris', env)

describe.skipIf(!hasBash)('provision.sh — redirect URI default', () => {
  it('registers every dev-stand port × host × callback path', () => {
    const expected: string[] = []
    for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
      for (const host of HOSTS) {
        for (const path of PATHS) expected.push(`http://${host}:${port}${path}`)
      }
    }

    expect(printRedirectUris().slice().sort()).toEqual(expected.slice().sort())
  })

  it('covers the whole `pnpm dev:ports` range — 10 ports, 40 URIs', () => {
    const uris = printRedirectUris()

    expect(uris).toHaveLength((PORT_MAX - PORT_MIN + 1) * HOSTS.length * PATHS.length)
    // The literal is a deliberate tripwire, NOT a duplicate of the line above.
    // The registration in the LIVE dev IdP is a manual act; widening the prober
    // range in tools/dev/dev-ports.mjs must therefore break a test loudly, so the
    // widening cannot ship without someone re-registering the new URIs (that
    // exact drift is incident #93). Bumping this number is the reminder — do it
    // in the same commit that re-registers the range.
    expect(uris).toHaveLength(40)
    for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
      expect(uris.filter((u) => u.includes(`:${port}/`))).toHaveLength(4)
    }
  })

  it('widens by one variable — no hand-listed literal to edit', () => {
    const uris = printRedirectUris({ IDP_DEV_PORT_MAX: '3011' })

    expect(uris).toHaveLength(48)
    expect(uris).toContain('http://localhost:3011/api/auth/callback/zitadel')
    expect(uris).toContain('http://127.0.0.1:3011/auth/callback')
  })

  it('refuses to continue with an empty generated set', () => {
    // A degenerate range must not print an empty set and exit 0: on a real run
    // that array is PUT to the app and wipes every registered redirect URI.
    const res = runPrintRedirectUris({ IDP_DEV_PORT_MAX: '2999' })

    expect(res.status).not.toBe(0)
    expect(res.stdout.trim()).toBe('')
    expect(res.stderr).toMatch(/EMPTY redirect-URI set/)
  })

  it('lets IDP_REDIRECT_URIS replace the generated set wholesale', () => {
    expect(printRedirectUris({ IDP_REDIRECT_URIS: 'http://a.test/cb,http://b.test/cb' })).toEqual([
      'http://a.test/cb',
      'http://b.test/cb',
    ])
  })
})

describe.skipIf(!hasBash)('provision.sh — post-logout URI default', () => {
  it('registers every dev-stand port × host as a bare origin', () => {
    const expected: string[] = []
    for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
      for (const host of HOSTS) expected.push(`http://${host}:${port}`)
    }

    expect(printPostLogoutUris().slice().sort()).toEqual(expected.slice().sort())
  })

  it('covers the whole `pnpm dev:ports` range — 10 ports, 20 URIs', () => {
    const uris = printPostLogoutUris()

    expect(uris).toHaveLength((PORT_MAX - PORT_MIN + 1) * HOSTS.length)
    // Same deliberate tripwire as the redirect set above, for the same reason:
    // the live registration is a manual act, so widening the prober range must
    // break loudly rather than silently leave the IdP behind (#93, #170).
    expect(uris).toHaveLength(20)
    for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
      expect(uris.filter((u) => u.endsWith(`:${port}`))).toHaveLength(2)
    }
  })

  it('hangs off the same one variable as the redirect set', () => {
    const uris = printPostLogoutUris({ IDP_DEV_PORT_MAX: '3011' })

    expect(uris).toHaveLength(24)
    expect(uris).toContain('http://localhost:3011')
    expect(uris).toContain('http://127.0.0.1:3011')
  })

  it('refuses to continue with an empty generated set', () => {
    // The redirect set is overridden wholesale so its own guard cannot fire
    // first: what is under test is that the post-logout set has a guard of its
    // own. An empty array here is PUT to the app and wipes every registered
    // post-logout URI — the #170 outage, in the opposite direction.
    const res = runPrintPostLogoutUris({
      IDP_REDIRECT_URIS: 'http://a.test/cb',
      IDP_DEV_PORT_MAX: '2999',
    })

    expect(res.status).not.toBe(0)
    expect(res.stdout.trim()).toBe('')
    expect(res.stderr).toMatch(/EMPTY post-logout-URI set/)
  })

  it('lets IDP_POST_LOGOUT_URIS replace the generated set wholesale', () => {
    expect(printPostLogoutUris({ IDP_POST_LOGOUT_URIS: 'http://a.test,http://b.test' })).toEqual([
      'http://a.test',
      'http://b.test',
    ])
  })

  it('keeps the two print flags disjoint — neither prints the other set', () => {
    expect(printRedirectUris().every((u) => u.includes('/callback'))).toBe(true)
    expect(printPostLogoutUris().some((u) => u.includes('/callback'))).toBe(false)
  })
})
