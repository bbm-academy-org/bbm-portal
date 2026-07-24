# ADR-003: Domain topology — `cms.bbm.academy` vs `portal.bbm.academy`

**Status:** Accepted
**Date:** 2026-07-24
**Decider:** Anton Sidorov (owner)
**Prepared by:** Claude (domain-topology recon after the `/okr` near-leak, issue #63 item 2)
**Related:** ADR-002 (repository & module strategy — modular monolith), issue #63 (post-#61 remediation), #60 (P3 prod: `portal.bbm.academy` DNS + Caddy), #59 (Zitadel OIDC gate), PR #64 (per-route guard, since reverted), PR #67 (`/okr` unrouted), BBMP-129 milestone

## Context

The BBM Platform runs as a **modular monolith**: one Next.js process, one deployable (ADR-002 §3). That process is fronted by Caddy (`deploy/Caddyfile`), which today terminates TLS for several hostnames on the same VPS (`cms.bbm.academy`, `preview.bbm.academy`, the apex redirect) and — per P3 (#60) — will soon also terminate `portal.bbm.academy`. Every one of those hostnames currently reverse-proxies (or will reverse-proxy) into the **same** app container.

The architectural fact that makes this dangerous: **in Next.js App Router a route is host-agnostic by default.** A file at `src/app/(frontend)/okr/page.tsx` answers on *every* hostname that reaches the process — `cms.bbm.academy/okr`, `portal.bbm.academy/okr`, and the raw origin alike. There is no built-in notion of "this route belongs to that host". The host→surface split lives entirely in operator-supplied configuration, and if that configuration is silent, the route leaks across all hosts.

This is not hypothetical. It already happened:

- **The `/okr` near-leak incident.** P1 (BBMP-130) shipped a `/okr` dashboard route into `main` ahead of owner sign-off. Because `cms.bbm.academy` proxies into the same process, the *next* CMS deploy would have served `cms.bbm.academy/okr` — an unauthenticated page listing team-member OKR data — with no code anywhere expressing "this must not be here". PR #64 patched it with a per-route guard (Next middleware Host-check + a Caddy 404 matcher for `/okr`). At the 2026-07-24 checkpoint the owner rejected that shape: a per-route blocklist does not scale ("and when there's an `/example` route?") — every new platform module would need someone to *remember* to add a new deny rule, and the failure mode of forgetting is a silent public leak. PR #67 then reverted the guard entirely and **unrouted** `/okr`: the page components were preserved under `src/modules/okr/view/` with no `page.tsx`, so today the cms app carries **no platform routes at all** — "nothing to protect" instead of "protected". `main` is deployable at any moment.

That leaves the systemic question this ADR must answer: when platform modules *do* return (P3, on `portal.bbm.academy`), what rule keeps them off the CMS host **by default**, so that no module author can leak one by omission?

## Decision

### 1. Host → surface mapping

One process serves multiple hosts; each host is restricted to exactly one **surface** (a class of routes). The mapping is authoritative:

| Host | Surface | What it serves | Everything else |
|------|---------|----------------|-----------------|
| `cms.bbm.academy` | **CMS** | Payload admin (`/admin`), Payload REST/GraphQL/media (`/api`, `/graphql`, uploads), and the CMS-owned frontend routes of the static-site backend | **404** |
| `portal.bbm.academy` | **Platform** | Platform modules (OKR dashboard first; future modules by ADR-002 §3) behind Zitadel OIDC | **404** (non-platform paths) |
| `preview.bbm.academy` | Astro SSR preview | proxied to the `preview` container (unchanged, not this process) | n/a |
| `bbm.academy` (apex) | redirect | 301 → `https://www.bbm.academy` (unchanged) | n/a |

The governing principle is **allowlist / default-deny per host**: on a given host only that host's surface is reachable; anything not on its allowlist returns 404. This inverts the rejected per-route blocklist — a new module is covered the moment it exists, with no per-route rule to remember.

### 2. Default-deny mechanics (two layers)

**Layer 1 — Next middleware, Host allowlist (in-process, authoritative).**
A single `middleware.ts` inspects the request `Host` header and the pathname, and enforces the mapping in table §1:

- On `cms.bbm.academy`: allow only the CMS surface prefixes (`/admin`, `/api`, `/graphql`, the media/upload paths, and the CMS frontend routes); **404 everything else**, including any current or future platform path — no platform-path enumeration needed.
- On `portal.bbm.academy`: allow the platform surface; 404 non-platform paths. (The Zitadel OIDC gate from #59 layers on top of this — topology first decides *what is routable on this host*, auth then decides *who may see it*.)
- Host matching normalizes the header (lowercase, strip port, strip a trailing-dot FQDN — the exact bypass fixed in PR #64's review cycle, preserved here as a known pitfall).

This is a **positive** check ("is this path allowed on this host?"), not a negative one ("is this path forbidden?"). That is the whole point: default-deny means a forgotten module fails **closed** (404), not open.

**Layer 2 — Caddy per-host site blocks (best-effort defense in depth).**
`deploy/Caddyfile` already holds one site block per host. Be honest about the limit: **host-level scoping alone cannot stop platform paths on the CMS host** — one app serves every path, so `reverse_proxy app:3000` inside the `cms.bbm.academy` block forwards `/okr` just as readily as `/admin`. For Layer 2 to actually block anything, the CMS site block needs its **own path handling** (a matcher that 404s non-CMS paths before `reverse_proxy`) kept consistent with the middleware allowlist — which reintroduces a second place to keep in sync. This ADR therefore scopes Layer 2 as **best-effort defense-in-depth whose exact form is decided at P3 implementation** (#60): either a host-block path matcher mirroring the allowlist, or an accepted "middleware is the sole enforcement, Caddy stays coarse" posture. Layer 1 (in-process middleware) is the authoritative, machine-checkable enforcement regardless; Layer 2 is a second net, not the primary guarantee.

### 3. How platform routes mount (and how `/okr` returns in P3)

Two mechanisms are involved here, and they must not be conflated — a route group is **not** a URL prefix:

- **(a) The middleware host-allowlist keys on the *visible URL*.** Next middleware sees `request.nextUrl.pathname`, from which App Router route-group segments (the `(…)` folders) are **already stripped** — they never appear in the URL. So the allowlist can only match on real, visible path segments. The platform surface's visible URL shape is therefore a decision — **resolved by the owner (2026-07-24, checkpoint in the orchestrated #63 session): a single shared prefix `/p/*`** (e.g. `portal.bbm.academy/p/okr`). The middleware allowlist is then a **single entry forever** (`allow /p/* on portal, else 404`), self-maintaining as modules are added — no per-module wiring, an O(1) rule. The prefix in URLs is the accepted cost.

  Rationale / alternative rejected: **clean top-level URLs** (`/okr`, `/reviews`, …) read nicer, but the allowlist would have to **enumerate every module's top-level prefix** and gain a new entry per module — reintroducing the "remember to add an entry" burden default-deny exists to eliminate. (It fails *closed*: a forgotten entry 404s a real module rather than leaking one — strictly safer than the rejected blocklist, but still manual.) The self-maintaining O(1) allowlist decided the choice for the shared prefix.

- **(b) The `(platform)` route group is a *code* boundary, not a routing/allowlist mechanism.** Its role is to host the **shared OIDC `layout.tsx`** (and any shared platform chrome) so every platform page inherits the Zitadel gate (#59) and shared shell from one place. It is invisible to the URL and to middleware; it does not and cannot participate in the host-allowlist. Both the shared-prefix and clean-URL options above can sit inside a `(platform)` group — the group governs *code layout and the auth layout boundary*, the visible prefix governs *the allowlist*.

The OKR module re-mounts in P3 at **`/p/okr`** by adding a `page.tsx` under the `(platform)` group that renders the already-preserved `src/modules/okr/view/` components — no view rewrite, just a re-wire. The moment it mounts, it is:
1. **404 on the CMS host automatically** — the cms allowlist never contains a platform surface, so no new *deny* rule is ever added for the module; and
2. behind the Zitadel OIDC gate (#59), inherited from the `(platform)` group's shared `layout.tsx` (§3(b)).

Because `/p/*` is a single allowlist entry (§3(a)), the module needs **no** allowlist change on either host — it is covered the moment its page file exists.

The dependency-cruiser boundary (ADR-002) that already isolates `src/modules/okr` from CMS internals stays in force through the re-mount.

## Consequences

- **Leaks fail closed, not open.** Adding a future platform module requires *no* change to any blocklist; forgetting the host-allowlist wiring produces a 404, not a public page. The `/okr` incident class cannot recur by omission.
- **Host changes are rare and deliberate.** The authoritative host→surface intent lives in one middleware table; Caddy gains a site block per new *host*. Both change only when a genuinely new host appears (next: `portal.bbm.academy` at P3) — not on every new module. If §2 Layer 2 adopts a Caddy path matcher mirroring the allowlist, that is a second place to keep in sync — a cost weighed at P3 against keeping Caddy coarse and treating middleware as sole enforcement.
- **P3 (#60) gains a concrete acceptance shape:** DNS + Caddy site block for `portal.bbm.academy`, the single `/p/*` middleware allowlist entry for the platform surface, OKR re-mounted at `/p/okr` under the `(platform)` group, OIDC gate live. Owner acceptance = opening the real `portal.bbm.academy/p/okr` URL and signing in via Zitadel.
- **Middleware is now a load-bearing security boundary,** so it warrants a test (a Host-matrix test: each host × {allowed path, foreign-surface path} → expected 200-ish / 404), added with the P3 wiring, restoring the coverage PR #67 removed with the reverted guard.
- **Boundaries follow-up candidate (from PR #67 review):** `.dependency-cruiser.cjs`'s `cms-must-not-import-okr-internals` rule lists `app/\(payload\)` in its `from` set but **not** `app/(frontend)`. The CMS frontend route group can therefore import `src/modules/okr` internals without tripping the boundary check. Not fixed here (doc-only PR); flagged as a boundaries-hardening candidate to fold in when the platform route group lands in P3.

## Rejected alternatives

- **Per-route blocklist (PR #64 shape) — rejected at the 2026-07-24 checkpoint.** Blocking `/okr` (and each future module path) on the CMS host by explicit deny rule. Rejected by the owner as unscalable: every new module needs a remembered deny entry, and the failure mode of forgetting is a silent public leak — the exact risk the ADR must eliminate. Default-deny (§2) inverts this so new modules are covered automatically.
- **Separate deployable for the platform surface (two apps / two containers) — rejected per ADR-002 §3.** Physically separating hosts by giving the platform its own process would make topology a deployment fact rather than a config rule. But the platform surface passes **none** of ADR-002's deployable-earning criteria (same runtime, same security perimeter, no divergent load/lifecycle, boundary not yet stabilized in prod), and ADR-002 explicitly reserves a deployable slot for modules that earn it. Host-based routing inside the one process (this ADR) is the modular-monolith-consistent answer; extraction stays available later if a module fires ADR-002 §3 criteria.
- **No topology rule — rely on discipline / code review — rejected implicitly by the incident.** "Remember not to route platform paths into `main` before P3" is exactly what failed in the `/okr` near-leak. A systemic default-deny replaces discipline with a failure-closed mechanism.

---

*Numbering is ecosystem-wide and append-only (see `docs/adr/README.md`). Accepted at the 2026-07-24 owner checkpoint in the orchestrated #63 session: the §3(a) visible-prefix decision (`/p/*`) was resolved there; no open owner-decision markers remain in this ADR. Stand/dev-loop decisions (#62 recon) are tracked separately and are out of scope here.*
