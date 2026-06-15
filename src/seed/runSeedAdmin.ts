import { seedAdmin } from './seedAdmin'

/**
 * CLI entrypoint for the prod seed-admin (BBMP-30 deploy).
 *
 * Run via `pnpm seed:admin` (→ `payload run src/seed/runSeedAdmin.ts`).
 * `payload run` loads the Payload config and executes this file's top-level
 * code, so the invocation is unconditional here. The actual logic lives in the
 * importable, side-effect-free `seedAdmin()` (so tests can import it without a
 * stray process.exit) — keep this file a thin runner only.
 */
seedAdmin()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
