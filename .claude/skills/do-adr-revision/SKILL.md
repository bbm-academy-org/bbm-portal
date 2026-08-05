---
name: do-adr-revision
description: Revise an existing ADR — inline rewrite while the decision is not yet running in production, an appended amendment block once it is. Use when closing an open question in an ADR, replacing a deferred decision, reversing a shipped one, or removing a dead reference. Project-local; this repo only.
---

# do-adr-revision — changing a decision that is already recorded

**Kind:** orchestration · **Mode:** inline.

Adapted from ds-platform's skill of the same name (inventory #127). **The
trigger is redefined for this repo:** ds is pre-production paper architecture,
so its default is "inline rewrite, always". bbm-portal ships to production —
`portal.bbm.academy` and `cms.bbm.academy` are live, and ADR-002 / ADR-003
govern the running system. Here the two modes are both real, and picking the
wrong one destroys information.

## The canon — which mode applies

Ask one question: **is the decision being changed already running in
production?**

| Situation                                                                        | Mode                | Why                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The decision is not yet built, or built but not deployed (no live surface on it) | **Inline rewrite**  | Nothing in the running system is explained by the old text. History lives in `git log`; a body full of "previously…" is noise.  |
| The decision is live — a deployed domain, route, schema, auth flow, module split | **Amendment block** | The original text explains why the running system looks the way it does. Delete it and the live topology becomes unexplainable. |

The test is concrete, not a judgment call: if reverting the ADR's decision today
would require a **deploy, a migration, or a DNS/IdP change**, it is running in
production → amendment. If it would require only editing a document → inline.

A decision that is live but whose ADR is being _clarified_ (typo, dead link,
sharpening wording without changing the rule) is an inline edit — amendments are
for **changed rules**, not for prose upkeep.

## Input

- The ADR number (`002`, `003`, …) and the sections in play.
- The reason: an issue link, a review finding, an owner decision with a date.
- The mode, decided by the table above, **stated explicitly in the PR body**.

## Procedure — inline rewrite

1. **`read-relevant-adrs`** — load the ADR's own sections plus anything adjacent
   it may contradict.
2. **Rewrite the affected sections in place.** The document must read as if the
   current decision were always the decision. Do not leave "previously…" /
   "before X we did Y" / "SUPERSEDED by…" callouts in the body — that is what
   `git log` is for.
3. **Update `docs/adr/README.md`** — the status/date cell of that row.
4. **Sweep cross-references, both directions.**
   - _Outbound:_ grep the repo for the old rule's wording and update every
     citation — `docs/`, `src/`, `.claude/skills/`, `.claude/rules/`,
     `CLAUDE.md`, `AGENTS.md`, workflows, lint scripts.
   - _Inbound:_ grep for everything that points **at** the rewritten section
     (`ADR-00N §X`) and reconcile the section numbers in the **same commit**.
     An outbound-only sweep leaves dangling `§` refs — the classic miss.

   ```bash
   grep -rn "ADR-002" --include="*.md" --include="*.ts" --include="*.mjs" .
   ```

5. **PR** with `Closes #N`, the repo PR template, and a body line naming the
   mode and why (`inline: the decision is not deployed — no live surface`).
6. **Review** per task-cycle stage 4 (a docs-only ADR PR may merge on green CI,
   but an ADR that changes a _rule_ is not "docs-only" — dispatch the review).
7. **Merge** per stage 6 and close per stage 7.

## Procedure — amendment block

Steps 1, 3–7 are identical. Step 2 becomes:

2. **Append an amendment block** at the end of the ADR, using the next free
   letter (`A1`, then `A2` — never renumber or consolidate existing ones):

   ```markdown
   ## A1 — <what changed>, <YYYY-MM-DD>

   **Context.** What we learned in production that the original decision did not
   anticipate.
   **Decision.** The new rule, stated as a rule.
   **Consequences.** What now has to change: code, deploys, migrations, other ADRs.
   **Why now.** The trigger — incident, owner decision, review finding (link it).
   **Affects.** The sections of this ADR the amendment overrides, by number.
   ```

   The original section stays **untouched**. It is the record of why the running
   system is shaped the way it is; the amendment is the record of what is true
   now. Add a one-line pointer at the head of each overridden section:
   `> Superseded by A1 (<date>).`

## Output

- `docs/adr/NNN-<slug>.md` revised inline, or carrying a new `A<N>` block.
- `docs/adr/README.md` row updated.
- Every inbound and outbound cross-reference reconciled in the same PR.
- The mode and its justification recorded in the PR body.

## Failure modes

- **Inline-rewriting a live decision.** The most expensive one: the explanation
  of the production topology is deleted, and the next session reads the new text
  as if it had always been true — then cannot explain the system it is looking at.
- **An amendment for a paper decision.** Clutters an ADR nobody has built yet
  with a history of its own drafting.
- **Renumbering or merging existing amendments.** `A1` is cited elsewhere; ids
  are append-only.
- **Outbound-only cross-ref sweep.** Dangling `ADR-00N §X` references left behind.
- **No mode statement in the PR body.** The reviewer then cannot tell whether
  the mode was chosen or defaulted into.

## Related

- [`read-relevant-adrs`](../read-relevant-adrs/SKILL.md) — step 1.
- [`task-cycle`](../task-cycle/SKILL.md) — stages 4/6/7 own the review and merge.
- `docs/adr/README.md` — the index and the ADR canon.
