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

- [ ] 2026-08-10 the `/p/okr` surface still has no vendored design source in
      `design-source/` after another touch (#181, a geometry-only fix like
      #79/#180 before it): the design-process rule back-fills a pre-#138 surface
      "on first touch", but the original is a Claude.Design canvas only the
      owner can export, and the owner declined to engage with the back-fill
      question in-session (2026-08-10). Geometry fixes measure against live-stand
      reference numbers (PR #180 / PR #188 comments), so nothing was built from
      prose — return condition: the first task that changes the OKR surface's
      DESIGN (layout/palette/composition) rather than its geometry vendors the
      canvas before building (#181)

<!-- debt-entry-end: 2026-08-10-caa8c9f751 -->

- [ ] 2026-08-07 supervised infra-script runs must ship the script from a
      pinned commit (`git show origin/main:<path> | ssh <box> bash -s -- …`),
      never `scp` from a working tree: the #93 AC-verification run scp'd the
      main checkout BEFORE it was fast-forwarded to the just-merged #179, so the
      OLD destructive default ran against the live dev IdP and collapsed
      `postLogoutRedirectUris` 20 → 1 for ~3 minutes (restored, evidence on
      #93). The recipe in `infra/dev-stand/idp/bootstrap.md` §6 still says
      nothing about pinning — return condition: the next supervised
      `provision.sh` run, or the next time any repo script is shipped to a
      remote box for execution (#93)

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
      tail) copying assignee + milestone from the linked issue — return
      condition: the guard trips on one more agent-opened PR despite the
      dispatch brief carrying the `--assignee`/`--milestone` instruction (#80)

<!-- debt-entry-end: 2026-08-07-01f12872fe -->

<!-- debt-entry-end: 2026-08-06-01cdf09cad -->

<!-- debt-entry-end: 2026-08-06-9c4363b31b -->

<!-- debt-entry-end: 2026-08-06-620bacd10f -->

- [ ] 2026-08-05 `deploy:smoke` / `deploy:notes` have no `pre*` Node-version
      guard (`deploy:prod` checks Node 22, the standalone entries don't) —
      return condition: first misrun of a standalone deploy subcommand on a
      wrong Node (#137, review of PR #155)

<!-- debt-entry-end: 2026-08-05-6f37d6258d -->

- [ ] 2026-08-05 `deploy:prod --rollback <sha>` accepts any sha with no
      ancestor/deployed-history check — an operator typo can "roll back" to an
      arbitrary commit — return condition: first rollback in anger, or before a
      second operator gets deploy access (#137, review of PR #155)

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

<!-- debt-entry-end: 2026-08-05-8fa8f75d9b -->

<!-- debt-entry-end: 2026-08-05-39d11e3194 -->

- [ ] 2026-08-05 `tools/gh/handoff-verify.mjs`: a segment naming ≥2 refs with one
      claim pins the claim on none of them and degrades to INFO (a false PASS is
      cheaper than a false STALE in a gate that exits 1) — return condition:
      revisit if real handoff runs produce INFO rows that should have been caught
      as STALE, i.e. the rule starts hiding genuine drift (#134, review of PR #150)

<!-- debt-entry-end: 2026-08-05-05b8797876 -->

- [ ] 2026-08-05 legacy Russian agent-tool prose remains in
      `tools/gh/lib/gh.mjs`, `tools/dev/task-worktree.mjs`, and
      `tools/hooks/dispatch-guard.mjs` / `deviations-gate.mjs` (owner ruling,
      2026-08-05: all project artifacts are English) — return condition:
      translate each file in its own no-behaviour-change commit before the next
      material edit. Worked off 2026-08-06 (#142) for `tools/gh/pr-land.mjs` and
      its spec. Worked off 2026-08-16 (#238) for the six remaining agent-facing
      `tools/gh` CLI files (`create-issue`, `backlog-triage`,
      `bootstrap-taxonomy`, `set-board-status`, `handoff-verify`,
      `dispatch-brief`), their matching test prose, and
      `.claude/skills/spec-issue-graph/SKILL.md`; legacy Russian parser fixtures
      remain only as intentional compatibility data. `tools/gh/lib/gh.mjs` was
      also materially edited by `39973aa` (#234) and missed the trigger, but was
      outside #238's enumerated six-file scope; the hooks likewise keep their
      existing trigger.

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
      `fix/48-…` are all merged and all still present). `pr:land` now tells the
      truth about this instead of promising teardown will do it (#142). Return
      condition: teach teardown to recognise a squash merge (e.g. `git cherry` or
      `--is-ancestor` against the PR's merge commit) so the remedy stops being
      manual — a behaviour change to a destructive tool, hence its own task, not a
      rider on #142 (review of PR #161)

<!-- debt-entry-end: 2026-08-06-fe94868264 -->

- [ ] 2026-08-04 `set-board-status.mjs`: `process.exit(0)` сразу после записи
      «ГОТОВО» — на Windows-TTY запись асинхронна, тот же класс, что #132
      (обрезанный вывод при сделанной работе); лечится `return` вместо exit.
      Замечание ревью PR #141 — return condition: первый случай обрезанного
      «ГОТОВО» или ближайший рефактор runBoardStatus (#132)

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

<!-- debt-entry-end: 2026-08-15-51ba26ac00 -->

<!-- debt-entry-end: 2026-08-17-a1f0c255e1 -->

<!-- debt-entry-end: 2026-08-17-b2e1d255e2 -->

- [ ] 2026-08-17 the dev-stand sign-in helper of `tests/e2e/hours-core-parity.e2e.spec.ts`
      duplicates the one in `tests/e2e/hours-prod.e2e.spec.ts` (absolute prod origin
      vs `baseURL` stand) — return condition: the next e2e spec that signs in, or
      the first edit of either helper (#255, PR #259)

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

<!-- debt-entry-end: 2026-08-20-b7f41c9a02 -->

- [ ] 2026-08-20 `spec-link-lint` resolves the linked issue from `Part of #N` too
      (#299, PR #303), so a chore-class slice of a `Feature`-typed epic parent
      inherits the parent's type and can be asked for a spec link it does not owe.
      WARN and low volume today — return condition: before the `spec-link` BLOCK
      promotion window opens, earliest 2026-09-02 (`docs/ci-guardrails.md` §5), or
      the first slice PR this fires on, whichever comes first (#299, PR #303
      review round 2, N3)

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
      mechanical import swap inside a claim-gate PR. Distinct from the
      2026-08-17 duplication line (`2026-08-17-c3d2e255e3`): that one is two
      specs duplicating each other, this one is one spec left behind by a
      hardening the other copies now have — return condition: the next task that
      touches hours e2e, or the first flake of hours sign-in in CI (#313,
      PR #334)

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
      from the 2026-08-15 measurement, not measured after the change. This
      narrowed line replaces the fixed 2026-08-15 entry so the residual is
      carried by the ledger rather than by one PR comment — return condition: the
      first cold `pnpm test:e2e` run on this box (green → delete the line; still
      red → the budget is the wrong remedy, not merely the wrong number)
      (#362, PR #364 review non-blocking N2)

<!-- debt-entry-end: 2026-08-26-7c4de91b83 -->

- [ ] 2026-08-26 `stage-b-lint.mjs` keeps the inherited `GO_RE`-before-
      `PLACEHOLDER_RE` ordering that `design-fidelity-lint.mjs` had to fix
      (an unfilled `GO — <owner, date>` shape could classify as a record);
      left as-is because the stage-b plane is WARN and its template shape is
      HTML-commented, never printed back at the violator — return condition:
      stage-b promotion to BLOCK per `docs/ci-guardrails.md` §4 (earliest
      2026-09-02), or the first observed placeholder clearing the guard
      (#359, PR #371 fix round)

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

<!-- debt-append-marker -->

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
