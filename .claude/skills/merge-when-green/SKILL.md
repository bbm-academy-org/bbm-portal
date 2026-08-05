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

Run it from the MAIN checkout, not from a worktree: `--delete-branch` cannot
delete a branch a worktree is holding.

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
  not part of it.
- **The review verdict**, freshly: a `VERDICT: APPROVE` line in a PR comment,
  dated after the PR's last commit. An approval given before the last commit
  approved different code. `--require-review` narrows this to a human APPROVE;
  `--no-review-gate "<reason>"` lifts it and prints the reason as the record.

## Before the gate: is the base even green?

```bash
pnpm ci:verify-base      # exit 0 green · 1 red · 2 pending
```

A red `main` makes your own PR's red checks ambiguous. Run this before pushing
(task-cycle stage 3); on exit 1 paste the disclaimer it prints into the PR body,
so a reviewer can tell an inherited red from one this PR introduced.

## Failure modes this replaces

- Merging on "the checks looked green" instead of on an exit code.
- Merging on an APPROVE that predates the last commit.
- Piping the gate and reading the pipe's exit status.
- Merging from inside a worktree and leaving the branch, the board row and the
  worktree behind because the tail died at its first stage.
