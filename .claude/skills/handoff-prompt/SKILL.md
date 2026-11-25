---
name: handoff-prompt
description: Emit the compact, verified prompt that lets a fresh agent session resume the current task — no agents in flight, the owner's session goal verbatim, one fenced block of at most 300 tokens checked by `pnpm handoff:verify`, as the final message. Use whenever a session ends before its outcome; it needs no retro (`/wrap` is a separate step). Project-local; this repo only.
---

# handoff-prompt — hand the session to the next one

Ported from ds-platform `handoff-prompt` (owner decision 2026-11-25: the handoff
is its own short step; the retro stays in [`wrap`](../wrap/SKILL.md), run
separately and less often). The handoff is a HYPOTHESIS for the next session,
never a go (`.claude/skills/task-cycle/SKILL.md` stage 1–2).

**When.** A session that ends before its requested outcome — the owner defers
to a new session, a context-budget tier fires (`tools/hooks/lead-context-budget.mjs`),
or a tail is pinned to a worktree — ends with this skill as its final message,
never a hand-written block. An owner gate or blocker inside a live session is a
pause, not a handoff: post the request with evidence and wait. A finished
outcome gets the report (`report-task-outcome`), not a handoff.

**Scope: this skill alone.** A handoff request implies no retro, no instruction
or memory edits and no `DEBT.md` lines. Do not ask clarifying questions; read
the session and the live tracker yourself.

## Step 0 — no agents in flight

Do not emit while any agent this session dispatched is still running. Receive
every result first, or stop the agent and record why; a harness-killed agent is
recorded (id, worktree, branch, port) in the issue's stop-state comment
(`.claude/skills/task-canon/SKILL.md` §5). A handoff that names an in-flight
agent as progress hands over a state nobody can verify.

## Step 1 — the durable record first

The issue/PR record is the canonical continuation point; a handoff that exists
only in chat is not one. Post the primary issue comment — the closing shape of
`.claude/skills/write-iteration-summary/SKILL.md`, or the §5 stop-state comment
for a task left open — in English (the Russian owner report is not pasted into
it) and cite its URL in the block. If the main checkout holds
`.claude/lead-budget-override`, quote its reason line in the block; never delete
it — the marker is box-wide and only the owner creates or removes it
(`docs/ci-guardrails.md` §6, lead-context-budget).

## Step 2 — gather

- **Session goal:** the owner's own goal for this session, verbatim where
  possible («разобрать бэклог», not the tasks the triage produced).
- **Progress:** product-first (`report-task-outcome` → Words) — one line per
  landed unit naming what a person can now do; PR/issue numbers in parentheses.
- **Where stopped:** the last substantive action and why it paused.
- **Next:** only the remaining delta to the session goal and its stop
  condition. Agent-proposed follow-ups are suggestions, never the goal. Never a
  stand/go step as a command («raise the stand + ask go»): the next session
  re-derives gates from the change tier (`.claude/rules/change-tiers.md`);
  recorded go's are carried as evidence with their quote.
- **Confirm before acting:** every claim the owner did not confirm in this
  session (a domain, a scope, an "already agreed") — never stated as fact.
  _(symptom: a handoff carried «портал живёт на cms.bbm.academy» from a
  Caddyfile — «откуда вообще такой контекст?»)_ A handoff that authorizes work
  through merge says: «чекпойнт с владельцем до начала имплементации — handoff ≠
  согласие владельца на объём».
- **Blocking prerequisite:** an issue that must land before the next task of
  its class (e.g. a `channel:retro` cure from `/wrap` phase 2) — named here,
  never among the Next suggestions.
- **Open questions:** only unresolved owner decisions.

## Step 3 — output

Exactly one fenced block, ≤300 tokens, and nothing after it — it IS the final
chat message, copied by the owner into the next session. Sections, omitting
only empty optional ones: `## Current task` (always `Session goal (owner):
<verbatim or "none recorded">` and `Origin task: <issue/PR/spec>`),
`## Progress so far`, `## Where we stopped` (plus `Prerequisite (blocking): #N
— <why>`, omitted when none), `## Next (suggestions, not
priority)` — never restating or replacing the session goal — and optional
`## Confirm before acting`, `## Context references` (the record URL, the
worktree/branch/port, the active spec), `## Open questions`. Terse bullets,
absolute paths, no inlined instruction files.

Before sending, save the block to a scratchpad file and run
`pnpm handoff:verify <file>`: exit 1 (STALE) — fix the claim against the live
state and re-run; a WARN row — re-derive the set or add the owner's verbatim
quote; exit 2 is not a verdict.

## Resume side

The fresh session saves the pasted block and runs `pnpm handoff:verify` on it
before its first tracker or git action, then acts on the live state it reports
(a `BBMP-*` id is checked in Plane, `AGENTS.md` §6). An «owner-approved»
premise counts only with the verbatim owner quote behind it; a cited document
that cannot be found is a question to the owner, not a reading to substitute.
