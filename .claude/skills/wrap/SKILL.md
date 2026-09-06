---
name: wrap
description: Use when ending a working session in this repo — "wrap up", "finish the session", before a handoff, or for the end-of-session retro that captures methodology lessons before context is lost. Project-local; this repo only.
---

# wrap — session-end retro + methodology improvement

Trackers: **GitHub Issues** (code/dev work for this repo) **+ Plane**
(organizational / strategic `BBMP-*`). Instruction files: **CLAUDE.md**
(authoritative on tracker choice) + **AGENTS.md** (entrypoint and fuller
context). The evidence and method below work in both Claude Code and Codex.

## Hard rules (read before running)

- **Project-local only.** Edits touch only this repo (`.claude/**`, `CLAUDE.md`,
  `AGENTS.md`, `DEBT.md`, `docs/**`). Never edit global/plugin skills.
- **Memory is outside the default wrap.** Update any harness memory only when
  the owner explicitly requests a memory update, and follow that harness's
  current memory-write procedure. A wrap request by itself is not permission.
- **No fabricated findings.** No symptom quote → no edit. A quiet session goes
  straight to the handoff.
- **Every edit is justified by a real symptom quote.** Guard against
  over-correction: smallest change that kills the symptom.
- **Understanding-check comes first**, before any edit is proposed or applied.

## Phase 0 — gates, then assemble THIS session's evidence

**In-flight agents first.** Enumerate every agent this session dispatched and
**wait for each to return** before dispatching the retro. A session's worst
deviation is often surfaced by the last agent's result, so a retro launched over
an in-flight agent analyses an incomplete session and misses exactly the tail
that mattered. Recording an unreapable agent's id + worktree/branch/port in the
issue's stop-state comment (`.claude/skills/task-canon/SKILL.md` §5) is the
fallback for a harness-killed agent, never an alternative to waiting.

Build a fixed evidence packet before dispatching phase 1:

- the current conversation's owner requests, corrections, approvals, and pauses;
- the primary issue and PR, including comments, checks, review verdicts, and the
  final diff/file list;
- the worktree status, branch, stand URL/port, deploy state, and results of the
  verification commands actually run;
- every completed agent's concise return, plus the id and state of anything that
  could not return.

Do not invent a Codex transcript path or parse an undocumented Codex JSONL
format. `pnpm session:last-report` remains a Claude-era recovery aid when an old
report was never posted; it is a fallback, not the normal cross-agent evidence
source. The normal durable source is the issue/PR record required by phases 4–5.

## Phase 1 — independent analysis subagent (read-only)

Dispatch a fresh-context judgment agent; **never self-review**. Claude Code uses
the canonical profile/model route in `CLAUDE.md`; Codex uses the adapter in
`docs/codex-agent-mode.md`. Give it the fixed evidence packet, the issue/PR
URLs, this skill, and `.wrap-init.json`. The analyst never globs session logs or
assumes access to the lead's hidden context.

- **Read-only:** it edits no file, opens no issue, and touches no tracker.
- **Return shape:** (1) an understanding-check, (2) a findings array with symptom
  quote, impact, recurrence, destination, and smallest remedy, (3) a handoff seed.
  A free-form narrative without that shape is not a valid return.
- **Scope check:** compare what the owner authorized in this session with what
  actually happened; useful work outside that scope is still a finding.
- **Recurrence check:** compare against `foldedThemes` in `.wrap-init.json`; a
  repeated folded theme requires a deterministic remedy, not another paragraph.

## Phase 2 — propose concrete diffs (MANDATORY approval gate)

Present the understanding-check first (owner confirms/corrects). Then a compact
`Finding → recurrence → Destination → Exact change → когда строим` table, each
mapped to its finding, favoring deterministic `remedy_kind` (`prose-not-enforced`
→ skill/command/hook/lint, not more prose); a `recurrence: yes` row may not be
remedied with prose.

