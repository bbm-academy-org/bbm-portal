---
name: run-iteration-end-checklist
description: The pre-merge iteration-end gate — a fresh-context subagent verifies the 12 items nothing else checks and returns a VERDICT the lead cannot bypass. Use after the implementation is done and before requesting review or running `pnpm pr:land`. Project-local; this repo only.
---

# run-iteration-end-checklist — the gate before the merge tail

Ported from ds-platform (task 7.8, issue #139). **This skill checks only what
nothing else already checks.** Three enforcement layers exist in this repo
before it, and the checklist REFERENCES them instead of re-running them:

| Layer                                                                                                                       | Owns                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm pr:land <PR>` (`tools/gh/pr-land.mjs`)                                                                                | PR open / not draft / no conflict / carries a linkage (`Closes #N`, or `Part of #N` on an OPEN parent); a `VERDICT: APPROVE` review newer than the last commit that changed the diff; every check-run green on the current head SHA; then merge, board `Done`, teardown |
| `tools/hooks/completion-report-gate.mjs`, `deviations-gate.mjs`, `surface-decision-debt-gate.mjs` (`tools/hooks/README.md`) | the shape of the final report at session Stop — «Проверить глазами:», «Отклонения от конвенций:», `surface-decision-debt:`                                                                                                                                              |
| `.claude/skills/report-task-outcome/SKILL.md`, `surface-decision-debt/SKILL.md`, `write-iteration-summary/SKILL.md`         | what those lines mean, how the routing is derived, and the shape of the closing issue comment                                                                                                                                                                           |

Duplicating any of those here would create a second source of truth that drifts.
The items below are the gap between "the code compiles and someone approved it"
and "this iteration is actually finished".

## Scope

Every PR outside the **review-free class defined in
`.claude/skills/task-cycle/SKILL.md` stage 4** runs this gate — that file owns
the boundary and this one does not restate it. A PR in that class skips the gate
and the review subagent together; anything else, including a prose-only edit to
the process canon, runs both.

## Mode — dispatch, never self-check

The lead dispatches a **fresh-context subagent** with this file's content plus a
task-specific message (branch, `git diff --name-only origin/main...HEAD`, issue
`#N`, PR `#M`, whether the change is owner-visible). The subagent verifies and
reports; it does not fix, stage, push, or merge.

- Every `Agent` call names an explicit `model` — `tools/hooks/agent-model-guard.mjs`
  **blocks** a call without one (CLAUDE.md → "Subagents and models"). This one is
  verification with judgement: `general-purpose`, `model: opus`.
- Return contract: the report below, ≤30 lines. Evidence longer than that goes
  to a scratchpad file whose path the report names.
- A lead running the checklist on its own work is the banned shortcut — the same
  reason stage-4 review is dispatched, and the same reason `/wrap`'s retro is
  (`.claude/skills/wrap/SKILL.md` phase 1).

## The 12 items

For each: **PASS** / **FAIL** (one-line reason) / **N/A** (one-line reason).

1. **Tests green** — `pnpm test:unit`; plus `pnpm test:int` when Payload
   collections/globals/endpoints changed and `pnpm test:e2e` when a UI route or
   an auth flow changed.
2. **TDD evidence** — for platform-module code (`src/lib/**`, `src/app/(frontend)/p/**`),
   the commit order shows a failing test before the implementation
   (`.claude/skills/task-cycle/SKILL.md` stage 3). N/A for docs, tooling and
   CMS-contract work.
3. **`pnpm typecheck`** green.
4. **`pnpm lint`** and **`pnpm format:check`** green; `pnpm lint:css` when
   `*.css` was touched.
5. **`pnpm boundaries`** green when `src/` was touched — module isolation is the
   ADR-002 invariant, not a style preference.
6. **Migrations committed** — any collection/global change carries the
   `pnpm migrate:create <name>` output under `src/migrations/` in the same PR
   (`push: false`, so a missing migration is a broken deploy, not a missing nicety).
7. **`pnpm lint:instruction-budget`** PASS when the diff touches the always-on
   corpus (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`) — the deterministic
   half of "compact, never just append" (`.claude/skills/wrap/SKILL.md` phase 3).
8. **Spec / ADR gate** — `.claude/skills/task-cycle/SKILL.md` stages 1a and 2.
   Triggers: a new platform module, new user-facing behaviour, any added or
   changed form, any change to a computed/money formula, any architectural
   decision. Read the stage before ruling — it names what each trigger requires
   and which have no exemption by task type.
9. **Docs that describe the changed surface** — `README.md`, `deploy/README.md`,
   `tools/hooks/README.md`, or the owning skill — updated when commands, hooks,
   ops steps or conventions changed. Prose that now describes something that no
   longer exists counts as FAIL.
10. **Decision-debt pass run** — `.claude/skills/surface-decision-debt/SKILL.md`
    was executed and every item is routed — own issue via `pnpm issue:create`
    (threshold: `.claude/skills/task-canon/SKILL.md` §6), a `DEBT.md` line with a
    return condition, or an explicit write-off. Verify the
    pass HAPPENED and the routing is real; the report LINES themselves are the
    Stop hooks' jurisdiction, not this checklist's.
11. **Iteration summary** — **deferred** to
    `.claude/skills/write-iteration-summary/SKILL.md`; report `N/A (deferred)`
    unless the comment is already published, in which case name its URL. It lands
    after `pnpm pr:land`, so at gate time it is normally still open.
12. **Owner-visible change → acceptance recorded** —
    `.claude/skills/task-cycle/SKILL.md` stage 5. Trigger: the change alters
    something the owner can see. Look for the recorded «принято» and the live URL
    on the issue; the stage says what counts as one. N/A for invisible changes
    (internals, tooling, docs, backend with no UI).

## Output (mandatory format)

```
## Iteration-end checklist — <branch>

| # | Item | Verdict | Note |
|---|------|---------|------|
| 1 | tests | PASS | test:unit 870 passed; int N/A — no collection change |
| … |
| 12 | acceptance recorded | N/A | invisible change |

VERDICT: <n>/12 — PASS | BLOCKED on <item numbers>
```

`VERDICT: PASS` is allowed only when every item is PASS or N/A. One FAIL →
`BLOCKED`, and the lead does not advance to review-dispatch or `pnpm pr:land`
until the blocking item is fixed and the checklist re-run. The verdict line is
the contract — a free-form report without it is re-dispatched, not interpreted.

## Failure modes

- **Running it yourself** because "the diff is small" — a self-check finds what
  the author already believes.
- **Returning PASS with a FAIL in the table** — the exact failure the verdict
  line exists to make visible.
- **Re-running what `pnpm pr:land` gates** (CI, review verdict, the linkage —
  `Closes #N` or `Part of #N`) — wasted tokens and a second source of truth for
  the same rule.
- **Marking item 8 N/A on a "chore" that added a form or changed a formula** —
  those two have no exemption by task type.
- **Treating the checklist as the review** — `bbm-reviewer` judges the change on
  its merits (`task-cycle` stage 4); this gate judges whether the iteration is
  finished. Both run.

## Related

- `.claude/skills/task-cycle/SKILL.md` — stages 3–7; the lifecycle this gate sits in.
- `.claude/skills/write-iteration-summary/SKILL.md` — item 11.
- `.claude/skills/surface-decision-debt/SKILL.md` — item 10.
- `.claude/skills/report-task-outcome/SKILL.md` — the report shape, deliberately
  not re-specified here.
- `tools/hooks/README.md` — the hook stack and the `BBM_HOOKS_DISABLE=1` switch.
- `tools/gh/pr-land.mjs` — the merge tail this gate runs before.
