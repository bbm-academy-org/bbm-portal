---
name: merge-when-green
description: How a PR is merged in this repo — the gate as a separate statement, the merge only on exit 0, and what each non-zero exit means. Use at task-cycle stage 6, whenever you are about to run any form of `gh pr merge` or `pnpm pr:land`. Project-local; this repo only.
---

# merge-when-green — the merge is a consequence of a green gate

The whole rule in one line: **the gate runs as its own statement, and the merge
happens only because the gate exited 0.** Everything below exists because that
sentence is easy to agree with and easy to violate.

## The single sanctioned command

```bash
pnpm pr:land <N>
```

`tools/gh/pr-land.mjs` chains the closing tail as ordered stages — `gate` →
`merge` → board Status → worktree teardown → re-sweep — where **stage 1 is the
gate and every stage is its own statement**. The first non-zero stage aborts the
tail, names the stage, and prints the one-line remedy. The merge is pinned to the
same head SHA the gate cleared (`gh pr merge --match-head-commit`), so a commit
that lands between the green gate and the merge cannot ride in unchecked — which
in a repo with parallel sessions is a routine event, not a thought experiment.

Run it from the MAIN checkout, not from a worktree — `pr:land` tears worktrees
down, so from inside one it would saw off the branch it sits on; it refuses with
exit 4.

**A landed merge never reads as a failure (#142).** `--delete-branch` also
deletes the LOCAL branch, and that always fails while a worktree holds it — the
norm here. So the merge stage is judged by the PR's state read back, not by the
exit code alone: a non-zero exit on a PR that IS merged is a `merge-cleanup:
WARNING`, and the tail carries on to the board. And the tail is re-runnable — on
an already-MERGED PR the gate and the merge are skipped and the run resumes at
the first unfinished stage, so a tail that aborted halfway is finished by
re-running the same command, not by hand.

**Nothing in the tail deletes that local branch — you do.**
`pnpm worktree:teardown <N>` removes the worktree, but it deletes a branch only
when `main` already contains it (`tools/dev/worktree-teardown.mjs`,
`cleanupBranch`), and `pr:land` merges with `--squash`, which never produces
such a branch. Teardown therefore takes its `keep` path and warns. That is a
deliberate safety property, not a bug — it is the same check that stops teardown
from throwing away unpushed commits. Once the merge is confirmed:

```bash
git branch -D <branch>
```

## What must never be done instead

```bash
# WRONG — the shell reads `tail`'s exit status (0), never the gate's.
pnpm pr:land <N> | tail -5 && gh pr merge <N> --squash
```

A piped gate cannot block anything. The pipe's exit status belongs to the LAST
command in it, so a RED gate reports success to the `&&` and the merge proceeds.
This is the exact incident ds-platform's `merge-when-green` wrapper was built to
remove; here the property is structural — `pr:land` never pipes its own stages —
and the rule for the caller is: **do not pipe `pr:land`, and do not hand-chain a
merge behind it.** Read its output directly.

A bare `gh pr merge` is likewise not a shortcut: it skips the review verdict, the
check-run reading, the SHA pinning, the board update and the teardown. If you
ever must run it (a bot branch with no CI), run it **on its own line**, never
downstream of anything.

## What the gate actually checks

- **CI**, structurally: every check-run's `status`/`conclusion` fields, never a
  match on the job's name — a renamed job would otherwise read as a false green.
  Zero registered runs is _pending_, not green. The aggregate to look for is the
  `ci` meta-job (`docs/ci-guardrails.md` §2.1); the WARN guards are deliberately
  not part of it. **Mind what `continue-on-error` really does** — the sentence
  that used to stand here got it backwards and cost a merge (#397, PR #396). It
  greens the workflow RUN; the job's OWN check-run keeps `conclusion: failure`,
  and the rollup the gate reads is made of check-runs. So a failing WARN guard is
  indistinguishable from a failing BLOCK one by conclusion alone, and until #397
  every failing WARN guard hard-blocked every merge.
  The gate now resolves the WARN plane itself: it reads
  `.github/workflows/*.yml` on the PR's **base** ref (not its head — a PR must
  not be able to demote the guard that is failing on it) and treats a
  `FAILURE` check-run whose job carries `continue-on-error: true` as a printed
  gate remark rather than a red. Everything else is unchanged and strict: a
  **cancelled** WARN run still reads as red (a run that did not finish proved
  nothing — which is why `pr-body-guards.yml` does not cancel in-progress runs),
  a WARN job that was renamed since the base ref falls out of the plane and reads
  as red, and a plane that could not be read at all leaves every failure red.
  A gate remark is not a licence to ignore the finding: WARN means the guard is
  soaking (`docs/ci-guardrails.md` §4), so read what it said before merging.
- **The review verdict**, freshly: a `VERDICT: APPROVE` line in a PR comment,
  dated after the last commit that changed the PR's own diff. An approval given
  before that commit approved different code. A `gh pr update-branch` merge
  commit is the one exception, and a narrow one — GitHub builds and signs it
  server-side, and it only re-bases the branch, so it does not send you back for
  a re-review (#222). `--require-review` narrows this to a human APPROVE;
  `--no-review-gate "<reason>"` lifts it and prints the reason as the record.

## The branch is BEHIND — and the update conflicts

`main` requires strict status checks, so a BEHIND branch is a RED gate and the
update is not optional. `gh pr update-branch <pr>` is the whole procedure while
it works, and it is free of review cost by design.

**When it refuses because the update conflicts, what you do next changes the
review situation.** The fallback is your own `git fetch && git merge origin/main`
in the worktree, resolving by hand — and those resolutions are code nobody
reviewed. The gate treats that merge as what it is: a commit of yours, made on
your machine, which stales the verdict and sends the PR back for a fresh review.
That is not the gate misfiring — dropping the other side's hunk while resolving
is a real change of behaviour. Budget the re-review; do not go looking for a way
around it.

**GitHub will offer you one, and it is not an escape hatch.** The «Resolve
conflicts» button on the PR page appears at exactly this moment, and a merge
committed through that web editor is indistinguishable to the gate from a clean
`update-branch` one — same two parents, same GitHub committer, same valid
signature — so it passes the freshness check while carrying content you typed
(`DEBT.md`, 2026-08-14; the boundary is stated in `isBaseMergeCommit`'s JSDoc).
Nothing stops you mechanically. Resolve in your worktree instead, and if you did
use the editor, re-request the review by hand: the gate cannot ask for you.

## Before the gate: is the base even green?

```bash
pnpm ci:verify-base      # exit 0 green · 1 red · 2 pending
```

A red `main` makes your own PR's red checks ambiguous. Run this before pushing
(task-cycle stage 3); on exit 1 paste the disclaimer it prints into the PR body,
so a reviewer can tell an inherited red from one this PR introduced.

## Failure modes this replaces

- Merging on "the checks looked green" instead of on an exit code.
- Merging on an APPROVE that predates the last commit that changed the diff.
- Piping the gate and reading the pipe's exit status.
- Merging from inside a worktree and leaving the branch, the board row and the
  worktree behind because the tail died at its first stage.
