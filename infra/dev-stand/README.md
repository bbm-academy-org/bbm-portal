# Dev stand — `infra/dev-stand/`

The **portable, committed contract** for bbm-portal's local development stand.
It holds the stateful services the app needs while you run the app itself on
your host with `pnpm dev`. Owner-approved scheme: see #62 (recon + decisions)
and #63.

## What this is (two layers)

| Layer              | Files                                           | In git?         | Scope             |
| ------------------ | ----------------------------------------------- | --------------- | ----------------- |
| Portable contract  | `compose.core.yml`, `.env.example`, this README | yes             | same for everyone |
| Per-machine recipe | `.env` (copied from `.env.example`)             | no (gitignored) | your machine      |

`compose.core.yml` is a plain `docker compose` project with a **fixed name**
(`bbm-portal-dev`) so its containers and named volume stay namespaced
(`bbm-portal-dev-*`) and never collide with co-hosted workloads. Everything
tunable is env-driven (`.env`), nothing is host-path-specific — so the same file
runs on a LAN box or a local Docker daemon unchanged.

**The stack is Postgres 17 + the Zitadel trio.** Postgres is the dedicated `cms`
database (decision #2); the app's `DATABASE_URL` (repo-root `.env`) points at it.
The **Zitadel trio** (`idp` + `idp-login` + `idp-proxy`) is the dev OIDC IdP for
the portal auth gate (#59, ADR-002) — see [`idp/bootstrap.md`](./idp/bootstrap.md).

### Services & ports

| Service                            | Container port | Host port (bbm-portal-dev)      | Published? |
| ---------------------------------- | -------------- | ------------------------------- | ---------- |
| `postgres`                         | 5432           | `${POSTGRES_PORT}` = **5444**   | yes        |
| `idp` (Zitadel core)               | 8080           | — (in-network `idp:8080`)       | no         |
| `idp-login` (Login V2 UI)          | 3000           | — (in-network `idp-login:3000`) | no         |
| `idp-proxy` (Caddy, issuer origin) | `${IDP_PORT}`  | `${IDP_PORT}` = **9180**        | yes        |

Only **two** host ports are published. `IDP_PORT` is **9180** because the shared
TrueNAS box already binds **9080** for the co-hosted `ds-platform` stand — the
trio is otherwise fully namespaced under project `bbm-portal-dev` and shares
nothing with it. The Zitadel trio is **DB-backed** (state in a dedicated
`zitadel` database inside this stack's Postgres) and carries no volume of its own.
No MinIO/Redis/Mailpit/SMS/Unleash — the portal needs the IdP only; media stays
on Timeweb S3.

The issuer origin is `http://${IDP_EXTERNAL_DOMAIN}:${IDP_PORT}`
(`http://truenas.local:9180` on the reference recipe). The OIDC **redirect URIs**
are the app's own callbacks on the dev machine — **not** the Zitadel host — and
cover the whole `pnpm dev:ports` range (3000–3009 × `localhost`/`127.0.0.1` ×
both callback paths); see [`idp/bootstrap.md`](./idp/bootstrap.md) §6.

## Where it runs (owner's scheme)

- **App** — the owner's Windows machine, `pnpm dev` → `http://localhost:3000`.
  Source code stays on local NVMe; it is never copied to the box.
- **Stateful services** — a **separate** compose stack `bbm-portal-dev` on the
  LAN TrueNAS box (its own project/ports — the `ds-platform` dev containers are
  **not** shared).

## Delivery — thin `pnpm dev:*` launcher

The trio's arrival brings the owner-approved thin launcher (`tools/dev/run.mjs`,
backing `pnpm dev:*`). It reads your **per-machine** `.env.local`, picks a
transport, syncs the contract, and drives `docker compose`:

```bash
pnpm dev:up        # sync infra/dev-stand/ to the box + docker compose up -d (detached)
pnpm dev:status    # docker compose ps
pnpm dev:logs idp  # follow logs (all, or one service)
pnpm dev:restart idp-login
pnpm dev:down      # stop (volumes preserved)
pnpm dev:config    # validate compose + assert required secrets resolve (no up)
```

The SSH recipe (`DEV_SSH_HOST=truenas`, `DEV_DOCKER_SUDO=1`) tars
`infra/dev-stand/` to a **staging dir** on the box and swaps it in atomically
(`DEV_REMOTE_DIR`, default `~/bbm-portal-dev-stand`), then ships your `.env.local`
verbatim as the compose `.env`. A host-only recipe (`DEV_SSH_HOST` empty) runs
against the local Docker daemon. The fixed project name `bbm-portal-dev` pins
containers/volume to one project regardless of the box directory.

> The first-time trio bring-up (fresh Zitadel init, PAT minting, OIDC
> provisioning) is a documented one-time procedure — see
> [`idp/bootstrap.md`](./idp/bootstrap.md). It brings up the **new** trio services
> with `--no-recreate` so the running `bbm-portal-dev-postgres-1` is adopted but
> never restarted. `pnpm dev:up` is for steady-state operation afterwards.

Read-only status check without the launcher:

```bash
ssh truenas "sudo docker ps"
```

## Secrets — per-machine, outside the synced dir

Real values live in a **per-machine** `.env.local`, gitignored and **never**
committed (the repo carries only `.env.example` with `CHANGE_ME` placeholders):

| Where                                      | What                                           | Note                                                             |
| ------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------- |
| `~/.bbm-portal/.env.local`                 | the durable secret source                      | the launcher ships it as the box compose `.env` on each sync     |
| `~/bbm-portal-dev-stand/.env`              | the box compose `.env`                         | auto-loaded by compose; re-provisioned from `.env.local` on sync |
| `~/.bbm-portal/idp-bootstrap-pat.txt`      | the `bbm-bootstrap` org-owner PAT              | **outside** the synced dir so `dev:up` never wipes it            |
| `/var/lib/bbm-portal/idp-login-client.pat` | the PAT the `idp-login` container mounts       | daemon-host path, outside the synced dir                         |
| `~/.bbm-portal/CREDENTIALS.dev.txt`        | human-readable console-admin + test-user creds | outside the synced dir                                           |

**The PAT is kept out of sync scope on purpose:** `dev:up` wipes+replaces the
synced stand dir every time, so a PAT placed inside it would be destroyed — and a
committed PAT is forbidden. Bootstrap secrets (`IDP_SECRET_KEY`, the admin/test
passwords) are generated once on the box (`openssl rand`) and kept in the
per-machine files above.
