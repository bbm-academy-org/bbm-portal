# bbm-portal

**Payload CMS** (v3, native inside Next.js) — the headless content backend for the BBM Academy public website (`bbm-public-website`), and the seed of the future BBM portal (auth / personal cabinet / blog grow here later).

> **Agents:** read [`AGENTS.md`](./AGENTS.md) first — it holds the content contract, accepted setup decisions, architectural authority, and the per-task workflow. Strategic tracking lives in Plane (`bbm` workspace / BBM Platform / milestone BBMP-24).

## Stack
- **Next.js 16** + **Payload 3** (`@payloadcms/next`)
- **Postgres** via `@payloadcms/db-postgres` — a dedicated `cms` database (decision #2)
- **Media** → Timeweb Object Storage via `@payloadcms/storage-s3` (decision #3; wired in BBMP-27)

## Local development
```bash
cp .env.example .env            # set PAYLOAD_SECRET — `openssl rand -hex 32`
docker compose up -d postgres   # dedicated `cms` Postgres
pnpm install
pnpm dev                        # admin UI at http://localhost:3000/admin
```

## Scripts
| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js + Payload dev server (admin at `/admin`) |
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
