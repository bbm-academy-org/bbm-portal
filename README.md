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

## Prerequisites
**Node 22 is required** — pinned by [`.nvmrc`](./.nvmrc) (`22.17.0`), the
`Dockerfile`, and CI. With a version manager just run `nvm use` / `fnm use` in the
repo root to select it automatically. `engine-strict=true` (in `.npmrc`) makes
`pnpm install` **fail loudly** on the wrong Node major, and the Node-22-sensitive
scripts (`migrate*`, `dev`, `build`, `test*`, `seed*`) run a preflight
([`scripts/require-node.mjs`](./scripts/require-node.mjs)) that exits early with a
clear "use Node 22" message before any deep crash. In particular,
`pnpm migrate:create` only works on Node 22 — under Node 23/24 drizzle-kit's tsx
loader crashes (`node:crypto?tsx-namespace` ENOENT), which is why early migrations
in this repo had to be hand-generated.

## Local development
```bash
nvm use                         # or `fnm use` — select Node 22 (see .nvmrc)
cp .env.example .env            # set PAYLOAD_SECRET — `openssl rand -hex 32`, point DATABASE_URL at your dev DB
pnpm install
pnpm migrate                    # apply migrations (push is off — run this before first dev)
pnpm dev                        # admin UI at http://localhost:3000/admin
```

### Database
A dedicated `cms` Postgres database + `payload` role (decision #2). The portable
compose contract lives in [`infra/dev-stand/`](./infra/dev-stand/README.md)
(`compose.core.yml` + `.env.example`); **where** the container runs is a
per-machine recipe, not part of that contract — mirroring
`ds-platform/infra/dev-stand`. Owner scheme (#62/#63): a **separate**
compose stack `bbm-portal-dev` on the LAN TrueNAS box, app on the host.
- **Remote (reference recipe):** ship the compose file to the box and bring the
  stack up over SSH, then point `DATABASE_URL` at `192.168.1.115:${POSTGRES_PORT}`
  (5432 is taken on the shared box — the compose publishes `${POSTGRES_PORT:-5432}`
  and the estate convention is to remap it, e.g. `5444`). The box-side file is
  named `docker-compose.yml` so the existing box layout / volumes keep working:
  ```bash
  scp infra/dev-stand/compose.core.yml truenas:~/bbm-portal-dev/docker-compose.yml
  ssh truenas "cd ~/bbm-portal-dev && sudo docker compose up -d"   # POSTGRES_PORT in ~/bbm-portal-dev/.env
  ```
- **Local:** with a local Docker daemon,
  `docker compose -f infra/dev-stand/compose.core.yml up -d postgres` and use
  `localhost:5432`.

Schema changes: edit collections/globals → `pnpm migrate:create <name>` → commit
the generated `src/migrations/*` → `pnpm migrate`. Production runs `pnpm migrate`
on deploy (`push: false` everywhere — no dev/prod schema drift).

### Admin auth
The admin panel at `/admin` uses **native Payload auth** — log in with an
**email + password**. The user model is a single implicit-admin: every user is a
full admin (no roles yet; SSO + a roles model are a deferred follow-up). The
`users` collection is access-controlled to authenticated callers only, so it is
not world-readable over the REST API.

**Bootstrap the first admin** (headless / non-interactive — e.g. on the prod VPS):
```bash
SEED_ADMIN_EMAIL=admin@bbm.academy SEED_ADMIN_PASSWORD='a-strong-password' pnpm seed:admin
```
The script is **idempotent** — if a user with that email already exists it skips
without overwriting. On an empty DB you can equivalently use the `/admin`
"create first user" screen; Payload bypasses access control until the first user
exists. Both `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are required (the
script fails loudly if either is unset) — see `.env.example`.

### Media storage
The `media` collection is backed by **Timeweb Object Storage** (S3-compatible,
decision #3) through `@payloadcms/storage-s3` with `forcePathStyle: true`. The
plugin is **gated on `S3_BUCKET`**:
- **Set `S3_BUCKET` + keys** (`S3_ENDPOINT=https://s3.twcstorage.ru`,
  `S3_REGION=ru-1`, account-level access key/secret) → uploads stream to S3 and
  are served from the bucket URL. **Production must set these.**
- **Leave `S3_BUCKET` empty** → Payload falls back to local-disk storage, so dev
  works without S3 credentials.

The bucket (`bbm-portal-media`, public-read, Hot class) and its keys are
provisioned by Terraform — `bbm/infra/timeweb/terraform/portal_media.tf`; read
the values with `terraform output portal_media_*`. No migration is involved —
the storage adapter adds no DB columns.

## Scripts
| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js + Payload dev server (admin at `/admin`) |
| `pnpm migrate` | apply pending migrations |
| `pnpm migrate:create <name>` | generate a migration from the current schema (needs a live DB) |
| `pnpm migrate:status` | list migrations and whether they ran |
| `pnpm migrate:down` | roll back the last batch |
| `pnpm seed:admin` | bootstrap the first admin (needs `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`; idempotent) |
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
