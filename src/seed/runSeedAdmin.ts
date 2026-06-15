// Load .env before anything imports payload.config (which reads DATABASE_URL at
// module-eval time). In the Docker tooling image the vars already come from the
// compose env_file, so this is a harmless no-op there.
import 'dotenv/config'

import { seedAdmin } from './seedAdmin'

/**
 * CLI entrypoint for the prod seed-admin (BBMP-30 deploy).
 *
 * Run via `pnpm seed:admin` (→ `tsx src/seed/runSeedAdmin.ts`). We invoke tsx
 * directly rather than `payload run`: in the Docker tooling image `payload run`
 * imported this module without executing its top-level async work, so the seed
 * silently never ran. tsx runs the file's top-level code reliably. The actual
 * logic lives in the importable, side-effect-free `seedAdmin()` (so tests can
 * import it without a stray process.exit) — keep this file a thin runner only.
 */
seedAdmin()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
