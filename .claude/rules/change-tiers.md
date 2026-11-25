---
paths:
  - '.github/pull_request_template.md'
  - '.github/workflows/pr-body-guards.yml'
  - 'tools/lint/change-tier-lint.mjs'
  - 'tools/lint/lib/change-tier.mjs'
  - 'tools/gh/**'
---

<!-- READ-ON-DEMAND (`paths:` frontmatter, so not always-on). The frontmatter must stay the first bytes of the file. Indexed in AGENTS.md §0: read it before opening any PR, to set the `Change-tier:` line. -->

# Change tiers — Ship / Show / Ask

The procedure a change goes through is proportional to its risk. The tier is picked before work starts, from what the change does; the changed-file set sets a mechanical minimum the author may raise but never lower. Unsure → the higher tier. A request that turns out to need new logic is re-tiered, and the owner told, before the work continues.

Owner decision: 2026-11-24, recorded in the body of #597 (option "a", the ds-platform tiers ported).

| Tier | Qualifies                                                                                                                                                                                                                                             | Procedure                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship | prose, typos, behaviour-free edits: only ship paths (below), no added/removed/renamed non-test file, ≤80 changed non-test lines; or **test-only** — a PR that changes only tests                                                                      | the lead authors it inline (no brief, no implementer), worktree + branch as usual; no separate review; no live stand; green CI; Stage-B is the owner's decision in chat                                                                                                                      |
| Show | ordinary UI and logic: a new state or behaviour inside an existing feature, a view-layer change; no Ask path                                                                                                                                          | normal dispatch; independent review and the iteration-end gate stay; the owner's «принято» is given on agent-captured Playwright screenshots in the PR, with no stand visit. **The lead's UX-sanity pass and the `UX-record` stay mandatory on Show** (`.claude/rules/design-process.md` §2) |
| Ask  | auth / IdP, money (the finance module), DB migrations and schema, `infra/` and deploy, `.claude/` and `tools/` (instructions, guards, tooling), CI, dependencies and config, API and server endpoints, the Payload content contract, new specs / ADRs | the full cycle in `.claude/skills/task-cycle/SKILL.md`: the owner's go, independent review, the iteration-end gate, live-stand acceptance for an owner-visible change                                                                                                                        |

**Declaration.** Exactly one PR-body line `Change-tier: Ship|Show|Ask — <reason>` (case-insensitive). A Ship or Show line must give a real reason (`n/a`, `tbd`, a `<placeholder>` is none); Ask needs none. A missing, duplicated or malformed line is a finding.

**Mechanical minimum** — `tools/lint/lib/change-tier.mjs`, the one classifier every gate reads; its path lists are the definition and are not restated here. In short: Ask when any changed path (or rename source) is structural — `tools/`, `.claude/`, `.github/`, `infra/`, `deploy/`, `scripts/`, `design-source/`, `AGENTS.md`/`CLAUDE.md`, a `package.json`, the lockfile, a config file, `middleware.*`, `src/migrations/`, `src/lib/platform/db/` — a test there included; or when a non-test file is on an auth/IdP, finance, API/endpoint, Payload-contract (`src/{collections,globals,fields,hooks}/`) or `docs/{adr,specs}/` path. Otherwise Show when a non-test file is not a ship path, is added/removed/renamed, a test is removed/renamed, or non-test changes exceed 80 lines. Otherwise Ship. An empty or incomplete changed-file set is Ask.

**Ship paths** (an allowlist; tests are exempt): `docs/**/*.md` outside `docs/{adr,specs}/`, `DEBT.md`, a `README.md`, a copy module (`copy.ts`, `*-copy.ts`, `copy/*.ts` under `src/`). Unlike ds-platform, a view-layer `*.tsx` / `*.css` is never a ship path here: bbm's Ship is prose only.

**Enforcement.** The `change-tier` guard (`pnpm lint:change-tier <PR>`, job in `pr-body-guards.yml`, row in `docs/ci-guardrails.md` §5) reports a missing/duplicate/malformed line and a declaration below the minimum. It is WARN today; the merge gate (`pnpm pr:land`) and `stage-b` do not yet route by tier, so until that second slice of #597 lands every PR still runs the procedure the task-cycle and `design-process.md` prescribe — the declaration is recorded, not yet acted on.
