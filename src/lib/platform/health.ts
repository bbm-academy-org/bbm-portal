/**
 * Build identity of the running app — the anchor of the deploy pipeline's
 * truthful-success gate (task 7.6, #137).
 *
 * Before this, `deploy/README.md` proved "prod == origin/main" by writing a
 * `DEPLOYED_SHA` marker file next to the shipped tree and comparing its mtime
 * against the app container's `Created` timestamp. That pair answers "was a
 * tree extracted, and was a container created after it" — NOT "is the code
 * answering requests the code we shipped". A skipped rebuild, a build that
 * failed after the extract, or a container recreated for an unrelated reason
 * all fooled it. The runbook carried its own TODO to replace it with the app
 * reporting its own build sha; this module is that replacement.
 *
 * The sha is baked into the image at `docker build` time (`ARG DEPLOY_SHA` →
 * `ENV DEPLOY_SHA` in the `runner` stage, `deploy/docker-compose.prod.yml`
 * passes it as a build arg), so it is a property of the IMAGE — it cannot be
 * set by whoever restarts the container, and it travels with a rollback to an
 * older SHA-tagged image.
 *
 * Fail-closed: an image built without the arg reports `sha: null`. Never a
 * placeholder string — `pnpm deploy:smoke --expect-sha <sha>` compares for
 * equality, and a placeholder is exactly the value a sloppy comparison would
 * let through.
 */

/** The one path the route handler mounts and the smoke checks request. */
export const HEALTH_PATH = '/api/health'

/** A git commit sha: 7–40 hex chars (7 is git's own short-sha floor). */
const SHA_RE = /^[0-9a-f]{7,40}$/i

/**
 * Normalize the raw `DEPLOY_SHA` env value into a commit sha, or `null` when it
 * is absent / not a sha (an unbuilt local run, or the `:local` fallback tag).
 */
export function resolveBuildSha(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim()
  if (!SHA_RE.test(value)) return null
  return value.toLowerCase()
}

export type HealthBody = {
  status: 'ok'
  sha: string | null
  time: string
}

/**
 * The health payload. Pure — the caller injects the clock, so the shape is
 * unit-testable without freezing time.
 */
export function buildHealthBody({
  sha,
  nowIso,
}: {
  sha: string | undefined | null
  nowIso: string
}): HealthBody {
  return { status: 'ok', sha: resolveBuildSha(sha), time: nowIso }
}
