import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PORT_MAX, PORT_MIN } from '../../tools/dev/dev-ports.mjs'

/**
 * `infra/dev-stand/idp/provision.sh` — the redirect-URI default (#93).
 *
 * What is actually at stake: the dev Zitadel app accepts a login callback only
 * for a URI registered on it. Parallel sessions take a dev-stand port out of
 * 3000–3009 (`pnpm dev:ports`, tools/dev/dev-ports.mjs), so a default that
 * registers port 3000 alone means the NEXT provisioning run silently deletes the
 * other nine ports from the live app and every stand outside 3000 dies at login
 * with `400 invalid_request` — long after boot, where nobody looks.
 *
 * The two sources of the range (this script and `pnpm dev:ports`) must therefore
 * agree, which is why the bounds are imported from dev-ports.mjs and not
 * retyped here: a widened prober range with an unwidened IdP registration is the
 * exact failure this pins down.
 *
 * The script is driven through its own `--print-redirect-uris` path — the
 * generation runs with no IdP, no PAT and no mutation.
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

function printRedirectUris(env: Record<string, string> = {}): string[] {
  const res = spawnSync('bash', [SCRIPT, '--print-redirect-uris'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  expect(res.status, res.stderr).toBe(0)
  return res.stdout.trim().split('\n')
}

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

  it('lets IDP_REDIRECT_URIS replace the generated set wholesale', () => {
    expect(printRedirectUris({ IDP_REDIRECT_URIS: 'http://a.test/cb,http://b.test/cb' })).toEqual([
      'http://a.test/cb',
      'http://b.test/cb',
    ])
  })
})