**«Когда строим» is a mandatory column, and «фоном» is not a value.** Allowed
values are «в этой сессии», «в PR этого ретро» or a named blocking issue —
"background, whenever" / «фоном, когда будет время» is banned outright: a remedy
scheduled that way is a remedy that never lands. _(symptom 2026-08-25: the
previous retro's remedies were filed and parked «фоном»; the same themes
recurred inside 24 hours.)_

**A `channel:retro` issue is the mechanical cure for a REPEAT theme
(`recurrence: yes`), and it is scheduled the moment it is filed:** milestone
**«Platform: operations and hardening»**, and it is named in the session
handoff's «Next steps» as a **blocking prerequisite of the next task of that
class**. An issue filed without both is parked, not scheduled. Live example:
#322 «Hook: block a lead that mutates repeatedly with zero Agent dispatches» is
the mechanical cure for the orchestration themes that the 2026-08-25 audit
could only fold with prose — a folded theme whose hook is still open is named
in the remedy, never silently folded on the prose alone.

**This gate is non-bypassable.** Nothing in phase 3 lands without the owner's
explicit "go" in THIS session, on THIS list:

- **An edit to a skill, a rule, `CLAUDE.md`/`AGENTS.md` or a hook changes how
  every future session behaves** — that is a scope of its own, and the retro's
  authorship of it grants no authority to apply it
  (`.claude/skills/task-cycle/SKILL.md` stage 2: handoff / task text / config ≠
  a "go").
- **Approval is per item.** "Apply all" is an answer the owner gives, not a
  default the wrap assumes from a silence or a general nod; a trimmed subset is
  carried forward exactly as trimmed.
- **A proposal shaped as a new issue routes through the significance threshold
  first** (`.claude/skills/task-canon/SKILL.md` §6): above it →
  `pnpm issue:create` with the criterion named, `--channel retro`; below it → a `DEBT.md` line with a return condition.
  An issue proposed without a named criterion is backlog inflation.
- Apply nothing while presenting. A previous wrap's approval covers that wrap's
  edits only.

## Phase 3 — apply approved + COMPACT (never just append)

**What "compact" is scoped to:** the repository instruction corpus this wrap
maintains — `CLAUDE.md`, `AGENTS.md`, and `.claude/rules/*.md`. These files are
entrypoints or routed policy, so growth taxes future sessions. The budget tool
may also measure a harness memory index when one exists; measurement does not
authorize the wrap to edit it.

- **Prune before adding:** fold duplicate instructions, delete disproven ones,
  and tighten the owning file before adding this session's durable rule.
- **Adding signal means relocating detail out**, not appending: long procedure →
  a routed rule or skill. A settled fact goes to harness memory only after an
  explicit owner request and through that harness's current memory procedure.
  An append with nothing relocated is the banned outcome.
- **Then run `pnpm lint:instruction-budget`** (`tools/lint/instruction-budget-lint.mjs`,
  200 lines / 25 KB per file). **PASS is the exit condition of this phase** — a
  wrap does not finish with a red budget, and a `NEAR` row is compacted now
  rather than left for the wrap that will be over. Size the compaction in one
  pass from the reported numbers; do not trim-and-re-measure by eye (this corpus
  is half Cyrillic — bytes and characters differ ~2×).
- **Land the wrap's own repository edits, never leave them dangling.** They are changes like
  any other: with parallel sessions live they are worktree-first from the first
  edit (`.claude/rules/parallel-sessions.md`) and land as a PR. Before declaring
  the wrap done, `git status` carries no uncommitted instruction files.
- **Tracker follow-ups:** load `task-canon`, then file discovered work in the
  tracker it assigns: code/dev work → GitHub; organizational / strategic
  `BBMP-*` → Plane (`--workspace bbm`). When unsure, CLAUDE.md is authoritative.
- Commit the methodology changes on the current branch; stage only the files this
  retro touched.

