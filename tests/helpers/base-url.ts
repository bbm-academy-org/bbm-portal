/**
 * The ONE place the local e2e suite learns where its stand lives (#169).
 *
 * Why this exists. Every local spec used to spell the default localhost origin
 * verbatim and `playwright.config.ts` pinned the same URL with `reuseExistingServer: true`.
 * On this box parallel sessions are the norm (`.claude/rules/parallel-sessions.md`),
 * so a listener on 3000 is usually ANOTHER session's acceptance stand on an
 * unknown branch. The old setup therefore had two failure modes: the suite could
 * not run at all (killing that listener is forbidden), or — run naively — it
 * attached to the neighbour's stand and drove `seedTestUser`/`cleanupTestUser`
 * against the shared dev DB under someone else's acceptance.
 *
 * The parameter, in precedence order:
 *   E2E_BASE_URL   full origin, e.g. `http://localhost:3005` (wins)
 *   E2E_PORT       port on localhost, e.g. `3005` (take one with `pnpm dev:ports`)
 *   neither        localhost on DEFAULT_E2E_PORT — a DEFAULT, not a claim
 *
 * The reuse policy is derived, not configured separately: `reuseExistingServer`
 * is true exactly when the target was named explicitly. Naming a port is the
 * operator asserting "this stand is mine"; saying nothing is not. Hence the
 * default run refuses to attach to whatever answers on 3000 and fails with
 * `portConflictMessage()` instead.
 *
 * Consumers: `playwright.config.ts` (baseURL + webServer) and, through the
 * Playwright `baseURL` option, every spec/helper via RELATIVE paths. Specs must
 * not re-derive an origin of their own — that would be a second source of truth.
 *
 * Pure and dependency-free on purpose: unit-tested in
 * `tests/unit/e2e-base-url.spec.ts`, no network, no `node:` imports.
 */

/** Where `next dev` lands with no PORT — a fallback, never an assertion of ownership. */
export const DEFAULT_E2E_PORT = 3000

/** Bad e2e targeting configuration. Thrown, never swallowed: a misread target is a wrong-stand run. */
export class E2eTargetError extends Error {
  override name = 'E2eTargetError'
}

export interface E2eTarget {
  /** Origin the suite talks to, no trailing slash. */
  baseURL: string
  /** TCP port of `baseURL` (defaulted from the scheme when the URL omits it). */
  port: number
  /** The target was named via E2E_BASE_URL / E2E_PORT rather than defaulted. */
  explicit: boolean
  /** Playwright `webServer.reuseExistingServer` — true only for an explicit target. */
  reuseExistingServer: boolean
}

type Env = Record<string, string | undefined>

const DEFAULT_SCHEME_PORT: Record<string, number> = { 'http:': 80, 'https:': 443 }

/** Trimmed value, or undefined for unset/blank — a blank env var is not a target. */
function read(env: Env, key: string): string | undefined {
  const raw = env[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

function parsePort(raw: string): number {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new E2eTargetError(
      `E2E_PORT must be an integer TCP port in 1-65535, got ${JSON.stringify(raw)}. ` +
        `Take a free port for this session with \`pnpm dev:ports\` (range 3000-3009).`,
    )
  }
  return port
}

/**
 * Resolve the e2e target from the environment. Throws `E2eTargetError` on a
 * malformed or self-contradictory configuration — a run against a guessed
 * origin is worse than no run.
 */
export function resolveE2eTarget(env: Env = process.env): E2eTarget {
  const rawBase = read(env, 'E2E_BASE_URL')
  const rawPort = read(env, 'E2E_PORT')
  const wantedPort = rawPort === undefined ? undefined : parsePort(rawPort)

  if (rawBase !== undefined) {
    const baseURL = rawBase.replace(/\/+$/, '')
    let url: URL
    try {
      url = new URL(baseURL)
    } catch {
      throw new E2eTargetError(
        `E2E_BASE_URL is not a valid absolute URL: ${JSON.stringify(rawBase)}. ` +
          `Expected something like http://localhost:3005.`,
      )
    }
    const port = url.port === '' ? (DEFAULT_SCHEME_PORT[url.protocol] ?? 0) : Number(url.port)
    if (wantedPort !== undefined && wantedPort !== port) {
      throw new E2eTargetError(
        `E2E_BASE_URL and E2E_PORT disagree: ${baseURL} resolves to port ${port}, ` +
          `E2E_PORT says ${wantedPort}. Set one of them, not a contradicting pair.`,
      )
    }
    return { baseURL, port, explicit: true, reuseExistingServer: true }
  }

  if (wantedPort !== undefined) {
    return {
      baseURL: `http://localhost:${wantedPort}`,
      port: wantedPort,
      explicit: true,
      reuseExistingServer: true,
    }
  }

  return {
    baseURL: `http://localhost:${DEFAULT_E2E_PORT}`,
    port: DEFAULT_E2E_PORT,
    explicit: false,
    reuseExistingServer: false,
  }
}

/**
 * What the operator sees when the default port is occupied and nothing was
 * named. Deliberately does NOT repeat Playwright's own advice ("set
 * reuseExistingServer: true"), which is exactly the change that made the suite
 * dangerous here.
 */
export function portConflictMessage(port: number): string {
  return [
    `e2e: port ${port} is already in use and no E2E_PORT / E2E_BASE_URL was given — refusing to run.`,
    ``,
    `On this box a listener on 3000-3009 is usually another session's acceptance stand`,
    `(.claude/rules/parallel-sessions.md). Do NOT kill a listener you did not start.`,
    `Attaching to it silently would be worse: this suite seeds and deletes users in the`,
    `shared dev DB, i.e. under someone else's acceptance.`,
    ``,
    `Take your own port and name it:`,
    `    pnpm dev:ports              # prints a free port in 3000-3009`,
    `    E2E_PORT=<n> pnpm test:e2e  # boots the stand on <n> and tests it`,
    ``,
    `Already have your OWN stand running? Name its port the same way — an explicitly`,
    `named target is reused instead of booted.`,
  ].join('\n')
}
