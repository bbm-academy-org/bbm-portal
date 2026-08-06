# bbm-portal

**Task cycle is regulated:** every tracked task follows
`.claude/skills/task-cycle/SKILL.md` (plan → design gate → owner's explicit
"go" → TDD → review → live-stand acceptance → merge → close). Handoff / task
text / config ≠ the owner's "go".

**Path is the contract.** A skill, rule or spec is loaded by READING its file —
`.claude/skills/<name>/SKILL.md`, `.claude/rules/<name>.md`, `docs/…`. Every
reference to one names that path; retelling its content somewhere else creates a
second source of truth, and the copy is always the one that drifts. A file that
must point at another points: path plus what lives there, never a paraphrase.
Where two files do disagree, the one that owns the subject wins and the other is
the bug.

**Parallel sessions are the norm here — read the rules before touching a branch
or a port.** The session's work branch lives in its OWN worktree
(`pnpm task:worktree <N>`), never in the shared checkout; the dev port is taken
with `pnpm dev:ports`, never assumed to be 3000; a listener you did not start is
never killed. Full rules: [`.claude/rules/parallel-sessions.md`](.claude/rules/parallel-sessions.md).
Machine specifics (portable Node 22, `git -C`, the 3000–3009 Zitadel range):
[`.claude/rules/dev-env.md`](.claude/rules/dev-env.md).

## Backlog / task tracking — GitHub Issues (not Plane)

The day-to-day backlog for **this repo** lives in **GitHub Issues** on
`bbm-academy-org/bbm-portal` — use `gh issue list` / `gh issue view`. Issues are
cross-linked into epics and may reference sibling sub-tasks in the
`bbm-academy-org/bbm-public-website` repo (the public Astro site). When asked to
"look at the backlog" or pick up work, start here, **not** in Plane.

**Tasks are created only via `pnpm issue:create`** (raw `gh issue create` is
forbidden) — load the `task-canon` skill before any backlog work: filing,
reformatting, linking, claiming, triaging or closing an issue.

**Cross-repo boundary — file, don't build.** When work surfaces that belongs to
`bbm-public-website` (or any sibling repo), the deliverable in a **bbm-portal**
session is a **filed, epic-linked GitHub issue** — do **not** `cd` into, read, or
scaffold the sibling repo to start implementing it here. Agreeing on the approach
is a decision about **what to file**, not authorization to begin the build;
implementation runs in a separate session launched from that repo.

Plane (below) is a higher-level / cross-project tracker; do not assume a
bbm-portal work item lives there. If the prompt names a `BBMP-*` identifier it is
Plane, otherwise default to GitHub Issues.

## Subagents and models

Every `Agent` call must pass an explicit `model` — inheriting the lead's
session model is forbidden (a Fable lead otherwise silently spawns Fable
subagents; Fable is never a subagent, only the orchestrator). Mechanical
fan-out (search, inventory, fact-gathering) → `bbm-explorer` (Sonnet).
Judgment (review, architecture, implementation) → Opus: `bbm-reviewer` for
PR review (task-cycle stage 4), or `general-purpose` with explicit
`model: opus` for everything else. Return contract in every brief is ≤30
lines by default (`bbm-reviewer`'s own contract is stricter: ≤20); heavy
output goes to a scratchpad file or PR comment, never into the agent's
reply.

## Plane (project tracker) — workspace targeting

The `plane-pp-cli` / `plane-pp-mcp` setup has **no default workspace** on purpose:
`bbm` and `doctor-school` are used 50/50, so there is no "primary". A call that
does not name a workspace falls to a sentinel slug and **fails loudly** (404/403)
rather than silently hitting the wrong one. Do **not** set `PLANE_SLUG` or
`default_workspace` to "fix" such an error — name the workspace instead.

**Always target the workspace explicitly:**

- CLI: `plane-pp-cli <cmd> --workspace <slug> …`
- MCP: pass `workspace: "<slug>"` to `plane_execute`.

**Which slug:** this repo's work lives in the **`bbm`** workspace — its issues are
prefixed `BBMP-*` (e.g. `BBMP-26`, project "BBM Platform"). Use `--workspace bbm`
unless a task explicitly references a `doctor-school` issue (prefixes `DSP-*` /
`DSC-*` / Energy), in which case use `--workspace doctor-school`.

If unsure which workspace an identifier belongs to, run
`plane-pp-cli workspaces list --agent` (both are enrolled) and pick by prefix —
never guess by relying on an implicit default.
