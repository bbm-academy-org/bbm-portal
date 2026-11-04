'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { runPathMapEdit, type PathMapEditOutcome } from '@/lib/path-map/save'
import { pathMapSourceFromEnv } from '@/lib/path-map/source'

/**
 * The one write endpoint of «Карта пути» (#539): one UI edit → one commit to
 * the map's YAML in `bbm-academy-org/path-maps`. A Server Action, like the
 * other `(platform)` mutations (`src/modules/hours/actions.ts`): Next checks
 * the request's Origin against the host (its CSRF guard for actions), and this
 * function asks `auth()` itself — the `/p` layout's gate does not cover an
 * action endpoint (EARS-462). The token stays in the server's env; the client
 * only ever sees the outcome.
 */
export async function savePathMapEditAction(input: unknown): Promise<PathMapEditOutcome> {
  const outcome = await runPathMapEdit({
    session: await auth(),
    input,
    source: pathMapSourceFromEnv(process.env),
  })
  // After a stale refusal the server cache already holds the newer file, so the
  // member's «Перечитать» must not be served the old render either.
  if (outcome.status === 'ok' || outcome.status === 'stale') revalidatePath('/p/path')
  return outcome
}
