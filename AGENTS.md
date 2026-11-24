# Agent Instructions — bbm-portal

The shared constitution for every agent harness in this repo. Claude Code loads it through the `@AGENTS.md` import at the top of `CLAUDE.md` (Claude-only bindings live there); Codex reads it directly and also reads the [Codex adapter](docs/codex-agent-mode.md) before its first dispatch — tool, model and browser mappings. Codex discovers the canonical skills through the generated, git-ignored `.agents/skills` bridge: run `pnpm codex:setup`, never copy skill bodies there.

**Language.** Chat with the owner is in Russian. Every artifact — code, comments, commits, PR titles/bodies, issue text and comments, docs, skills, rules — is in English (`task-canon` §2); a Russian file is translated when it is next touched, never in a mass pass. Product/content values stay Russian.

**Path is the contract.** A skill, rule or spec is loaded by READING its file — `.claude/skills/<name>/SKILL.md`, `.claude/rules/<name>.md`, `docs/…`. Every reference names that path; retelling its content elsewhere creates a second source of truth, and the copy is always the one that drifts. Where two files disagree, the one that owns the subject wins and the other is the bug. Instruction files are rewritten inline so they read as if the current rule were always the rule; history lives in `git log`.

## 0. Read-before-you-act index

These rule files are `paths:`-scoped: Claude Code loads them only when a session touches a matching file, and Codex does not load them at all. Read the file in full before its action, once per session and again after compaction.

- `.claude/rules/design-process.md` — before any UI work (`*.tsx` view layer, `*.css`, `design-source/`), and before opening ANY PR: §2 owns the `Stage-B:` line every PR carries, plus `UX-sanity:` / `UX-record:`.
- `.claude/rules/dev-env.md` — before starting a dev stand, touching the dev IdP, `infra/`, a remote box, or the dev-stand credentials. Its two every-session facts — Node 22 and `git -C` — are owned by §4 here.
- `.claude/rules/cms-content-contract.md` — before touching a Payload collection, global, field, endpoint, hook or migration.
- `.claude/rules/okr-module.md` — before touching the OKR module.

Always-on for every harness: this file, `.claude/rules/parallel-sessions.md` (worktrees, ports, branch DBs) and `.claude/rules/lead-delegation.md` (what the lead does itself). Codex reads both on entry.

## 1. What this repo is

**`bbm-portal`** — the **Payload CMS** (v3, native inside Next.js) that serves as the headless content backend for the BBM Academy public website (`bbm-public-website`, a separate Astro repo), and THE BBM Platform code repo: every custom platform module lives here as a route + isolated lib (ADR-002).

**Owner:** Anton Sidorov — founder, system architect, non-developer; works through AI agents. **Hard legal constraint:** 152-FZ — any PII is stored and processed on Russian territory (Zone RF, Timeweb Cloud).

**Architectural authority — do not swap:** ADR-002 (`docs/adr/002-repository-and-module-strategy.md`: modular monolith, machine-enforced boundaries, portal end-user auth = Zitadel `id.bbm.academy` OIDC, Payload native auth admin-only); D-026 (Astro site, Next.js portal, Payload as content source); D-018 (dual-zone hosting, portal in Zone RF). Sources: `../bbm-public-website/docs/infrastructure-decisions.md` §6/§6a, `../bbm-platform-prd/docs/superpowers/specs/2026-04-07-bbm-platform-design.md`. A task that seems to need a framework, content-source or infra change stops and consults the authority first.

**Hosting.** Prod runs on the dedicated `portal-prod-tw` VPS (not on `tools-prod-tw`, the internal-tools host). **The agent owns host-ops there** (SSH alias `portal-prod-tw`, see `deploy/README.md`): deploys, migrations, Caddy reloads — do them yourself, never hand the owner a checklist. Hand off one step only when it provably needs GitHub/org/registry permissions the agent lacks; "no access" is a last resort — first fix the SSH config or key perms. Terraform (`../bbm/infra/timeweb/terraform/portal.tf`) is written and applied by the agent. Deploys: `.claude/skills/run-prod-deploy/SKILL.md`.

