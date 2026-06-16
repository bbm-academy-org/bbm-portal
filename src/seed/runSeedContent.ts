// Load .env before anything imports payload.config (which reads DATABASE_URL at
// module-eval time). In the Docker tooling image the vars already come from the
// compose env_file, so this is a harmless no-op there.
import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../payload.config'
import { DEFAULT_CONTENT_DIR, seedContent } from './seedContent'

/**
 * CLI entrypoint for the content seed (#24 / BBMP-28).
 *
 * Run via `pnpm seed:content` (→ `tsx src/seed/runSeedContent.ts`). Like
 * `runSeedAdmin.ts`, we invoke tsx directly (not `payload run`) so the file's
 * top-level async work actually executes. The seed logic lives in the
 * importable, side-effect-free `seedContent()` (the content-parity int spec
 * imports it) — keep this file a thin runner only.
 *
 * SEED_CONTENT_DIR overrides the fixtures location (defaults to the sibling
 * `../bbm-public-website/src/content` checkout, the content SSOT).
 */
const contentDir = process.env.SEED_CONTENT_DIR ?? DEFAULT_CONTENT_DIR

getPayload({ config })
  .then((payload) => seedContent(payload, contentDir))
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
