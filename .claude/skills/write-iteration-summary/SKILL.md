---
name: write-iteration-summary
description: The fixed shape of the issue comment that closes an iteration — files touched, decisions taken, decision debt routed, links, plus the stage-7 deviations line. Use right after the PR lands, when closing a task's issue, or when an iteration ends without closing the task. Project-local; this repo only.
---

# write-iteration-summary — the closing comment of an iteration

Ported from ds-platform (task 7.8, issue #139) onto **our** stage-7 close. The
authority is `.claude/skills/task-cycle/SKILL.md` stage 7 ("issue closed with a
results comment"); this skill fixes the SHAPE of that comment and nothing else.
Where the two could diverge, `task-cycle` wins and this file is the bug.

**Why it is regulated:** the issue closes and the trace of what was actually
decided evaporates with the session. The next session — or the owner three weeks
later — reads a closed issue whose body is the plan and whose comments are
silence, and re-derives the decisions from the diff. A merged PR is not a record
of decisions; it is a record of lines.

## When it applies

- **Every closed task**, right after `pnpm pr:land <PR>` returns (a `Closes #N`
  merge closes the issue; a comment still lands on a closed issue).
- **An iteration that ends without closing the task** — then this comment is
  NOT the shape to use: leave the stop-state comment of
  `.claude/skills/task-canon/SKILL.md` §5 instead. One or the other, never both
  for the same stop.
- A task whose deliverable is entirely outside the repo (issues, board, an
  external service) still gets this comment — with `Files touched: none (…)`.

**Language: English**, like every project artifact
(`.claude/skills/task-canon/SKILL.md`). The one exception is the fixed marker
string «Отклонения от конвенций:» — a token the Stop hooks and the stage-7 canon
match verbatim; it is never translated or paraphrased.

## Input

Gather before writing — do not reconstruct any of it from memory:

- issue `#N` and PR `#M`, branch name;
- `git diff --name-only origin/main...HEAD` (the actual touched set, not the
  planned one);
- the routing table produced by
  `.claude/skills/surface-decision-debt/SKILL.md` (may be empty);
- spec / ADR paths in play (`docs/specs/…`, `docs/adr/…`), or `no spec: <reason>`
  copied from the issue's `Spec reference` section.

## The comment

`gh issue comment <N> --body-file <file>` (a body file, never an inline `-b`
with newlines — quoting on this box mangles it):

```markdown
## Iteration summary — PR #<M>

**Branch:** <type>/<N>-<slug>
**Spec:** <docs/specs/… | docs/adr/… | no spec: reason>
**Landing state:** <merged to main, not deployed | deployed to prod, postcheck OK>

### Files touched

- <path> — <what changed there, one line>

### Decisions

- <decision — one line of rationale, and who took it: owner "go" / lead / implementer>

### Decision debt routed

- <#K — one line> | <DEBT.md line — one line> | <written off: why>

(or: "none")

### What got unblocked

- <#K, or "nothing waited on this">

Отклонения от конвенций: <нет | список>
```

The last line is the stage-7 canon line, verbatim. It is the same line the
session's final report carries — the report is where
`tools/hooks/deviations-gate.mjs` reads it (a hook cannot read a GitHub
comment), this comment is where it survives the session. Deriving it:
`.claude/skills/surface-decision-debt/SKILL.md`.

**Record the comment URL** in the final report's technical tail, so the owner's
report and the durable record are one click apart.

## What this comment is NOT

- **Not the owner's report.** The stage-6 report is a live message in Russian,
  product-first, with «Проверить глазами: \<URL\>» — its canon is
  `.claude/skills/report-task-outcome/SKILL.md`. This comment is an English
  project artifact for whoever opens the issue later. Neither replaces the other,
  and neither is produced by pasting the other.
- **Not a diff retelling.** "Files touched" is a path list with one line each;
  what a line of code does belongs to the code.
- **Not a status update.** Board status is `pnpm board:status` (set by
  `pnpm pr:land`), not prose in a comment.

## Failure modes

- **Skipping it at merge time** — the failure this skill exists to prevent. The
  merge feels like the end, so the record never gets written.
- **Writing it from memory** instead of from `git diff --name-only` — the touched
  set drifts, usually by omitting the file that will surprise the next session.
- **"Decision debt routed: none" next to a paragraph describing a workaround** —
  the same contradiction `surface-decision-debt` bans in the report.
- **Posting it on the PR instead of the issue** — the issue is the durable
  surface; a PR is an implementation detail of one branch.

## Related

- `.claude/skills/task-cycle/SKILL.md` — stage 7, the authority for this comment.
- `.claude/skills/task-canon/SKILL.md` — §5 stop-state comment (the alternative
  shape when the task is not closing), §6 the issue-vs-`DEBT.md` threshold.
- `.claude/skills/surface-decision-debt/SKILL.md` — produces the routing table
  and the deviations line.
- `.claude/skills/report-task-outcome/SKILL.md` — the owner-facing report this
  comment is deliberately not.
- `.claude/skills/run-iteration-end-checklist/SKILL.md` — the pre-merge gate that
  reports this comment as its own item.
