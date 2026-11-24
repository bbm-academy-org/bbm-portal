# Parallel sessions — worktrees, ports, the shared box

Several agent sessions work in this repo at once, on one machine. The shared checkout is one HEAD and one set of uncommitted changes for everyone, port 3000 is one per machine, and RAM is shared. Four incidents in one week (a force-push over another session's branch that resurrected a deleted one; a subagent switching the branch under a live acceptance stand; the checkout moving to `feat/81` in the middle of the owner's acceptance — «the link does not work») came from exactly here. The rules below are structural, not "be more careful".

## Branches and worktrees

- **A session's work branch lives ONLY in its own worktree.** One command: `pnpm task:worktree <N>` → `.claude/worktrees/<N>` on `<type>/<N>-<slug>` off a fresh `origin/main`. No `git checkout -b` in the shared checkout.
- **The main checkout `C:\Users\sidor\repos\bbm-portal` stays on `main`** and belongs to the lead and the live stands. It never switches branch for a task — switching under a running stand breaks someone else's acceptance, not just a build.
- **Write subagents run only in an isolated worktree** (`isolation: "worktree"` or a `task:worktree` made beforehand). Read agents may use the shared checkout.
- **Never touch another session's worktree or branch.** `git push --force` only on this session's own branch; a branch that is not in your worktree is someone else's by default.
- **Clean up after yourself:** `pnpm worktree:teardown <N>`. It keeps an unmerged branch and warns — that is the protection, not a failure.
- A fresh worktree is empty: **`pnpm install` (~42 s) before the first commit** — no `node_modules`, no tests. Its `ENOTDIR … .git\hooks` line is expected: a linked worktree's `.git` is a file, so `simple-git-hooks` cannot write there and `pnpm install` still exits 0. The pre-commit hook is installed once from the MAIN checkout and is shared by every worktree (git resolves hooks through `commondir`).

## Ports

- **Probe, don't reuse.** The port comes from `pnpm dev:ports` (bind-and-release over 3000–3009) — never bind 3000 blind. Start: `PORT=<n> pnpm dev` (the form `pnpm dev -- -p <n>` does not work here: the `--` reaches Next as a path).
- **Never kill a listener you did not start.** A foreign listener is almost certainly another session's acceptance stand waiting for the owner's verdict. This **overrides** the single-session habit "kill stale processes first": that habit applies only to your own processes on your own port.
- **The e2e suite names its port too:** `E2E_PORT=<n> pnpm test:e2e` (or `E2E_BASE_URL=<origin>`); resolution in `tests/helpers/base-url.ts`. Unnamed, the suite boots ITS OWN stand on 3000 and fails with a hint when 3000 is taken — it never attaches to a foreign stand. A named port is the claim "this stand is mine" and is reused as is: name a foreign one and you break that acceptance, because the suite seeds and deletes users in the shared dev DB (#169).
- **The chosen port is recorded** in the handoff and in an issue comment — the owner opens the right link, the next session sees the slot is taken.
- **TaskStop does not kill node children.** Stop your own stand by its port: `Get-NetTCPConnection -LocalPort <n> | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }` — only a stand this session started.

## The workstation runs no full regression

Full Playwright runs and parallel builds on this shared machine run it out of memory and take other sessions' stands down with it (ds-platform #4202). The full `pnpm test:e2e` suite runs only in CI on the PR head. A local Playwright run executes only the spec(s) the change edits or the journey it drives, with one worker (`--workers=1`, narrowed with `--grep` or a spec path). A session runs one production build at a time, never alongside another build or a Playwright run.

## Platform database and the shared stand

- **Branch, don't share.** A numeric task worktree gets its own platform DB: `pnpm dev:db:branch` inside `.claude/worktrees/<N>` creates `platform_<N>`, writes the worktree `.env` marker `PLATFORM_DATABASE_URL=…/platform_<N>`, prints the connection string, and **migrates and seeds it** (#436). An already-branched DB is refreshed by `pnpm dev:seed` alone; `--no-migrate` / `--no-seed` decline a step deliberately. What the seed writes and what it refuses to touch: [`src/lib/platform/db/README.md`](../../src/lib/platform/db/README.md) → Commands.
- **Two roles since #278.** `dev:db:branch` writes `PLATFORM_MIGRATE_DATABASE_URL` alongside `PLATFORM_DATABASE_URL` when the base stand is split, and creates the branch DB through the MIGRATING role — the application role is `NOCREATEDB` by design. An unsplit stand has no migrating variable; the tools fall back to the application string and say so on stderr. Splitting is one supervised command (`pnpm platform:roles:ensure`, superuser) and affects every session's branch DB on the box (it only adds roles). Canon: the same README → Commands.
- **One migration in flight, repo-wide.** Before `pnpm migrate:create` or `pnpm platform:migrate:generate`, check `gh pr list` for another open PR that adds a migration (`src/migrations/**`, `src/lib/platform/db/**`); if one exists, agree the order with that session — two generated migrations off the same base collide on numbering and snapshot.
- **A stand-capable brief carries an ops log.** A subagent that may touch the shared stand (base Postgres cluster, dev Zitadel, a seed) is told what it must not run (dropping or resetting a database it did not create, `provision.sh`, ad-hoc `psql` writes outside its branch DB) and to append every state-changing command to `<scratchpad>/stand-ops-<N>.log`. The lead reads that log on return, and breakage the session caused is restored in the same session.
- **Teardown removes only proven branch DBs.** `pnpm worktree:teardown <N>` drops `platform_<N>` only when that worktree's `.env` names exactly `platform_<N>`. Without that marker it skips DB cleanup and says why; if the marker exists and the drop fails, teardown stops rather than claim a clean teardown while leaking a database.
