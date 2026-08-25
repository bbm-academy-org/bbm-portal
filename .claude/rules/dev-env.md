# Dev env — this Windows box

- **Node 22 is mandatory** (`engines: ^22.22.1`, engine-strict). The system Node
  here is newer, so the first thing in every bash session is:
  `export PATH="$LOCALAPPDATA/node22:$PATH"` — the portable build lives in
  `%LOCALAPPDATA%\node22`. On Node 23/24 the Payload tsx loader breaks
  (`node:crypto?tsx-namespace` ENOENT), and `pnpm patch-commit` refuses to work
  at all.
- **Git — only as `git -C <absolute root>`.** Do not use `cd` in the Bash tool:
  the cwd drifts between calls, and the command ends up in someone else's
  worktree. Every git command names its own tree explicitly.
- **Dev-stand ports: 3000–3009.** The redirect URIs in the dev Zitadel are
  registered for exactly this range (× `localhost`/`127.0.0.1` × both callback
  paths); a stand on another port will come up, but the login fails with
  `400 invalid_request`. The port is taken via `pnpm dev:ports`, the stand is
  started as `PORT=<n> pnpm dev` (not `pnpm dev -- -p <n>`).
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
- **The workspace roles** `platform-user` / `platform-admin` are seeded by the
  same script and granted to the dev test user by it (steps 2 and 8). Printing
  the set without talking to the IdP: `--print-seed-roles`. What has to be true
  for a member to actually get in — the role, the role assertion and the
  per-user grant are three different objects with one shared symptom — plus the
  **prod** path, which is a console step for the operator and never a script
  run: [`infra/dev-stand/idp/bootstrap.md`](../../infra/dev-stand/idp/bootstrap.md)
  §5a.
- **A full `provision.sh` run is an operation against the live IdP:** it is
  idempotent and no longer narrows the URIs, but it writes to the live dev
  Zitadel (roles, login policy, loginV2, the test user and its project grant). Run it deliberately,
  not "just in case".
- Parallel sessions, worktrees and the rules about other sessions' listeners:
  [`parallel-sessions.md`](./parallel-sessions.md).
