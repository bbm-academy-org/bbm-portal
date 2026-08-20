<!-- task-cycle: .claude/skills/task-cycle/SKILL.md -->

## What

<!-- What changed, in product language where possible. -->

## Why

<!-- ONE linkage line, whichever is TRUE:
       Closes #<issue>   — this PR finishes the issue
       Part of #<parent> — this PR is a SLICE; the parent stays open after the merge
     `pnpm pr:land` accepts both. Never file a sub-issue just to have something
     to close: that is where #261 / #270 / #279 came from. Rule: task-cycle
     stage 4 (.claude/skills/task-cycle/SKILL.md). -->

Closes #

## Product note (RU)

<!-- Две фразы продуктовым языком: что читатель теперь увидит. Для PR, который
     никто не видит (тулинг, доки, бэкенд без UI), допустимо `none`.
     Проверяется гардом product-note — docs/ci-guardrails.md §5. -->

none

## Task-cycle checklist

- [ ] Owner's "go" was given in-session on this scope (stage 2) — or this is a chore inside an already-granted scope
- [ ] Spec in `docs/specs/` (only if new module / user-facing behavior)
- [ ] TDD for platform-module code: tests first (or no module code touched)
- [ ] Owner-visible change → live-stand acceptance planned/recorded (stage 5) — or invisible, stage skipped
- [ ] Deviations from conventions: none / listed in the results comment

## Stage B

<!-- Replace the line below with exactly ONE of:
       Stage-B: GO — <owner, date>                        (owner's «принято» on a live stand)
       Stage-B: batched at #<gate issue>                  (acceptance deferred to an agreed gate)
       Stage-B: N/A (no visual surface) — lead-certified  (no visual surface changed)
     Rule: .claude/rules/design-process.md · check: `pnpm lint:stage-b <PR>` -->

Stage-B: <GO — owner, date | batched at #N | N/A (no visual surface) — lead-certified>
