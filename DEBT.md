# DEBT.md — minor convention deviations (decision-debt lite)

Rules (issue #65, owner decision 2026-07-24; #92, 2026-07-30):

- **Significance threshold:** anything serious gets its own GitHub issue —
  never a line here. This file is for small, deliberate deviations only.
- **"First incident" is a BANNED return condition** for gaps touching
  money/computed data or the only editing path for an entity — those are not
  small deviations and go straight to their own issue (#92, 2026-07-30).
- **Every line carries a return condition** (what event or date brings it
  back). Lines without one do not survive a sweep.
- **Mandatory sweep** on every `/wrap` and at every epic close: each line is
  either fixed, promoted to an issue, or explicitly written off — never
  silently kept.
- **Entry end anchors are immutable:** every active debt block is followed by
  `<!-- debt-entry-end: <stable-id> -->`. A sweep that removes/promotes the body
  MUST preserve that anchor as the tombstone for Git's union merge.
- **Permanent append marker:** add new active entries immediately before
  `<!-- debt-append-marker -->`, each with a new unique end anchor. Historical
  sweep notes live after that marker.
- **Merge semantics:** root `.gitattributes` sets `/DEBT.md merge=union`, so
  two branches that append different root-ledger entry blocks keep both blocks
  instead of conflicting. Union does not guarantee relative order between two
  concurrent appends; the invariant is structural: every body stays with its
  anchor, every anchor stays unique, and the permanent marker remains after all
  active blocks. The immutable anchor is the line both sides keep when a sweep
  removes a body while another branch appends: union then has no body line to
  resurrect, but still has a stable insertion boundary. The tradeoff is that if
  a sweep deletes the anchor too, Git can silently resurrect the removed body;
  preserving anchors is therefore part of the file format and is checked against
  repository history by the unit test.
- **Why not newest-first:** putting new entries at the top would still make
  concurrent branches edit the same top hunk. It helps sweep ergonomics, not the
  merge-conflict root cause, so this file stays append-only with the union
  driver handling additive branches.

Entry format:

```
- [ ] YYYY-MM-DD <what was deviated & why> — return condition: <trigger> (#N)
<!-- debt-entry-end: YYYY-MM-DD-stable-id -->
```

<!-- entries below this line -->

<!-- debt-entry-end: 2026-08-11-8fcb3c6ffc -->

<!-- debt-entry-end: 2026-08-11-a0f80803db -->

- [ ] 2026-08-11 `decideEscapeBlock` still calls a session isolated whenever its
      `cwd` matches the worktree pattern, so a session that OWNS the main
      checkout and merely `cd`-ed into `.claude/worktrees/<N>` is blocked from a
      legitimate shared-checkout write (cwd `<main>/.claude/worktrees/79`,
      target `<main>/DEBT.md` → block), and the message then advises writing
      into worktree 79 — the mirror image of #187's false positives. Telling that
      session from a genuine worktree session needs true session identity, which
      `cwd` cannot carry; #187's approved design explicitly rejected inferring it,
      so the residual class is routed rather than fixed — return condition: first
      Edit/Write block of a legitimate shared-checkout write from a session that
      owns the main checkout (mirror of #187; PR #189 review blocker 2)

<!-- debt-entry-end: 2026-08-11-6583582d65 -->

- [ ] 2026-08-10 the `/p/okr` DASHBOARD surface (`src/app/(platform)/p/okr`)
      still has no vendored design source in `design-source/` after another touch
      (#181, a geometry-only fix like #79/#180 before it): the design-process rule
      back-fills a pre-#138 surface "on first touch", but the original is a
      Claude.Design canvas only the owner can export, and the owner declined to
      engage with the back-fill question in-session (2026-08-10). Geometry fixes
      measure against live-stand reference numbers (PR #180 / PR #188 comments),
      so nothing was built from prose — return condition: the first task that
      changes THIS surface's DESIGN (layout/palette/composition) rather than its
      geometry vendors the canvas before building (#181). **Scope narrowed
      2026-09-02 (#440 sweep), because the naked phrase "the OKR surface" was
      about to catch the wrong screen.** `e38de64` (#404) and `7724147` (#416)
      both touched `src/app/(platform)/p/admin/okr` — the OKR section of the
      `/p/admin` cabinet, a DIFFERENT surface which already has its own
      provenance row (`design-source/p-admin-shell.html`, `fidelity: wireframe`,
      #315) and therefore its own, separate readiness question. The `/p/okr`
      dashboard itself has had no commit since 2026-08-10, so THIS condition has
      not fired.

<!-- debt-entry-end: 2026-08-10-caa8c9f751 -->

<!-- debt-entry-end: 2026-08-07-de2021c1b9 -->

- [ ] 2026-08-07 `provision.sh`: `IDP_DEV_HOSTS=','` yields origins with empty
      hosts (`http://:3000`) — pre-existing input-validation hole, orthogonal to
      #170's diff, flagged as nit 5 of PR #179's review and deliberately not
      fixed there — return condition: the next task that touches
      `generate_uris` or adds host-axis configuration (#170)

<!-- debt-entry-end: 2026-08-07-482a0dce22 -->

- [ ] 2026-08-07 agent-opened PRs trip the `assignee-milestone` guard on every
      open: `gh pr create` sets neither assignee nor milestone, so each
      implementer patches both by hand and re-runs the job (bit #178 and #179 on
      the same day). Root fix is a create-side wrapper (or a `pr:land`-style
      tail) copying assignee + milestone from the linked issue (#80).
      **Return condition FIRED 2026-09-02 (#440 sweep): PR #430** (the finance
      requests board, #388) is open with `assignees: []`, `milestone: null`
      and a FAILING `assignee-milestone` check — the dispatch-brief instruction
      is prose, and prose does not fire. Note what the merged history proves and
      does not prove: the last 60 merged PRs all carry both fields, because each
      implementer patched them by hand AFTER the guard went red. The guard works;
      nothing sets the fields at create time. **Promoted 2026-09-02 to #442**
      (the create-side wrapper). The line stays here until #442 lands, because
      until the wrapper exists the deviation is still live — return condition,
      superseding the above: #442 closed.

<!-- debt-entry-end: 2026-08-07-01f12872fe -->

<!-- debt-entry-end: 2026-08-06-01cdf09cad -->

<!-- debt-entry-end: 2026-08-06-9c4363b31b -->

<!-- debt-entry-end: 2026-08-06-620bacd10f -->

<!-- debt-entry-end: 2026-08-05-6f37d6258d -->

- [ ] 2026-08-05 `deploy:prod --rollback <sha>` accepts any sha with no
      ancestor/deployed-history check — an operator typo can "roll back" to an
      arbitrary commit (#137, review of PR #155). The original return condition
      «first rollback in anger» is a **first-incident trigger on the production
      deploy path**: the incident IS the loss (the running production app, plus
      recovery by another deploy under incident conditions), which is the same
      argument this file's own rules use to ban that shape for money and computed
      data. Replaced rather than waited on. **Promoted 2026-09-02 to #443**
      (validate the sha before anything is shipped) — return condition,
      superseding the above: #443 closed.

<!-- debt-entry-end: 2026-08-05-00c2fc95bc -->

- [ ] 2026-08-05 inaugural release digest walks the full release history
      serially — return condition: digest step visibly slow (>30 s) once
      release count grows (#137, review of PR #155)

<!-- debt-entry-end: 2026-08-05-0a2c516a3d -->

- [ ] 2026-08-05 migration-ledger read in `deploy:prod` hard-requires `psql`
      on the workstation — return condition: first deploy attempt from a box
      without psql (#137, review of PR #155)

<!-- debt-entry-end: 2026-08-05-69629acc81 -->

- [ ] 2026-08-05 `tools/lint/guard-test-coverage-lint.mjs`: a future helper in
      `tools/lint/lib/` importing `guard.mjs` would be flagged `nested` with a
      wrong remedy (false-positive class; no such helper exists today) — return
      condition: first new file added under `tools/lint/lib/` (#136, review of
      PR #154)

<!-- debt-entry-end: 2026-08-05-e5366ddfb7 -->

- [ ] 2026-08-05 `tools/lint/test-presence-lint.mjs` (called
      `tdd-signal-lint.mjs` until the #355 rename on 2026-08-27): substring path
      matching — a spec that merely MENTIONS a module path counts as covering it
      (nothing masked today; anchor needles to import statements like
      `IMPORTS_GUARD_LIB_RE` does) — return condition: first test-presence
      finding disputed as false, or the guard's WARN→BLOCK promotion review
      (2026-09-02 window) (#136, review of PR #154). `tdd-order-lint.mjs`
      inherits the same `needlesFor` and so the same weakness, one direction
      milder: there the needle is matched against ADDED PATCH lines only.
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `test-presence`:
      **promoted to
      BLOCK**, with THIS defect weighed and recorded in the register's promotion
      cell as an accepted limit: the substring match is a false **PASS** — it can
      let a violation through, it cannot invent one, and a guard that only
      under-reports cannot stop legitimate work. **The decision is taken; the
      defect is not fixed,** and its cost changed direction — at BLOCK the gate
      now certifies test presence it never actually verified. Return condition,
      superseding the above: the first `test-presence` or `tdd-order` finding
      disputed as false, the next edit to `needlesFor`, or the `tdd-order`
      WARN→BLOCK promotion review (earliest 2026-09-24,
      `docs/ci-guardrails.md` §5), which reads this same matcher — whichever
      comes first.

<!-- debt-entry-end: 2026-08-05-8fa8f75d9b -->

<!-- debt-entry-end: 2026-08-05-39d11e3194 -->

- [ ] 2026-08-05 `tools/gh/handoff-verify.mjs`: a segment naming ≥2 refs with one
      claim pins the claim on none of them and degrades to INFO (a false PASS is
      cheaper than a false STALE in a gate that exits 1) — return condition:
      revisit if real handoff runs produce INFO rows that should have been caught
      as STALE, i.e. the rule starts hiding genuine drift (#134, review of PR #150)

<!-- debt-entry-end: 2026-08-05-05b8797876 -->

- [ ] 2026-08-05 legacy Russian agent-tool prose (owner ruling, 2026-08-05: all
      project artifacts are English) — return condition: translate each file in
      its own no-behaviour-change commit before the next material edit. Worked
      off 2026-08-06 (#142) for `tools/gh/pr-land.mjs` and its spec. Worked off
      2026-08-16 (#238) and 2026-08-17 (#253) for the agent-facing `tools/gh` CLI
      files, their matching test prose, and
      `.claude/skills/spec-issue-graph/SKILL.md`; legacy Russian parser fixtures
      remain only as intentional compatibility data. **The trigger has now fired
      on every remaining file and was missed twice** (#440 sweep, 2026-09-02):
      `tools/gh/lib/gh.mjs` (~90 lines of prose plus user-facing error strings)
      was materially edited by `39973aa` (#234); `tools/hooks/dispatch-guard.mjs`
      by `2f4a2cd` (#393); `tools/hooks/deviations-gate.mjs` by `320d60d` (#417)
      and `2f4a2cd` (#393). Two things the sweep checked and is recording so the
      next one does not re-file them: the Cyrillic in
      `tools/dev/task-worktree.mjs` is a **transliteration table** (data, not
      prose) and stays, and the Russian tokens inside `deviations-gate.mjs`'s
      `DEVIATIONS_MARKER_RE` and its «нет» recognizer are **functional** — they
      match the stage-7 marker agents actually write. **Promoted 2026-09-02 to
      #444** — return condition, superseding the above: #444 closed.

<!-- debt-entry-end: 2026-08-05-61162d4aea -->

- [ ] 2026-08-06 `pnpm pr:land <n>` on an ALREADY-MERGED PR resumes the tail with
      no gate in front of it (#142): a mistyped number moves the board of whatever
      that PR closes and runs `worktree:teardown` for its issue numbers. Accepted
      because the gate never protected a merged PR either — it refused it outright —
      and the blast radius is bounded (a Done set on a Done, teardown behind an
      existence check, a read-only sweep). Return condition: a real run moves the
      wrong issue's board row, or the resume path grows a stage that is not
      idempotent — then gate the resume on the `Closes #N` of the PR matching the
      worktree/branch the caller is in (review of PR #161)

<!-- debt-entry-end: 2026-08-06-3c9d79cef1 -->

- [ ] 2026-08-06 `tools/dev/worktree-teardown.mjs` `cleanupBranch()` never deletes
      a branch merged by `--squash`: it tests `git merge-base --is-ancestor`, which
      a squash merge never satisfies, so every landed task branch is kept and
      accumulates locally (`chore/dev-stand-contract`, `docs/108-…`, `feat/13-…`,
      `fix/48-…` were all merged and all still present when this was written).
      `pr:land` now tells the truth about this instead of promising teardown will
      do it (#142). Teaching teardown to recognise a squash merge (e.g.
      `git cherry`, or `--is-ancestor` against the PR's merge commit) is a
      behaviour change to a destructive tool, hence its own task, not a rider on
      #142 (review of PR #161). **Return condition rewritten 2026-09-02 (#440
      sweep): the previous text stated the REMEDY where the trigger goes, so this
      line could never fire and no sweep could ever act on it.** Return condition:
      the next edit to `cleanupBranch` or to `worktree-teardown.mjs`'s branch
      handling, or a local checkout carrying ≥10 merged-but-undeleted task
      branches (`git branch --merged` against the squash-merged set), whichever
      comes first.

<!-- debt-entry-end: 2026-08-06-fe94868264 -->

<!-- debt-entry-end: 2026-08-04-a2a203497d -->

- [ ] 2026-08-04 Тесты `gh-board-tools`: фикстуры `parsed` собраны руками, не
      через parseArgs — дрейф CLI-контракта тесты не поймают. Замечание ревью
      PR #141 — return condition: первое изменение CLI-флагов set-board-status (#132)

<!-- debt-entry-end: 2026-08-04-0cf7baa7fd -->

- [ ] 2026-07-30 `worktree-teardown.mjs`: в robocopy-фолбэке финальный
      `cmd /c rmdir /s /q \\?\<путь>` — no-op (cmd.exe не понимает `\\?\`-префикс);
      первая ступень PS 5.1 отрабатывает, так что исход — честный exit 1, не потеря
      данных. Лечится вызовом rmdir с обычным `winPath` — return condition: первый
      реальный заход в robocopy-фолбэк (teardown упал с exit 1 на long-path) (#90)

<!-- debt-entry-end: 2026-07-30-4ac165c83d -->

- [ ] 2026-08-14 `pnpm install` в свежем worktree печатает
      `[ERROR] Was not able to set git hooks … ENOTDIR: mkdir '<wt>/.git/hooks'`:
      `simple-git-hooks` не знает, что в worktree `.git` — файл, а хуки живут в
      общем каталоге основного чекаута. Хук на деле РАБОТАЕТ (lint-staged
      отработал на первом же коммите в worktree 214), то есть сообщение ложное, но
      читается как «хука нет» — в этой сессии я на нём построил неверный вывод и
      сообщил его владельцу. Лечится проверкой на worktree перед вызовом
      `simple-git-hooks` в `prepare` — return condition: первый случай, когда
      сессия из-за этого сообщения пропустит проверки «раз хука всё равно нет»,
      или ближайшая правка `prepare`. Всплыло при работе над #214, чинится в
      worktree-тулинге (#90)

<!-- debt-entry-end: 2026-08-14-0dea1e1a7d -->

- [ ] 2026-08-14 `.github/branch-protection.json` and the live protection on `main`
      drift independently: editing the file does not touch the branch, and editing
      the protection in the GitHub UI does not touch the file. Nothing detects the
      divergence — a guard could diff the payload against
      `GET …/branches/main/protection` on every PR. Low stakes while both are
      changed by hand in the same motion, which is what #216 did. Return condition:
      the first time the two are found out of sync, or the next edit to either
      (#216)

<!-- debt-entry-end: 2026-08-14-731955ffe7 -->

- [ ] 2026-08-14 `gateConditions` in `tools/gh/pr-land.mjs` still inspects
      `mergeStateStatus` value by value (only `BEHIND` today), so every state the
      now-live protection can produce has to be remembered one at a time. `BLOCKED`
      — what an unresolved inline review thread produces under
      `required_conversation_resolution` — slips past, and the gate reports green
      while the server refuses. Reachable today only via a human inline comment:
      the reviewer subagent posts plain PR comments, which create no threads. The
      structural fix is a THREE-way classification, not a two-way allow-list —
      merge / refuse / poll again. Whoever picks this up must not map
      `BLOCKED → RED`: `BLOCKED` is the normal state of a PR whose required `ci`
      check has not gone green YET, and `pr:land` is designed to be launched into
      exactly that state and wait it out (`--timeout`), so reddening it would abort
      the gate before the wait it exists to perform. Observed on this very PR:
      `BLOCKED` with `lint-and-typecheck` pending, `CLEAN` minutes later. `UNKNOWN`
      is transient for the same reason — GitHub has not finished computing
      mergeability. So this is a design change to the gate on the critical path of
      every merge, not a three-line edit — which is why it is routed rather than
      rushed in. Return condition «the next edit to `gateConditions`» FIRED in #222,
      which edited the `findAgentApproval` call site and the stale-verdict message —
      and the three-way classification was deliberately still not made there, because
      #222 declares it out of scope and a redesign of the merge gate is not a thing to
      smuggle into a freshness fix. Explicitly re-deferred, with a trigger that no
      longer fires on any edit to the function: the first inline review thread on any
      PR, or the next edit that touches `mergeStateStatus` handling itself (#216,
      re-deferred in #222)

<!-- debt-entry-end: 2026-08-14-2d19fac77b -->

- [ ] 2026-08-14 `isBaseMergeCommit` (`tools/gh/pr-land.mjs`, #222) cannot tell a
      `gh pr update-branch` merge from one committed through GitHub's **web
      conflict editor** («Resolve conflicts» → «Commit merge»), and the second one
      carries whatever a human typed into the merged file. GitHub builds both
      server-side, so both come back with two parents, the base tip as the second,
      committer `GitHub <noreply@github.com>` and a valid signature — all four
      clauses pass. Confirmed from GitHub's own docs, not inferred: «GitHub will
      automatically use GPG to sign commits you make using the web interface» plus
      «click Commit merge. This merges the entire base branch into your head
      branch». The button is offered on the PR page at exactly the moment
      `update-branch` refuses, so it sits one click off the path this fix serves;
      `.claude/skills/merge-when-green/SKILL.md` now says not to take it, which is
      prose, not a guard. Separating the two needs CONTENT, not provenance —
      the merge's tree against a clean 3-way merge of its parents
      (`git merge-tree`), i.e. a fetch plus local git on the critical path of every
      merge; the cheaper `compare(base…merge)` variant was costed and refused
      because its false «dirty» rate is highest exactly in this repo's common raced
      case (two PRs appending to `DEBT.md` shift each other's hunk headers), which
      would disable the fix where it is needed most. Priced and declined, not
      overlooked. Return condition: the first time a session resolves a conflict in
      the web editor on any PR (its own action, so it is known at the time), or the
      next edit to `isBaseMergeCommit` (#222, round-2 review of PR #226)

<!-- debt-entry-end: 2026-08-14-6327d2f70c -->

<!-- debt-entry-end: 2026-08-14-a50a7e5e21 -->

- [ ] 2026-08-14 #220 added a top-level `permissions: contents: read` floor to `ci.yml`
      and `pr-body-guards.yml`, but NOTHING enforces that a workflow has one. A workflow
      added tomorrow with no top-level block silently inherits the repo default
      (`default_workflow_permissions: read` — read on every scope) and reproduces exactly
      the gap #220 was filed to close, with no guard noticing. `workflow-auth` is the
      natural home — it already parses every workflow and already resolves permissions the
      way GitHub does (job block else workflow block) — but today it only audits gh-GATED
      jobs, so a workflow of nothing but tree-local jobs is invisible to it. Not built in
      #220 deliberately: a new finding class in a guard is its own deliverable with its own
      spec fixtures and `guard-tests` spec (§8), and smuggling it into a posture PR would
      ship an untested rule on the meta-guard that polices every other workflow — return
      condition: the next workflow file added under `.github/workflows/`, or the
      `workflow-auth` WARN→BLOCK promotion review (2026-09-02 window), whichever comes
      first (#220, review of PR #223)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `workflow-auth`:
      **promoted to
      BLOCK**, with all three of its recorded defects — this one included —
      weighed as false **PASSES**: the guard never claimed to check a top-level
      `permissions:` floor, so the missing rule can only under-report. **The
      decision is taken; the defect is not fixed** — a workflow of nothing but
      tree-local jobs is still invisible to it, now under a BLOCK badge. Return
      condition, superseding the above: the line's own FIRST trigger, still
      unfired — the next workflow file added under `.github/workflows/`.

<!-- debt-entry-end: 2026-08-14-f2de673c1f -->

<!-- debt-entry-end: 2026-08-15-01bc69afb6 -->

- [ ] 2026-08-15 `pnpm lint:stage-b` classifies a PR as a UI diff **by path** — a
      non-test `*.tsx` / `*.css` under `src/` — so an **asset-only** change to a
      visual surface is invisible to it. PR #246 replaces the three vendored
      `/p/okr` WOFF2 binaries, which is exactly a change to how that page renders,
      and the `stage-b` check went green without ever looking for a marker. The
      blind spot is worst where it is least affordable: an asset regression is
      silent by nature — a wrongly-subsetted font does not error, it draws tofu,
      which is the same reason #230 was filed as an issue rather than a debt line.
      Widening the classifier is not one line (it has to say which asset types
      under which paths count as visual, without turning every `README.md` in a
      module into a UI diff), and doing it inside a font PR would put an untested
      rule change into a guard that gates acceptance — return condition: the next
      task that changes a visual surface WITHOUT touching a `*.tsx` or `*.css`, or
      the `stage-b` WARN→BLOCK promotion review (2026-09-02 window), whichever
      comes first (#230, iteration-end gate of PR #246)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `stage-b`:
      **promoted to
      BLOCK**, with all three of its recorded defects — this one included —
      weighed as false **PASSES**: the path-only classifier can miss a UI diff,
      it cannot invent one. **The decision is taken; the defect is not fixed,**
      and the cost is now larger, not smaller: a BLOCK guard answering «no UI
      diff» to an asset-only visual change reads as a cleared acceptance gate
      rather than a WARN nobody weighed. Return condition, superseding the above:
      the line's own FIRST trigger, still unfired — the next task that changes a
      visual surface WITHOUT touching a `*.tsx` or `*.css`.

<!-- debt-entry-end: 2026-08-15-586bd87345 -->

- [ ] 2026-08-15 `tools/lint/workflow-auth-lint.mjs` recognises a guard step by its
      `run:` line, so a guard invoked through a **composite action** (`uses:`) is
      invisible to `unaggregated-warn-step` — the step could carry
      `continue-on-error: true` with no aggregation row and the guard would say
      nothing. Deliberately not built in #207: closing it means resolving the
      composite's own `action.yml`, which is a different rule class with its own
      fixture shape, and no composite action exists in this repo today — so it
      would ship an untested rule on the meta-guard that polices every other
      workflow, for a shape nothing produces. Recorded in the guard header and
      `docs/ci-guardrails.md` §8 as a known limit, but prose does not fire and a
      return condition does — return condition: the first composite action added
      under `.github/`, or the `workflow-auth` WARN→BLOCK promotion review
      (2026-09-02 window), whichever comes first (#207, round-2 review of PR #245)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `workflow-auth`:
      **promoted to
      BLOCK**; this defect was weighed as a false **PASS** (a guard reached
      through a composite `uses:` action is simply not seen) and recorded as an
      accepted limit in the register's promotion cell. **The decision is taken;
      the defect is not fixed.** Return condition, superseding the above: the
      line's own FIRST trigger, still unfired — the first composite action added
      under `.github/` (none exists in the repo today).

<!-- debt-entry-end: 2026-08-15-25ed97380d -->

- [ ] 2026-08-15 the same guard-step detection misses a **matrix-interpolated**
      invocation: `run: pnpm lint:${{ matrix.guard }}` resolves to a guard only at
      runtime, so a matrix job running every guard as a WARN step would be exempt
      from `unaggregated-warn-step` entirely — the one shape where the rule matters
      most, since a matrix is how you would batch guards in the first place. Not a
      false positive but a silent hole, and it is adjacent to the batch collapse
      (#205 / PR #206) this whole check exists to make safe to re-attempt. Found by
      the round-2 reviewer of PR #245 while stress-testing the alias matcher —
      return condition: the first `.github/workflows/**` job that invokes a guard
      through a matrix or any other expression, or the same 2026-09-02 promotion
      review (#207, round-2 review of PR #245)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `workflow-auth`:
      **promoted to
      BLOCK**; this defect was weighed as a false **PASS** (a matrix-interpolated
      invocation resolves to a guard only at runtime, so the rule stays silent)
      and recorded as an accepted limit in the register's promotion cell. **The
      decision is taken; the defect is not fixed** — and it is still the shape
      where the rule matters most, since a matrix is how guards would be batched.
      Return condition, superseding the above: the line's own FIRST trigger,
      still unfired — the first `.github/workflows/**` job that invokes a guard
      through a matrix or any other expression.

<!-- debt-entry-end: 2026-08-15-51ba26ac00 -->

<!-- debt-entry-end: 2026-08-17-a1f0c255e1 -->

<!-- debt-entry-end: 2026-08-17-b2e1d255e2 -->

- [ ] 2026-08-17 the dev-stand sign-in helper of `tests/e2e/hours-core-parity.e2e.spec.ts`
      duplicates the one in `tests/e2e/hours-prod.e2e.spec.ts` (absolute prod origin
      vs `baseURL` stand) — return condition «the next e2e spec that signs in, or
      the first edit of either helper» (#255, PR #259) **FIRED**: seven signing-in
      specs have been added since (`finance-f1b`, `finance-documents`,
      `member-admin`, `member-admin-pagination`, `p-admin-cabinet`, `p-launcher`,
      `platform-claim-gate`), every one of them on the shared helpers. **Promoted
      2026-09-02 to #445** together with the `2026-08-25-6b0d4c1a83` line, which
      had converged on the same remedy — return condition, superseding the above:
      #445 closed.

<!-- debt-entry-end: 2026-08-17-c3d2e255e3 -->

<!-- debt-entry-end: 2026-08-18-d4c3b256f1 -->

<!-- debt-entry-end: 2026-08-19-e7a1b201f2 -->

- [ ] 2026-08-20 `stage-b-lint` now reads the Stage-B verdict off the `Part of #N`
      parent's comments (#299, PR #303), so ONE `Stage-B: GO` recorded on a
      long-lived parent satisfies the check for every later slice of it,
      indefinitely — the verdict is not slice-scoped. Correct direction (that is
      where a slice's GO is actually recorded) and harmless at WARN, but a real
      weakening ahead of the BLOCK promotion — return condition: before the
      `stage-b` BLOCK promotion window opens, earliest 2026-09-02
      (`docs/ci-guardrails.md` §5) (#299, PR #303 review round 2, N2)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `stage-b`:
      **promoted to
      BLOCK**; the parent-GO weakness was weighed as a false **PASS** and
      recorded as an accepted limit in the register's promotion cell. **The
      decision is taken; the defect is not fixed,** and the promotion is exactly
      the event this line said to act BEFORE — so what was accepted is that a
      BLOCK gate can be satisfied for a slice by a verdict the owner gave on an
      earlier one. This line had NO event-shaped trigger left (its only one was
      «before the window opens»), so the restatement supplies one. Return
      condition, superseding the above: the first slice PR observed clearing
      `stage-b` on a parent `Stage-B: GO` recorded BEFORE that slice's work
      began (noticed in review or by the iteration-end gate), or the next edit to
      `extractLinkedIssues` / the parent-comment resolution in
      `tools/lint/stage-b-lint.mjs`, whichever comes first.

<!-- debt-entry-end: 2026-08-20-b7f41c9a02 -->

- [ ] 2026-08-20 `spec-link-lint` resolves the linked issue from `Part of #N` too
      (#299, PR #303), so a chore-class slice of a `Feature`-typed epic parent
      inherits the parent's type and can be asked for a spec link it does not owe.
      WARN and low volume today — return condition: before the `spec-link` BLOCK
      promotion window opens, earliest 2026-09-02 (`docs/ci-guardrails.md` §5), or
      the first slice PR this fires on, whichever comes first (#299, PR #303
      review round 2, N3)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `spec-link`:
      **promoted to
      BLOCK** — and this is the one promoted guard whose recorded defect is a
      live false **BLOCK** class, not a false PASS. It was promotable because
      `docs/ci-guardrails.md` §3 clause (d) is satisfied: `spec-exempt: <reason>`
      is reachable without leaving the PR, so a wrongly-typed slice costs one
      escape line rather than a dead end. **The decision is taken; the defect is
      not fixed,** and each firing now costs a red gate plus that escape line
      instead of a WARN nobody had to answer. Return condition, superseding the
      above: the line's own second trigger, still unfired — the first slice PR
      this fires on.

<!-- debt-entry-end: 2026-08-20-4e6a80d1c7 -->

- [ ] 2026-08-24 a tracker issue body must be edited by downloading it to a file
      and writing it back with `gh issue edit --body-file`, with a **post-write
      non-ASCII integrity check** (re-read the body and compare its non-ASCII
      characters against the source): an in-place regex rewrite of #112's body on
      2026-08-24 round-tripped the text through a non-UTF-8 codepage on this
      Windows box and corrupted every em dash into mojibake, caught only by eye.
      The class is the pipeline, not that one issue — any `gh issue edit` /
      `gh pr edit` that pipes body text through a shell here can do it, and the
      damage is silent because GitHub stores the mojibake without complaint.
      Recorded rather than fixed because the remedy belongs inside `tools/gh/`
      (a shared read-modify-write helper with the check built in), not bolted
      onto a retro's DEBT commit — return condition: a second corruption incident
      on any issue or PR body, or the next tooling touch of `tools/gh/`,
      whichever comes first (session retro 2026-08-24). **Promoted 2026-08-26 to
      #361** (the `tools/gh/` text-integrity helper): the line stays here until
      #361 lands, because until the helper exists the deviation is still live and
      a deleted line is one nobody re-reads — return condition, superseding the
      above: #361 closed.

<!-- debt-entry-end: 2026-08-24-9b3c71ad04 -->

<!-- debt-entry-end: 2026-08-24-4f7e02c8b1 -->

- [ ] 2026-08-25 `src/auth.ts` `jwt()` stamps the roles claim only under
      `if (profile)` — `profile` is present on the sign-in pass only, so a
      sign-in pass where the provider returns NO profile leaves the token
      unstamped. `rolesClaimAbsent` then reads true on a token that has just
      been through sign-in, and the session loops back through re-sign-in
      instead of failing closed on a bare 403 — the recovery path the gate uses
      for a genuinely stale token becomes an endless one for this shape. Not
      fixed in #313 because telling «no profile on this pass» from «not a
      sign-in pass at all» needs a positive sign-in marker on the token rather
      than the absence of a field, which is a change to the token contract every
      gate reads, not a guard clause — return condition: the first observed
      sign-in loop in dev or prod, or the next task touching `src/auth.ts`'s
      `jwt` callback (#313, PR #334 review round 2, non-blocking residual)

<!-- debt-entry-end: 2026-08-25-3ac91f2e70 -->

- [ ] 2026-08-25 `tests/e2e/hours-core-parity.e2e.spec.ts` still carries the
      pre-hardening COPY of the Zitadel sign-in flow; the hardened shared helper
      extracted by #313 is `tests/e2e/support/zitadel-sign-in.ts`, and the
      sibling was deliberately left untouched — migrating it means actually
      RUNNING the hours parity suite, which mutates the stand it signs into, so
      it is a run with its own port and its own dev-stand state, not a
      mechanical import swap inside a claim-gate PR (#313, PR #334). Return
      condition «the next task that touches hours e2e» **FIRED** with `d46e65a`
      (#317 / PR #412), which edited this very spec. **Promoted 2026-09-02 to
      #445**, which owns both this line and `2026-08-17-c3d2e255e3` — the two
      describe the same pair of specs from opposite ends and have one remedy —
      return condition, superseding the above: #445 closed.

<!-- debt-entry-end: 2026-08-25-6b0d4c1a83 -->

<!-- debt-entry-end: 2026-08-25-3f7ac91d02 -->

<!-- debt-entry-end: 2026-08-25-b71e40cc59 -->

- [ ] 2026-08-25 The dispatched-agent/SDK discriminator now lives in TWO places:
      the hand-rolled `grep -qE '"promptSource":"sdk"|"isSidechain":true'` in
      `.claude/skills/wrap/SKILL.md` phase 0 and `AGENT_LOG_MARKERS` in
      `tools/session/last-report.mjs`. They are not merged in this PR because the
      two jobs differ — phase 0 selects THIS session's segments by a content MARK
      before dispatching the retro agent, the tool finds the PREVIOUS session's
      report — so the shared part is the constant, not the procedure, and
      collapsing them means giving the tool a segment-selection mode nobody has
      asked for — return condition: the next change to the discriminator itself
      (a new marker, a harness that actually emits `"isSidechain":true`), which
      must then land in both (#349, PR #345 review non-blocking 4)

<!-- debt-entry-end: 2026-08-25-4d7ac91b52 -->

- [ ] 2026-08-25 `isSessionLog` in `tools/session/last-report.mjs` tests the
      agent markers as a WHOLE-FILE substring, so one occurrence anywhere
      excludes the entire session log. Verified not to false-positive today
      (nested JSON escapes the quotes, so a quoted mention inside message text
      does not match), and the per-entry form
      `entry.promptSource === 'sdk' || entry.isSidechain === true` would need the
      parse to run before the cheap exclusion that keeps the full-corpus scan at
      ~2 s — hardening, not a live bug — return condition: the first session log
      wrongly excluded, or any change that parses entries before the exclusion
      anyway (#349, PR #345 review non-blocking 2)

<!-- debt-entry-end: 2026-08-25-9e51f0c7ab -->

- [ ] 2026-08-26 the cold-start fix for the e2e `beforeAll` budget
      (`COLD_START_HOOK_TIMEOUT_MS` in `tests/helpers/login.ts`, applied by the
      sign-in hooks of `admin.e2e.spec.ts` and `publish-panel.e2e.spec.ts`) has
      never been OBSERVED green: PR #364 landed it without a stand, so the claim
      "180 s covers Next dev's first compile of `/admin` on this box" is reasoned
      from the 2026-08-15 measurement, not measured after the change (#362, PR
      #364 review non-blocking N2). `tests/helpers/login.ts` is unchanged since,
      and no run has been recorded against this line. **Return condition sharpened
      2026-09-02 (#440 sweep) with a date backstop, because "the first cold run"
      alone has no owner and can idle indefinitely** — return condition: the first
      cold `E2E_PORT=<n> pnpm test:e2e` run of `admin.e2e.spec.ts` /
      `publish-panel.e2e.spec.ts` on this box, whose outcome is recorded HERE
      (green → delete the line; still red → the budget is the wrong remedy, not
      merely the wrong number); **and if no such run is recorded by 2026-10-01,
      the next sweep files the measurement as its own task** rather than carrying
      an unverified number for a second month.

<!-- debt-entry-end: 2026-08-26-7c4de91b83 -->

- [ ] 2026-08-26 `stage-b-lint.mjs` keeps the inherited `GO_RE`-before-
      `PLACEHOLDER_RE` ordering that `design-fidelity-lint.mjs` had to fix
      (an unfilled `GO — <owner, date>` shape could classify as a record);
      left as-is because the stage-b plane is WARN and its template shape is
      HTML-commented, never printed back at the violator — return condition:
      stage-b promotion to BLOCK per `docs/ci-guardrails.md` §4 (earliest
      2026-09-02), or the first observed placeholder clearing the guard
      (#359, PR #371 fix round)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `stage-b`:
      **promoted to
      BLOCK**; the ordering weakness was weighed as a false **PASS** and recorded
      as an accepted limit in the register's promotion cell. **The decision is
      taken; the defect is not fixed — and the reason this line gave for leaving
      it is now void:** «the stage-b plane is WARN» was half the justification,
      and that plane is BLOCK as of 2026-09-02. What still holds is the other
      half (the template shape is HTML-commented and never printed back at the
      violator). Return condition, superseding the above: the first observed
      placeholder clearing the guard, or the next edit to the marker
      classification (`GO_RE` / `PLACEHOLDER_RE` in
      `tools/lint/stage-b-lint.mjs`), whichever comes first.

<!-- debt-entry-end: 2026-08-26-3b59d1e0f4 -->

- [ ] 2026-08-26 `design-fidelity-lint.mjs` (and `stage-b-lint.mjs` alike)
      accepts `batched at #N` without checking that issue #N exists or is
      open, so a `batched at` marker naming a never-filed gate issue would
      clear the gate; left as-is because `checkDesignFidelity` is an IO-free
      pure seam by design — an existence check adds a network call per marker
      and turns a token or rate-limit hiccup into a red BLOCK on a correct
      PR — and because a fabricated gate number is a deliberate forgery, the
      class a guard cannot detect, not the «nobody checked» class #359
      closes; the `covers` globs still have to reach the touched file —
      return condition: the first `batched at #N` marker observed naming a
      non-existent or closed issue, or the stage-b promotion to BLOCK per
      `docs/ci-guardrails.md` §4 (earliest 2026-09-02), whichever is first
      (#359, PR #371 review round 2, finding N2)
      **2026-09-02 (#440 sweep): the deferral target arrived and the review has
      ALREADY RUN.** The `docs/ci-guardrails.md` §5 promotion review dated
      2026-09-02 was performed in **#438 / PR #449**, not in the #446 this sweep
      first filed for it — #446 is closed as a duplicate of #438, and pointing a
      line at a duplicate is pointing it at nothing. Verdict for `stage-b`:
      **promoted to
      BLOCK**. This line spans two guards and both planes are now blocking:
      `design-fidelity` has been BLOCK since 2026-08-26 and `stage-b` joined it
      on 2026-09-02, so a `batched at #N` marker naming a never-filed gate issue
      clears a BLOCK gate on both. That does not change the verdict — a
      fabricated gate number is a deliberate forgery, the class a guard cannot
      detect, and the `covers` globs still have to reach the touched file — but
      it states the accepted limit at its real size. **The decision is taken; the
      defect is not fixed.** Return condition, superseding the above: the line's
      own first trigger, still unfired — the first `batched at #N` marker
      observed naming a non-existent or closed issue.

<!-- debt-entry-end: 2026-08-26-9f27ac4d15 -->

- [ ] 2026-08-27 a fresh numeric task worktree cannot run the Payload-backed
      integration specs until the non-`PLATFORM_*` secrets (`PAYLOAD_SECRET`,
      S3, IdP) are hand-copied from the shared checkout's `.env` — neither
      `pnpm task:worktree` nor `pnpm dev:db:branch` carries them, and 8 int
      specs fail on "missing secret key"; the #380 session copied them by hand,
      nothing committed — return condition: the next session that hits the
      missing-secret int failures in a fresh worktree promotes this to a tooling
      issue (extend `task:worktree`/`dev:db:branch` to copy or reference the
      base keys) (#380). **Promoted 2026-08-27 to #403** — the return condition
      fired the same day it was written: the #382 session's worktree stand came
      up with no `AUTH_SECRET` (no sign-in at all), and the implementer merged
      the main checkout's `.env` by hand (recorded on PR #402). The line stays
      until #403 lands, because until the tooling carries the base keys the
      deviation is still live — return condition, superseding the above: #403
      closed.

<!-- debt-entry-end: 2026-08-27-4b1e7d92c3 -->

- [ ] 2026-08-27 the role-less-member witness of acceptance scenario 9
      (`tests/e2e/finance-documents.e2e.spec.ts`, #382/PR #402) signs in with a
      **minted Auth.js session cookie** (`tests/e2e/support/platform-session.ts`
      signs with the stand's own `AUTH_SECRET`), not a real OIDC hop: the dev
      Zitadel has no account holding `platform-user` and neither finance flow
      role — `bbm-test` holds `platform-admin` plus both flow roles after
      `provision.sh` step 8 — and no `E2E_MEMBER_*` credentials exist on this
      box. `auth()`, the claim gate and the EARS-523 authorization join all run
      untouched; only the OIDC redirect dance is skipped, which is
      `platform-claim-gate.e2e.spec.ts`'s own subject — return condition: a
      role-less member account is provisioned in the dev Zitadel (then the
      helper's callers switch to a real sign-in), or the first e2e defect that
      a real OIDC hop would have caught and the minted cookie masked (#382,
      PR #402)

<!-- debt-entry-end: 2026-08-27-5c8f2a1d94 -->

- [ ] 2026-08-30 `pnpm lint:tdd-order` cannot complete its PR-mode GitHub
      pagination on Windows: the guard's shell-backed `ghRun` passes an API URL
      containing `&page=` through `cmd.exe`, which executes `page=` as a second
      command (`'page' is not recognized`). Exact-head Linux CI still runs the
      same guard successfully, so this is a local-verification gap rather than a
      release blocker — return condition: the next edit to `tdd-order-lint.mjs`'s
      GitHub pagination/runner, or the next Windows session that needs a local
      PR-mode verdict before CI is available (#317)

<!-- debt-entry-end: 2026-08-30-317-tdd-order-windows -->

- [ ] 2026-08-31 PR #402 merged with a genuine historical TDD-order inversion:
      production route code preceded its test, the exact-head `tdd-order` guard
      was red, and the final review acknowledged the finding rather than
      classifying it as a false positive. Rewriting merged history is not a
      remedy; this record closes only when recurrence is mechanically prevented
      — return condition: the `tdd-order` WARN→BLOCK promotion review (earliest
      2026-09-24), or the next proposed merge with a genuine `tdd-order` finding,
      whichever comes first (#382, PR #402, #416)

<!-- debt-entry-end: 2026-08-31-416-tdd-order-402 -->

- [ ] 2026-08-31 `GET /api/p/member/admin/members` calls `listMembers()` without
      query bounds, then filters, sorts and slices in JavaScript, so every page
      reads the full `core.member` table. This is correct at the current registry
      scale but must not become the copied server-pagination pattern — return
      condition: the next material edit to `listMembers` or the admin members
      list route, or the registry reaching 500 members, whichever comes first;
      move filtering, numeric sorting and paging into the database query then
      (#416)

<!-- debt-entry-end: 2026-08-31-416-member-list-query -->

- [ ] 2026-08-31 `endpoint-authz-lint` covers platform API `route.ts` boundaries
      but not equally reachable `'use server'` boundaries. The existing Server
      Actions gate correctly, so this is a guard-coverage gap rather than a live
      authorization defect; changing process canon or guard machinery is outside
      this remediation PR — return condition: the next task that adds or
      materially edits a `'use server'` boundary, or the next separate
      process-canon/guard task touching `endpoint-authz-lint`, whichever comes
      first; extend this guard or add a sibling in that separate PR (#416)

<!-- debt-entry-end: 2026-08-31-416-server-action-authz -->

- [ ] 2026-09-02 nothing checks the open backlog before a new issue is filed:
      `pnpm issue:create` (`tools/gh/create-issue.mjs`) validates the SHAPE of an
      issue (type, channel, milestone, Source) and never asks whether one with the
      same trigger is already open, and `task-canon` §3 governs links, not
      duplicates. This sweep filed **#446** for the 2026-09-02 WARN→BLOCK promotion
      review while the parallel session on #438 was performing that very review the
      same day; #446 was closed as a duplicate hours later, after nine DEBT lines
      had already been pointed at it. Cheap to hit and cheap to undo (one close, one
      re-edit of the lines), so it is a line and not an issue — but it is a
      PARALLEL-SESSION failure mode, and this repo runs parallel sessions by default
      (`.claude/rules/parallel-sessions.md`) — return condition: the second
      duplicate issue filed by a parallel session or a sweep, or the next material
      edit to `tools/gh/create-issue.mjs`, whichever comes first (#440, PR #450
      decision-debt pass)

<!-- debt-entry-end: 2026-09-02-440-duplicate-filing -->

- [ ] 2026-09-02 the five `pr-body-guards.yml` guards promoted to BLOCK by #438 —
      `epic-autoclose`, `assignee-milestone`, `spec-link`, `stage-b`,
      `spec-deletion` — turn `pnpm pr:land` red but do NOT gate branch
      protection: `needs` cannot span workflows and
      `.github/branch-protection.json` still requires only the `ci` context, so a
      merge performed by hand in the GitHub UI lands the PR with those five red.
      What a bypass costs is tracker and process state, not data, money or access
      (task-canon §6 clause 2, hence a line and not an issue): a live epic
      auto-closed by a `Closes #<epic>` line, a spec or ADR deleted without the
      sanctioned `spec-deletion:` escape, a UI diff with no `Stage-B:` record, a
      feature PR resolving to no spec, an un-triageable PR row — each reversible
      by reopening, reverting or editing after the fact. Adding a cross-workflow
      context to the required list is the obvious fix and is rejected today
      because it would wedge merges the day that job legitimately skips — return
      condition: the first PR merged into `main` whose checks show any of those
      five with conclusion `failure` (`gh pr checks <n>` on the merged PR), or the
      next edit to `.github/branch-protection.json`, whichever comes first;
      decide then between adding the required contexts and giving
      `pr-body-guards.yml` its own `if: always()` aggregate job that CAN be
      required (#438, PR #449)

<!-- debt-entry-end: 2026-09-02-438-pr-body-guard-ui-merge-bypass -->

<!-- debt-entry-end: 2026-09-02-438-unpaged-files-array -->

- [ ] 2026-09-02 a subagent ran `pnpm install` in the SHARED main checkout
      instead of in its own worktree, unasked. `.claude/rules/parallel-sessions.md`
      says the session's work lives in `.claude/worktrees/<N>`, but nothing
      mechanically stops an install — or any other node/pnpm command — from
      landing in the main checkout under a live stand. Left as prose rather than
      fixed in this canon PR: the fix is a hook, which is its own diff — return
      condition: the next recurrence of an install/build command run outside the
      session's worktree; then a hook that refuses install commands whose cwd is
      not the session's worktree (sibling of #322's lead-dispatch hook) (#433)

<!-- debt-entry-end: 2026-09-02-433-install-outside-worktree -->

- [ ] 2026-09-02 the six UX facets (composition / controls / grouping / states /
      feedback / post-submit) now live in FOUR places: the canon in
      `.claude/skills/build-ui-from-design-system/SKILL.md` step 4, the fill-in
      slots in `.github/pull_request_template.md`, the `FACETS` constant in
      `tools/lint/ux-record-lint.mjs`, and an enumeration in prose in the
      `docs/ci-guardrails.md` §5 register row. The template and the constant are
      operational copies the mechanism needs (a form to fill, strings to match);
      the §5 prose enumeration is a second retelling of the canon in the sense
      CLAUDE.md's «path is the contract» bans, kept because the register row is
      read standalone — return condition: the first change to the facet SET
      (adding, renaming or dropping a facet); that PR replaces the §5
      enumeration with a pointer at step 4 and updates the template and the
      constant in the same diff (#433)

<!-- debt-entry-end: 2026-09-02-433-ux-facets-four-copies -->

- [ ] 2026-09-02 both always-on rules files touched by #433 grew by APPEND with
      nothing relocated — `.claude/rules/design-process.md` +17 lines (119/200,
      60 % of the per-file budget) and `.claude/rules/dev-env.md` +10 (74/200,
      37 %), the latter restating the «seeded by `provision.sh`, steps 2 and 8»
      fact the same file already carries one bullet up.
      `pnpm lint:instruction-budget` is PASS (corpus 77 %, 618/800), so nothing
      forced a compaction pass and none was run; `.claude/skills/wrap/SKILL.md`
      phase 3 («adding signal means relocating detail out») binds a wrap session
      and this was not one — return condition: the first NEAR or FAIL row for
      either file or for the corpus in `pnpm lint:instruction-budget`, or the
      next `/wrap` phase 3, whichever comes first; then the incident narratives
      in both bullets move to the skills that own them (#433)

<!-- debt-entry-end: 2026-09-02-433-rules-appended-not-compacted -->

- [ ] 2026-09-02 the permanent append-marker comment occurs TWICE in this file —
      once quoted in the rules bullet that defines it, once as the real marker at
      the end of the active block — and #433's entry was first inserted at the wrong (first)
      occurrence, inside the rules header, then redone. Nothing catches that
      placement: the `debt-merge-driver` spec asserts anchor uniqueness and
      preservation, not that an active entry sits between the «entries below
      this line» marker and the permanent append marker at the end of the active
      block — return condition: the second misplaced insertion, or the next `/wrap`
      DEBT sweep, whichever comes first; then that spec gains the placement
      assertion (#433)

<!-- debt-entry-end: 2026-09-02-433-debt-marker-ambiguous -->

- [ ] 2026-09-02 #439 removes a subagent DISPATCH from the write-evidence list of
      `isWriteToolUse()` (`tools/hooks/completion-report-gate.mjs`), inverting the
      #158 clause «the subagents wrote, the lead reports». The inversion is right
      for the incident it closes — a grooming session that only read canon and
      fanned out read-only recon owes no stage-6 report — but it leaves a named
      residual: a lead that dispatches an IMPLEMENTER, lets the subagent commit and
      push inside its own worktree/transcript, and then writes «done» while itself
      landing nothing (no commit/push of its own, no `pnpm pr:land` / `gh pr merge`,
      no `gh issue comment`) now trips none of the three Stop gates, where under
      #158 it tripped all three. That session DOES owe a report. Closing it needs
      evidence the lead's own transcript does not carry — the subagent's write, or a
      dispatch-result-derived signal — which is a new cross-transcript input to the
      recognizer, not a list edit, so it is routed rather than smuggled into the
      fix — return condition: the next `/wrap` or retro that records a lead session
      which dispatched implementation and reported it done while landing nothing
      itself (gates silent on a session that owed a stage-6 report), or the next
      material edit to `isWriteToolUse()`'s evidence list, whichever comes first
      (#439, PR #441 decision-debt pass)

<!-- debt-entry-end: 2026-09-02-439-dispatch-not-write-evidence -->

- [ ] 2026-09-02 Root `.gitattributes` sets `/DEBT.md merge=union`, but that driver
      is a LOCAL git config: GitHub's SERVER-side mergeability computation ignores
      it. So every append to `DEBT.md` that lands on `main` flips each still-open PR
      that also touches `DEBT.md` to `CONFLICTING` — which suppresses that PR's CI
      runs (GitHub will not build an unmergeable head), and makes
      `gh pr update-branch` refuse with «merge conflict between base and head». The
      union driver then only helps whoever merges `origin/main` LOCALLY, which is
      the manual step the driver was adopted to remove. Today (#440 sweep wave) it
      cost three local `git merge origin/main` rounds across PRs #448/#449/#450 and
      one accidental push of conflict markers into a PR branch. Not fixed here
      because both candidate fixes are structural, not a one-liner: split the ledger
      into per-entry files under a `debt/` directory (no shared hunk, so no
      server-side conflict at all), or serialize DEBT-touching PRs by convention —
      the first is a format migration touching the sweep tooling and
      `tests/unit/debt-merge-driver.spec.ts`, the second trades throughput for calm
      — return condition: the next parallel wave that has ≥2 open PRs touching
      `DEBT.md` at the same time, or a decision to split debt into per-entry files,
      whichever comes first (#440, review of PR #450)

<!-- debt-entry-end: 2026-09-02-440-union-driver-not-server-side -->

- [ ] 2026-09-03 `docs/evidence/<issue>/` invented as the home for committed acceptance screenshots (#434). The repo had no such convention: `.playwright-mcp/` is git-ignored, so it cannot carry evidence into a PR, and there is nowhere else a reviewer can look. One issue's folder is a precedent, not a rule — return condition: the SECOND task that needs to commit acceptance screenshots, at which point it is a convention and belongs in `.claude/skills/task-cycle/SKILL.md` stage 5 with a retention rule (2.4 MB per task does not scale silently).

<!-- debt-entry-end: 2026-09-03-ev1dence434 -->

- [ ] 2026-09-03 Three React-Compiler-era eslint rules — `react-hooks/set-state-in-effect`, `react-hooks/immutability`, `react-hooks/static-components` — switched off for `src/ui/**` alone in `eslint.config.mjs` (#434). The current upstream shadcn/Refine sources trip all three, and fixing them in place is a silent fork the next `shadcn add` reverts. Scoped by directory and by rule name so the app's own components keep every one of them — return condition: the next refresh of the kit from its registries, when each rule is re-enabled one at a time and the ones upstream has fixed stay on.

<!-- debt-entry-end: 2026-09-03-uikitl1nt -->

- [ ] 2026-09-03 `src/ui/refine-ui/data-table/data-table-filter.tsx` is the one file of the vendored `data-table` registry item deliberately NOT kept (#434): its operator map is missing `eqs`/`nes` and it does not typecheck against `@refinedev/core` 5.x. Nothing needs column filters yet, so the gap is invisible today — return condition: the first cabinet screen that needs a per-column filter, which is also the moment to decide between patching the map here and dropping the item.

<!-- debt-entry-end: 2026-09-03-dtf1lter -->

<!-- debt-append-marker -->

_(Swept 2026-09-02 (#440, owner-requested full sweep of the 44 open lines: 43
real entries plus the `- [ ]` example inside the entry-format code fence, which
is documentation and not an entry). **43 entries in, 40 out — counted at the sweep's base commit `fe1508d`,
not at the merged head, which carries later 2026-09-02 arrivals from `main`
that this sweep did not cover. Every return
condition was checked against the repo, the tracker and the guard register —
none was assumed.**

**Discharged in this PR — three, bodies removed, anchors kept:** the
pinned-commit shipping rule (`2026-08-07-de2021c1b9`), whose trigger «the next
supervised `provision.sh` run» fired with `6b9b9c0`/#380 (finance flow roles) —
the recipe now carries the `git show origin/main:… | ssh … bash -s --` form and
the 2026-08-07 incident that motivates it, in `infra/dev-stand/idp/bootstrap.md`
§5, one step above where the run actually happens; the missing Node-version
guard on the standalone deploy subcommands (`2026-08-05-6f37d6258d`) — two
`predeploy:*` lines in `package.json`, the `task-canon` §6 floor exactly (one
line, no decision, so it is APPLIED, not filed); and `set-board-status`'s
`process.exit(0)` after the DONE write (`2026-08-04-a2a203497d`) — the default
`io.exit` seam now sets `process.exitCode` and returns, and `main()`'s two raw
exits went the same way, so a Windows TTY can finish flushing before the process
ends.

**Promoted — four issues covering five lines,** each line kept in place with
a superseding «#N closed» condition, because until the issue lands the deviation
is still live and a deleted line is one nobody re-reads:
`2026-08-07-01f12872fe` → **#442** (assignee/milestone set at PR create time; the
firing event is PR #430, open with both fields empty and the guard red);
`2026-08-05-00c2fc95bc` → **#443** (`deploy:prod --rollback` ancestry check —
promoted specifically to retire a banned-shape first-incident trigger on the
production deploy path); `2026-08-05-61162d4aea` → **#444** (the last Russian
agent-facing prose, whose on-touch trigger fired on all three remaining files and
was missed twice; the sweep also recorded the two Cyrillic cases that must NOT be
translated — the transliteration table and the functional stage-7 marker
regexes); and `2026-08-17-c3d2e255e3` + `2026-08-25-6b0d4c1a83` → **#445**, one
issue for two lines that describe the same pair of hours e2e specs from opposite
ends and have one remedy.

**The 2026-09-02 promotion review was not ours to file — it had already been
done.** Nine lines (`2026-08-05-8fa8f75d9b`, `2026-08-14-f2de673c1f`,
`2026-08-15-586bd87345`, `2026-08-15-25ed97380d`, `2026-08-15-51ba26ac00`,
`2026-08-20-b7f41c9a02`, `2026-08-20-4e6a80d1c7`, `2026-08-26-3b59d1e0f4`,
`2026-08-26-9f27ac4d15`) deferred themselves, by their own text, to the
WARN→BLOCK promotion review dated 2026-09-02 in `docs/ci-guardrails.md` §5. This
sweep filed **#446** for that review; the parallel **#438 / PR #449** had already
performed it on the same day — 12 guards examined, 10 promoted to BLOCK,
`ears-naming` and `ears-test` held at WARN until 2026-09-30 (narrowing filed as
#447; #288 open). #446 is therefore closed as a duplicate of #438, and all nine
lines are **restated** against the verdict rather than left pointing at it: every
one of their guards was promoted, every defect was weighed BY DIRECTION and
recorded as an accepted limit in the register's promotion cell, and none was
fixed. Eight of the nine got their own surviving, event-shaped first trigger
back; `2026-08-20-b7f41c9a02` had none left and was given one. A deferred
decision that has been TAKEN is not the same thing as a gap that has been
CLOSED, so no body was removed.

**Restated — twelve** (the nine above, plus three).
`2026-08-06-fe94868264` stated its REMEDY where the trigger
belongs, so it could never fire and no sweep could act on it; it now has one
(`cleanupBranch` edited, or ≥10 merged-but-undeleted local task branches).
`2026-08-10-caa8c9f751` was narrowed to the `/p/okr` DASHBOARD, because `e38de64`
(#404) and `7724147` (#416) touched `/p/admin/okr` — a different surface with its
own provenance row — and the loose phrase «the OKR surface» was about to be read
as a firing. `2026-08-26-7c4de91b83` gained a 2026-10-01 backstop: «the first
cold run» has no owner and can idle forever.

**Written off — none. Kept unchanged — 23,** every trigger re-checked rather than
assumed. The checks that could plausibly have fired and did not: `tools/lint/lib/`
still holds exactly the two files #154 created, so the `guard-test-coverage`
false-positive trigger is unfired; no workflow has been ADDED under
`.github/workflows/` and no composite action or matrix-interpolated guard
invocation exists anywhere under `.github/`, so all three `workflow-auth` lines
are unfired on their first trigger (they moved on their second, the promotion
review); `package.json`'s `prepare` and `.github/branch-protection.json` are both
untouched since their lines were written; `mergeStateStatus` handling and
`isBaseMergeCommit` in `pr-land.mjs` have had no edit since #226, so neither
merge-gate line has fired (`1ca16c9`/#399 taught the gate the WARN plane, which
is a different function); `src/auth.ts`'s `jwt` callback has had no commit since
#334 created its line; `listMembers`, the admin members route,
`endpoint-authz-lint.mjs` and any `'use server'` boundary are all untouched since
2026-08-31; and `#361` and `#403` are both still open, which is exactly what the
two «#N closed» lines say they are waiting for.)_

_(Swept 2026-07-30 (#92): the /p/hours upsert-without-prefill line — the very
gap the money rule above now bans from this file — was fixed in #85/#86, not
written off.)_

_(Swept 2026-08-15 (#239, owner-requested full tech-debt sweep). 35 open lines in,
32 out. **Deleted as dead — three:** the 2026-08-05 `workflow-auth`
"undeclared-severity catches neither but not both" line, which had already been
promoted to the open #207 and was a second copy of it; the 2026-08-14
`strict: true` / `update-branch` line, fixed in #222 (`isBaseMergeCommit`) and
itself saying it goes at the next sweep; the 2026-08-15 `next dev` /
`AGENTS.md` line, which duplicates the open #229 — #229 owns the fix and this
sweep, not #229's PR, removes the line. **Promoted — three,** each marked in
place and to be deleted at the sweep after its issue closes: the
`release-digest.yml` empty-sha backfill → #236 (trigger fired: `cce6631`/#215
edited the workflow without the fix); `handoff-verify` false rows → #237 (a false
`STALE` plus a new wrong-repo subclass, both observed live on this session's own
handoff); the Russian `tools/gh` CLI surfaces → #238 (trigger fired in
`39973aa`/#234 and was missed for the second time, so an on-touch rule became a
bounded task). **Written off — none.** **Kept — the remaining 29,** every trigger
re-checked against the repo rather than assumed. Four checks that could plausibly
have fired and did not: only one platform migration exists
(`0000_create_core_schema.sql`), so neither `audit-coverage` nor
`migration-index` has a trigger; no file has been added under `tools/lint/lib/`
since #154 created both of the two there; the `assignee-milestone` guard passed
on all eight agent-opened PRs from #213 to #234, so its "trips one more time"
trigger has not fired; and #227 was SSH hardening, not a `deploy:prod --rollback`,
so the rollback-ancestor trigger has not fired either. Also considered and left
alone: #230 (OKR font subsetting) does not fire the `/p/okr` `design-source`
back-fill trigger, which asks for a change to the surface's DESIGN — layout,
palette, composition — and subsetting changes none of them.)_

_(Swept 2026-08-05 (/wrap, retro of the 7.2 session): the 2026-07-31
`frontend-design` line closed as fixed — the skill is now registered and
available in the plugin catalog (`frontend-design:frontend-design`), which is
exactly its return condition. Remaining lines kept: none of their return
conditions have fired (board:status output complete twice today, no CLI-flag
changes, no robocopy-fallback entry).)_

_(Swept 2026-08-18 (#256, PR-2). **Two lines closed by the work, bodies removed,
anchors kept:** the `HoursDataError`-twice line (`2026-08-17-b2e1d255e2`) — its
return condition «#256 deletes `store.ts`» fired, the JSON store is gone and the
class now exists once, in `src/lib/hours/core/errors.ts`; the refusal-sentence
duplication line (`2026-08-17-a1f0c255e1`) — its return condition «#256, the JSON
store leaves and the domain files are next touched» fired, and the sentences moved
into one source, `src/lib/hours/messages.ts`, which `document.ts`,
`publication.ts` and `core/refusals.ts` all import. The third #255 line (the e2e
sign-in helper duplication, `2026-08-17-c3d2e255e3`) is UNTOUCHED: its trigger —
the next e2e spec that signs in — has not fired.)_

_(Swept 2026-08-19 (#276). **One line closed by the work, body removed, anchor kept:**
the `audit-coverage` guard line (`2026-08-11-8fcb3c6ffc`) — its return condition «the
first product table lands in `core`» fired with #125/#255 (six `core` tables) and the
rule could finally be stated concretely once #273 attached the triggers. The guard is
`tools/lint/audit-coverage-lint.mjs` (`pnpm lint:audit-coverage`), WARN in `ci.yml`,
registered in `docs/ci-guardrails.md` §5, paired with
`tools/lint/guard-tests/audit-coverage-lint.spec.ts`. Note what it turned out to be: not
«every `core` table carries its audit COLUMNS» as the 2026-08-11 line guessed, but «every
`core` table carries the capture TRIGGER and every column has a whitelist decision» —
spec 201 replaced the per-table-columns design with one generic trigger, so the line's
subject moved before it was discharged.)_
_(Swept 2026-08-19 (`/wrap` retro of the #201 session). **Five lines promoted to
their own issues, bodies removed, anchors kept.** Per line, what actually
happened to its return condition:

- `2026-08-11-a0f80803db` (`migration-index`) → **#285**. Return condition «the
  third platform migration» — FIRED: the chain now holds four
  (`0000_create_core_schema`, `0001_member`, `0002_hours`,
  `0003_universal_edit_audit`), so it fired at `0002` and was missed once.
- `2026-08-05-39d11e3194` (no `.mjs` is ever prettier-checked) → **#286**.
  Return condition «the next PR that touches `package.json`'s script block» —
  FIRED repeatedly and missed each time: `b188988` (#243), `91312c0` (#200),
  `81e7ebc` (#255) and `3b922fd` (#256) all edited that block.
- `2026-08-18-d4c3b256f1` (caller-less `src/lib/hours/core/import.ts`) → **#287**.
  Return condition «the next task that touches `src/lib/hours/core/`» — FIRED
  with `c99caaa` (#273/PR #280), the audit-capture work.
- `2026-08-19-e7a1b201f2` (flat `EARS-N` id space) → **#288**. Promoted **ahead
  of its trigger**: neither «the #201 implementation task lands its tests» nor
  «a third spec starts at `EARS-1`» has happened. The promotion stands anyway
  because the live symptom is already in the tree — `tools/lint/ears-test-lint.mjs`
  carries a flat-key deferral allowlist as the workaround for exactly this
  conflation, and a workaround with no owning issue is what this file's sweep
  rule exists to end.
- `2026-08-06-9c4363b31b` (`.claude/rules/dev-env.md` untranslated) → **#289**.
  Return condition «the next task that substantively reworks `dev-env.md`» —
  FIRED on 2026-08-07 with `6783739` (#170/PR #179), a 12-insertion rewrite of
  the provisioning bullet; the file is still all-Russian.

Promotion rather than a fix in place for all five: each is a bounded task with
its own diff, and none of them belongs inside the retro's canon-file PR.)_
