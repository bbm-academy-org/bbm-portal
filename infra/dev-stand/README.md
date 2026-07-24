# Dev stand — `infra/dev-stand/`

The **portable, committed contract** for bbm-portal's local development stand.
It holds the stateful services the app needs while you run the app itself on
your host with `pnpm dev`. Owner-approved scheme: see #62 (recon + decisions)
and #63.

## What this is (two layers)

| Layer | Files | In git? | Scope |
|---|---|---|---|
| Portable contract | `compose.core.yml`, `.env.example`, this README | yes | same for everyone |
| Per-machine recipe | `.env` (copied from `.env.example`) | no (gitignored) | your machine |

`compose.core.yml` is a plain `docker compose` project with a **fixed name**
(`bbm-portal-dev`) so its containers and named volume stay namespaced
(`bbm-portal-dev-*`) and never collide with co-hosted workloads. Everything
tunable is env-driven (`.env`), nothing is host-path-specific — so the same file
runs on a LAN box or a local Docker daemon unchanged.

**Today the stack is one service: Postgres 17** (the dedicated `cms` database,
decision #2). The app's `DATABASE_URL` (repo-root `.env`) points at it.

## Where it runs (owner's scheme)

- **App** — the owner's Windows machine, `pnpm dev` → `http://localhost:3000`.
  Source code stays on local NVMe; it is never copied to the box.
- **Stateful services** — a **separate** compose stack `bbm-portal-dev` on the
  LAN TrueNAS box (its own project/ports — the `ds-platform` dev containers are
  **not** shared).

## Delivery — light scp/ssh loop

No DX launcher yet (owner decision — one arrives with the Zitadel trio in P2).
Ship the contract to the box and bring the stack up over SSH. The box-side
directory is `~/bbm-portal-dev/` and the file is named `docker-compose.yml`
there, so the box layout is byte-compatible with what was deployed before this
reorg (existing volumes/containers keep working — no state change):

```bash
scp infra/dev-stand/compose.core.yml truenas:~/bbm-portal-dev/docker-compose.yml
ssh truenas "cd ~/bbm-portal-dev && sudo docker compose up -d"   # POSTGRES_PORT etc. in ~/bbm-portal-dev/.env
```

`~/bbm-portal-dev/.env` on the box is the per-machine `.env` (copied from
`.env.example`) — it is not committed. Read-only status check:

```bash
ssh truenas "sudo docker ps"
```

## P2 — Zitadel trio lands here

The OKR/portal auth gate (ADR-002, Zitadel OIDC) needs the Zitadel trio
(`idp` / `idp-login` / `idp-proxy`) on the stand. It is **not** here yet.
When P2 (#59) lands, the trio is added to `compose.core.yml`, its ports /
masterkey / issuer are parameterized in `.env.example`, and the light scp/ssh
loop is likely replaced by a thin `pnpm dev:*` wrapper (owner decision).
No MinIO — media stays on Timeweb S3.
