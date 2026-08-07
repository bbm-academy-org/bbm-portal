# Zitadel dev IdP — one-time bring-up (reproducible, per recipe)

The Zitadel trio (`idp` + `idp-login` + `idp-proxy`) comes up from
`compose.core.yml` and serves OIDC discovery at the issuer root once healthy.
This file is the scripted, re-runnable procedure to bring a **fresh** dev IdP to a
state the portal auth gate (#59) can consume: a reachable discovery document, an
OIDC application, and a human test user. No console click-paths.

Commands assume the **TrueNAS recipe**: SSH alias `truenas`, `sudo docker`, the
stand synced to `~/bbm-portal-dev-stand` (the compose project name is fixed at
`bbm-portal-dev`, so it targets the same project — and adopts the existing
`bbm-portal-dev-postgres-1` — regardless of the directory). On a host-only recipe
drop the `ssh truenas` prefix and the `sudo`.

> **HOST choice.** The issuer must be the address the app on your dev machine
> resolves _and_ the address Zitadel advertises in discovery — byte-identical or
> every OIDC client rejects the issuer. The reference recipe uses `truenas.local`
> (mDNS resolves from Windows to the box). Use the SAME value for
> `IDP_EXTERNAL_DOMAIN` and `IDP_ISSUER` (bare origin, **no path**), e.g.
> `http://truenas.local:9180`.
>
> **Redirect URI is NOT the HOST.** The OIDC redirect URI points at the **app's
> own callback**, and the app runs on your **dev machine**, so it is
> `http://localhost:3000/api/auth/callback/zitadel` even on the truenas.local
> recipe (the Auth.js/next-auth default the P2b gate wires; the historical
> `/auth/callback` stays registered too). A `truenas.local` redirect URI is not
> registered and Zitadel's authorize returns `400 invalid_request`.

---

## 0. Ports & isolation on the shared box

The TrueNAS box already runs the **ds-platform** stand (its own project/ports,
`idp-proxy` on **9080**) plus **this** stand's `bbm-portal-dev-postgres-1` on
**5444**. The trio adds **one** published port — `idp-proxy` on `IDP_PORT` — so
bbm-portal uses **9180** (9080 is taken). Core (`idp:8080`) and the login UI
(`idp-login:3000`) are in-network only. Everything is namespaced under the fixed
project `bbm-portal-dev`; nothing collides with ds-platform.

**Never touch the ds-platform containers or the existing `bbm-portal-dev-postgres-1`.**
Bring up the trio with the services named explicitly and `--no-recreate` so the
running Postgres is adopted (label-matched) but never recreated:

```bash
ssh truenas 'cd ~/bbm-portal-dev-stand && \
  sudo docker compose -f compose.core.yml up -d --no-recreate idp idp-login idp-proxy'
```

---

## 1. Wire the per-box `.env` (secrets never leave the box)

The compose `.env` on the box carries the existing Postgres values **unchanged**
(so Zitadel authenticates against the running container) plus the new IDP vars.
Generate the masterkey + passwords ON THE BOX (`openssl rand`); never commit them.

```ini
# ~/bbm-portal-dev-stand/.env  (also mirrored to ~/.bbm-portal/.env.local)
POSTGRES_USER=payload
POSTGRES_PASSWORD=payload            # the EXISTING value — do not change it
POSTGRES_DB=cms
POSTGRES_PORT=5444

IDP_PORT=9180
IDP_EXTERNAL_DOMAIN=truenas.local
IDP_ISSUER=http://truenas.local:9180
IDP_SECRET_KEY=<openssl rand -hex 16>          # EXACTLY 32 chars
IDP_LOGIN_IMAGE=ghcr.io/zitadel/zitadel-login:v4.15.0
IDP_LOGIN_PAT_FILE=/var/lib/bbm-portal/idp-login-client.pat
IDP_BOOTSTRAP=1                                 # ONLY during the fresh init
IDP_BOOTSTRAP_ADMIN_PASSWORD=<pick one>         # upper+lower+digit+symbol
IDP_TEST_USER_PASSWORD=<pick one>               # for provision.sh; set PERMANENT (see step 5)
```

## 2. Fresh init — mint the bootstrap machine user + PAT

`compose.core.yml` carries an opt-in FIRSTINSTANCE block gated on `IDP_BOOTSTRAP`.
With it set, the init step creates an IAM-owner machine user `bbm-bootstrap`, a
console admin `zitadel-admin`, writes the machine user's PAT to a readable tmpfs
file, and enables Login V2.

```bash
# Bring up core only (Postgres already running, adopted, NOT recreated):
ssh truenas 'cd ~/bbm-portal-dev-stand && \
  sudo docker compose -f compose.core.yml up -d --no-recreate idp'
# Wait for health, then verify the issuer:
curl -s http://truenas.local:9180/.well-known/openid-configuration | jq -r .issuer
#   -> http://truenas.local:9180   (once idp-proxy is up, step 4)
```

### Obtaining the bootstrap PAT (fully scriptable — no console)

`ZITADEL_FIRSTINSTANCE_PATPATH` writes the PAT to `/pat/pat.txt` on init. The
distroless image runs as uid/gid 1000 and the tmpfs is owned 1000, so the file
lands readable. The image has no shell, so read it through the host `/proc` view:

```bash
ssh truenas 'PID=$(sudo docker inspect bbm-portal-dev-idp-1 --format "{{.State.Pid}}"); \
  sudo cat /proc/$PID/root/pat/pat.txt' > /tmp/idp-pat.txt
# keep a durable copy OUTSIDE the synced stand dir:
scp /tmp/idp-pat.txt truenas:'~/.bbm-portal/idp-bootstrap-pat.txt'
```

Then flip `IDP_BOOTSTRAP=` back off in the `.env` so normal boots don't re-init.

## 3. Place the PAT for the login container (outside the synced dir)

`idp-login` mounts the PAT read-only from `IDP_LOGIN_PAT_FILE`, which MUST live
outside the synced stand dir (`dev:up` wipes+replaces it on every sync):

```bash
ssh truenas 'PAT=$(tr -d "\r\n" < ~/.bbm-portal/idp-bootstrap-pat.txt); \
  sudo mkdir -p /var/lib/bbm-portal && \
  printf "%s" "$PAT" | sudo tee /var/lib/bbm-portal/idp-login-client.pat >/dev/null && \
  sudo chmod 0644 /var/lib/bbm-portal/idp-login-client.pat'
```

## 4. Bring up the login UI + proxy

```bash
ssh truenas 'cd ~/bbm-portal-dev-stand && \
  sudo docker compose -f compose.core.yml up -d --no-recreate idp-login idp-proxy'
# discovery now reachable from the Windows host:
curl -s http://truenas.local:9180/.well-known/openid-configuration | jq -r .issuer
#   -> http://truenas.local:9180
```

## 5. Provision the OIDC application + test user (idempotent)

`idp/provision.sh` creates (or converges) the `bbm-portal-dev` project, the
web/OIDC application (`authorization_code` + `refresh_token`, BASIC auth, dev-mode
http redirect URIs), the project-role assertion, a seed role, the Login V2 feature
with its baseUri, the `IAM_LOGIN_CLIENT` grant, closes public self-registration,
and — when `IDP_TEST_USER_PASSWORD` is set — a human test user (`bbm-test`, email
pre-verified, password **permanent** / change NOT required). Re-running converges;
it never duplicates.

> **Why permanent, not change-required:** the Zitadel login-v2
> `/ui/v2/login/password/change` screen is broken on this stand ("Could not get
> the context of the user"), so a forced first-login change makes the gate
> impossible to complete. The password is set permanent from the start.

> **Both URI sets converge, neither narrows (#93, #170).** The redirect-URI set
> (40) and the post-logout set (20 bare origins) are generated from the same
> port × host bounds the live app carries, so a full run leaves both as they are.
> Step 6 shows how to inspect either set without touching the IdP.

```bash
ssh truenas 'cd ~/bbm-portal-dev-stand/idp && \
  IDP_BASE_URL=http://truenas.local:9180 \
  IDP_TEST_USER_PASSWORD="$(grep -E "^IDP_TEST_USER_PASSWORD=" ../.env | cut -d= -f2-)" \
  ./provision.sh --pat-file ~/.bbm-portal/idp-bootstrap-pat.txt'
```

It prints `IDP_PROJECT_ID`, `IDP_CLIENT_ID`, and — **only on first creation** —
`IDP_CLIENT_SECRET` (the client id is not a secret; the secret and PAT are).
Capture them into `~/.bbm-portal/.env.local` for P2b. Then restart the login
container so it picks up the grant/policy:

```bash
ssh truenas 'cd ~/bbm-portal-dev-stand && \
  sudo docker compose -f compose.core.yml restart idp-login'
```

## 6. What P2b (#59) consumes

The app (on the dev machine) reads these from its repo-root `.env`:

| Key                 | Source                                            | Secret? |
| ------------------- | ------------------------------------------------- | ------- |
| `IDP_ISSUER`        | `http://truenas.local:9180` (bare origin)         | no      |
| `IDP_CLIENT_ID`     | provision.sh output                               | no      |
| `IDP_CLIENT_SECRET` | provision.sh output (on create)                   | **yes** |
| `IDP_PROJECT_ID`    | provision.sh output                               | no      |
| `IDP_REDIRECT_URI`  | `http://localhost:3000/api/auth/callback/zitadel` | no      |
| `AUTH_SECRET`       | `openssl rand -hex 32` (Auth.js session/JWT)      | **yes** |
| `IDP_SERVICE_TOKEN` | the `bbm-bootstrap` PAT                           | **yes** |

**Callback path: `/api/auth/callback/zitadel`** on `http://localhost:3000` — the
Auth.js/next-auth v5 default the P2b gate (#59) wires. `provision.sh` registers it
by default (alongside the historical ds-platform `/auth/callback`, kept for
continuity). If a future task wires a different callback route, re-run
`provision.sh` with `IDP_REDIRECT_URIS=<new uri>` to register it.

**Not one port — the whole 3000–3009 range.** Parallel sessions each take a dev
port with `pnpm dev:ports`, so both URI sets are _generated_ from the same bounds,
matching the live app exactly, so a re-provision never narrows either one (#93,
#170):

| Set                                     | Axes                                      | Count |
| --------------------------------------- | ----------------------------------------- | ----- |
| `redirectUris`                          | ports × `localhost`/`127.0.0.1` × 2 paths | 40    |
| `postLogoutRedirectUris` (bare origins) | ports × `localhost`/`127.0.0.1`           | 20    |

Inspect either set without touching the IdP:

```bash
./provision.sh --print-redirect-uris
./provision.sh --print-post-logout-uris
```

Widening the range is one variable (`DEV_PORT_MAX` in `provision.sh`, kept in step
with `PORT_MAX` in `tools/dev/dev-ports.mjs`) — it widens both sets at once.

## 7. Browsable admin Console (operator-only)

`http://truenas.local:9180/ui/console` → redirects to `/ui/v2/login/...` → log in
as `zitadel-admin@zitadel.truenas.local` with `IDP_BOOTSTRAP_ADMIN_PASSWORD`. Use
the `truenas.local` hostname (Caddy host-matches `IDP_EXTERNAL_DOMAIN`), not an
IP.

## Where secrets live on the box

- `~/bbm-portal-dev-stand/.env` — compose `.env` (auto-loaded); Postgres + IDP
  vars + `IDP_SECRET_KEY`. Re-shipped from `~/.bbm-portal/.env.local` on each sync.
- `~/.bbm-portal/.env.local` — the durable secret source (outside the synced dir).
- `~/.bbm-portal/idp-bootstrap-pat.txt` — the org-owner PAT (outside the synced dir).
- `/var/lib/bbm-portal/idp-login-client.pat` — the PAT the login container mounts.
- `~/.bbm-portal/CREDENTIALS.dev.txt` — human-readable summary: console admin login,
  the `bbm-test` test-user login + permanent password, client id/secret, project id.

None of these are ever committed; the repo carries only `.env.example`
placeholders.
