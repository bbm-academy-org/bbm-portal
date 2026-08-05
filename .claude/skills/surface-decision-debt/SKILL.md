---
name: surface-decision-debt
description: How a task's silent deviations from convention are surfaced and routed at the end of the work — the reflection pass, the significance threshold (own issue vs a DEBT.md line), and the two report lines the Stop gates read («Отклонения от конвенций:» + `surface-decision-debt:`). Use before writing the stage-6 final report or the stage-7 closing comment, on every task. Project-local; this repo only.
---

# surface-decision-debt — routing what you decided silently

Ported from ds-platform (task 7.3, issue #134). The symptom this closes is ours,
not theirs: a deviation gets NAMED in the stage-7 line «Отклонения от конвенций:
…» and then evaporates — nobody says where it went. A deviation that is not
routed is indistinguishable from one that was never surfaced; the next session
meets it as a surprise.

Run this **at the end of every task**, right before writing the stage-6 report
(`.claude/skills/task-cycle/SKILL.md`). The list may be empty; the pass is not
optional.

## 1. Reflect — re-read your own session

Go back over this session's transcript and find every moment where you took a
decision that:

- **deviated from a documented convention** (CLAUDE.md, `.claude/rules/*`,
  `task-cycle`, `task-canon`, a spec in `docs/specs/`) without amending it;
- **substituted a generic mechanism** for the project-specific one because the
  project one was missing or inconvenient (a raw `gh issue create` instead of
  `pnpm issue:create`, a hand-rolled port instead of `pnpm task:worktree`);
- **skipped a checklist item** with a silent N/A (a CRUD-чек not run, a
  Playwright pre-pass replaced by curl, an E2E deferred);
- **resolved an architectural question the spec left open** (a threshold, a
  storage shape, a naming pattern nobody approved);
- **applied a default without the owner's confirmation** — stage 2 already
  requires this one to land in the report verbatim as
  "applied without owner confirmation: \<what\>".

Silence about a deviation you know you made is the failure this skill exists to
prevent — not the deviation itself.

## 2. Route each item against the significance threshold

The threshold is the one in `DEBT.md`'s header (issue #65 / #92), unchanged:

| Item                                                                                                                                       | Route                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Significant: blocks a deliverable, user-visible, touches money/computed data, prod or data risk, or is the only editing path for an entity | **Its own GitHub issue** — `pnpm issue:create` (never raw `gh issue create`), linked to the epic, `blocked_by` where real. "First incident" is a **banned** return condition for these. |
| Convention itself should change                                                                                                            | **Its own issue against the convention document** (rule / skill / spec), naming the rule text to amend.                                                                                 |
| Small, deliberate, reversible                                                                                                              | **One line in `DEBT.md`**, in the same PR as the work that surfaced it — never deferred to "later". Every line carries a return condition.                                              |
| Genuinely one-off, worth no tracking                                                                                                       | **Named in the report anyway**, routed nowhere, with the rationale.                                                                                                                     |

The fourth row is the one agents skip. It still produces a list item.

## 3. Write the two report lines

The stage-6 final report carries **both**, adjacent:

```
Отклонения от конвенций: <нет | список того, что пошло не по правилу>
surface-decision-debt: <[] | по одному пункту на отклонение — куда оно ушло>
```

- **«Отклонения от конвенций: …»** — the stage-7 canon line; it NAMES the
  deviations. Enforced as a **BLOCK** by `tools/hooks/deviations-gate.mjs`, and
  the same line is repeated in the issue's closing comment (a hook cannot read
  the comment). When the session had an owner halt or an earlier Stop-gate
  block, the value «нет» is rejected — a halted session that certifies itself
  clean is not a report.
- **`surface-decision-debt: …`** — the ROUTING half; for each named deviation,
  where it landed: `#N` / `DEBT.md` / "written off: \<why\>". `[]` when the
  first line says «нет». Checked by
  `tools/hooks/surface-decision-debt-gate.mjs` as a **WARN** — it prints a
  systemMessage and lets the stop through. Promotion to BLOCK follows
  `docs/ci-guardrails.md` §4, and §6 records what this gate needs first: the
  clean window **and** a documented escape hatch, because a wrong verdict on a
  `Stop` gate strands the session with no way out.

Both lines are `[]`/«нет» only for a genuinely deviation-free task. `[]` next to
a prose paragraph describing a deviation is invalid output — the empty list
asserts the opposite of the paragraph.

## Failure modes

- **Skipping the pass** and going from merge straight to the report — the
  structural reason silent decisions accumulate.
- **Naming a deviation in prose while writing `[]`** — the contradiction the
  WARN cannot catch and a reviewer will.
- **Routing to nothing**: "noted for later" with no issue, no `DEBT.md` line and
  no explicit write-off is a deviation that was never surfaced.
- **A `DEBT.md` line without a return condition** — it does not survive the next
  `/wrap` sweep, so it is a deletion with extra steps.

## Related

- `.claude/skills/task-cycle/SKILL.md` — stage 6 (report) and stage 7 (close).
- `.claude/skills/report-task-outcome/SKILL.md` — the full report shape both
  lines live in.
- `.claude/skills/do-decision-debt-followup/SKILL.md` — how a surfaced item is
  later closed.
- `DEBT.md` — the threshold and the line format.
