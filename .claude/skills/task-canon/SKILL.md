---
name: task-canon
description: How a task is formulated in this repo — issue body skeleton, the Type + channel:* + milestone taxonomy, the native sub-issue / blocked_by graph, the two claim signals, stop-state comments, the issue-vs-DEBT.md threshold, and the tooling that enforces them. Use when filing, reformatting, linking, claiming, triaging, or closing an issue, when running backlog triage, or when opening a set of issues from a spec. Project-local; this repo only.
---

# Task canon — how a task is formulated

This repo's backlog is **GitHub Issues** `bbm-academy-org/bbm-portal` (CLAUDE.md);
Plane `BBMP-*` is the organizational layer, not this canon. The rules below port
the ds-platform pattern (inventory #127) onto our labels, board and `task-cycle`.

Applies **to new issues**; existing ones are reformatted by task 7.2, not
retroactively. This canon describes **formulation**; the lifecycle (plan → "go" →
TDD → review → acceptance → merge) belongs to
`.claude/skills/task-cycle/SKILL.md`, branches and ports to
[`parallel-sessions.md`](../../rules/parallel-sessions.md).

**Language: every project artifact is written in English** — docs, skills, rules,
memory, issue titles and bodies, comments, PR descriptions, issue forms. Russian
is reserved for two things only: live session dialogue with the owner, and
end-user-facing platform text. Section headers and field markers are fixed
strings parsed by the tooling (§7).

<!-- owner ruling, 2026-08-05 retro: the previous "English headers / Russian
content" compromise is void. It assumed the owner is the only reader of issue
bodies; in practice every agent and subagent reads them too, and a mixed-language
corpus costs tokens and blocks any language guard in CI. The existing Russian
corpus is translated on touch only — no mass translation pass. -->

## 1. Issue body — a fixed skeleton

```markdown
**Source:** <what this task exists on the basis of — free text>

## Context

<Why now. What problem it closes. Links: spec `docs/specs/…`, ADR `docs/adr/…`,
PRD, an owner comment with its date.>

## Scope

**In scope:**

- <a concrete deliverable>

**Out of scope:**

- <what this task does NOT close, and where that goes instead>

## Spec reference

<Spec/ADR + the specific §. If no spec is needed per the task-cycle stage 1a
gate, write "no spec: <reason>"; this field is never empty.>

## Acceptance criteria

- [ ] <observable and checkable: a command, a URL, a status, a file>

## Dependencies

**Blocked by:** #N — <one-line technical rationale>
**Blocks:** #M

## Notes

<Free text. Sessions also post stop-state comments here (§5).>
```

The heading level is not significant: `pnpm issue:create` writes `##`, while
GitHub issue forms (`.github/ISSUE_TEMPLATE/*.yml`) render their fields as `###`.
The tooling reads both; do not rewrite an issue body over hash count.

Semantics and obligation:

| Section               | What goes in it                                                                                                                                         | Required                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `**Source:**`         | **on the basis of what** the task exists — free text (§2). Not to be confused with the `channel:*` label: that one is "who filed it"                    | always                    |
| `Context`             | why now, what pain it closes, where the solution came from                                                                                              | always                    |
| `Scope`               | **In** — deliverables; **Out** — explicit exclusions with an address ("goes to #M"). An empty Out is a smell: the boundaries were never thought through | always                    |
| `Spec reference`      | spec/ADR/§ or an explicit "no spec: …". This records the stage 1a gate; it is not decoration                                                            | always                    |
| `Acceptance criteria` | a checklist of observable facts. "It works" is not a criterion; a criterion says what to open/run and what to see                                       | always, except `epic`     |
| `Dependencies`        | a human-readable mirror of the **native** graph (§3) + the rationale of each edge                                                                       | if the graph is non-empty |
| `Notes`               | everything else; stop-state comments live as comments, not as body edits                                                                                | as needed                 |

The **`**Source:**` line is mandatory free text**, and it answers "why does this
task exist at all", not "who filed it". Examples:

- `bug report from Anton in Mattermost 2026-08-04`
- `executive decision by the partners, 2026-07-30`
- `a colleague's request on the content call`
- `caught it myself while working on #124`
- `session retro 2026-08-01`
- `payload dependency bumped to 3.86`
- `the mission changed — PRD §2 rewritten`

This cannot be reduced to a list: the space of sources is open, and this is
exactly the context that gets lost first. The line is written by
`pnpm issue:create --source "<text>"` (never typed into the body by hand — that
would create a second source of truth); from the web UI a required form field
fills it in.

For an issue of type **Bug**, `Context` contains the reproduction: environment,
steps, expected/actual — otherwise the task is not picked up but returned to its
author (the `.github/ISSUE_TEMPLATE/fix.yml` form pre-fills these fields).
For an `epic`, `Acceptance criteria` is replaced by the set of sub-issues: an
epic's criterion is its closed children, it keeps no separate checklist.

The **title** is free-form English text without a Conventional-Commits prefix:
the task class is carried by the built-in **Type** field, and duplicating it in
the title buys nothing.

<!-- author's decision: `pnpm task:worktree` derives the branch prefix from the
issue's Type; the title as a carrier of type survives only as a fallback for
issues filed before the canon that have no Type. -->

Reformatting an existing issue never changes its subject: if the title or scope
turns out to be factually wrong, apply the body reformat but raise the
retitle/rescope to the owner as a separate question BEFORE applying it.

## 2. Taxonomy: Type (built-in) + exactly one `channel:*` + milestone

**Exactly one built-in `Type`** — `Bug` · `Feature` · `Task`. This is the task
classifier, and it lives in a GitHub field rather than a label: the types are
defined at the organization level, shown in the issue sidebar, and filterable on
a par with milestone and assignee.

<!-- owner ruling, 2026-08-04: "do not invent new fields to replace existing
ones". Hence: the task class is the built-in Type, not kind:* labels (which the
draft canon carried over from ds-platform). A custom label survives exactly where
no built-in field exists at all — that is `channel:*`. -->