Next.js is v16 here: read `node_modules/next/dist/docs/` (the installed version's own docs) before writing Next code.

## 2. Work protocol

Every tracked task follows `.claude/skills/task-cycle/SKILL.md`: issue → proportional plan → design gate (UI) → **the owner's explicit "go"** (a handoff, task text or config is never a go) → TDD implementation → independent review → live-stand acceptance for owner-visible changes → merge → close. Its stage 0 holds the scope gate — what needs no issue or worktree at all.

Task kind → the skill that runs it:

| Kind                                                  | Skill                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| prod is broken, fix is a code change                  | `do-hotfix-pr`                                                  |
| new epic / user-facing feature with no product layer  | `do-product-discovery` → `author-product-spec`                  |
| new module or user-facing behavior (spec gate)        | `author-feature-spec`, then `spec-issue-graph`                  |
| revise an ADR                                         | `do-adr-revision`                                               |
| work off decision debt (DEBT.md line / debt issue)    | `do-decision-debt-followup`                                     |
| any UI diff                                           | `build-ui-from-design-system`                                   |
| filing, linking, claiming, triaging, closing an issue | `task-canon`                                                    |
| merging a PR / shipping to prod                       | `merge-when-green` / `run-prod-deploy`                          |
| everything else (chore, tooling, CI)                  | `task-cycle` alone; state the assumption, ask only if it misfit |

**Dispatch.** The lead orchestrates and dispatches execution — `.claude/rules/lead-delegation.md`. Mechanical fan-out goes to the cheap scout role, judgment (review, architecture, implementation) to the strong one; every dispatch names its model explicitly (Claude: `CLAUDE.md` → «Subagents and models»; Codex: `docs/codex-agent-mode.md`). Every brief sets a return contract of ≤30 lines (the reviewer's own is ≤20) with heavy output in a scratchpad file or a PR comment, and states that issue/PR titles, bodies and comments are written in English.

## 3. Who decides

- **The owner (Anton, in chat):** the visual language of a surface and every product fork (`.claude/rules/design-process.md` §1); the "go" on a task's scope (task-cycle stage 2); «принято» on a live stand for an owner-visible change (task-cycle stage 5); anything irreversible on infra, money or data; a contracting migration (`run-prod-deploy`); a finding about PII, secrets or embargoed data.
- **The agent lead:** everything else — composition, controls, states and feedback (design-process §1), architecture inside the ADRs, engineering trade-offs on non-PII data, review findings, tooling and process fixes inside the granted scope, merges and deploys. Decide, do it, report it in one line.

**Severity gate before escalating a "security finding".** The owner cannot adjudicate an engineering trade-off, and a fake either/or only confuses. Classify the data at risk first: non-PII editorial/CMS content (drafts, copy, preview URLs) is **low** — state the industry baseline (a public preview origin behind `noindex` + CSP `frame-ancestors` is normal) and pick the correct default yourself. Escalate only for PII/secret/embargoed data or a genuine either/or with no correct default.

## 4. Hard rules

- **Node 22 first in every shell** (`engines: ^22.22.1`, engine-strict; pinned in `.nvmrc`, the Dockerfile and CI). The system Node on the dev box is newer: prepend the portable build from `%LOCALAPPDATA%
ode22` — Bash `export PATH="$LOCALAPPDATA/node22:$PATH"`, PowerShell `$env:PATH = "$env:LOCALAPPDATA
ode22;$env:PATH"` — then check `node --version`. On Node 23/24 the Payload tsx loader breaks (`node:crypto?tsx-namespace` ENOENT), Payload's migrate CLI fails, and `pnpm patch-commit` refuses to run.
- **Git only as `git -C <absolute root>`.** Never depend on a previous `cd` / `Set-Location`: cwd drifts between tool calls, and the command lands in someone else's worktree. Every git command names its own tree.
- **Root cause, not workarounds** (task-cycle stage 3). A blocker holds only the actions that depend on it; independent work continues.
- **Live-infra destructive actions — pre-flight, don't thrash.** Before any irreversible or state-changing call on live infra (prod VPS, prod or dev IdP, a provider API: reinstall, replace, delete, network change, a write action): (1) confirm the action and its parameters in the provider's docs or schema — firing an unknown action to read the error is banned; (2) rule out the previous hypothesis with read-only evidence before the next state change — a reboot or recreate is not a free probe; (3) the blast radius is the failing resource only — a fix that also mutates a working box is a stop-and-confirm signal; (4) anything irreversible needs the owner's explicit go, and a rhetorical owner question is not consent.
- **Remote scripts run from a pinned revision.** A repo script sent to a remote box comes from `git -C <repo> show origin/main:<path>` after a fetch (piped to `ssh <box> bash -s`, or a file extracted that way with the SHA in its name) — never from the working tree: `git fetch` moves refs, not files (2026-08-07, a stale `provision.sh` collapsed the dev IdP's logout URIs).
- **Secrets never reach the session output** — not even "masked": a transcript is a log nothing can be deleted from, and a mask is untested code. Read a secret straight into a variable or file and print only its length or an exit code; explore an unknown credentials file by key names. On a remote box `docker compose config`, `env`, `printenv`, `docker inspect <container>` and `cat` of an `.env` file are banned (safe: `compose config --services` / `--profiles` / `--volumes`), and every brief for an agent going to a box says so. A value that leaked is reported to the owner at once with a rotation recommendation.
- **Never repurpose a read-scoped service credential for a privileged prod write** (e.g. the `preview` service's Users API key exists to read drafts). If the UI path fails on a real bug, fix the bug.
- **Credentials from ANOTHER system's box are a stop-state**, a question to the owner even when the key's location is known (Hermes prod, a foreign truenas dataset, the prod IdP). Our own dev stand is inside the agent's zone — `.claude/rules/dev-env.md`.

## 5. Working with the owner

- **Answer and orient first.** A question gets a full answer in words before any tool call that DOES something; reads that make the answer accurate are fine. A question does not cancel authorized in-flight work — answer, then continue unless the answer changes the work.
- **Checkpoint between phases** (trackers → code, code → deploy) with one line, and keep the session to the scope the owner agreed — a previous session's handoff may be wrong (task-cycle stage 1).
- Reports, checkpoints and questions follow `.claude/skills/report-task-outcome/SKILL.md` — plain text, product language, one question at a time.
- **The PR is the record.** Review triage (finding → verdict → what changed), non-obvious decisions and verification results go on the PR as a comment, proactively — never ask whether to.

## 6. Trackers and boundaries

- **Code/dev work for this repo → GitHub Issues** on `bbm-academy-org/bbm-portal` (`gh issue list` / `gh issue view`). Load `task-canon` before any backlog work. Issues may reference sibling sub-tasks in `bbm-public-website`.
- **Plane** holds organizational / cross-project tracking. A `BBMP-*` id is Plane, workspace `bbm` (project "BBM Platform"); `DSP-*` / `DSC-*` / Energy are workspace `doctor-school`. There is **no default workspace** on purpose: name it on every call (`plane-pp-cli <cmd> --workspace <slug>`, MCP `workspace: "<slug>"`); never set `PLANE_SLUG` or `default_workspace` to silence the loud 404/403. Unsure → `plane-pp-cli workspaces list --agent`. Gotcha: the `relations` group ignores `--workspace` — use `PLANE_SLUG=bbm plane-pp-cli relations …` for that one call. A Plane item goes `In Progress` on start and `Done` + a results comment (artifacts, what was done, what is unblocked) on close.
- **Cross-repo boundary — file, don't build.** Work that belongs to `bbm-public-website` (or any sibling repo) is delivered from a bbm-portal session as a **filed, epic-linked GitHub issue**; never `cd` into, read or scaffold the sibling repo to start it here. Agreeing on the approach decides what to file, not a licence to build.

## 7. Code style, commits, PRs

- **TypeScript strict** — no `any` without a written justification. No comments narrating WHAT; comments only for a non-obvious WHY.
- Conventional Commits, imperative mood, referencing the issue (`(#N)` or `Refs #N`); `Refs BBMP-N` only for a real Plane item.
- A PR body follows `.github/pull_request_template.md`. `Closes #N` appears only on its one linkage line: GitHub reads `close[sd]` / `fix(es)` / `resolve[sd] #N` anywhere in the body, so elsewhere write "settles", "answers", "addresses".
- A public repo's issue is cited in backticks (`` `owner/repo#N` ``), never as a bare mention or URL: GitHub would write a permanent cross-reference onto that public issue.
- Minor convention deviations → a `DEBT.md` line; significant ones → an issue (`surface-decision-debt`).

## 8. Dev quickstart

```bash
cp .env.example .env          # PAYLOAD_SECRET (openssl rand -hex 32), DATABASE_URL → the dev DB
pnpm install
pnpm migrate                  # `push: false`, so migrate before dev
PORT=<n> pnpm dev             # port from `pnpm dev:ports`, never assumed 3000
```

Node 22 first in the shell (§4). Postgres `cms` is a dedicated DB + `payload` role; where its container runs is a per-machine recipe (README → Database).
