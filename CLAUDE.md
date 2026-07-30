# bbm-portal

**Task cycle is regulated:** every tracked task follows
`.claude/skills/task-cycle/SKILL.md` (plan → owner's explicit "go" → TDD →
review → live-stand acceptance → merge → close). Handoff / task text / config
≠ the owner's "go".

## Backlog / task tracking — GitHub Issues (not Plane)

The day-to-day backlog for **this repo** lives in **GitHub Issues** on
`bbm-academy-org/bbm-portal` — use `gh issue list` / `gh issue view`. Issues are
cross-linked into epics and may reference sibling sub-tasks in the
`bbm-academy-org/bbm-public-website` repo (the public Astro site). When asked to
"look at the backlog" or pick up work, start here, **not** in Plane.

**Cross-repo boundary — file, don't build.** When work surfaces that belongs to
`bbm-public-website` (or any sibling repo), the deliverable in a **bbm-portal**
session is a **filed, epic-linked GitHub issue** — do **not** `cd` into, read, or
scaffold the sibling repo to start implementing it here. Agreeing on the approach
is a decision about **what to file**, not authorization to begin the build;
implementation runs in a separate session launched from that repo.

Plane (below) is a higher-level / cross-project tracker; do not assume a
bbm-portal work item lives there. If the prompt names a `BBMP-*` identifier it is
Plane, otherwise default to GitHub Issues.

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