**Task origin is two different dimensions, and conflating them is expensive:**

| Dimension                 | Answers                                  | Where it lives              | Form                    |
| ------------------------- | ---------------------------------------- | --------------------------- | ----------------------- |
| **Source** (§1)           | on the basis of WHAT the task exists     | the `**Source:**` body line | free text               |
| **Channel** (`channel:*`) | HOW it reached the backlog, who filed it | a label                     | exactly one of the four |

**Exactly one `channel:*`** — the route into the tracker: `channel:owner` (filed
or requested by the owner), `channel:spec` (opened mechanically from a spec/ADR —
the issue graph), `channel:retro` (retro, `/wrap`, incident analysis),
`channel:agent` (agent initiative — the most common source of backlog junk, hence
marked explicitly). The list is closed and serves order, not analytics: GitHub has
no built-in field for the channel, and this is the repo's only custom taxonomy.
The labels are created by `pnpm taxonomy:bootstrap --apply`.

<!-- owner ruling, 2026-08-04: the earlier `source:*` taxonomy merged both
dimensions into one label and degenerated — "99% of tasks will be owner-requested,
no value in that". The real source is contextual and one level up: a user bug
report, an executive decision by the partners, a colleague's request, caught it
myself, the app was updated, the mission changed. An enum cannot express that —
hence the mandatory free text in §1. The owner kept the owner/spec/retro/agent
split ("still needed for order"), but as a separate channel field. -->

Both are mandatory: a task without a channel is not created, and neither is a
task with an empty Source.

There is one chain and no translation tables, with Type as the primary:
**Feature** → branch `feat/<N>-<slug>` → commit `feat: …`; **Bug** → `fix/…`;
**Task** → `chore/…`. The branch prefix is derived from the issue's Type by
`pnpm task:worktree <N>`. For a docs-only change the branch may be named
`docs/<N>-<slug>` by hand: there is no separate org-level Docs type and no reason
to create one — the task type stays `Task`.

**A milestone is mandatory.** A milestone is a long-lived theme, not a spec and
not an epic. There is currently one product theme — «Консолидация платформы»; the
permanent fallback **«Платформа: эксплуатация и упрочнение»**, for process and
operations tasks that fit no theme, is created by `pnpm taxonomy:bootstrap
--apply` (which also creates the `channel:*` labels). A task without a milestone
is not created.

**Structural labels** (orthogonal to the taxonomy, they do not replace it):
`epic` — an umbrella issue; `consolidation` — the thematic marker of the
consolidation epic, which goes away when the milestone closes. An epic too
carries its own Type, its own channel and its own Source line — by the class of
its own deliverable.

**A forbidden class of labels — status labels** (`blocked`, `ready`,
`in progress`). Status comes from the native graph and the board; a label would
be a second source of truth, and the first one to drift.

**Fate of the default GitHub labels.** The migration is done by task 7.2 in a
single pass together with reformatting the issues that carry them; until then
`pnpm backlog:triage` lists the carriers in its «Гигиена полей» section.

