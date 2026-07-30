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

## Shipping an update

```bash
# Ship `origin/main`, never the local `main` — a stale local checkout is how prod
# silently ends up a merge behind (2026-07-30).
git fetch origin

# Refresh the tree on the host first. `tar -xz` is ADDITIVE — it overwrites but
# NEVER deletes files retired in the branch, so a removed source file (e.g. a
# retired collection) lingers on the host and breaks the type-check. Wipe `src/`
# first, then extract (env files live in deploy/, not src/, so they survive):
ssh portal-prod-tw 'rm -rf ~/bbm-portal/src'
git archive --format=tar.gz origin/main | ssh portal-prod-tw 'tar -xz -C ~/bbm-portal'

# Record WHAT was shipped — the host has no git clone, so the sha must travel
# with the tree. This marker is what the post-check below compares.
git rev-parse origin/main | ssh portal-prod-tw 'cat > ~/bbm-portal/DEPLOYED_SHA'
cd deploy

# Rebuild the app image. If migrations changed, rebuild `migrate` too — it builds
# from the SEPARATE `tooling` target, and a stale tooling image makes the migrate
# step a SILENT no-op (logs "Done." with no "Migrating:" lines).
docker compose -f docker-compose.prod.yml build app migrate

# Apply any new migrations BEFORE the new app starts serving, THEN verify they
# actually landed (the silent-no-op trap above):
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U payload -d cms -c 'SELECT name, batch FROM payload_migrations ORDER BY id;'

# Roll the app. Postgres + volumes persist.
docker compose -f docker-compose.prod.yml up -d app
# If the Caddyfile changed, `up -d caddy` does NOT pick it up (the bind-mounted
# config does not recreate the container, and `caddy reload` reports "config is
# unchanged"). Use a plain restart to reload it:
docker compose -f docker-compose.prod.yml restart caddy

# Optional: re-run the seed (idempotent) if SEED_ADMIN_* changed.
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate pnpm seed:admin
```

## Post-check: prod == `origin/main` (mandatory, task-cycle stage 6)

A deploy is not done because the commands exited 0 — it is done when prod
carries the same commit as `origin/main`. Run this from the workstation right
after `up -d app`; a mismatch means finish shipping, not "noted":

```bash
git fetch origin
PROD=$(ssh portal-prod-tw 'cat ~/bbm-portal/DEPLOYED_SHA')
[ "$PROD" = "$(git rev-parse origin/main)" ] \
  && echo "prod == origin/main ($PROD)" \
  || echo "DRIFT: prod=$PROD origin/main=$(git rev-parse origin/main)"

# The marker proves what was EXTRACTED. Prove the running app carries it too —
# the app container must be newer than the marker file:
ssh portal-prod-tw 'stat -c %Y ~/bbm-portal/DEPLOYED_SHA'
docker compose -f docker-compose.prod.yml inspect app --format '{{.Created}}' \
  2>/dev/null || docker inspect deploy-app-1 --format '{{.Created}}'
```

> TODO: replace the marker+timestamp pair with the app itself reporting its
> build sha (a `/api/health` field baked in at `docker build`) — then the
> post-check is one HTTP call and cannot be fooled by a skipped rebuild.

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
- **Rollback:** rebuild from a previous commit and `up -d app`. Migrations are
  forward-only by policy; coordinate any `migrate:down` manually.
