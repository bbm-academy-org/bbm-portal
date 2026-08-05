---
name: do-hotfix-pr
description: The proportionate lane for fixing something already broken in production — reproducer-first, minimum diff, one PR, straight to a deploy. Use when prod is misbehaving and the fix is a code change, not when planning new work. Project-local; this repo only.
---

# do-hotfix-pr — fixing what is already broken in prod

A hotfix is not a small feature. It is the one class of work where the cost of
the full task-cycle ceremony can exceed the cost of the bug, and where the
temptation to skip the parts that actually matter is strongest. This skill says
which parts compress and which do not.

**It compresses the ceremony, not the evidence.** The reproducer, the review and
the live check are exactly the things a hurried fix drops, and exactly the
things that turn one incident into two.

## When this lane applies

- Something is **already wrong in production** — a 500, wrong data on screen, a
  broken flow — and the fix is a code change in this repo.
- The change is **behaviour-restoring**, not behaviour-adding. A "while I'm here"
  improvement is a separate task; it does not ride the hotfix lane.

Anything else runs the normal `task-cycle`.

## Procedure

1. **State the observed facts, separately from the cause.** What request, what
   response, what was on screen, which sha is live
   (`curl -s https://cms.bbm.academy/api/health | jq -r .sha`). Any cause is an
   **UNCONFIRMED hypothesis** until reproduced — never report an unproven root
   cause as the diagnosis.
2. **Issue + worktree.** `pnpm issue:create` (type Bug), then
   `pnpm task:worktree <N>` → `fix/<N>-<slug>`, then `pnpm install`. A prod bug
   is always worth an issue: it is what makes the incident countable later.
   Reference an existing epic rather than opening a parallel one.
3. **Failing test FIRST.** Reproduce the bug in a test that fails for the right
   reason before touching the fix. If the bug is in tooling or CI, the smallest
   artifact demonstrating the failure counts. A fix without a reproducer is a
   guess that happens to make the symptom go away.
4. **Minimum diff.** The smallest change that turns the failing test green.
   Refactoring the surrounding code is a separate PR.
5. **Live-verify the touched surface** if the fix touches anything rendered —
   the changed thing, in a real running stand, at the state that was broken. Not
   the whole matrix; not a screenshot of the test suite.
6. **One PR, `Closes #N`**, with a filled-in «Product note (RU)» if a user would
   notice the difference (they usually would — the thing was broken for them).
7. **Review before merge.** Dispatch `bbm-reviewer` (Opus) with the PR number.
   Urgency is not a review exemption; it is the reason a second pair of eyes is
   cheap insurance.
8. **Deploy it.** A merged hotfix is not a fixed prod. Run
   [`run-prod-deploy`](../run-prod-deploy/SKILL.md) and confirm the live sha.
9. **Close the loop** — the issue's closing comment records what was broken,
   what the cause turned out to be, and the deployed sha.

## What does NOT compress

- The failing test (step 3).
- The review (step 7).
- The deploy verification (step 8) — the fix is not done when the PR merges.
- The pre-flight gates of `deploy:prod`. A hotfix does not get `--skip-ci-check`
  by default; if CI is red for an unrelated reason, that is a decision to state
  out loud, not a flag to reach for quietly.

## Failure modes

- **Fixing the symptom with no reproducer** — the bug comes back, and now
  nothing in the suite knows about it.
- **Merging and calling it fixed** — prod still runs the old sha until someone
  deploys.
- **Widening the diff** — "while I'm here" is how a five-line hotfix becomes a
  second incident.
- **Skipping review because it is urgent** — the review costs minutes; a bad
  hotfix costs a second deploy cycle and the owner's trust in the first one.

## Related

- [`.claude/skills/task-cycle/SKILL.md`](../task-cycle/SKILL.md) — the full
  lifecycle this lane compresses.
- [`.claude/skills/run-prod-deploy/SKILL.md`](../run-prod-deploy/SKILL.md) —
  step 8.
- [`.claude/skills/surface-decision-debt/SKILL.md`](../surface-decision-debt/SKILL.md)
  — a hotfix that left a shortcut behind is exactly what that skill is for.
