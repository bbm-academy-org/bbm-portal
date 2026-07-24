# ADR-003: Domain topology — `cms.bbm.academy` vs `portal.bbm.academy`

**Status:** Proposed (awaiting owner checkpoint sign-off)
**Date:** 2026-07-24
**Decider:** Anton Sidorov (owner)
**Prepared by:** Claude (domain-topology recon after the `/okr` near-leak, issue #63 item 2)
**Related:** ADR-002 (repository & module strategy — modular monolith), issue #63 (post-#61 remediation), #60 (P3 prod: `portal.bbm.academy` DNS + Caddy), #59 (Zitadel OIDC gate), PR #64 (reverted per-route guard), PR #67 (`/okr` unrouted), BBMP-129 milestone

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

**Layer 2 — Caddy per-host site blocks (defense in depth).**
`deploy/Caddyfile` already holds one site block per host. The blocks stay the second layer: even if a bug slips past middleware, the CMS host block should not forward platform paths to the app. This layer is coarse (host-level proxy scoping), the in-process middleware is the fine-grained authority. Two independent layers means a single mistake in either does not produce a leak.

### 3. How platform routes mount (and how `/okr` returns in P3)

Platform modules mount under a **dedicated route group / path prefix** so that "the platform surface" is one contiguous, allowlistable thing rather than routes scattered across the tree. The concrete prefix is a **proposal — «предложение, требует решения владельца»**: candidates are a bare top-level path (`/okr`, `/…` per module, with the *route group* — e.g. `src/app/(platform)/…` — being the allowlist unit) versus a shared prefix (`/app/okr`, `/p/okr`). The route-group approach (`(platform)` segment, URL-invisible) is the recommended default because it makes the allowlist a single filesystem boundary the middleware can key on, while keeping clean top-level URLs. Final path shape is deferred to P3 (#60) and owner decision.

`/okr` re-mounts in P3 by adding a `page.tsx` (and layout) under that platform route group that renders the already-preserved `src/modules/okr/view/` components — no view rewrite, just a re-wire. The moment it mounts, it is:
1. reachable only on `portal.bbm.academy` (middleware §2 default-deny keeps it 404 on the CMS host automatically — **no new guard rule**), and
2. behind the Zitadel OIDC gate (#59).

The dependency-cruiser boundary (ADR-002) that already isolates `src/modules/okr` from CMS internals stays in force through the re-mount.

## Consequences

- **Leaks fail closed, not open.** Adding a future platform module requires *no* change to any blocklist; forgetting the host-allowlist wiring produces a 404, not a public page. The `/okr` incident class cannot recur by omission.
- **Two configs stay in sync by construction.** The host→surface intent lives in one middleware table and is mirrored (coarsely) in Caddy. Both must be updated when a genuinely new *host* appears — a rare, deliberate event (next: `portal.bbm.academy` at P3) — not on every new module.
- **P3 (#60) gains a concrete acceptance shape:** DNS + Caddy site block for `portal.bbm.academy`, middleware allowlist entry for the platform surface, `/okr` re-mounted under the route group, OIDC gate live. Owner acceptance = opening the real `portal.bbm.academy/okr` URL and signing in via Zitadel.
- **Middleware is now a load-bearing security boundary,** so it warrants a test (a Host-matrix test: each host × {allowed path, foreign-surface path} → expected 200-ish / 404), added with the P3 wiring, restoring the coverage PR #67 removed with the reverted guard.
- **Boundaries follow-up candidate (from PR #67 review):** `.dependency-cruiser.cjs`'s `cms-must-not-import-okr-internals` rule lists `app/\(payload\)` in its `from` set but **not** `app/(frontend)`. The CMS frontend route group can therefore import `src/modules/okr` internals without tripping the boundary check. Not fixed here (doc-only PR); flagged as a boundaries-hardening candidate to fold in when the platform route group lands in P3.

## Rejected alternatives

- **Per-route blocklist (PR #64 shape) — rejected at the 2026-07-24 checkpoint.** Blocking `/okr` (and each future module path) on the CMS host by explicit deny rule. Rejected by the owner as unscalable: every new module needs a remembered deny entry, and the failure mode of forgetting is a silent public leak — the exact risk the ADR must eliminate. Default-deny (§2) inverts this so new modules are covered automatically.
- **Separate deployable for the platform surface (two apps / two containers) — rejected per ADR-002 §3.** Physically separating hosts by giving the platform its own process would make topology a deployment fact rather than a config rule. But the platform surface passes **none** of ADR-002's deployable-earning criteria (same runtime, same security perimeter, no divergent load/lifecycle, boundary not yet stabilized in prod), and ADR-002 explicitly reserves a deployable slot for modules that earn it. Host-based routing inside the one process (this ADR) is the modular-monolith-consistent answer; extraction stays available later if a module fires ADR-002 §3 criteria.
- **No topology rule — rely on discipline / code review — rejected implicitly by the incident.** "Remember not to route platform paths into `main` before P3" is exactly what failed in the `/okr` near-leak. A systemic default-deny replaces discipline with a failure-closed mechanism.

---

*Numbering is ecosystem-wide and append-only (see `docs/adr/README.md`). Points marked «предложение, требует решения владельца» are proposals pending owner sign-off at the #63 checkpoint; the ADR does not become **Accepted** until then.*
