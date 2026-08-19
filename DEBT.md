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

- [ ] 2026-08-11 spec §11 defers `audit-coverage` (a guard that every `core` table
      carries its audit columns) to «эпик 1, при создании схемы и миграций» — #125
      created the schema and the first migration, so the trigger fired, but the
      migration creates `CREATE SCHEMA` and NOTHING else: there is not one table
      for the guard to have an opinion about, and a guard written against zero
      tables would be green by vacuum and unreviewable. Recorded rather than
      built — return condition: the first product table lands in `core` (#124 or
      the hours migration), which is also the first moment the guard's rule can
      be stated concretely (PR #190 review major 7)

<!-- debt-entry-end: 2026-08-11-8fcb3c6ffc -->

- [ ] 2026-08-11 spec §11 defers `migration-index` (a generated index of
      migrations with their purpose) to the same «при создании схемы и миграций»
      trigger, fired by #125. Deferred for the same reason at a smaller scale —
      the repo holds exactly ONE platform migration, and an index of one entry is
      a file that only ever costs a review. `pnpm platform:migrate:status` already
      answers the question the index exists for (what is applied, what is not,
      what can never be) — return condition: the third platform migration, or the
      first time a migration's purpose is not obvious from its tag (PR #190
      review major 7)

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

- [ ] 2026-08-06 `.claude/rules/dev-env.md` was touched by PR #166 (new
      Russian STOP bullet added) without the translate-on-touch pass the task
      canon prescribes for the legacy Russian corpus — deliberate: a lone
      English bullet in an all-Russian file reads worse, and translating a
      canon rules file is not a redirect-URI chore's business — return
      condition: next task that substantively reworks `dev-env.md` translates
      the whole file (#166, review round 2)

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

- [ ] 2026-08-05 `tools/lint/tdd-signal-lint.mjs`: substring path matching — a
      spec that merely MENTIONS a module path counts as covering it (nothing
      masked today; anchor needles to import statements like
      `IMPORTS_GUARD_LIB_RE` does) — return condition: first tdd-signal finding
      disputed as false, or the guard's WARN→BLOCK promotion review
      (2026-09-02 window) (#136, review of PR #154)

<!-- debt-entry-end: 2026-08-05-8fa8f75d9b -->

- [ ] 2026-08-05 `package.json` `format:check` / `lint-staged` globs are
      `{ts,tsx,css,md,json,yml,yaml}` per tree, so **no `.mjs` is ever
      prettier-checked** — the whole `tools/**` tooling layer (every guard, every
      hook, the gh scripts) is unformatted-by-omission in CI. PREDATES this PR:
      the glob has never covered `.mjs`; #157 only made it visible by adding four
      guards. Not fixed there deliberately — widening the glob reformats every
      existing `.mjs` in one sweep, which belongs in its own diff, not inside a
      guard PR. Return condition: the next PR that touches `package.json`'s
      script block for any reason, or the 2026-09-02 guard-promotion sweep —
      whichever comes first (#157, review round 2 of PR #160 + iteration-end
      gate note b)

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

- [ ] 2026-08-15 the e2e suite's `test.beforeAll` hook budget is 30 s, which is
      shorter than Next dev's FIRST compile of `/admin` on this box: a cold run of
      `pnpm test:e2e` fails `admin.e2e.spec.ts` and `publish-panel.e2e.spec.ts` on
      `"beforeAll" hook timeout of 30000ms exceeded` while waiting for
      `#field-email`, then leaves 16 skipped and 7 not run. Nothing is wrong with
      the product — a warmed stand passes — but the suite's first red of the day is
      routinely noise, and task-cycle stage 5 makes a green Playwright pass the
      precondition for inviting the owner to any UI flow, so noise there is
      expensive. CI does not cover it (`ci.yml` runs `test:unit` only), which is why
      it stays invisible between sessions — return condition: the next task that
      must run `pnpm test:e2e` as acceptance evidence, or any move to run e2e in CI
      (observed in #232 / PR #234, diff touched no runtime code)

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

- [ ] 2026-08-18 `src/lib/hours/core/import.ts` has no PRODUCTION caller since
      #256 deleted `tools/platform/hours-import.ts` and the
      `platform:hours:import` command (owner: a second import is never needed).
      Kept rather than deleted because it is the mechanics the production rows
      were written with and the only reviewed restore path from the
      `hours.json.<date>` archive; its driver is now
      `tests/int/platform/hours-import.int.spec.ts` alone, which is also EARS-13's
      coverage — return condition: the archive is retired (the volume mount goes
      with it), or the next task that touches `src/lib/hours/core/` (#256, PR-2)

<!-- debt-entry-end: 2026-08-18-d4c3b256f1 -->

- [ ] 2026-08-19 `lint:ears-test` treats `EARS-N` as a FLAT, repo-wide id space,
      but `docs/specs/README.md` defines the ids as stable **per spec**. Spec 201
      landed as the second spec declaring `EARS-1`…`EARS-22`, and the guard reads
      all of them as covered because spec 124's tests cite those same tokens —
      so 22 clauses with no test whatsoever report clean, and only `EARS-23` (an
      id 124 does not use) surfaces. The guard's stale-deferral ratchet makes the
      honest workaround impossible too: deferring `EARS-1` would be reported
      stale. Recorded rather than fixed here because the fix is a change to the
      guard's id model (qualify a citation by its spec, e.g. `201 EARS-1:` in the
      test title — the very ds-platform machinery §7 of `docs/ci-guardrails.md`
      deliberately dropped for lack of a convention), which is its own task and
      not this spec's — return condition: the #201 implementation task lands its
      tests (the first moment the conflation would hide a REAL missing test), or
      a third spec starts at `EARS-1`

<!-- debt-entry-end: 2026-08-19-e7a1b201f2 -->

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