| Label                                              | Fate                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bug` (3), `enhancement` (11), `documentation` (3) | the issues get Type `Bug` / `Feature` / `Task` and the labels are deleted — otherwise one class has two names |
| `duplicate`, `invalid`, `wontfix`                  | deleted: these are close reasons, not task properties (`gh issue close --reason not planned` + a comment)     |
| `good first issue`, `help wanted`                  | deleted: a private repo with a single owner and agents, there are no external contributors                    |
| `question`                                         | deleted: a question to the owner is not a backlog task                                                        |

The assignee defaults to `@me` — a mark of who filed the task, not an assignment
and **not** a busy signal: there are exactly two claim signals and both are in §4
(the worktree and the board status). The wrapper sets it on every new task, so
the "no assignee" line in `backlog:triage` only fires on issues filed before the
canon — which is exactly what task 7.2 needs.

## 3. The link canon — a native graph, not prose

**Hierarchy and dependencies live in the GitHub API, not in the text.** Prose
like "part of #117" or "depends on #130" does **not** count as a link — neither
the board nor triage can see it.

- **Parent → child** — a native sub-issue:
  `gh api --method POST repos/$OWNER/$REPO/issues/<P>/sub_issues -F sub_issue_id=<child db-id>`
  (these endpoints take the **numeric DB id**, not the number:
  `gh api repos/$OWNER/$REPO/issues/<n> --jq .id`).
- **Dependency** — `blocked_by`:
  `gh api --method POST repos/$OWNER/$REPO/issues/<B>/dependencies/blocked_by -F issue_id=<blocker db-id>`.
  GitHub derives the reverse edge itself — do not draw it a second time in the
  other direction.
- The `Dependencies` section in the body is a **mirror** of the graph for humans;
  if it diverges from the graph, the graph wins and the body is fixed.

**`blocked_by` = a technical dependency only, with a recorded rationale.** An
edge means "physically impossible earlier", not "we'd rather do the other one
first": priority is expressed by the board order and by handoff waves, never by
edges. The rationale is written **as a line in the blocked task's `Dependencies`**
(`#N — why`); a comment on either of the two issues is acceptable if the context
is longer than a line. An edge without a rationale is a provenance orphan: triage
flags it, and that is grounds to challenge the edge rather than to treat it as
fact.

**Never blockers:** a parent/epic, "related to", "successor of", "let's discuss
first". Hierarchy ≠ dependency.

**Opening a set of tasks from a spec:** every child is a native sub-issue of the
parent, edges between children are drawn immediately, and the numbers of the
created issues are written back into the spec. A set cannot land as N
simultaneously pickable tasks: exactly one is pickable — the head of the critical
path — and the rest are filed blocked. Cross-repo children
(`bbm-public-website`) are linked natively (one organization) but are **filed,
not implemented** here — the boundary from CLAUDE.md.

## 4. Claim — a task is taken = worktree **AND** status

Consolidation spec §3, item 10: there are **two** busy signals, and both are
mandatory:

1. **the worktree** `.claude/worktrees/<N>` on its own branch `<type>/<N>-<slug>`
   (`pnpm task:worktree <N>`) — created **before the first file edit**;
2. **status `In Progress`** on the Project 2 board — set in the same motion.

For a task whose deliverable lives entirely outside the repo (issues, board, an
external service), the claim is board status + a fixing comment on the issue; no
worktree is created — an empty branch would only become teardown debt.

A divergence is itself a canon violation, not a "detail"; `pnpm backlog:triage`
catches it (the «Расхождения claim» section). Resolution is asymmetric:

- **worktree present, status missing** → the worktree holds more truth: the work
  is physically underway and the board lagged → **the board is fixed**. A
  worktree and a branch are facts of the filesystem and of origin; they cannot be
  "forgotten by inattention" in the other direction.
- **status present, no worktree and no branch** → the task does **not** become
  free automatically: the agent marks the claim as stale (with its age), and the
  decision to release it is the lead's or the owner's. Someone else's claim is
  lifted by people, not by a script.

<!-- author's decision: the SSOT rule is asymmetric — "worktree as evidence of
work" + "board as the right to take" — because a symmetric "freshest signal wins"
would let a script take a task away from a live session belonging to someone
else, and that is exactly the incident class from parallel-sessions.md -->

The chosen dev-stand port is recorded as a comment on the issue (the
[`parallel-sessions.md`](../../rules/parallel-sessions.md) rule) — it is part of
the same claim: the owner opens the right link, and the neighboring session sees
the slot is taken.

## 5. Stop-state comment — a fixed shape

A session stopping on a **non-closed** task (end of session, blocker, priority
switch) must leave a comment in exactly this shape:

