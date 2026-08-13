/**
 * drizzle-kit entry point for the PLATFORM database (#125).
 *
 * Named `--config` on every `pnpm platform:migrate*` script rather than sitting
 * at the repo root: a root-level `drizzle.config.ts` reads as "the project's
 * drizzle config", and this project has a second, unrelated drizzle inside
 * `@payloadcms/db-postgres` that this file must never be mistaken for.
 *
 * All decisions live in `./config.ts` (pure, unit-tested); this file only binds
 * them to the real environment.
 */
import { defineConfig } from 'drizzle-kit'

import { buildPlatformDrizzleConfig } from './config'

export default defineConfig(buildPlatformDrizzleConfig(process.env))
