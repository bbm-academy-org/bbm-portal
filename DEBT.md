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

Entry format:

```
- [ ] YYYY-MM-DD <what was deviated & why> — return condition: <trigger> (#N)
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

- [ ] 2026-08-11 spec §11 defers `migration-index` (a generated index of
      migrations with their purpose) to the same «при создании схемы и миграций»
      trigger, fired by #125. Deferred for the same reason at a smaller scale —
      the repo holds exactly ONE platform migration, and an index of one entry is
      a file that only ever costs a review. `pnpm platform:migrate:status` already
      answers the question the index exists for (what is applied, what is not,
      what can never be) — return condition: the third platform migration, or the
      first time a migration's purpose is not obvious from its tag (PR #190
      review major 7)

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

- [ ] 2026-08-07 `provision.sh`: `IDP_DEV_HOSTS=','` yields origins with empty
      hosts (`http://:3000`) — pre-existing input-validation hole, orthogonal to
      #170's diff, flagged as nit 5 of PR #179's review and deliberately not
      fixed there — return condition: the next task that touches
      `generate_uris` or adds host-axis configuration (#170)

- [ ] 2026-08-07 agent-opened PRs trip the `assignee-milestone` guard on every
      open: `gh pr create` sets neither assignee nor milestone, so each
      implementer patches both by hand and re-runs the job (bit #178 and #179 on
      the same day). Root fix is a create-side wrapper (or a `pr:land`-style
      tail) copying assignee + milestone from the linked issue — return
      condition: the guard trips on one more agent-opened PR despite the
      dispatch brief carrying the `--assignee`/`--milestone` instruction (#80)

- [ ] 2026-08-06 `.claude/**` sits outside `format:check`'s globs while
      lint-staged prettier DOES reformat it on commit — canon files get
      formatted by the hook but are never checked in CI, so a hook-bypassing
      commit can land unformatted canon and the next toucher inherits a noisy
      diff (bit PR #172: the hook silently reformatted a line of
      `parallel-sessions.md`) — return condition: next edit to the
      `format:check` globs or the next surprise-reformat incident (#169,
      gate of PR #172)

- [ ] 2026-08-06 `.claude/rules/dev-env.md` was touched by PR #166 (new
      Russian STOP bullet added) without the translate-on-touch pass the task
      canon prescribes for the legacy Russian corpus — deliberate: a lone
      English bullet in an all-Russian file reads worse, and translating a
      canon rules file is not a redirect-URI chore's business — return
      condition: next task that substantively reworks `dev-env.md` translates
      the whole file (#166, review round 2)

- [ ] 2026-08-06 `release-digest.yml` "Resolve target sha" step: the
      `gh api … -f environment=production -F per_page=1` call turns the request
      into a POST (create-a-deployment), which 403s under `deployments: read`;
      the error JSON lands on stdout, so `$sha` is polluted and the
      `git rev-parse HEAD` fallback never fires — a `workflow_dispatch` backfill
      WITHOUT an explicit `sha` input always skips green. Workaround: pass the
      sha explicitly (that path is verified working, 2026-08-06). Return
      condition: next edit to `release-digest.yml`, or the first backfill
      dispatch that needs the empty-sha path (#137, first live digest run).
      **Return condition FIRED and promoted 2026-08-15: `cce6631` (#215) edited
      this workflow without the fix → #236.** This line goes at the sweep after
      #236 closes.

- [ ] 2026-08-05 `deploy:smoke` / `deploy:notes` have no `pre*` Node-version
      guard (`deploy:prod` checks Node 22, the standalone entries don't) —
      return condition: first misrun of a standalone deploy subcommand on a
      wrong Node (#137, review of PR #155)
- [ ] 2026-08-05 `deploy:prod --rollback <sha>` accepts any sha with no
      ancestor/deployed-history check — an operator typo can "roll back" to an
      arbitrary commit — return condition: first rollback in anger, or before a
      second operator gets deploy access (#137, review of PR #155)
- [ ] 2026-08-05 inaugural release digest walks the full release history
      serially — return condition: digest step visibly slow (>30 s) once
      release count grows (#137, review of PR #155)
- [ ] 2026-08-05 migration-ledger read in `deploy:prod` hard-requires `psql`
      on the workstation — return condition: first deploy attempt from a box
      without psql (#137, review of PR #155)

- [ ] 2026-08-05 `tools/lint/guard-test-coverage-lint.mjs`: a future helper in
      `tools/lint/lib/` importing `guard.mjs` would be flagged `nested` with a
      wrong remedy (false-positive class; no such helper exists today) — return
      condition: first new file added under `tools/lint/lib/` (#136, review of
      PR #154)
- [ ] 2026-08-05 `tools/lint/tdd-signal-lint.mjs`: substring path matching — a
      spec that merely MENTIONS a module path counts as covering it (nothing
      masked today; anchor needles to import statements like
      `IMPORTS_GUARD_LIB_RE` does) — return condition: first tdd-signal finding
      disputed as false, or the guard's WARN→BLOCK promotion review
      (2026-09-02 window) (#136, review of PR #154)
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

- [ ] 2026-08-05 `tools/gh/handoff-verify.mjs`: a segment naming ≥2 refs with one
      claim pins the claim on none of them and degrades to INFO (a false PASS is
      cheaper than a false STALE in a gate that exits 1) — return condition:
      revisit if real handoff runs produce INFO rows that should have been caught
      as STALE, i.e. the rule starts hiding genuine drift (#134, review of PR #150)
- [ ] 2026-08-05 `tools/gh/*` (plus `tools/dev/task-worktree.mjs`, `tests/unit/gh-*`
      and the `.claude/skills/spec-issue-graph/SKILL.md` body) still carry Russian
      file headers, CLI output, test names and prose; #144 fixed only the canon
      path strings inside them, which is not a material edit, so the on-touch
      translation rule (owner ruling, 2026-08-05: all project artifacts are
      English) did not fire — return condition: translate each file the next
      time it is materially edited (#144). Extended 2026-08-05 (retro PR): the
      same holds for `tools/hooks/dispatch-guard.mjs` / `deviations-gate.mjs` —
      materially edited by the retro-hooks PR, but the whole-file translation was
      deliberately kept out of that PR to keep the behavioral diff reviewable;
      same return condition applies to them. Worked off 2026-08-06 (#142) for
      `tools/gh/pr-land.mjs` + `tests/unit/gh-pr-land.spec.ts`, translated in
      their own no-behaviour-change commit ahead of the fix; the rest of the set
      still stands. **Return condition FIRED and promoted 2026-08-15: `39973aa`
      (#234) materially edited `tools/gh/bootstrap-taxonomy.mjs` and
      `tools/gh/lib/gh.mjs` without translating either — the SECOND recorded miss
      of this trigger, which is the signal that an on-touch rule is not
      self-enforcing here. The six remaining `tools/gh` files are now one bounded
      task, #238.** The `tools/hooks/*` half of this line is NOT in #238's scope
      and keeps its existing trigger. This line goes at the sweep after #238 closes.

- [ ] 2026-08-06 `pnpm pr:land <n>` on an ALREADY-MERGED PR resumes the tail with
      no gate in front of it (#142): a mistyped number moves the board of whatever
      that PR closes and runs `worktree:teardown` for its issue numbers. Accepted
      because the gate never protected a merged PR either — it refused it outright —
      and the blast radius is bounded (a Done set on a Done, teardown behind an
      existence check, a read-only sweep). Return condition: a real run moves the
      wrong issue's board row, or the resume path grows a stage that is not
      idempotent — then gate the resume on the `Closes #N` of the PR matching the
      worktree/branch the caller is in (review of PR #161)
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

- [ ] 2026-08-04 `set-board-status.mjs`: `process.exit(0)` сразу после записи
      «ГОТОВО» — на Windows-TTY запись асинхронна, тот же класс, что #132
      (обрезанный вывод при сделанной работе); лечится `return` вместо exit.
      Замечание ревью PR #141 — return condition: первый случай обрезанного
      «ГОТОВО» или ближайший рефактор runBoardStatus (#132)

- [ ] 2026-08-04 Тесты `gh-board-tools`: фикстуры `parsed` собраны руками, не
      через parseArgs — дрейф CLI-контракта тесты не поймают. Замечание ревью
      PR #141 — return condition: первое изменение CLI-флагов set-board-status (#132)

- [ ] 2026-07-30 `worktree-teardown.mjs`: в robocopy-фолбэке финальный
      `cmd /c rmdir /s /q \\?\<путь>` — no-op (cmd.exe не понимает `\\?\`-префикс);
      первая ступень PS 5.1 отрабатывает, так что исход — честный exit 1, не потеря
      данных. Лечится вызовом rmdir с обычным `winPath` — return condition: первый
      реальный заход в robocopy-фолбэк (teardown упал с exit 1 на long-path) (#90)

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

- [ ] 2026-08-14 `.github/branch-protection.json` and the live protection on `main`
      drift independently: editing the file does not touch the branch, and editing
      the protection in the GitHub UI does not touch the file. Nothing detects the
      divergence — a guard could diff the payload against
      `GET …/branches/main/protection` on every PR. Low stakes while both are
      changed by hand in the same motion, which is what #216 did. Return condition:
      the first time the two are found out of sync, or the next edit to either
      (#216)

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

- [ ] 2026-08-14 `tools/gh/handoff-verify.mjs` classifies a file path shaped like a
      branch name as a git ref: `docs/ci-guardrails.md` in a handoff is looked up as
      `refs/remotes/origin/docs/ci-guardrails.md`, not found, and reported `STALE`.
      A false STALE is worse than no row — the gate the verifier feeds tells the
      session to reconcile a premise that was never wrong, and a reader who learns
      the rows can be wrong stops trusting the real ones. Fix: reject candidates
      carrying a file extension, or test `git cat-file -e HEAD:<path>` before the
      ref lookup. Return condition: the next false STALE, or the next edit to the
      verifier (#150). **Return condition FIRED and promoted 2026-08-15: a false
      `STALE` plus a NEW subclass — `sidorovanthon/bbm#149` resolved against THIS
      repo, so the row reported bbm-portal #149's state instead → #237.** This line
      goes at the sweep after #237 closes.

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
