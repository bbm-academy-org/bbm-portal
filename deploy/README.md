# bbm-portal — production deploy runbook

Deploys the Payload CMS (Next.js 16 standalone) to the dedicated
**`portal-prod-tw`** VPS (Ubuntu 24.04, 2 vCPU / 4 GB RAM, Timeweb ru-2, Zone RF)
as a single `docker compose` stack:

- **`postgres`** — dedicated Postgres 17 (decision #2), internal network only.
- **`app`** — the repo `Dockerfile` (Next.js standalone runtime), fronted by Caddy.
- **`caddy`** — reverse proxy + automatic Let's Encrypt TLS for `cms.bbm.academy`.
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
   ```
   `DATABASE_URL` host is the compose service name `postgres`, not localhost.

4. **The code on the host.** Org policy disables repo deploy keys, so the box
   has no `git` clone. Ship the committed tree as an archive from a workstation
   with repo access (`git archive --format=tar.gz <branch> | ssh … tar -xz …`),
   or wire a CI image-push later. The "update" flow below assumes the tree is
   refreshed the same way (not `git pull`).

> **Node version:** the image bakes Node 22 (`Dockerfile`), so the Payload
> migrate tsx-loader gotcha that bites Node 23/24 on the dev host does **not**
> apply inside Docker.

## Why migrations/seed run as a separate `migrate` service

Repo policy is `push: false`: **migrations are the schema SSOT and must run
against the empty DB before the app serves traffic.** The standalone runtime
image (`runner` stage) contains only `server.js` + traced `node_modules` — it
has **no pnpm, no Payload CLI, no tsx, and no source**, so `pnpm migrate` /
`pnpm seed:admin` cannot run from the `app` container.

The `migrate` service solves this: it builds from the Dockerfile **`builder`**
target (full `node_modules` + source + Node 22), shares the same `env_file` and
network, waits for Postgres health, and runs `pnpm migrate` by default. It is
gated behind the `tools` profile, so it never starts on a plain `up`. The admin
seed reuses the same service with a command override.

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
# Refresh the tree on the host first (archive/scp or CI — see prerequisite 4;
# the repo has no git clone on the box because org deploy keys are disabled).
cd deploy

# Rebuild the app image with the new code.
docker compose -f docker-compose.prod.yml build app

# Apply any new migrations BEFORE the new app starts serving.
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate

# Roll the app (and caddy if its config changed). Postgres + volumes persist.
docker compose -f docker-compose.prod.yml up -d app

# Optional: re-run the seed (idempotent) if SEED_ADMIN_* changed.
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate pnpm seed:admin
```

## Notes

- **Persistence:** named volumes `pgdata` (database), `caddy_data` (TLS certs),
  `caddy_config`. They survive `down`; do not `down -v` in prod (wipes data).
- **No published DB/app ports:** Postgres is internal-only; the app is reachable
  only through Caddy on 80/443.
- **Rollback:** rebuild from a previous commit and `up -d app`. Migrations are
  forward-only by policy; coordinate any `migrate:down` manually.