```markdown
**Where I stopped:** <last commit / last successful command / where the reading broke off>
**What remains:** <concrete steps to Done>
**Blockers:** <what is in the way + #N of the blocker, or "none">
**Next session entry point:** <the command, file or link to continue from>
```

Four fields, all four, even when a field is empty ("none"). A comment, not a body
edit: the body is the statement of work, the comments are its history.

The next session reads the latest stop-state **before** any action and treats its
claims as **hypotheses**: it verifies them against real issues/PRs/branches and
takes any divergence to the owner (the `orient-before-acting` memory). A
stop-state newer than the last claim comment retires that comment's claim signal;
the worktree signal is retired only by `pnpm worktree:teardown <N>`.

## 6. Significance threshold: an issue or a line in `DEBT.md`

A separate **issue** is filed if the debt matches at least one of:

1. it blocks a deliverable or sits on its critical path;
2. it is user-visible or it is a production risk (security, data, money);
3. it must be done before the next release/deploy.

Everything else is **one line in `DEBT.md`**, added in the same commit or the same
PR as the work that exposed the debt. The file's own rules (a return condition on
every line, a mandatory sweep on `/wrap` and at every epic close, the ban on
"first incident" as a return condition for money/computation and for the only
editing path of an entity) stay in `DEBT.md` and are not duplicated here.

The threshold is applied **at the moment the debt is discovered**. Already-filed
issues are not re-evaluated or "tidied up" by this rule — only at the owner's
explicit request; an instruction to "clear the backlog" means do it, not close it.

Promoting a `DEBT.md` line to an issue goes the same way as any task: through the
`issue:create` wrapper, with a Type, a channel (usually `--channel retro`), a
Source line ("session retro <date>") and a milestone; the line is then marked with
a link to the created issue.

## 7. Tooling

The canon names each command and its role; the contract of each lives in the
artifact itself (the script's `--help` and its file header).

| Command / artifact                             | Role in the canon                                                                                                     | Where the contract is                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm issue:create`                            | the **only** way to create a task; raw `gh issue create` is forbidden                                                 | `tools/gh/create-issue.mjs` (`--help`)     |
| `pnpm board:status <issue> <status>`           | half of the claim (§4) and `Done` after a merge: `Closes #N` does not move the board column                           | `tools/gh/set-board-status.mjs`            |
| `pnpm pr:land <pr>`                            | the PR closing tail in one command; the first failing stage stops the tail                                            | `tools/gh/pr-land.mjs`                     |
| `pnpm backlog:triage`                          | readiness from the native graph, field hygiene, edges without a rationale, mega-blockers, claim-signal reconciliation | `tools/gh/backlog-triage.mjs`              |
| `pnpm taxonomy:bootstrap [--apply]`            | creates the `channel:*` labels and the fallback milestone; deletes nothing                                            | `tools/gh/bootstrap-taxonomy.mjs`          |
| `pnpm task:worktree <N>` / `worktree:teardown` | the worktree as the first claim signal (§4); the branch prefix is derived from Type                                   | `parallel-sessions.md`                     |
| The `spec-issue-graph` skill                   | opening a connected set of tasks from a spec: sub-issues, edges, exactly one pickable                                 | `.claude/skills/spec-issue-graph/SKILL.md` |
| Issue forms                                    | the owner's path from the web UI; the form sets Type and `channel:owner` itself, a blank issue is forbidden           | `.github/ISSUE_TEMPLATE/*.yml`             |
| `.github/branch-protection.json`               | declarative protection of `main`: required check `ci` (the aggregate meta-job), linear history, no force-push         | `docs/ci-guardrails.md` §2.1               |

`.github/branch-protection.json` is a payload, not a state: it is applied by hand
with
`gh api --method PUT repos/bbm-academy-org/bbm-portal/branches/main/protection --input .github/branch-protection.json`,
and on the current GitHub plan it may not apply at all.

**Review is not required by server-side protection, but it is required by a
gate.** A mandatory APPROVE review is not enabled in the payload: the only human
with permissions is the PR author, and he cannot APPROVE his own PR. Our checkable
form of review is different — a reviewer subagent's comment carrying the line
`VERDICT: APPROVE`, and `pnpm pr:land` blocks the merge until such a comment
**newer than the last commit** exists (a human APPROVE counts too). To narrow it
to a human one — `--require-review`; to lift it — only
`--no-review-gate "<reason>"`, where the reason is mandatory and gets printed.
The owner's acceptance (stage 5) is not checked by the gate: a reminder about it
is printed on every run.
