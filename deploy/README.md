# bbm-portal — production deploy runbook

Deploys the Payload CMS (Next.js 16 standalone) to the dedicated
**`portal-prod-tw`** VPS (Ubuntu 24.04, 2 vCPU / 4 GB RAM, Timeweb ru-2, Zone RF)
as a single `docker compose` stack:

- **`postgres`** — dedicated Postgres 17 (decision #2), internal network only.
- **`app`** — the repo `Dockerfile` (Next.js standalone runtime), fronted by Caddy.
- **`preview`** — Astro SSR live-preview origin for `preview.bbm.academy` (epic #13).
  Pulled from GHCR (built by the site repo), not built here — see _Preview service_.
- **`caddy`** — reverse proxy + automatic Let's Encrypt TLS for `cms.bbm.academy`
  and `preview.bbm.academy`.
- **`migrate`** — profiled one-off tooling job (migrations + admin seed).

Public endpoint: **`https://cms.bbm.academy`** — admin `/admin`, REST `/api`,
GraphQL `/api/graphql`. DNS `cms.bbm.academy` already resolves to this host, so
Caddy provisions the certificate automatically on first start.

All commands below run **from the `deploy/` directory on the host**.

## Prerequisites

1. **Docker Engine + Compose v2** on the host (`docker compose version`).
2. **A swap file.** The Next.js build runs with `--max-old-space-size=8000`
   (~8 GB heap ceiling) but the box has only 4 GB RAM. Without swap the
   `docker build` step is OOM-killed. Create at least 4 GB of swap once:
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
3. **The env files.** Two gitignored files, on the host only — split so the
   postgres container never receives the app's Payload/S3/seed secrets:

   ```bash
   cp .env.prod.example .env.prod          # app + migrate
   # edit: PAYLOAD_SECRET (openssl rand -hex 32), DATABASE_URL,
   #       PLATFORM_DATABASE_URL + PLATFORM_MIGRATE_DATABASE_URL (database
   #         `platform`, two DIFFERENT roles — see Splitting the platform roles),
   #       S3 keys (terraform output portal_media_*), SEED_ADMIN_*.

   cp .env.postgres.example .env.postgres  # postgres container only
   # edit: POSTGRES_USER/PASSWORD/DB — POSTGRES_PASSWORD MUST equal the
   #       password embedded in DATABASE_URL above.

   cp .env.preview.example .env.preview    # preview container only
   # edit: PAYLOAD_PREVIEW_TOKEN — a Users API key as the full Authorization
   #       header value `users API-Key <key>` (see Preview service below).
   ```

   `DATABASE_URL` host is the compose service name `postgres`, not localhost —
   and so is `PLATFORM_DATABASE_URL`'s (see _Platform database_ below). Since
   #278 the two platform strings name two **non-superuser** roles that have to
   exist before the first deploy of that release — _Splitting the platform roles_
   below is the step that creates them.

4. **The code on the host.** Org policy disables repo deploy keys, so the box
   has no `git` clone. Ship the committed tree as an archive from a workstation
   with repo access (`git archive --format=tar.gz <branch> | ssh … tar -xz …`),
   or wire a CI image-push later. The "update" flow below assumes the tree is
   refreshed the same way (not `git pull`) — and note that a bare `tar -xz` onto
   an existing tree cannot delete anything, which is why `pnpm deploy:prod`
   extracts and swaps instead (_How the tree reaches the box_ below).

5. **SSH access to the host.** Everything here — and `pnpm deploy:prod`
   (`tools/deploy/prod.mjs`, override `BBM_PROD_SSH`) — reaches the box through
   the SSH alias **`portal-prod-tw`** and nothing else. **The coordinates behind
   that alias are deliberately not in this repository** (public since 2026-08-14,
   #218): the procedure is public, the address / login user / key are not. They
   live per-machine, the same way the dev stand keeps its own values outside the
   tree (`infra/dev-stand/README.md` → _Secrets — per-machine, outside the synced
   dir_):

   | Where                          | What                                                                                                      |
   | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
   | `~/.bbm-portal/prod-access.md` | the operator's per-machine **working copy**: host address, login user, which key, where the key came from |
   | `~/.ssh/config`                | the live `Host portal-prod-tw` stanza the tooling actually resolves                                       |
   | `~/.ssh/portal-prod-tw`        | the private key itself, mode `600` (`icacls` on Windows)                                                  |

   **Setting up a new machine** from this runbook alone: read the values out of
   `~/.bbm-portal/prod-access.md` (or get them from the owner — they are not
   recoverable from the repo), then write the stanza into `~/.ssh/config`:

   ```
   Host portal-prod-tw
     HostName <host address>
     User <login user>
     IdentityFile ~/.ssh/portal-prod-tw
     IdentitiesOnly yes
   ```

   **The key is not a value — it cannot be read out of a chat, so obtaining it
   is an out-of-band step the repo cannot automate:**

   - **You already have it** (a machine that used to work, or a copy the owner
     handed over out of band): put it at `~/.ssh/portal-prod-tw` and tighten the
     permissions — `chmod 600` on Unix, `icacls` on Windows stripping inheritance
     and leaving only your own account. OpenSSH refuses a key any other principal
     can read.
   - **You have none:** generate a fresh pair **on your own machine**
     (`ssh-keygen -t ed25519 -f ~/.ssh/portal-prod-tw`), send the owner the
     **`.pub`** half only, and ask him to append it to the deploy account's
     `~/.ssh/authorized_keys` on the box. The private half never leaves the
     machine that made it, and no existing operator has to surrender theirs.

   Verify with `ssh portal-prod-tw docker ps`. If `ssh portal-prod-tw` stops
   resolving on a machine that used to work, that block has gone missing from
   `~/.ssh/config` (the key and the `known_hosts` entry normally persist). Two
   cases, and this runbook cannot tell them apart for you:

   - **This machine has `~/.bbm-portal/prod-access.md`** — rewrite the stanza
     from it and you are done.
   - **It does not** (a fresh machine, or the record was never written here) —
     the values are **not** recoverable from this repository. Get them from the
     owner out of band, and write the record down while you have it.

   Either way, don't conclude "no access" and escalate.

   **Where that record lives durably.** `~/.bbm-portal/prod-access.md` is a
   per-machine working copy, not an archive — one laptop's disk is no place for
   the only copy of the coordinates. Their durable home is the private **`bbm`
   ops repo**, the same repo that owns `infra/portal/README.md` and
   `restore-portal.sh` (see _Backups_ below); the per-machine file is a working
   copy of what **belongs** there. Whether that record exists yet is a question
   for the ops repo, not an assumption to act on — creating it under
   `infra/portal/` is tracked there as ops-repo issue 148.

6. **The workspace roles in the prod IdP — a precondition of the release that
   carries the claim gate (#313), not a follow-up.** Since that release every
   path under `/p` (`portal.bbm.academy/p/okr`, `/p/hours`, `/p/admin`) requires
   the Zitadel project role **`platform-user`**, and the cabinet requires
   **`platform-admin`**. Hand-written `/api/p/*/admin/*` route handlers enforce
   the same cabinet role themselves because they pass through no layout. Three
   separate objects have to exist in
   `id.bbm.academy` **before** the release is deployed, for **every** person who
   uses the portal:

   | #   | Object                                           | Missing ⇒                                            |
   | --- | ------------------------------------------------ | ---------------------------------------------------- |
   | 1   | the two project ROLES on the prod project        | nothing to grant; the console offers no role to tick |
   | 2   | **`projectRoleAssertion: true`** on that project | grants exist, the claim never reaches the token      |
   | 3   | a per-user GRANT carrying the roles, per person  | the claim arrives EMPTY                              |

   **Blast radius if any of them is missing: the whole live workspace answers a
   bare HTTP 403** — no copy, no link, nothing to click (that refusal is the
   specced one, D-5). A missing grant and a correct refusal are the SAME screen,
   so the failure is silent: nobody gets an error to report, the surfaces simply
   stop working for everyone at once.

   The procedure is not repeated here — it is
   [`infra/dev-stand/idp/bootstrap.md`](../infra/dev-stand/idp/bootstrap.md)
   §5a, _Prod (`id.bbm.academy`)_. Do **not** point `provision.sh` at prod: it is
   a dev-stand script and also writes the login policy, Login V2 and test users.

   Ordering, both directions: the provisioning steps are additive and safe to run
   **before** the deploy (a role nobody's build reads changes nothing), while
   running them after it means an outage that lasts until they are done. Verify
   after deploying: a granted member signs in and reaches `/p`; an account with
   no grant gets the bare 403 on every `/p` path. A member who was already
   signed in when the release landed is sent through sign-in once and comes back
   with the claim — no cookie-clearing, no support ticket.

> **Node version:** the image bakes Node 22 (`Dockerfile`), so the Payload
> migrate tsx-loader gotcha that bites Node 23/24 on the dev host does **not**
> apply inside Docker.

## Why migrations/seed run as a separate `migrate` service

Repo policy is `push: false`: **migrations are the schema SSOT and must run
against the empty DB before the app serves traffic.** The standalone runtime
image (`runner` stage) contains only `server.js` + traced `node_modules` — it
has **no pnpm, no Payload CLI, no tsx, and no source**, so `pnpm migrate` /
`pnpm seed:admin` cannot run from the `app` container.

The `migrate` service solves this: it builds from the Dockerfile **`tooling`**
target (full `node_modules` + source + pnpm/Node 22, but no `next build` — so it
is fast and needs no build-time swap), shares the network, waits for Postgres
health, and runs `pnpm migrate` by default. It is gated behind the `tools`
profile, so it never starts on a plain `up`. The admin seed reuses the same
service with a command override.

## First deploy (ordered)

First-time provisioning only — an empty box, an empty database, no admin user.
Steady-state updates are `pnpm deploy:prod` (below), which does not repeat any
of this.

```bash
cd deploy

# 1. Build the app image (needs swap — see prerequisites).
docker compose -f docker-compose.prod.yml build

# 2. Apply migrations (starts postgres, waits healthy, runs `pnpm migrate`).
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate

# 3. Seed the first admin user (idempotent — skips if the email exists).
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate pnpm seed:admin

# 4. Start the long-running stack (postgres + app + caddy).
docker compose -f docker-compose.prod.yml up -d

# 5. Verify.
curl -fsS https://cms.bbm.academy/api/access >/dev/null && echo "REST ok"
#   open https://cms.bbm.academy/admin       -> login with SEED_ADMIN_*
#   open https://cms.bbm.academy/api/graphql -> GraphQL playground
docker compose -f docker-compose.prod.yml logs -f caddy   # watch cert issuance
```

Steps 1-3 implicitly start the `postgres` container (the `migrate` service
`depends_on` it). It keeps running, so step 4 reuses it.

## Shipping an update — `pnpm deploy:prod`

**This file no longer describes the update procedure.** It is one command, and
its source of truth is the skill:

```bash
pnpm deploy:prod          # ship origin/main
pnpm deploy:prod --dry-run
```

- **Procedure, gates, rollback, failure modes:**
  [`.claude/skills/run-prod-deploy/SKILL.md`](../.claude/skills/run-prod-deploy/SKILL.md)
- **Executable form:** [`tools/deploy/prod.mjs`](../tools/deploy/prod.mjs)
- **Migrations rule:**
  [`docs/runbooks/migrations-expand-contract.md`](../docs/runbooks/migrations-expand-contract.md)

The script does exactly what the hand-run sequence used to do — ship the tree,
build `app`+`migrate`, migrate before serving, `up -d`, reload Caddy only when
its config actually changed — plus the parts a human reliably skipped: it
refuses a dirty tree or red CI, it proves the RUNNING container carries the
deployed image, it smoke-tests both vhosts, and it cuts a release tag and a
GitHub Deployment record. Keeping a second, hand-written copy of those steps
here is precisely how the two drift apart, so there is not one.

### How the tree reaches the box — extract-and-swap (#264)

`tar -xz` is **additive**: it overwrites and adds, it never deletes. Extracting
the archive onto `~/bbm-portal` therefore cannot express a DELETION — a file
retired in the branch stays on the box forever and is still compiled, because
the image build typechecks the whole extracted tree. That trap is real, not
theoretical: it was first hit on 2026-07-30, and again on 2026-08-18, when a
deploy went red on `TS2307` from two files `main` had already deleted.

The ship step therefore never writes into the live tree. It:

1. extracts the archive into a fresh `~/bbm-portal.next`;
2. copies the box's host-only env files — `deploy/.env` and `deploy/.env.*`,
   minus the `.env.*.example`s the commit ships — into its `deploy/` **by name**
   (nothing else is copied, so a shipped compose file or Caddyfile is never even
   a candidate for being overwritten);
3. **asserts `deploy/.env.prod` is in the new tree** — and aborts if it is not;
4. swaps: `mv bbm-portal bbm-portal.prev && mv bbm-portal.next bbm-portal`,
   asserts `deploy/.env.prod` once more in the live tree, and only THEN drops
   `.prev`.

Before all of that it runs one more statement, which is also its own pipeline
stage (`recoverInterruptedShip`, the first box-touching stage of
`pnpm deploy:prod`): if `~/bbm-portal.prev` carries `deploy/.env.prod` and the
live `~/bbm-portal` does not, the previous tree is put back. That is the state an
interrupted swap leaves, and `.prev` is then the only copy of files that exist
nowhere else.

Consequences worth knowing on the host:

- **The tree is exactly the shipped commit, plus the host-only `deploy/.env*`
  files.** Anything else you leave lying around inside `~/bbm-portal` — including
  a non-`.env` file under `deploy/` — is removed by the next deploy. Put host
  state in a `deploy/.env*` file, or outside the tree entirely (the way the
  backup machinery lives in `/home/deploy/portal-backup` and the cutover dataset
  lives outside `~/bbm-portal`). Docker named volumes are unaffected — they are
  not in the tree.
- **Nothing is destroyed before the new tree is proven.** A broken transfer or a
  missing `.env.prod` aborts with the box exactly as it was, and `~/bbm-portal.prev`
  is never removed while it may hold the only copy of the host-only env files:
  the removal stands after the assert, and the final one also after the swap.
- **`~/bbm-portal.prev` after a failed run** means the swap itself broke: the
  previous tree is whole. Re-running `pnpm deploy:prod` repairs it — its first
  box-touching stage (`recoverInterruptedShip`) restores the tree before the env
  pre-flight reads it. By hand, the equivalent is:

  ```bash
  rm -rf ~/bbm-portal && mv ~/bbm-portal.prev ~/bbm-portal
  ```

  The `rm -rf` is not optional: a swap that broke half-way can leave a PARTIAL
  `~/bbm-portal` behind, and a bare `mv` would then move the previous tree
  _inside_ it.

- **Caddy is RECREATED, not restarted, when its config changed.** `./Caddyfile`
  is a file bind mount, pinned to an inode when the container is created, so
  after a swap the running caddy still holds the previous file. The pipeline's
  `applyCaddy` stage therefore runs `up -d --force-recreate --no-deps caddy`. The
  old inode stays alive (the container's mount holds it) until that recreate, so
  dropping `.prev` never pulls the config out from under a running caddy.

### What replaced the `DEPLOYED_SHA` marker

The old post-check wrote a `DEPLOYED_SHA` file next to the shipped tree and
compared its mtime against the app container's `Created` timestamp. That pair
answered "was a tree extracted, and was a container created after it" — never
"is the code answering requests the code we shipped", so a skipped or failed
rebuild passed it.

The app now reports its own build sha, baked into the image at `docker build`
(`ARG DEPLOY_SHA` → `ENV DEPLOY_SHA`, `image: bbm-portal-app:${DEPLOY_SHA}`):

```bash
curl -s https://cms.bbm.academy/api/health | jq -r .sha
```

The marker file is obsolete; a leftover `~/bbm-portal/DEPLOYED_SHA` on the box
can be deleted.

### Seeding after an update

The admin seed is idempotent and is NOT part of the deploy pipeline. Run it by
hand only when `SEED_ADMIN_*` changed:

```bash
cd deploy && docker compose -f docker-compose.prod.yml --profile tools run --rm migrate pnpm seed:admin
```

## Platform database (`platform`, schema `core`) — #125

The `postgres` container holds **two** databases from this task on: Payload's
`cms`, and the platform's `platform`, reached through its own connection
string(s) in `.env.prod` — the Payload adapter is untouched. Since #278 those
are **two** strings with **two dedicated non-superuser roles**, not Payload's
credentials: `PLATFORM_DATABASE_URL` (application role) and
`PLATFORM_MIGRATE_DATABASE_URL` (migrating role, owner of `core`). Both are
created by the supervised `pnpm platform:roles:ensure` step — _Splitting the
platform roles_ below.

The decision and its alternatives:
[**ADR-004**](../docs/adr/004-platform-persistence-foundation.md). The pipeline's
commands and day-to-day handling:
[`src/lib/platform/db/README.md`](../src/lib/platform/db/README.md). What follows
here is only what is true at the **host** level.

### One-time upgrade step on an EXISTING install — do this before the first deploy

`deploy/.env.prod` is host-only: it is gitignored, it is never shipped (the
deploy carries the box's own `deploy/.env*` across the swap — _How the tree
reaches the box_ above), and **no deploy can add a line to it for you**. A box
installed before this change therefore has neither platform variable, and the
`migrate` service reads its environment from that file.

Since #278 both lines are written by the supervised role-split step below —
_Splitting the platform roles — one supervised step, once per box (#278)_ — and
that step is the only recipe for them on this page. Do not hand-write a
`PLATFORM_DATABASE_URL` carrying Payload's superuser credentials: the roles must
exist first, and a box that already has such a line must have it **edited**, not
appended to.

`pnpm deploy:prod` **checks this for you** before it touches anything: its first
remote stage (`verifyRemoteEnv`) greps `.env.prod` for every variable the release
needs and aborts with the remedy if one is missing — before the tree is shipped,
before the checkpoint is taken, before anything migrates. Without that gate the
same omission would surface much later and much worse: the stack stage runs under
`bash -euo pipefail`, so the platform migration would abort _after_ the dump and
Payload's migration and _before_ `up -d`.

Three consequences at the host level:

- **Nothing to provision inside Postgres by hand** (as distinct from the env line
  above and the role split below). `POSTGRES_DB` in `.env.postgres` still names
  `cms` only. The `platform`
  database itself is created on first migrate by `pnpm platform:db:ensure` (which
  `pnpm platform:migrate` runs first), so a fresh `pgdata` volume needs no
  hand-run `psql` — the same pattern the dev Zitadel uses for its own `zitadel`
  database.
- **`pnpm deploy:prod` applies both pipelines** in its `deployStack` stage, and
  prints both ledgers afterwards. That stage runs **after** `checkpoint`, so a
  platform migration is protected by exactly the same fail-closed dump gate as a
  Payload one.
- **The checkpoint must cover BOTH databases.** See below.

### Splitting the platform roles — one supervised step, once per box (#278)

> **This is the one thing on this page that is NOT run by `pnpm deploy:prod`.**
> Postgres roles are cluster objects: a migration runs as the migrating role, and
> a non-superuser can neither `CREATE ROLE` nor take ownership of a table a
> superuser owns. Provisioning them is therefore an operator step, run once, as
> the container superuser — the same reasoning ADR-004 §5 applied to
> `CREATE DATABASE`, arriving at the opposite answer only because roles cannot be
> created from inside the pipeline at all.

Until #278 the application, `drizzle-kit` and Zitadel all connected to `platform`
as the **container superuser**. A superuser switches off any trigger with one
statement and is exempt from every grant, so the ledger's append-only triggers
protected `core.audit_event` from an accident and from nothing else. After this
step the box carries two roles: an application role that can only **read** the
ledger, and a migrating role that owns `core`.

**Bootstrap order on a box whose tree predates this release** (this is how the
2026-08-21 split was actually run — `ensure-roles.mjs` and the `tooling` image
only reach the box via the deploy, so the step cannot run first): (1) append a
temporary `PLATFORM_MIGRATE_DATABASE_URL` that is a byte-copy of the existing
superuser `PLATFORM_DATABASE_URL` line — this satisfies `verifyRemoteEnv`, and
migration 0007 no-ops with a NOTICE while the roles are absent; (2)
`pnpm deploy:prod` as usual; (3) step 1 below (replace both strings with the
two new role logins); (4) step 2 below (`platform:roles:ensure` — its guards
require the targets to already be the non-superuser names, which is why step 1
comes first); (5) `docker compose -f deploy/docker-compose.prod.yml up -d app`
to recreate the app under the new role. On a box that already carries this
release's tree, steps 1–2 of the runbook before the next deploy are enough —
`verifyRemoteEnv` refuses to ship without `PLATFORM_MIGRATE_DATABASE_URL` in
`.env.prod` either way.

**Step 1 — REPLACE the existing `PLATFORM_DATABASE_URL`, do not append one.**
This box has carried that line since #125 and it names the container superuser
(`payload`). Two lines with the same name would leave the superuser string in
force, and `verifyRemoteEnv` — which greps `^NAME=` — would report the variable
present either way. So the application line is **edited in place** and only the
genuinely new migrating line is appended.

```bash
ssh portal-prod-tw
cd ~/bbm-portal/deploy

cp .env.prod .env.prod.bak-$(date +%F)   # host-only file, no other copy exists
grep -n '^PLATFORM_' .env.prod           # see exactly what is there today

# Pick two strong passwords first (`openssl rand -base64 24`, no `@ : / #`).
# The role names and passwords are read out of these strings — there is no
# separate PLATFORM_*_ROLE variable to keep in sync.
#
# 1a. Replace the one existing line (this rewrites it; it never adds a second):
sed -i 's|^PLATFORM_DATABASE_URL=.*|PLATFORM_DATABASE_URL=postgres://bbm_platform_app:<app-password>@postgres:5432/platform|' .env.prod

# 1b. Append the migrating string only if it is not already there:
grep -q '^PLATFORM_MIGRATE_DATABASE_URL=' .env.prod \
  || echo 'PLATFORM_MIGRATE_DATABASE_URL=postgres://bbm_platform_migrate:<migrate-password>@postgres:5432/platform' >> .env.prod

# 1c. Verify before going further — EXACTLY one of each, and neither names `payload`:
grep -c '^PLATFORM_DATABASE_URL=' .env.prod          # must print 1
grep -c '^PLATFORM_MIGRATE_DATABASE_URL=' .env.prod  # must print 1
grep '^PLATFORM_' .env.prod | grep -c 'payload'      # must print 0
```

**Step 2 — split the cluster, as the superuser.** Idempotent, and safe to run
before or after step 1: the tool **refuses** to touch a role that is the login of
`PLATFORM_SUPERUSER_DATABASE_URL` or of `DATABASE_URL`, and refuses any
pre-existing role the catalog reports as a `SUPERUSER`. A box whose step 1 is not
done yet therefore gets a refusal, not a demoted superuser.

```bash
cd ~/bbm-portal
# PLATFORM_SUPERUSER_DATABASE_URL is passed on the command line for this one run
# and is never written to .env.prod.
docker compose -f deploy/docker-compose.prod.yml --profile tools run --rm \
  -e PLATFORM_SUPERUSER_DATABASE_URL='postgres://payload:<POSTGRES_PASSWORD>@postgres:5432/platform' \
  migrate pnpm platform:roles:ensure
```

It prints the two role names and whether it applied the grants. `core` is handed
to the migrating role and the ledger's `UPDATE`/`DELETE`/`TRUNCATE`/`INSERT` are
revoked from the application role (`SELECT` retained), as is `USAGE` on its
identity sequence. Verify from the box:

```bash
docker compose -f deploy/docker-compose.prod.yml exec postgres \
  psql -U payload -d platform -c \
  "select tableowner from pg_tables where schemaname='core' and tablename='audit_event'"
# expected: platform_migrator
```

### Backups must cover both databases

`pnpm deploy:prod`'s `checkpoint` stage does not dump anything itself: it runs
`/home/deploy/portal-backup/backup-portal.sh` and then **pins every fresh dump
that script left** under this deploy's own S3 key,
`checkpoints/pre-migrate-<UTC>-<sha12>-<dump-filename>`. Retention is inherited
from the nightly's recursive `rclone delete … --min-age 30d`, i.e. **30 days**;
the stage never deletes anything itself.

> **The pinned key gained a `-<dump-filename>` suffix** (it used to end
> `-<sha12>.sql.gz`), because one deploy can now pin more than one dump. If the
> ops repo's `restore-portal.sh` parses that key, `sidorovanthon/bbm#112` must
> cover the new shape — confirm it there rather than assuming.

The pin is a loop over `*.sql.gz`, not a single newest file, precisely so the
second dump appears in the recovery point the moment the box starts producing it.
Coverage is then reported **per database, matched on the dump's filename** — not
by counting files, which any stray second dump would satisfy while `platform`
stayed uncovered.
**The box script currently dumps `cms` only.** Extending it to dump `platform`
too — and the matching restore runbook — is owned by the **`bbm` ops repo**
(`infra/portal/README.md`) and **tracked there** as `sidorovanthon/bbm#112`,
which also covers the off-site backup of both databases. Until it lands, the
checkpoint stage prints a
named `WARNING` on every deploy saying how many dumps it pinned against how many
databases it expects, so the gap is visible in the deploy log rather than
discovered during a restore.

## Preview service (`preview.bbm.academy`, epic #13)

The `preview` service is the Astro SSR live-preview origin: it renders a single
**draft** document with the real site components so editors see unsaved changes.
Unlike `app`, it is **not built here** — it is the code-only image the site repo
publishes to GHCR (`ghcr.io/bbm-academy-org/bbm-site-preview:latest`,
bbm-public-website `Dockerfile.preview`). The image is **public** (non-secret
code) so the host pulls it anonymously — see step 2 for why. It fetches drafts from the CMS
server-to-server over the internal compose network
(`PAYLOAD_API_URL=http://app:3000`, set inline in compose), authenticated with a
**Users API key** carried in `.env.preview` (the only secret). Caddy serves it at
`preview.bbm.academy` with a CSP `frame-ancestors https://cms.bbm.academy` so only
the Payload admin can embed it. DNS `preview.bbm.academy` already resolves to
this host, so Caddy auto-provisions the cert on first start.

**1. Issue the preview token (one-time):** use a **dedicated** `preview@bbm.academy`
user (not a human admin's account) and give it a **self-chosen** API key.
Payload **hides `apiKey` on REST reads**, so an auto-generated key cannot be
read back out — PATCH the user with a key you generate, and use that value:

```bash
KEY=$(openssl rand -hex 32)
# Authenticated as an admin (cookie/JWT), PATCH the dedicated preview user:
curl -sS -X PATCH "https://cms.bbm.academy/api/users/<preview-user-id>" \
  -H 'Content-Type: application/json' -H "Authorization: JWT <admin-jwt>" \
  -d "{\"enableAPIKey\":true,\"apiKey\":\"$KEY\"}"
```

Then put it in `.env.preview` as the FULL Authorization header value — scheme
included, the scheme is the collection slug `users`:

```
PAYLOAD_PREVIEW_TOKEN=users API-Key <the-self-chosen-KEY>
```

Leave it **unquoted** — compose passes the value verbatim, so wrapping it in
quotes makes them part of the header and Payload 401s. The spaces are fine.

- This needs `useAPIKey: true` on the Users collection (shipped) **and** the
  migration that adds the api-key columns applied (see _Shipping an update_) —
  without the migration, key auth 401s on prod.

**2. Make the GHCR package public (one-time) — the host then pulls anonymously,
no registry credential on the box.** This is the chosen path; the image is
non-secret code. Two facts forced it:

- A **GitHub App installation token cannot pull a private, repo-inherited GHCR
  package** — it 404s even with `packages:read` and the correct installation
  scope (a GitHub limitation). So the "clean private, no host cred" path is
  not viable here.
- The org had **both Public and Internal package visibility disabled** by
  policy, so the package could not be made public until that was lifted.

Resolution (one-time, done): enable **Public** package visibility at the org
level (`https://github.com/organizations/bbm-academy-org/settings/packages` —
a capability toggle, **not** a mass-publish), then set visibility on **only**
`bbm-site-preview` to Public. The host now pulls with a plain
`docker compose pull preview` — no `docker login`, no PAT.

   <details><summary>Fallback: keep the package private</summary>

Only if the package must stay private — log the host in once with a PAT that
has `read:packages` (a personal-account credential lives on the box, which is
what we avoided):

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
```

   </details>

**3. Pull + start it, then restart Caddy for the new vhost:**

```bash
cd deploy
docker compose -f docker-compose.prod.yml pull preview
docker compose -f docker-compose.prod.yml up -d preview
# The new preview.bbm.academy vhost was already added to the Caddyfile. Caddy
# will not pick it up on its own: `up -d caddy` won't recreate the container for
# a bind-mounted config change, and `caddy reload` reports "config is unchanged".
# `--force-recreate` rather than `restart`, because since #264 a deploy SWAPS the
# whole tree — a restarted container keeps the pre-swap Caddyfile inode.
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps caddy
curl -fsS -o /dev/null https://preview.bbm.academy/ && echo "preview reachable"
docker compose -f docker-compose.prod.yml logs -f caddy   # watch cert issuance
```

**Updating the preview image** (when the site repo ships a new build): re-pull and
re-create just that container — `docker compose -f docker-compose.prod.yml pull
preview && docker compose -f docker-compose.prod.yml up -d preview`.

## Notes

- **Persistence:** named volumes `pgdata` (database), `caddy_data` (TLS certs),
  `caddy_config`. They survive `down`; do not `down -v` in prod (wipes data).
- **No published DB/app ports:** Postgres is internal-only; the app is reachable
  only through Caddy on 80/443.
- **Rollback:** `pnpm deploy:prod --rollback <sha>` brings up a retained
  `bbm-portal-app:<sha>` image — no rebuild, no migrate, no DB change (retention
  keeps the last 3 sha-tagged images). It is only safe while the previous code
  still runs against the current schema, which is what
  [`docs/runbooks/migrations-expand-contract.md`](../docs/runbooks/migrations-expand-contract.md)
  exists to guarantee. Migrations stay forward-only; `migrate:down` is not the
  production rollback plan.
- **Database backups: nightly off-box, plus a pinned one per deploy.** The box
  runs `/home/deploy/portal-backup/backup-portal.sh` — from cron nightly, and
  from `pnpm deploy:prod`'s fail-closed `checkpoint` stage before any migration.
  Mechanism, retention and the honest caveat are stated once, in
  [`docs/runbooks/migrations-expand-contract.md`](../docs/runbooks/migrations-expand-contract.md);
  the script itself is owned by the **`bbm` ops repo, `infra/portal/README.md`**
  — install and repair happen there, not here. What matters at the host level:
  `pgdata` is still a single named volume with no WAL archiving, so a snapshot is
  not PITR, and the backup writes into `deploy@`'s `$HOME`, not into `/var` (no
  root on this box). Since #125 there are **two** databases to cover — see
  _Platform database_ above.
