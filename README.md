# bbm-portal

**Payload CMS** (v3, native inside Next.js) — the headless content backend for the BBM Academy public website (`bbm-public-website`), and the seed of the future BBM portal (auth / personal cabinet / blog grow here later).

> **Agents:** read [`AGENTS.md`](./AGENTS.md) first — it holds the content contract, accepted setup decisions, architectural authority, and the per-task workflow. Strategic tracking lives in Plane (`bbm` workspace / BBM Platform / milestone BBMP-24).

## Stack
- **Node 22** (LTS — pinned by `.nvmrc`, the `Dockerfile`, and CI). Payload's
  migrate CLI runs through a tsx ESM loader that **breaks on Node 23/24**
  (`node:crypto?tsx-namespace` ENOENT); stay on 22 locally.
- **Next.js 16** + **Payload 3** (`@payloadcms/next`)
- **Postgres** via `@payloadcms/db-postgres` — a dedicated `cms` database (decision #2).
  Migrations are the source of truth (`push: false`); see [Database](#database).
- **Media** → Timeweb Object Storage via `@payloadcms/storage-s3` (decision #3; wired in BBMP-27)

## Local development
```bash
cp .env.example .env            # set PAYLOAD_SECRET — `openssl rand -hex 32`, point DATABASE_URL at your dev DB
pnpm install
pnpm migrate                    # apply migrations (push is off — run this before first dev)
pnpm dev                        # admin UI at http://localhost:3000/admin
```

### Database
A dedicated `cms` Postgres database + `payload` role (decision #2). **Where** the
container runs is a per-machine recipe, not part of the repo contract — mirroring
`ds-platform/infra/dev-stand`:
- **Remote (reference recipe):** run `docker-compose.yml` on the LAN TrueNAS box
  over SSH and point `DATABASE_URL` at `192.168.1.115:${POSTGRES_PORT}` (5432 is
  taken on the shared box — the compose publishes `${POSTGRES_PORT:-5432}` and the
  estate convention is to remap it, e.g. `5444`):
  ```bash
  scp docker-compose.yml truenas:~/bbm-portal-dev/
  ssh truenas "cd ~/bbm-portal-dev && sudo docker compose up -d"   # POSTGRES_PORT in ~/bbm-portal-dev/.env
  ```
- **Local:** with a local Docker daemon, `docker compose up -d postgres` and use
  `localhost:5432`.

Schema changes: edit collections/globals → `pnpm migrate:create <name>` → commit
the generated `src/migrations/*` → `pnpm migrate`. Production runs `pnpm migrate`
on deploy (`push: false` everywhere — no dev/prod schema drift).

### Media storage
The `media` collection is backed by **Timeweb Object Storage** (S3-compatible,
decision #3) through `@payloadcms/storage-s3` with `forcePathStyle: true`. The
plugin is **gated on `S3_BUCKET`**:
- **Set `S3_BUCKET` + keys** (`S3_ENDPOINT=https://s3.twcstorage.ru`,
  `S3_REGION=ru-1`, account-level access key/secret) → uploads stream to S3 and
  are served from the bucket URL. **Production must set these.**
- **Leave `S3_BUCKET` empty** → Payload falls back to local-disk storage, so dev
  works without S3 credentials.

The bucket itself is ordered in the Timeweb panel (a one-time user-action); the
keys are the same account-level S3 credentials used by the estate's off-site
backups. No migration is involved — the storage adapter adds no DB columns.

## Scripts
| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js + Payload dev server (admin at `/admin`) |
| `pnpm migrate` | apply pending migrations |
| `pnpm migrate:create <name>` | generate a migration from the current schema (needs a live DB) |
| `pnpm migrate:status` | list migrations and whether they ran |
| `pnpm migrate:down` | roll back the last batch |
| `pnpm lint` | ESLint (flat config) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm generate:types` | regenerate `src/payload-types.ts` from collections |
| `pnpm test` | integration (vitest) + e2e (playwright) |

## Where things live
- `src/payload.config.ts` — Payload config (db adapter, collections, globals, plugins)
- `src/collections/` — collections (one per file)
- `src/app/(payload)/` — Payload admin + REST/GraphQL routes
- `src/app/(frontend)/` — Next.js frontend routes (portal surfaces grow here)
- `docs/payload-collections-spec.md` — target content model, 1:1 with the site contract
