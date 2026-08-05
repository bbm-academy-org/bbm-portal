# CI guardrails — severity canon and guard inventory

**This is the single authoritative document for guards in this repo.** It carries the
severity canon (what BLOCK and WARN mean, how a guard is promoted or demoted), the guard
inventory (every guard, its severity, its promotion date or condition), and the guard
contract (what a new guard must look like to be wired). There is no second guards README:
a guard's source header points here, and this file points back at the source.

It is deliberately **not** an ADR. An ADR records a frozen decision; this table changes
every time a guard lands or is promoted. The decision that guards exist at all and are
modelled on ds-platform is epic #117 / spec
`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md` §11; this file is the
living register that decision produced (task 7.5, issue #136).

## 1. What a guard is

A guard is a small deterministic script that reads the repo tree or the PR's own metadata
and exits non-zero when it finds the thing it was written to catch. Guards are inputs to
**human** review — they nudge a reviewer to look at something, they do not review. A guard
never rewrites code, never posts to the tracker, and never depends on a model.

Three planes carry guards in this repo, and the canon covers all three:

| Plane           | Where it runs                               | Artifacts                            | Severity is recorded in                                      |
| --------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| **CI guards**   | GitHub Actions, on `pull_request` / `push`  | `tools/lint/*-lint.mjs`              | the workflow file (§2.1)                                     |
| **Hook guards** | the agent's own session (Claude Code hooks) | `tools/hooks/*.mjs`                  | the hook's exit code + `.claude/settings.json` wiring (§2.2) |
| **CLI guards**  | on demand, by a human or an agent           | `tools/gh/*.mjs` behind a pnpm alias | the script's documented exit-code contract (§2.3)            |

The three planes share the canon (posture, promotion, demotion) and differ only in the
mechanics of "BLOCK" — §2.1, §2.2, §2.3.

## 2. Severity — exactly two levels

**BLOCK** — the finding stops the work (a merge, a tool call, a caller's next step).
**WARN** — the finding is printed and the work continues. Severity is never inferred from
the guard's prose: it is read off the mechanism.

**One severity per finding class, not per file.** A CI job and a session hook each produce
exactly ONE conclusion, so each carries exactly one severity — it cannot be both. A CLI
guard can report several classes of finding in one run and discriminate them through its
exit code (§2.3); such a guard records a severity **per class** in §6, and every class is
named. What is forbidden is an unrecorded mix: a guard whose prose says WARN while some
code path exits non-zero. That is the failure this rule exists to catch, and it was live
in this repo when the canon landed (`handoff-verify`, §6).

### 2.1 CI guards

- **BLOCK** = the job carries **no** `continue-on-error` **and** is listed in the `ci`
  meta-job's `needs` array in `.github/workflows/ci.yml`.
- **WARN** = the job carries `continue-on-error: true` and is **absent** from that
  `needs` array.

The `ci` meta-job is the single aggregate status check. It runs `if: always()` and treats
`failure`, `skipped` **and** `cancelled` in `needs.*.result` as red — a job that never ran
proves nothing, so a red upstream job must not vacuously green the aggregate.

**Cross-workflow guards.** `needs` cannot span workflows, so a BLOCK guard living in
`.github/workflows/pr-body-guards.yml` cannot be in the `ci` needs-list. There is
currently no such guard: every guard in that workflow is WARN. Promoting one to BLOCK
requires either moving it into `ci.yml` or teaching `pnpm pr:land`'s gate to demand its
check-run by name — decide that at the promotion, do not leave it implied.

**A WARN check-run can still be read as red by the merge gate.** `pnpm pr:land` classifies
**every** check-run in the PR's rollup structurally — `SUCCESS`/`SKIPPED`/`NEUTRAL` pass,
anything else counts as failed — and it does not know which job carries
`continue-on-error`. The `if:` no-op fence in `pr-body-guards.yml` is therefore safe
(`SKIPPED` passes), but a **cancelled** run is not: `cancel-in-progress` on the WARN
workflow would leave `CANCELLED` check-runs that block a merge the canon says WARN never
blocks. That is why `pr-body-guards.yml` sets `cancel-in-progress: false` — the WARN
workflow is cheap, and a superseded run finishing is preferable to a cancelled one being
read as a verdict. Do not re-enable it without changing the gate first.

**A job that is neither is a bug, and is checked.** A `ci.yml` job with no
`continue-on-error` that is also absent from the needs-list would look blocking on the PR
(a red X) while gating nothing. That third state is not merely discouraged here: the
`workflow-auth` guard fails on it (`undeclared-severity`), so the invariant is mechanical
rather than reviewed. The `ci` aggregate itself is the one exemption — it cannot be in its
own needs-list.

**Branch-protection limitation (verified 2026-08-05).** `.github/branch-protection.json`
is a declarative payload, not live state: this repo is private on GitHub Free, and
`GET/PUT /repos/bbm-academy-org/bbm-portal/branches/main/protection` answers
`403 Upgrade to GitHub Pro or make this repository public`. Until the plan is upgraded or
the repo is public, **BLOCK is enforced by the merge tooling, not by the server**: a red
`ci` check makes `pnpm pr:land` refuse to merge (task-canon §7), and that is the whole
barrier. The payload's `required_status_checks.contexts` is kept correct so that the
upgrade is a single `gh api --method PUT … --input .github/branch-protection.json` away.

### 2.2 Hook guards

A Claude Code hook has no `needs` list; its severity is its own exit code and the hook
event it is wired to:

- **BLOCK** = the hook exits non-zero on a finding (`PreToolUse` exit 2 denies the call;
  a `Stop`/`SubagentStop` gate exit 2 refuses the stop). The agent cannot proceed.
- **WARN** = the hook exits 0 and emits `systemMessage` / stderr text. The agent sees the
  nudge and decides.

Every hook guard is **fail-open on malformed input** regardless of severity: a broken
stdin payload, a missing file, or an unexpected shape exits 0. A guard that cannot read
its input has found nothing, and a tool stack that dies because a guard tripped over its
own plumbing is worse than the finding it was looking for.

### 2.3 CLI guards

A CLI guard (`pnpm handoff:verify`, `pnpm ci:verify-base`) is wired to no event: a human or
an agent runs it and reads its exit code. §2.2's anchor — "exit code plus the hook event" —
is undefined here, so the plane has its own contract:

- **exit 0** = clean, or WARN-class findings only (printed, work continues).
- **exit 1** = a BLOCK-class finding. The caller does not proceed on it.
- **exit 2** = the guard could not read its input (usage error, unreadable file). **Not a
  verdict** — neither clean nor a finding. A caller that treats 2 as "clean" has skipped
  the check; a caller that treats it as "blocked" is blocked by its own plumbing.

Because a CLI guard is invoked deliberately rather than fired by an event, it may report
several finding classes in one run and separate them by exit code — which is exactly what
§2's per-class rule allows. Each class is listed in §6 with its own severity; a class that
is not listed does not exist.

Note the deliberate asymmetry with hooks: a hook fails **open** (it sits inside the agent's
control flow and must never wedge it), a CI guard and a CLI guard fail **closed** (they
cleared nothing, so they must not report clean).

## 3. New-guard posture

**A new guard lands as WARN.** No exceptions by preference, one exception by mandate:

**Day-0 BLOCK mandate.** A guard may land BLOCK only if this document records the mandate
in §5 with a reason, and the guard is in one of these classes:

1. **Deterministic tree check** — the guard's only input is the checked-out repo tree; no
   network, no PR metadata, no heuristics, no regex over prose. The false-positive class
   is empty by construction, so the WARN soak would only prove what is already provable by
   reading the guard. (`guard-test-coverage` is such a guard.)
2. **Documented security mandate** — a written decision that the failure being caught is a
   security/data-protection incident, in which case a soak period is itself the risk.

Anything with a heuristic, a regex over human text, or an external API call soaks as WARN.

## 4. Promotion, demotion, cadence

**WARN → BLOCK** requires all four:

1. **Real signal.** The guard exits non-zero on a finding. A guard that prints and always
   exits 0 is a stub — make it fail first, then start the clock.
2. **Age.** ≥ 4 consecutive weeks since the guard landed, or since the last substantive
   change to its rule (a wording change to a message is not substantive; a change to what
   it matches is).
3. **Clean window.** In that window: zero confirmed false positives, and zero live
   findings on `main` — including findings a WARN guard prints while exiting 0. A PR that
   went red and was fixed by fixing the PR is a **true** positive: it counts **for**
   promotion.
4. **Blast radius named.** Whoever promotes states what will be blocked and who unblocks
   it — for a PR-metadata guard, the one-line fix command; for a tree guard, the file to
   edit.

For a PR-event-gated guard the window is counted over PR runs only. Greenness on `push`
runs is vacuous — the guard skips on a non-PR event by design.

**Promotion mechanics (CI guard):** delete the `continue-on-error` line, add the job to
the `ci` needs-list, update the job's header comment, and update this file's §5 row (new
severity + the promotion date). Three edits, one PR, no other changes.

**Promotion mechanics (hook guard):** flip the guard's finding branch from exit 0 to a
non-zero exit, update its header comment, update its unit test (the test asserts the exit
code — that is the severity-of-record for a hook), and update §6 here.

**Demotion.** One confirmed false positive on a BLOCK guard demotes it back to WARN **in
the same session that confirmed it**, plus an issue to fix the guard. A BLOCK guard that
people route around is worse than a WARN guard they read: a false positive spends the
team's trust in every guard, not just this one.

**Cadence.** The whole WARN set is re-evaluated at each epic close and at each DEBT.md
sweep (skill `do-decision-debt-followup`). Each sweep records a dated per-guard verdict —
promoted, or left WARN with the reason — in this file's §5/§6 tables.

## 5. CI guard inventory

Severity-of-record is the workflow file; this table is the register that must match it,
and `workflow-auth` + `guard-test-coverage` keep the mechanics honest.

| Guard                   | Workflow             | What it catches                                                                                                                                                                                                   | Severity  | Since      | Promotion                                                                                                                                                                                     |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **guard-test-coverage** | `ci.yml`             | a `tools/lint/<name>-lint.*` with no `tools/lint/guard-tests/<name>-lint.spec.ts`; also an orphaned spec, and a guard that evades the flat layout of §8 (nested dir, or no `-lint` suffix)                        | **BLOCK** | 2026-08-05 | day-0 mandate: deterministic tree check (§3 class 1)                                                                                                                                          |
| **tdd-signal**          | `ci.yml`             | a PR that changes production source and ships no test, in a module that has no test either                                                                                                                        | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses                                                                                                                                                               |
| **no-stub**             | `ci.yml`             | a user-facing dev placeholder ("set this env var"), or a `TODO`/`FIXME`/`STUB` standing in for a deliverable with no `#NNN`                                                                                       | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses                                                                                                                                                               |
| **workflow-auth**       | `ci.yml`             | a workflow job that reaches GitHub through `gh` without `permissions:` + `GH_TOKEN`/`PR_NUMBER` wiring                                                                                                            | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses                                                                                                                                                               |
| **epic-autoclose**      | `pr-body-guards.yml` | `Closes #<epic>` on a PR whose target issue still has OPEN sub-issues — merging would auto-close a live epic                                                                                                      | WARN      | 2026-08-05 | earliest 2026-09-02; BLOCK also needs the cross-workflow decision in §2.1                                                                                                                     |
| **assignee-milestone**  | `pr-body-guards.yml` | an open PR with no assignee or no milestone — an un-triageable board row                                                                                                                                          | WARN      | 2026-08-05 | earliest 2026-09-02; see §7 for why this is not a day-0 BLOCK here                                                                                                                            |
| **product-note**        | `pr-body-guards.yml` | a PR touching the user-facing render surface with no `## Product note (RU)` a reader would notice                                                                                                                 | WARN      | 2026-08-05 | **blocked on task 7.6** (#137, release-note delivery) — a note nobody delivers is not worth blocking a merge for; promote with 7.6, not on the clock                                          |
| **spec-link**           | `pr-body-guards.yml` | a feature PR (a `Feature` issue or a `feat:` title, changing `src/`) that resolves to no spec — or resolves to one that is missing, statusless, or still `Draft`                                                  | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses. Guard authored in task 7.4 (#135); wired here, invoked with `--severity block` so the script gives a real signal while the CI plane stays WARN               |
| **instruction-budget**  | `ci.yml`             | the always-on agent context (CLAUDE.md + AGENTS.md + `.claude/rules/*.md` + the MEMORY.md index) over 200 lines / 25 KB per file, **or the corpus sum over 800 lines / 100 KB**                                   | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses. Guard landed in task 7.8 (#139) CLI-only; **wired into `ci.yml` by #157**, which is what started this plane's clock. No `--severity` flag — see §6.1 for why |
| **stage-b**             | `pr-body-guards.yml` | a UI diff (non-test `*.tsx` / `*.css` under `src/`) with no recorded `Stage-B:` verdict in the PR body or a linked-issue comment                                                                                  | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses. Guard authored in task 7.7 (#138); wired here, invoked with `--severity block` so the script gives a real signal while the CI plane stays WARN               |
| **ears-naming**         | `ci.yml`             | a test title that ATTEMPTS the `EARS-N:` prefix and misspells it (`ears-3:`, `EARS3:`, `EARS-3` with no colon, `EARS 3:`) — the traceability grep then silently misses it                                         | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses. Guard tranche 2 (#157)                                                                                                                                       |
| **ears-test**           | `ci.yml`             | an `EARS-N` clause declared in a spec's `## Requirements` that no test title cites, or a test citing a clause no spec declares (orphan), or a stale entry in the deferral allowlist                               | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses. Guard tranche 2 (#157)                                                                                                                                       |
| **spec-deletion**       | `pr-body-guards.yml` | a PR deleting a `.md` under `docs/specs` / `docs/superpowers/specs` / `docs/adr` with no sanctioned escape; **and** the repo-wide spec status sweep (statusless, off-ladder, `Superseded` with no live successor) | WARN      | 2026-08-05 | earliest 2026-09-02, §4 clauses. Guard tranche 2 (#157). Both finding classes are WARN, so the one exit code carries one severity (§2)                                                        |

`spec-link` followed exactly the path `stage-b` (#138) took: its guard, its spec moved to
`tools/lint/guard-tests/` per §8, its job in `pr-body-guards.yml`, its row here — all in
the session that landed it, not by the lead afterwards.

**Guard tranche 2 (#157) closed the deferred set.** `instruction-budget` was authored twice
in parallel; #135 deleted its copy in favour of #139's rather than leave two scripts
fighting over one `pnpm` script name, and #139 shipped it CLI-only (§6.1) because #135's
acceptance criterion wanted the always-on context MEASURED, which is a report, not a job.
No epic-7 task then wired it. #157 did — and wiring is exactly what starts a §4 clock, so
the `ci.yml` row above dates from that wiring. #157 also landed the EARS pair
(`ears-naming` + `ears-test`) and `spec-deletion`, which carries the repo-wide spec-status
sweep. Every one of them is WARN against §8 and on the §4 clock; nothing from the tranche
remains deferred, so there is no forward pointer left in this file.

`instruction-budget` is the one guard that appears in BOTH inventories, deliberately: the
same script is a §2.3 CLI guard (BLOCK by exit code — §6.1) and a §2.1 CI job (WARN,
`continue-on-error`). That is not the "unrecorded mix" §2 forbids: the mix is recorded
here, the planes are separate mechanisms, and the asymmetry is the whole point of a WARN
soak on a plane where a red X is new.

## 6. Hook and CLI guard inventory

These landed WARN in task 7.3 (#134) with a `TODO(#136)` marker deferring the severity
decision to this canon. The decision is recorded here; the markers are gone.

| Hook guard                      | File                                                | Severity | Verdict 2026-08-05 — why, and what would promote it                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **askuserquestion-calibration** | `tools/hooks/askuserquestion-calibration-guard.mjs` | WARN     | Calibration advice on a question already being asked. Blocking it would deny the owner a question — the opposite of the intent. **Permanent WARN by design**, not a promotion candidate.                                                                                   |
| **handoff-verify-reminder**     | `tools/hooks/handoff-verify-reminder.mjs`           | WARN     | A `SessionStart` reminder. A session that cannot start is a broken session, and the reminder's whole value is that a human reads it. **Permanent WARN by design.**                                                                                                         |
| **screenshot-path-guard**       | `tools/hooks/screenshot-path-guard.mjs`             | WARN     | Highest-value promotion candidate: the rule (a screenshot is not acceptance — task-cycle stage 5) is categorical and the detection is a path match. Promote per §4 — earliest 2026-09-02, needs a clean window with zero false denials of a legitimate `Read` of an image. |
| **surface-decision-debt-gate**  | `tools/hooks/surface-decision-debt-gate.mjs`        | WARN     | A `Stop` gate. Promotion means an agent cannot end its turn — a wrong verdict strands the session with no way out, so this needs the clean window from §4 **and** a documented escape hatch before it can block.                                                           |

### 6.1 CLI guards (§2.3) — severity per finding class

`handoff-verify` is the reason §2.3 and §2's per-class rule exist. It is **not** a hook: no
event fires it, `pnpm handoff:verify` does, and it reports two classes of finding with two
different exit codes. Recording it as a flat "WARN" was wrong — the file exits 1 on a STALE
row, which is BLOCK by mechanism, with a "WARN" header sitting directly above that code
(caught in review of PR #154).

| CLI guard                | File                                     | Finding class                                                                                                                                                                                          | Severity                                  | Verdict 2026-08-05                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **handoff-verify**       | `tools/gh/handoff-verify.mjs`            | **STALE row** — a handoff premise contradicted by the issue/PR/branch it names                                                                                                                         | **BLOCK** (exit 1)                        | Acting on a stale premise is the failure the tool exists to stop; demoting it to exit 0 would leave nothing but a printout. Kept BLOCK. Demotion per §4 on one confirmed false STALE.                                                                                                                                                               |
| **handoff-verify**       | `tools/gh/handoff-verify.mjs`            | **qualitative rows** — completeness claims, unquoted owner-directive framing                                                                                                                           | WARN (exit 0, never bumps `stale`)        | Both are heuristics over free text with no checkable referent. Promotion would need a §4 clean window AND a way to name the specific claim — not on the clock.                                                                                                                                                                                      |
| **handoff-verify**       | `tools/gh/handoff-verify.mjs`            | **unreadable input** — usage error, unreadable handoff file                                                                                                                                            | exit 2, not a verdict                     | §2.3: neither clean nor a finding. The caller re-runs it correctly instead of drawing a conclusion.                                                                                                                                                                                                                                                 |
| **instruction-budget**   | `tools/lint/instruction-budget-lint.mjs` | **file over budget** — an always-on file past 200 lines / 25 KB (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`, the `MEMORY.md` index)                                                                | **BLOCK** (exit 1), day-0 per §3 class 1  | Deterministic tree check: byte and line counts over checked-out files, no network, no PR metadata, no heuristic, no regex over prose — the false-positive class is empty by construction, so a WARN soak would prove nothing. A NEAR row (≥80 %) prints and exits 0                                                                                 |
| **instruction-budget**   | `tools/lint/instruction-budget-lint.mjs` | **corpus over budget** (#157) — the SUM of the always-on set past 800 lines / 100 KB, i.e. 4 × the per-file budget (`CLAUDE.md`, `AGENTS.md`, the `MEMORY.md` index, and `.claude/rules/` as ONE slot) | **BLOCK** (exit 1), same §3 class-1 basis | The per-file rule alone is satisfiable by a corpus nobody can afford: six files at 199 lines each pass individually while every session pays for 1194. The rules directory counts as one slot on purpose — per-file counting would let adding a rule raise the ceiling that rule lives under. Corpus at the wiring: 387 lines / 37 986 bytes = 48 % |
| **instruction-budget**   | `tools/lint/instruction-budget-lint.mjs` | **not a verdict** — an unreadable target, or (#157) an EMPTY corpus: zero always-on files measured                                                                                                     | exit 2, not a verdict                     | §2.3: cleared nothing, so not a pass. `CLAUDE.md` and `AGENTS.md` are not optional — measuring zero of them means the guard was pointed at the wrong tree, an input problem. Before #157 an empty corpus returned PASS, which is the fail-open «a check that never ran must not look clean» exists to forbid                                        |
| **verify-base-ci-green** | `tools/gh/verify-base-ci-green.mjs`      | **base branch red** — last completed run failed/cancelled/timed out                                                                                                                                    | **BLOCK** (exit 1)                        | Not a merge gate: it blocks the caller's next step (push) until the inherited red is recorded in the PR body. Exit 2 = no completed run yet, per §2.3.                                                                                                                                                                                              |

**Grandfathering.** `handoff-verify`'s BLOCK class predates this canon (it landed in task
7.3), so §3's "a new guard lands as WARN" is not being waived for it — the severity is
being _recorded_, not newly granted. §3 governs guards landing after 2026-08-05.

The exit-code contract of each is pinned by its unit test — for a CLI guard the exit code
IS the severity, so it is asserted, never assumed (`tests/unit/handoff-verify.spec.ts`,
`tests/unit/verify-base-ci-green.spec.ts`).

## 7. Deliberate deviations from ds-platform

The guard family is ported from `ds-platform` (inventory #127). Three places where this
repo does **not** follow the source:

1. **`assignee-milestone` is wired here.** In ds-platform the script and its test exist
   with no workflow job and no package script — an orphan that documents itself as a hard
   gate and never runs. Ported **with** wiring, and as WARN: this repo's canon (§3) has no
   day-0 exception for "the fields are easy to set".
2. **"A guard without a test does not merge" is mechanical here.** In ds-platform it is a
   convention held up by review and a hand-maintained coverage list. Here it is the
   `guard-test-coverage` guard, and it is BLOCK from day 0 (§3 class 1).
3. **The canon covers hook guards too** (§2.2, §6). ds-platform's canon is written for CI
   jobs only; this repo's guard mass currently sits in session hooks, so a canon that
   ignored them would leave the larger half ungoverned.
4. **`spec-deletion` and `spec-status` are ONE guard here** (#157). ds ships them as two
   scripts. Both mechanise one section of one document — `docs/specs/README.md` "Status
   model" — at the same severity, so splitting them would buy two register rows, two CI
   jobs and two promotion clocks for one rule. The two finding classes are named in the
   §5 row, which is what §2's per-class rule actually asks for.
5. **`ears-test` reads the `## Requirements` section, not the whole spec** (#157). ds's
   specs are single-purpose `NNN-requirements.md` files, so a whole-doc scan is safe
   there. Ours are multi-section, and the `## Acceptance scenarios` section NAMES the
   clauses it exercises — a whole-doc scan would read those pointers as declarations.
   ds's spec-scoped deferral machinery is dropped for the same kind of reason: it keys on
   a `NNN EARS-…` test-title prefix this repo has no convention for, so every code path
   would degenerate to "compatible". Porting it would have been dead code, not fidelity.

## 8. The guard contract — what a new guard must satisfy

Everything here is checked by `guard-test-coverage` and `workflow-auth`, so a guard that
follows it wires in with no rework, and one that does not goes red before review.

**File layout**

- Guard: `tools/lint/<name>-lint.mjs`. Plain ESM Node 22 (`.mjs`) — the repo's tooling
  language; ESLint lints `tools/**/*.mjs` under `no-undef`. **The flat layout is
  enforced, not requested:** `guard-test-coverage` treats any file under `tools/lint/**`
  that imports `lib/guard.mjs` as a guard and BLOCKS it if it sits in a subdirectory or
  lacks the `-lint` suffix. Both meta-guards derive their file sets from this shape, so a
  misplaced guard would otherwise be invisible to both at once.
- Test: `tools/lint/guard-tests/<name>-lint.spec.ts` — the name mirrors the guard file
  exactly. This pairing is what `guard-test-coverage` asserts.
- Fixtures: `tools/lint/guard-tests/fixtures/<name>/<case>/…` — a fixture case is a small
  fake repo tree; canned `gh` JSON goes in that case's `gh/` sub-dir.
- Shared helpers: `tools/lint/lib/guard.mjs` (reporter, repo root, tree walk, PR-event
  gating) and `tools/lint/lib/gh.mjs` (the `gh` seam). Do not re-implement either.

**CLI shape**

- Invoked as `node tools/lint/<name>-lint.mjs`, aliased as `pnpm lint:<name>` in
  `package.json`. No arguments in CI; flags are optional and must have a default.
- **Exit 0** = clean, or "nothing to check" (not a PR event, no PR number, the rule does
  not apply). Say so on stdout — a silent exit 0 is indistinguishable from a stub.
- **Exit 1** = findings, one line per finding on **stderr**, prefixed `[<name>]`, ending
  with a summary line that names the fix.
- Any other exit code is a bug in the guard.
- An unexpected exception exits 1 with the stack on stderr. Fail-closed: a guard that
  crashed did not clear anything. (Hook guards are the opposite — §2.2 — because they sit
  in the agent's own control flow.)

**Environment / seams** (all inert in production — unset means real behaviour)

| Variable              | Meaning                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `LINT_FIXTURE_ROOT`   | scan this tree instead of the repo root                                                     |
| `LINT_GH_FIXTURE_DIR` | serve `gh <kind> view <n>` from `<dir>/<kind>-view-<n>.json` instead of spawning `gh`       |
| `GITHUB_EVENT_NAME`   | a PR-gated guard runs only when this is `pull_request`                                      |
| `PR_NUMBER`           | the PR under test; a PR-gated guard exits 0 (skip) when it cannot resolve one               |
| `PR_BODY`             | the event payload's body, authoritative over `gh pr view`'s `body` for that same PR         |
| `GH_TOKEN`            | required on any step that reaches GitHub — `workflow-auth` fails the build if it is missing |

`PR_BODY` exists because a `gh pr view` REST read immediately after PR creation has
returned a stale or absent body. The event payload is always current for the event that
triggered the run, so it wins.

**Known limit of `--json files`.** `gh pr view <N> --json files` is page-limited (100
files), so a guard deriving its verdict from that array under-reads a very large PR
without saying so. `tdd-signal` and `product-note` both do. Accepted for now — both are
WARN, and a >100-file PR is its own review problem — but a guard promoted to BLOCK on this
input must page the API first. Do not inherit the assumption silently.

**Wiring convention for `pr-body-guards.yml`.** Every job there carries the no-op fence
`if: github.event.action != 'edited' || github.event.changes.body != null` — a title-only
edit changes no guard input, and a skipped check-run passes the merge gate. The workflow
also does not cancel in-progress runs (§2.1).

**Testability**

The guard's decision logic is exported as a pure function and unit-tested directly; the
CLI wrapper (`main()`) is thin and runs only when the file is the process entry point.
The spec additionally spawns the real guard at least once against a fixture tree and
asserts the exit code — the exit code **is** the severity, so it is tested, not assumed.

**Wiring**

- WARN: a job in `ci.yml` (tree guards) or `pr-body-guards.yml` (PR-metadata guards) with
  `continue-on-error: true`, **not** in the `ci` needs-list.
- A job reaching GitHub carries `permissions: { contents: read, pull-requests: read }`
  (plus `issues: read` if it reads issues) and passes `GH_TOKEN` + `PR_NUMBER` on the
  invoking step. `workflow-auth` enforces this.
- A new row in §5 with severity, date, and promotion condition. The row is part of the
  guard, not documentation of it.
