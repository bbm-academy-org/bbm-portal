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
      dispatch that needs the empty-sha path (#137, first live digest run)

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
- [ ] 2026-08-05 `tools/lint/workflow-auth-lint.mjs`: `undeclared-severity`
      catches "neither WARN nor BLOCK" but not "both" (continue-on-error AND in
      the needs-list = vacuous BLOCK) — return condition: first change to the
      `ci` meta-job's needs-list or to any job's continue-on-error flag (#136,
      review of PR #154)
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
      still stands.

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

_(Swept 2026-07-30 (#92): the /p/hours upsert-without-prefill line — the very
gap the money rule above now bans from this file — was fixed in #85/#86, not
written off.)_

_(Swept 2026-08-05 (/wrap, retro of the 7.2 session): the 2026-07-31
`frontend-design` line closed as fixed — the skill is now registered and
available in the plugin catalog (`frontend-design:frontend-design`), which is
exactly its return condition. Remaining lines kept: none of their return
conditions have fired (board:status output complete twice today, no CLI-flag
changes, no robocopy-fallback entry).)_
