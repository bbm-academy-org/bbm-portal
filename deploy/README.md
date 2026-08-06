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
GraphQL `/api/graphql`. DNS `cms.bbm.academy → 201.51.28.190` already resolves,
so Caddy provisions the certificate automatically on first start.

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
   #       S3 keys (terraform output portal_media_*), SEED_ADMIN_*.

   cp .env.postgres.example .env.postgres  # postgres container only
   # edit: POSTGRES_USER/PASSWORD/DB — POSTGRES_PASSWORD MUST equal the
   #       password embedded in DATABASE_URL above.

   cp .env.preview.example .env.preview    # preview container only
   # edit: PAYLOAD_PREVIEW_TOKEN — a Users API key as the full Authorization
   #       header value `users API-Key <key>` (see Preview service below).
   ```

   `DATABASE_URL` host is the compose service name `postgres`, not localhost.

4. **The code on the host.** Org policy disables repo deploy keys, so the box
   has no `git` clone. Ship the committed tree as an archive from a workstation
   with repo access (`git archive --format=tar.gz <branch> | ssh … tar -xz …`),
   or wire a CI image-push later. The "update" flow below assumes the tree is
   refreshed the same way (not `git pull`).

5. **SSH access to the host.** Alias `portal-prod-tw` → `201.51.28.190`, user
   `deploy`, key `~/.ssh/portal-prod-tw`. If `ssh portal-prod-tw` fails to resolve,
   the `Host portal-prod-tw` block has gone missing from `~/.ssh/config` (the key
   and the `known_hosts` entry persist) — restore it by copying another `*-prod-tw`
   block and swapping host/IP/key. Don't conclude "no access" and escalate.

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
the Payload admin can embed it. DNS `preview.bbm.academy → 201.51.28.190` already
resolves, so Caddy auto-provisions the cert on first start.

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
# needs a RESTART to load it — `up -d caddy` won't recreate the container for a
# bind-mounted config change, and `caddy reload` reports "config is unchanged".
docker compose -f docker-compose.prod.yml restart caddy
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
- **Database backups: nightly off-box, plus one per deploy.** A cron at 23:30
  UTC runs `/home/deploy/portal-backup/backup-portal.sh` — `pg_dump` of `cms`
  (gzip) + a tar of the host-only env files → `rclone` to the Timeweb S3 bucket
  `bbm-portal-backups` (30-day S3 retention; the local copy is pruned before each
  write). Freshness is monitored from `mon-prod-tw` with a Grafana alert.
  `pnpm deploy:prod` runs the same script as its fail-closed `checkpoint` stage
  before any migration. The script, its cron and the restore procedure are owned
  by the **`bbm` ops repo, `infra/portal/README.md`** (strategy: `infra/backups.md`)
  — install and repair happen there, not here. Restore was rehearsed on
  2026-08-06. `pgdata` itself is still a single named volume with no WAL
  archiving: a daily snapshot is not PITR, so up to ~24h can be lost between
  snapshots — the pre-migrate checkpoint closes that window only for
  migration-caused damage. The canon above is still the rule.
