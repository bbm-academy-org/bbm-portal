# ADR-002: Repository & module strategy for the BBM Platform

**Status:** Accepted
**Date:** 2026-07-24
**Decider:** Anton Sidorov (owner)
**Prepared by:** Claude (recon of `bbm`, `bbm-platform-prd`, `bbm-kb`, `bbm-public-website`, `ds-platform` + three independent industry-practice research sweeps, 2026-07-24 session)
**Related:** BBMP-129 (milestone «платформа BBM — динамический слой»), `bbm-platform-prd` spec v1.5 + D-001..D-029, `ds-platform` ADR-0008, plan `bbm/docs/superpowers/plans/2026-06-11-bbm-portal-payload-setup.md`

## Context

The BBM Platform target architecture (`bbm-platform-prd/docs/superpowers/specs/2026-04-07-bbm-platform-design.md` v1.5) plans **10+ custom deployable components** across phases 5–9 (Core Service, Access Sync, Event Log, Schema Registry, Knowledge Gateway, MCP connectors, AI layer, marketplace logic, Web3 layer). The decision log D-001..D-029 fixes the stack, zones and service boundaries — but **repository granularity was never decided**. The first dynamic module (OKR dashboard, BBMP-129) forced the question: same repo, new repo per product, or a platform monorepo.

Inputs weighed:

1. **Current estate** — polyrepo by nature of the repos: `bbm-portal` (the only platform *application*), `bbm-kb` (content master + SSOT), `bbm-public-website` (Astro site), `bbm` (holding ops/strategy/Terraform). One prior decision (2026-06-12 plan, decision #1): single Next.js app, monorepo only when a genuine second deployable appears (YAGNI).
2. **Sibling precedent** — `ds-platform` ADR-0008: single-purpose monorepo (`apps/*` + `packages/*`, pnpm + Turborepo), explicitly rejecting polyrepo (tooling duplication, no atomic cross-app refactors) and strategy-with-code mixing (AI-agent context bleed). Notably `apps/cms` (Payload) and `apps/portal` are separate apps there.
3. **Industry practice** (three research sweeps, 2026-07-24; sources in PR):
   - *Mono vs poly:* for a 1–2 dev TS-only team, a light pnpm-workspace monorepo is the near-consensus choice; anti-monorepo arguments target 100+ dev scale; documented regrets skew toward premature splitting; single-app → workspace conversion costs ~days.
   - *AI-agent workflows:* repo boundaries act as "context walls" for agents; parallel agent work is isolated via git worktrees, not extra repos; context bloat in bigger repos is managed with nested agent-instruction files and scoped sessions.
   - *Deploy boundaries:* modular monolith is the default for tiny teams ("Citadel": one core + few earned outposts). Each extra deployable on a Compose/VPS estate costs real ops (image, CI, healthcheck, proxy entry, OIDC client, monitoring, backups, runbook); realistic budget for the whole custom platform at this team size is **~3–5 deployables**. Payload v3's official line is "app framework": product surfaces co-located in the same Next.js app are the mainstream pattern (Local API, shared types).

## Decision

1. **One platform code repository.** All custom BBM Platform application code lives in **this repo** (`bbm-portal`; to be renamed `bbm-platform` together with the workspace conversion of decision 4). Per-module repos (polyrepo) are rejected.
2. **What stays outside** (different nature/lifecycle, not "everything BBM" gravity):
   - `bbm-kb` — holding knowledge master + SSOT core (content, PR-edited; D-015);
   - `bbm` — holding strategy/ops; **Terraform/IaC stays centralized there** for all hosts;
   - `bbm-public-website` — own lifecycle and consumer contract; *candidate* to join the monorepo later, trigger = a genuinely shared package (e.g. content Zod-schemas or design tokens);
   - `ds-platform` — separate platform forever; identity link is Zitadel OIDC federation only.
3. **Modular monolith inside (Citadel pattern).** A new platform module is **by default a route + isolated library in this Next.js app**: it exposes a public API, owns its data, and never imports another module's internals. The boundary is machine-enforced in CI (dependency-cruiser or equivalent). A module **earns** a separate deployable only via explicit criteria — at least one of:
   - different runtime/technology (e.g. Python RAG stack);
   - divergent performance/lifecycle profile (queues, cron, long jobs, independent restart cadence);
   - different security perimeter (e.g. provisioning worker holding admin tokens to Zitadel/Plane/Mattermost);
   - the boundary has **stabilized in production** (extraction, not prediction).
   "Different business domain", "cleaner this way" and "we'll extract it anyway" are explicitly **not** criteria.
4. **Workspace conversion by trigger, not upfront.** The repo converts to a pnpm workspace (`apps/*` + `packages/*`, `ds-platform` as the structural template) when the **first genuine second app or shared package** appears. Until then: single app at root.
5. **Auth split (owner decision 2026-07-24, supersedes PRD OQ-2 recommendation):**
   - Portal end-user surfaces (starting with `/okr`) are gated by **Zitadel `id.bbm.academy` (OIDC) from day one** — no interim native-auth stage. The pattern is already proven in the estate (`kb.bbm.academy` behind oauth2-proxy → Zitadel), and the team already holds Zitadel accounts.
   - **Payload native auth remains admin-only** (the `users` collection = CMS editors). It is not used for portal end-users.
   - Every future *separate* deployable is an OIDC client of `id.bbm.academy` from day one.
6. **Platform engineering ADRs live here** (`docs/adr/`), following the `ds-platform` ADR-0008 rationale (decisions next to the code, in the working agent's context). Holding-level decisions stay in `bbm` / `bbm-kb`; platform architecture specs (D-series) stay in `bbm-platform-prd` — a follow-up D-030 entry there should point at this ADR.

## Consequences

- **BBMP-129 milestone survives with two corrections:**
  - BBMP-130 (P1) additionally requires module discipline: `src/lib/okr` + the `/okr` route import nothing from the CMS internals (collections/globals/endpoints); a dependency-cruiser (or equivalent) boundary check enters CI with this task.
  - BBMP-131 (P2) is re-scoped: **OIDC gate via Zitadel** (forward-auth/oauth2-proxy in front of `/okr`, or in-app OIDC session when a user identity is needed in React — implementation choice belongs to the task), **not** native Payload auth.
- The June 2026-06-12 decision #1 ("single Next.js app, monorepo by trigger") is confirmed and extended, now evidence-backed rather than intuition.
- Future modules (dozens planned) get evaluated against §3 criteria instead of re-running this investigation. Expected early outposts by those criteria: Knowledge Gateway (runtime), Access Sync (security perimeter). `hermes` on kz-1 already validates the outpost pattern.
- Renaming to `bbm-platform` is deferred to the workspace conversion moment (one rename, one migration of remotes/links).

## Rejected alternatives

- **New repo per internal product** (`bbm-okr`, …): duplicates auth/CI/tooling per module, breaks atomic cross-module changes, fragments AI-agent context; rejected by both `ds-platform` ADR-0008 experience and current industry consensus for this team size.
- **Immediate split of portal app from CMS app** (two apps in a workspace now): the portal today passes none of the §3 deployable criteria (same runtime, same perimeter, no load divergence, boundary not yet stabilized — Fowler: boundaries guessed upfront are usually wrong); Payload v3's official pattern favors co-location; a deployable slot would be spent on a read-only dashboard for ~10 users. The module-boundary discipline of §3 keeps a future extraction mechanical if/when criteria fire.
- **Immediate workspace conversion with a single app:** ceremony without benefit; conversion is a ~2-day mechanical move whenever the trigger fires.
