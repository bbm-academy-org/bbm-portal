# OKR dashboard — Zitadel OIDC gate (P2b) — spec (issue #59)

## Why

The `/okr` dashboard shows team-member OKR data (names in the tree = team
PII). Today the module is **unrouted** — its view components are preserved
under `src/modules/okr/view/` with no `page.tsx`, so nothing is publicly
reachable (ADR-003, the `/okr` near-leak remediation). This task re-mounts the
dashboard as a real page, but behind a login: **unauthenticated users must get
a Zitadel login, not data.** Auth is OIDC via Zitadel from day one (ADR-002;
owner decision 2026-07-24, superseding the PRD's interim native-Payload
recommendation).

Scope note: this spec is **P2b** — wiring the app to the dev IdP that P2a
(PR #71) already stood up. Production (`portal.bbm.academy` DNS/Caddy, the prod
`id.bbm.academy` Zitadel client) is **P3 / #60** and explicitly out of scope
here. The whole of #59 closes across P2b + P3; this spec is the P2b slice the
owner verifies on the dev stand.

## Requirements

1. **Mount the dashboard at `/p/okr`.** Add a `page.tsx` under a `(platform)`
   route group that renders the already-preserved `src/modules/okr/view/`
   components — a re-wire, not a view rewrite. The `(platform)` group is a
   **code boundary**, not a URL prefix (ADR-003 §3(b)); the visible URL is
   `/p/okr`.

2. **The `(platform)` layout enforces OIDC login.** The shared
   `(platform)/layout.tsx` is the single place the Zitadel gate lives, so every
   current and future platform page inherits it. An unauthenticated request to
   `/p/okr` is sent to the Zitadel login flow and **never** rendered the
   dashboard or its data (no team PII to anonymous users). Only after a
   successful login does the page render.

3. **Host-allowlist middleware (ADR-003 §2, default-deny).** A single
   `middleware.ts` keys on the request `Host` header + visible pathname:
   - `/p/*` is **NOT** an allowed surface on `cms.bbm.academy` → **404** there
     (the CMS host must never serve a platform path — the near-leak class must
     not recur).
   - `/p/*` **is** allowed on the dev origin (`localhost:3000`) and on the
     future portal host (P3).
   - Host matching normalizes the header (lowercase, strip port, strip a
     trailing-dot FQDN — the PR #64 bypass, preserved as a known pitfall).
     Topology decides _what is routable on this host_; the OIDC gate (req. 2)
     then decides _who may see it_ — two independent layers.

4. **OIDC mechanics — RESOLVED (owner decision 2026-07-24).** Auth is an
   **in-app OIDC session (Auth.js / next-auth in-app BFF)**, not an
   oauth2-proxy / forward-auth container. The owner accepted this at stage 2 (go
   recorded on issue #59). Rationale on record:
   - identity is available to React (the dashboard can show who is signed in /
     scope future per-user views);
   - no extra proxy container on the prod request path (fewer moving parts to
     operate and secure);
   - matches the estate's `ds-platform` BFF pattern the P2a stand was ported
     from (PR #71 callback convention `…/auth/callback` is already the BFF
     shape).
     Payload native auth (users collection) stays admin-only for CMS editors,
     unchanged.

5. **Env contract (dev).** The app reads OIDC config from repo-root `.env`
   (values live on the box, non-secret client-id may be committed to
   `.env.example`), per PR #71:
   - `IDP_ISSUER` = `http://truenas.local:9180`
   - `IDP_CLIENT_ID` = `383188659542756099`
   - `IDP_CLIENT_SECRET` — secret, on the box
   - `IDP_REDIRECT_URI` = `http://localhost:3000/auth/callback` (app runs on the
     owner's Windows machine; localhost even on the truenas.local recipe). If a
     different callback route is wired, `provision.sh` is re-run with the new
     URI.
     Prod values (`id.bbm.academy` issuer + a new prod Zitadel client) arrive in
     **P3 / #60** — out of scope here.

6. **Constraints.** ADR-003 host/surface topology and ADR-002 module boundaries
   hold through the re-mount: the dependency-cruiser rule isolating
   `src/modules/okr` from CMS internals stays in force. Middleware is a
   load-bearing security boundary → it gets a test (req. via the TDD note in
   the acceptance scenarios). 152-FZ: team PII must not reach anonymous users
   (the whole point of req. 2).

## Acceptance scenarios

Verified by hand on the **dev stand** (owner's Windows machine running
`pnpm dev` at `localhost:3000` + the TrueNAS IdP trio). A dev-server screenshot
is **not** acceptance (issue #59, ADR per #63).

1. **Anonymous → login.** Owner opens `http://localhost:3000/p/okr` in a fresh
   browser (not logged in) → is **redirected to the Zitadel login page**; the
   OKR dashboard and its data are never shown.

2. **Login → dashboard.** Owner signs in as the `bbm-test` user
   (`bbm-test@bbm.local`) at the Zitadel login → is returned to `/p/okr` and
   **sees the OKR dashboard with the OKR tree** rendered.

3. **Logout / fresh session → no data.** Owner logs out (or opens `/p/okr` in a
   fresh incognito window) → the dashboard and team PII are **not reachable**;
   back to the login (scenario 1).

4. **CMS host → 404.** A request to `/p/okr` with `Host: cms.bbm.academy` (e.g.
   `curl -H 'Host: cms.bbm.academy' http://localhost:3000/p/okr`) returns
   **404** — the platform surface is not routable on the CMS host.

5. **TDD note (derived from the above).** Middleware host-allowlist tests
   (host × {allowed path, foreign-surface path} → 200-ish / 404, incl. the
   trailing-dot / port-normalization cases) and an auth-required test
   (unauthenticated `/p/okr` → redirect, not 200 with data) are written first,
   from these scenarios, per task-cycle stage 3. These restore the middleware
   coverage PR #67 removed with the reverted guard.

## Out of scope

- **`portal.bbm.academy` DNS + Caddy site block + prod deploy** — P3, issue #60.
- **Prod Zitadel client** (`id.bbm.academy` issuer, prod client-id/secret) — P3.
- **Vercel retirement / hosting migration.**
- **Role-based authorization** beyond "any authenticated org user may see the
  dashboard" — no per-role or per-team scoping in this task.
- **Caddy Layer-2 path matcher** (ADR-003 §2 Layer 2, best-effort
  defense-in-depth) — its exact form is a P3 decision; Layer-1 middleware is the
  authoritative enforcement here.
- **OKR view/UI changes** — the preserved components render as-is; this is a
  re-mount + gate, not a redesign.