## Phase 4 — repo & tracker hygiene

Clean working tree; merge any green, reviewed PR with `pnpm pr:land <PR>` (it
owns the whole tail: gate → squash-merge → board `Done` → teardown → re-sweep) —
whether a PR merging in this wrap needs the
independent review and the iteration-end gate is decided by the one boundary in
`.claude/skills/task-cycle/SKILL.md` stage 4 — never re-decided here. In
practice a wrap's own edits land on canon files (`CLAUDE.md`, `.claude/rules/**`,
`.claude/skills/task-cycle/**`), which puts them in the gated class: a wrap is
not a bypass of its own regulation. Each task closed here gets its closing comment in
the fixed shape (`.claude/skills/write-iteration-summary/SKILL.md`); each task
left open gets the `.claude/skills/task-canon/SKILL.md` §5 stop-state comment
instead. Reconcile **both**
trackers (GitHub Issues for code work, Plane for org
work — nothing stuck "In Progress" for finished work, results comment on close);
file deferred/stale work. Auto-apply safe cleanups; confirm consequential ones.

**DEBT.md sweep (mandatory, issue #65):** walk every line of `DEBT.md` — each
is either fixed now, promoted to a GitHub issue, or explicitly written off in
this wrap; lines without a return condition do not survive the sweep. (The
same sweep also runs at every epic close.)

**Fix-here comes BEFORE file (#299).** A line whose return condition has fired
is asked one question first: **does it close inside this retro's own PR?** The
retro is already opening a PR that touches canon files and tooling, so a line
that needs one edit and no owner decision is FIXED IN THAT PR, and the `DEBT.md`
line is deleted with the fix — not converted into an issue. Only work that needs
its own cycle (a design gate, an owner "go", an acceptance on a stand, a diff
that does not belong next to this one) becomes an issue, through the significance
threshold in [`task-canon`](../task-canon/SKILL.md) §6 — whose floor bans filing
one-line work in the first place. _(Symptom: the 08-19 sweep turned five lines
into #285–#289 in one pass; on the same day two other generators fired, and the
owner read 13 process-born issues as 13 new problems.)_

**Cross-check the generators before presenting.** When `spec-issue-graph`,
this sweep and the retro itself all fire in one session, say so in the report and
name what each batch actually is (planned slices of an approved spec / old
`DEBT.md` lines changing storage form / this retro's remedies). An undifferentiated
list of newly filed numbers reads as newly discovered problems, and that reading
is the one the owner acts on.

## Phase 5 — durable report and handoff

Write the handoff from the fixed evidence packet. If the harness provides a
handoff skill, it may draft the text, but this procedure remains authoritative.
Note `instructions updated this session: <one-line summary>` when applicable.
Before emitting, gate the handoff text:

- **Unvalidated assumptions → explicit list.** Anything the handoff asserts that
  the owner did not confirm in-session (domains, scope decisions, "already
  agreed" claims) goes into a `Confirm before acting:` list at the top, not into
  the narrative as fact. _(symptom: handoff carried «портал живёт на
  cms.bbm.academy» из Caddyfile — «откуда вообще такой контекст? Я не помню
  согласования».)_
- **Build+merge scope → owner checkpoint first.** If the handoff authorizes
  implementation through merge, prepend: «чекпойнт с владельцем до начала
  имплементации — handoff ≠ согласие владельца на объём». _(symptom: следующая
  сессия дошла до merge по ошибочному handoff без единого чекпойнта.)_

**Then give the session's durable English record a URL.** Write the primary
issue comment in the fixed shape owned by
`.claude/skills/write-iteration-summary/SKILL.md`, then cite that comment URL in
the handoff. The Russian owner-facing stage-6 report remains governed by
`report-task-outcome`; do not paste it verbatim into the English tracker record.
The issue/PR record is the canonical cross-agent continuation point. A report
that exists only in a conversation or transcript is not a handoff;
`pnpm session:last-report` is retained only to recover legacy Claude reports
that missed this rule.

## Project gotchas

- **A substantive proposal is a text message; a compact user-question control
  comes only after the owner can read that proposal.** Publish the reasoning and
  options first, then use the harness's supported asynchronous question tool or
  a following chat turn for the short choice. _(symptom 24.07: диалог «съел» текст
  предложения — владелец увидел варианты без обоснования.)_
- **Two trackers, by domain — do not default to one.** **Code/dev** work for this
  repo lives in **GitHub Issues** (`gh issue list/view`, `bbm-academy-org/bbm-portal`).
  **Organizational / strategic / cross-project** work lives in **Plane**
  (`pp-plane`, `--workspace bbm`, prefixes `BBMP-*`). CLAUDE.md is authoritative;
  if AGENTS.md and CLAUDE.md disagree, CLAUDE.md wins. _(symptoms: «СТоп, мы разве
  в этом проекте в Plane работем, а не в GitHub?»; «При чём тут Plane… я по инерции
  пошёл в Plane из-за инструкций».)_
- **Plane CLI 403 / empty result → do NOT improvise raw REST.** Load the `pp-plane`
  skill and check for a **leftover** process-wide `PLANE_SLUG` from another
  workspace silently overriding `--workspace` (that gives a false 403). NB: an
  _inline_ `PLANE_SLUG=bbm plane-pp-cli relations …` is intended — it's the
  documented workaround for the `relations`-group `--workspace` bug; the trap is a
  _stale exported_ value, not the inline use. Read with
  `plane-pp-cli work-items get <seq> BBMP --workspace bbm`; for writes, follow
  the currently installed `pp-plane` skill rather than inventing a raw REST
  fallback. The failure is not loading it at the decision point. _(symptom:
  «Куда ты опять упёрся? pp-plane
  работает чётко… Workspace указываешь?».)_
- **"Done" = verified on the surface the owner sees (prod), not just the dev DB.**
  For seeds/deploys, hit the prod URL (e.g. `cms.bbm.academy`) before reporting
  done — «мы же не локально работем». _(symptom: «А где? я всё ещё вижу пустой
  Payload CMS» — dev DB seeded, prod empty.)_ **And a screenshot is never the
  acceptance**: a screenshot/localhost render is evidence for the agent, not the
  hand-off proof — a product artifact is delivered only when the owner can reach
  it on a real stand. _(symptom: «А мне не нужен скриншот — дай мне реальный
  стенд, где посмотреть. Что за странный метод сдачи-приёмки?».)_
- **A deploy config / task text is NOT an owner decision.** Never assert a
  domain, scope, or "already agreed" claim by extrapolating from a Caddyfile,
  env, repo layout, or the nearest task description; if no owner-confirmed
  source exists, flag it as an open question and gather the full context the
  owner named before concluding. _(symptoms: «откуда вообще такой контекст? Я не
  помню согласования этого домена под внутренние приложения»; «я попросил
  сначала собрать весь контекст, а не просто посмотреть в текст задачи».)_
- **Owner is a non-developer working through agents.** Don't escalate an
  engineer-internal nicety (e.g. seed-code reproducibility) into an owner decision;
  separate genuine blockers from internal follow-ups. _(symptom: a raised
  "durability" alarm the agent later retracted as «над-инженерный шум».)_
- **Node 22 for `pnpm migrate`** — the tsx ESM loader breaks on Node 23/24
  (`node:crypto?tsx-namespace` ENOENT). After any collection/global change:
  `pnpm migrate:create <name>` → commit `src/migrations/*`.
- **Content contract is fixed by code, not prose** — plain text (no Lexical-AST) on
  mirrored surfaces, entry id = human-readable slug, 3 globals (`philosophy`,
  `contact`, `siteChrome`). Mirror the seed JSON + `schemas.ts` field-for-field;
  do not invent.
