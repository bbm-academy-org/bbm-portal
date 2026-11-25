---
paths:
  - '.github/pull_request_template.md'
  - '.github/workflows/pr-body-guards.yml'
  - 'tools/lint/change-tier-lint.mjs'
  - 'tools/lint/lib/change-tier.mjs'
  - 'tools/gh/**'
  - 'tools/lint/stage-b-lint.mjs'
---

<!-- READ-ON-DEMAND (`paths:` frontmatter, so not always-on). The frontmatter must stay the first bytes of the file. Indexed in AGENTS.md §0: read it before opening any PR, to set the `Change-tier:` line. -->

# Change tiers — Ship / Show / Ask

The procedure a change goes through is proportional to its risk. The tier is picked before work starts, from what the change does; the changed-file set sets a mechanical minimum the author may raise but never lower. Unsure → the higher tier. A request that turns out to need new logic is re-tiered, and the owner told, before the work continues.

Owner decision: 2026-11-24, recorded in the body of #597 (option "a", the ds-platform tiers ported).

| Tier | Qualifies                                                                                                                                                                                                                                                                                                                           | Procedure                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship | prose, typos, behaviour-free edits: only ship paths (below) — plain docs prose at any size, new or modified; a copy module modified with ≤80 lines; or **test-only** — a PR that changes only tests                                                                                                                                 | the lead authors it inline (no brief, no implementer), worktree + branch as usual; no separate review; no live stand; green CI; Stage-B is the owner's decision in chat                                                                                                                      |
| Show | ordinary UI and logic: a new state or behaviour inside an existing feature, a view-layer change; no Ask path                                                                                                                                                                                                                        | normal dispatch; independent review and the iteration-end gate stay; the owner's «принято» is given on agent-captured Playwright screenshots in the PR, with no stand visit. **The lead's UX-sanity pass and the `UX-record` stay mandatory on Show** (`.claude/rules/design-process.md` §2) |
| Ask  | auth / IdP, money (the finance module), member PII (152-FZ), the outbound site-dispatch integration, the dev-DB seed, DB migrations and schema, `infra/` and deploy, `.claude/` and `tools/` (instructions, guards, tooling), CI, dependencies and config, API and server endpoints, the Payload content contract, new specs / ADRs | the full cycle in `.claude/skills/task-cycle/SKILL.md`: the owner's go, independent review, the iteration-end gate, live-stand acceptance for an owner-visible change                                                                                                                        |

**Declaration.** Exactly one PR-body line `Change-tier: Ship|Show|Ask — <reason>` (case-insensitive; the bold label `**Change-tier:**` is accepted). A Ship or Show line must give a real reason (`n/a`, `tbd`, a `<placeholder>` is none); Ask needs none. A missing, duplicated or malformed line is a finding.

**Mechanical minimum** — `tools/lint/lib/change-tier.mjs`, the one classifier every gate reads; its path lists are the definition and are not restated here. In short: Ask when any changed path (or rename source) is structural — `tools/`, `.claude/`, `.github/`, `infra/`, `deploy/`, `scripts/`, `design-source/`, `AGENTS.md`/`CLAUDE.md`, a `package.json`, the lockfile, a config file, `middleware.*`, `src/migrations/`, `src/lib/platform/db/` — a test there included; or when a non-test file is on an auth/IdP, finance, member (`src/lib/member/`), site-dispatch (`src/lib/site{Dispatch,Sync}.ts`), seed (`src/seed/`), API/endpoint, Payload-contract (`src/{collections,globals,fields,hooks}/`) or `docs/{adr,specs}/` path. Otherwise Show when a non-test file is not a ship path, a non-prose file is added/removed/renamed, a prose doc or a test is removed (a test also when renamed), or non-test, non-prose changes exceed 80 lines. Otherwise Ship. An empty or incomplete changed-file set is Ask. `tests/helpers/` is not a test path (it seeds and deletes users in the shared dev DB), so it is at least Show.

**Ship paths** (an allowlist; tests are exempt): plain prose — `docs/**/*.md` outside `docs/{adr,specs}/`, `DEBT.md`, a `README.md` — at any size and when new; a copy module (`copy.ts`, `*-copy.ts`, `copy/*.ts` under `src/`), capped and never new. Canon docs (`docs/specs/`, `docs/adr/`, the rule and skill files under `.claude/`) are prose too but keep their Ask floor on purpose: they are decisions and procedure, not copy. Unlike ds-platform, a view-layer `*.tsx` / `*.css` is never a ship path here: bbm's Ship is prose only.

**Routing.** Every gate routes by the **effective** tier — `resolveTier` in the classifier: max(declared, minimum), and Ask when the line is missing or invalid, so an undeclared PR never buys a lighter procedure. Each gate re-proves the minimum from the PR's changed-file set itself; the body line alone is never trusted.

- `pnpm pr:land` refuses a declaration below the minimum, lifts the review requirement only for a verified Ship (the review-free class, `.claude/skills/task-cycle/SKILL.md` stage 4), and names the acceptance the tier owes.
- `pnpm lint:stage-b` routes the Stage-B record: Show accepts the owner's `Stage-B: GO (screenshots) — <owner, date>`, Ask only the live-stand `GO — <owner, date>` (`.claude/rules/design-process.md` §2; the acceptance protocol is task-cycle stage 5).

**Enforcement.** The `change-tier` guard (`pnpm lint:change-tier <PR>`, job in `pr-body-guards.yml`, row in `docs/ci-guardrails.md` §5) reports a missing/duplicate/malformed line and a declaration below the minimum. Its CI job is WARN until the §4 promotion clock allows BLOCK (the §5 row holds the date); the merge gate already refuses a declaration below the minimum.
