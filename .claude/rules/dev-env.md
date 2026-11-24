---
paths:
  - 'infra/**'
  - 'deploy/**'
  - 'tools/dev/**'
  - 'tools/deploy/**'
  - 'tools/ops/**'
  - 'tools/platform/**'
  - 'tests/e2e/**'
  - 'tests/helpers/**'
  - 'playwright.config.ts'
  - '.env.example'
  - 'src/auth.ts'
  - 'src/lib/platform/db/**'
---

<!-- READ-ON-DEMAND (`paths:` frontmatter, so not always-on). The frontmatter must stay the first bytes of the file. Indexed in AGENTS.md §0; its two every-session facts (Node 22, `git -C`) are owned by AGENTS.md §4. -->

# Dev env — this Windows box

- **Node 22 in every shell and git only as `git -C <absolute root>`** are
  every-session rules, so they are owned by the always-on `AGENTS.md` §4 — read
  them there.
- **Remote commands with quotes go through Bash, not PowerShell.** PowerShell
  5.1 strips nested quotes when it calls native `ssh.exe`, so `psql -c "…"`, JSON
  bodies and pipes arrive split on the remote side. If `ssh` reports
  "UNPROTECTED PRIVATE KEY FILE" / "bad permissions", lock the key's ACL with
  `icacls <key> /inheritance:r /grant:r "$env:USERDOMAIN\$env:USERNAME:R"` —
  that is a fix, not a missing access.
- **Dev-stand ports: 3000–3009.** The redirect URIs in the dev Zitadel are
  registered for exactly this range (× `localhost`/`127.0.0.1` × both callback
  paths); a stand on another port will come up, but the login fails with
  `400 invalid_request`. The port is taken via `pnpm dev:ports`, the stand is
  started in PowerShell as `$env:PORT = '<n>'; pnpm dev` (not
  `pnpm dev -- -p <n>`). Clear the session override afterwards with
  `Remove-Item Env:PORT`. Bash equivalent: `PORT=<n> pnpm dev`.
- **The range in the provisioning default:** `infra/dev-stand/idp/provision.sh`
  generates both sets from the same bounds — the redirect URIs (port × host ×
  callback path) and the post-logout URIs (port × host, bare origins) — so a
  re-provisioning narrows neither of them (#93, #170). Printing without talking
  to the IdP: `--print-redirect-uris` and `--print-post-logout-uris` (one flag at
  a time; both at once is an error). **Widening the range is not a one-liner**,
  and the full checklist of edits (plus a supervised run at the end)
  deliberately lives in one place:
  [`infra/dev-stand/idp/bootstrap.md`](../../infra/dev-stand/idp/bootstrap.md)
  §6, "Widening the range — the whole checklist". The set counts are not
  duplicated here: their canon is the table in that same §6.
- **The workspace roles** `platform-user` / `platform-admin` — and, since #380,
  the finance flow roles `finance-entry` / `finance-approve` — are seeded by the
  same script and granted to the dev test user by it (steps 2 and 8). Printing
  the set without talking to the IdP: `--print-seed-roles`. What has to be true
  for a member to actually get in — the role, the role assertion and the
  per-user grant are three different objects with one shared symptom — plus the
  **prod** path, which is a supervised step on the owner's explicit
  per-operation go (management API or console, never a `provision.sh` run):
  [`infra/dev-stand/idp/bootstrap.md`](../../infra/dev-stand/idp/bootstrap.md)
  §5a.
- **A full `provision.sh` run is an operation against the live IdP:** it is
  idempotent and no longer narrows the URIs, but it writes to the live dev
  Zitadel (roles, login policy, loginV2, the test user and its project grant).
  Run it deliberately, not "just in case", and ship it from a pinned revision
  (AGENTS.md §4).
- **A long-lived `next dev` process can stop being able to fork — restart it, do
  not debug the app.** Symptom: every `/api/auth/*` request answers `500` with
  `Jest worker encountered 2 child process exceptions, exceeding retry limit`
  while the rest of the stand is fine. In dev, Next runs `generateStaticParams`
  for every DYNAMIC app route in a forked worker (`base-server.js`, unconditional
  — `export const dynamic` does not opt out). The app has three dynamic
  segments — `(platform)/api/auth/[...nextauth]` plus Payload's
  `(payload)/admin/[[...segments]]` and `(payload)/api/[...slug]` — so a fork
  that cannot start takes out whichever of those surfaces gets compiled next:
  in the observed case the sign-in surface, but a 500 on `/admin` is the same
  failure. Observed 2026-08-25 (#313 acceptance): the child exited
  with `3221225794` = `0xC0000142` STATUS_DLL_INIT_FAILED before any JS ran, and
  the same process could no longer spawn even `node -e "process.exit(7)"` with a
  minimal env, while a fresh node on the same box forked fine. It is the PROCESS,
  not the code, not the box: kill that stand's PID and start a new one.
- **Our own dev stand is inside the agent's zone** — the exception to AGENTS.md
  §4's stop-state on another system's credentials. The test users `bbm-test` /
  `bbm-member` are seeded by `infra/dev-stand/idp/provision.sh` itself (steps 2
  and 8); the password lives on truenas in `~/bbm-portal-dev-stand/.env` and
  `~/.bbm-portal/CREDENTIALS.dev.txt`. Reading it to sign in to your own
  acceptance stand is an ordinary task step: the permission is this bullet, do
  not ask again (owner decision, Anton, 2026-09-02 — that day an agent cited the
  stop-state, refused to read its own stand's credentials and halted the
  acceptance). Secrets are still never printed to the session output.
- Parallel sessions, worktrees, the shared box and other sessions' listeners:
  [`parallel-sessions.md`](./parallel-sessions.md).
