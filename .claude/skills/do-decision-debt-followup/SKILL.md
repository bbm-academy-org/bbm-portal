---
name: do-decision-debt-followup
description: How accumulated decision debt is worked off — reading a debt item (a GitHub issue filed from a deviation, or a DEBT.md line), classifying what would actually close it, executing that flow, and closing the item with a linked artifact. Use during a DEBT.md sweep, at an epic close, or when picking up a debt item from the backlog. Project-local; this repo only.
---

# do-decision-debt-followup — closing a debt item

Ported from ds-platform (task 7.3, issue #134). Companion to
`.claude/skills/surface-decision-debt/SKILL.md`: that one **files** the debt,
this one **closes** it. A surfacing discipline with no follow-up flow just moves
the pile from the transcript into `DEBT.md`.

**Cannot proceed without a closing artifact.** "Dropped, no longer relevant" is a
valid outcome only with a written rationale — and the rationale itself (the
closing comment, or the struck-out `DEBT.md` line in a PR) is the artifact.
Deleting a line or closing an issue with no trace defeats the whole discipline.

## When it runs

- The **`DEBT.md` sweep** — mandatory on every `/wrap` and at every epic close
  (`DEBT.md` header, issue #65): each line is fixed now, promoted to an issue, or
  explicitly written off. This skill is what "fixed now" and "written off" mean.
- Picking a debt-born issue off the backlog like any other task — it then runs
  the full `task-cycle` (plan → "go" → TDD → review → merge → close).

## Input — what a debt item looks like here

There is no `decision-debt` label: our taxonomy is Type + exactly one
`channel:*` + milestone (`task-canon` §2), and a status/theme label would be a
second source of truth. A debt item is therefore one of:

- a **GitHub issue** whose `**Source:**` line names the deviation and the task
  that surfaced it, usually `channel:agent` or `channel:retro`;
- a **line in `DEBT.md`** — `- [ ] YYYY-MM-DD <what & why> — return condition:
<trigger> (#N)`;
- a deviation named in a **stage-7 closing comment** or a PR thread that was
  routed nowhere (this is itself a defect — file it before working it).

## Procedure

1. **Read the item and reconstruct the deviation** — what convention, what was
   done instead, why. If the item does not say, go to the PR/issue it came from;
   an item nobody can reconstruct is written off explicitly, not guessed at.
2. **Classify what would close it:**
   - **The convention was right, the code was not** → a normal fix task under
     `task-cycle` (a rule stays, the deviation goes).
   - **The deviation was right, the convention is stale** → amend the convention
     itself: the rule (`.claude/rules/*`), the skill (`.claude/skills/*/SKILL.md`),
     `CLAUDE.md`, or the spec in `docs/specs/`. The deliverable is the AMENDED
     document in one PR — not a proposal document about amending it (memory
     `no-doc-about-doc`).
   - **The theme recurred** → it escalates to a hook or a lint, not to more
     prose (`task-cycle`, "Enforcement hooks": a recurrence of a theme the prose
     already covers is exactly the promotion trigger). `tools/hooks/README.md`
     documents the stack the new gate joins.
   - **Spec/canon gap** → a correction PR against the spec or the canon skill,
     with the acceptance scenario the gap exposed.
   - **No longer relevant** → close with the rationale; name what changed to make
     it moot.
3. **Execute that flow** under the normal task cycle — a debt item is not a
   licence to skip the "go" gate, TDD, or review.
4. **Close the item with the artifact linked**: the issue gets a results comment
   with the PR URL; the `DEBT.md` line is removed **in that same PR**, never in a
   separate cleanup pass; if the item was written off, the rationale is the
   comment.
5. **Roll the umbrellas up** — a debt item usually hangs under an epic or a
   remediation issue; closing your own does not close those (memory
   `close-umbrella-issues-explicitly`).

## Output

- The debt item closed, with the closing artifact linked from it.
- `DEBT.md` shorter by exactly the lines you closed, in the same PR as the work.
- Any new deviation made while closing it surfaced through
  `surface-decision-debt` — the follow-up is a task like any other.

## Failure modes

- **Closing with no linked artifact or rationale** — silent closure is
  indistinguishable from never having surfaced the debt.
- **A `DEBT.md` line removed in a separate "cleanup" commit** — the line and the
  fix must travel together, otherwise the sweep loses which fix retired what.
- **Answering a recurrence with more prose** when the prose already existed —
  the escalation is a hook or a lint.
- **Writing a plan/convention document instead of amending the convention** —
  the deliverable is the final artifact in one PR.

## Related

- `.claude/skills/surface-decision-debt/SKILL.md` — where debt items come from.
- `.claude/skills/task-cycle/SKILL.md` — the cycle a debt task still runs.
- `.claude/skills/wrap/SKILL.md` — the mandatory `DEBT.md` sweep.
- `DEBT.md` — threshold, line format, return conditions.
