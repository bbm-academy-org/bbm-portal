// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { loadDotEnv } from '../../tools/platform/load-env.mjs'

/**
 * `.env` loading for the platform tools (#125, review blocker 1).
 *
 * `.env.example`, `src/lib/platform/db/README.md` and `config.ts`'s own error
 * text all tell the developer to put `PLATFORM_DATABASE_URL` in `.env`. That was
 * only ever true for half the pipeline: `drizzle-kit`'s CLI bundles
 * `dotenv/config`, but `tools/platform/*.mjs` run as plain `node` and read
 * `process.env` alone — so `platform:db:ensure` and `platform:migrate:status`
 * failed on a correctly-configured machine, naming the very variable the
 * developer had just set. The live run that "proved" the pipeline had the value
 * exported into its shell, which is why it hid this.
 *
 * The end-to-end cases below spawn the real tools with a `.env` and assert on
 * the message they print, because the bug was precisely that the file was never
 * consulted — only a real process proves it now is.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENSURE = resolve(REPO_ROOT, 'tools', 'platform', 'ensure-database.mjs')

const temps: string[] = []
function tempDirWith(envContents: string | null) {
  const dir = mkdtempSync(resolve(tmpdir(), 'bbm-load-env-'))
  temps.push(dir)
  if (envContents !== null) writeFileSync(resolve(dir, '.env'), envContents)
  return dir
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe('loadDotEnv', () => {
  it('loads the file and reports the path it used', () => {
    const dir = tempDirWith('BBM_LOAD_ENV_PROBE=from-dotenv\n')
    const result = loadDotEnv(dir)
    expect(result.loaded).toBe(true)
    expect(result.path).toBe(resolve(dir, '.env'))
    expect(process.env.BBM_LOAD_ENV_PROBE).toBe('from-dotenv')
    delete process.env.BBM_LOAD_ENV_PROBE
  })

  it('is a no-op without a `.env` — prod and CI have none, and that is normal', () => {
    const dir = tempDirWith(null)
    expect(loadDotEnv(dir)).toMatchObject({ loaded: false })
  })

  it('never lets a malformed `.env` take the tool down', () => {
    // A parse failure must degrade to "no .env" and let the tool's own
    // fail-closed check produce the diagnostic, rather than surfacing a stack.
    const dir = tempDirWith('\x00not = a valid line\x00')
    expect(() => loadDotEnv(dir)).not.toThrow()
  })
})

describe('the tools read `.env` (end to end)', () => {
  function runEnsure(cwd: string, env: Record<string, string | undefined> = {}) {
    const res = spawnSync(process.execPath, [ENSURE], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PLATFORM_DATABASE_URL: undefined,
        // Cleared for the same reason as the line above: since #278 the ensure
        // step resolves the MIGRATING string first, so a leaked one from the
        // developer's own environment would make every case here talk to a real
        // database instead of the temp directory's `.env`.
        PLATFORM_MIGRATE_DATABASE_URL: undefined,
        ...env,
      },
    })
    return `${res.stdout ?? ''}${res.stderr ?? ''}`
  }

  it('picks PLATFORM_DATABASE_URL up from `.env` instead of failing "not set"', () => {
    // The `cms` URL is used deliberately: the tool refuses it BY NAME, which is
    // a message only reachable once the value was actually read from the file.
    const dir = tempDirWith('PLATFORM_DATABASE_URL=postgres://payload:pw@127.0.0.1:5432/cms\n')
    expect(runEnsure(dir)).toContain('points at `cms`')
  })

  it('still fails closed when neither the environment nor `.env` carries it', () => {
    expect(runEnsure(tempDirWith(null))).toContain('PLATFORM_DATABASE_URL')
  })

  it('#278: the MIGRATING string is what the ensure step uses when the estate is split', () => {
    // Both set, and it is the migrating one the tool refuses by name — the whole
    // point being that `CREATE DATABASE` must not run as the application role.
    const dir = tempDirWith(
      'PLATFORM_DATABASE_URL=postgres://app:pw@127.0.0.1:5432/platform\n' +
        'PLATFORM_MIGRATE_DATABASE_URL=postgres://mig:pw@127.0.0.1:5432/cms\n',
    )
    expect(runEnsure(dir)).toContain('points at `cms`')
  })

  it('#278: an un-split environment falls back to the application string, and says so', () => {
    const dir = tempDirWith('PLATFORM_DATABASE_URL=postgres://payload:pw@127.0.0.1:5432/cms\n')
    const out = runEnsure(dir)
    expect(out).toContain('PLATFORM_MIGRATE_DATABASE_URL is not set')
    expect(out).toContain('points at `cms`')
  })

  it('lets an exported variable win over `.env` — the shell is the override', () => {
    const dir = tempDirWith('PLATFORM_DATABASE_URL=postgres://payload:pw@127.0.0.1:5432/platform\n')
    const out = runEnsure(dir, {
      PLATFORM_DATABASE_URL: 'postgres://payload:pw@127.0.0.1:5432/cms',
    })
    expect(out).toContain('points at `cms`')
  })
})
