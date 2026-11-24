# Lead delegation — what the lead does itself and what it dispatches

The lead orchestrates: dispatch, supervision, review, the tracker. Every time it instead started "just doing it quickly", the session lost time and once lost data. The limits below are thresholds with an explicit stop condition, not an appeal to "delegate more".

Canon they grow from: `.claude/skills/task-cycle/SKILL.md` (stage 1 — the `Диспатч:` line of the plan; stage 3 — module implementation goes to a subagent) and `CLAUDE.md` → «Subagents and models» (which agent, which model; under Codex, `docs/codex-agent-mode.md` maps the roles).

## 1. An edit of ≤1 file — one attempt, then dispatch

**The lead may apply an edit of ≤1 file itself in ONE attempt. If it does not land the first time (a conflict, a broken commit, a revert), that is a dispatch, not a second attempt.** Unwritten, the exemption silently widened — "≤1 file" became "≤1 file and a bit more", a failed attempt became a chain of attempts — and twice it ended badly (a corrupted `.gitattributes` repaired by more edits; fixes abandoned half-way that nobody picked up). The stop condition is mechanical: it did not land → describe the state (what was tried, what broke, what was reverted) and hand it to a subagent in an isolated worktree ([`parallel-sessions.md`](./parallel-sessions.md)).

**Execution is dispatched even when it is small** (owner, 2026-08-17). Ops preparation — copying data, seeding a stand, running E2E, booting an acceptance stand — and tracker/doc rewrites (issue bodies, spec revisions) are execution: they go to a subagent by brief, even as one command. "It's tiny and I'm waiting anyway" is not a reason: a manual lead step is covered by no brief and no return contract. The lead itself does reads and the ≤1-file edit above. For reversible, non-conflicting batch edits (issue bodies, labels) the default brief is "read → rewrite → apply → one line per object": one agent per batch mutates through `gh` itself, no dossiers or drafts in between.

## 2. Recon — more than three read-only calls in a row is a brief

**More than three read-only calls in a row on ONE question** ("where is it", "what is already done", "why did it fail") **is a `bbm-explorer` brief, not the lead's work. The lead reads conclusions, not files.**

- The count is per question, not per session: three calls on "where is X", then three on "why did Y fail" are two counters, both within the limit.
- A fourth call on the same question means it is wider than one grep — so its answer is worth getting compressed. Symptom, 2026-08-25: 20–25 read-only Bash calls before the first dispatch of a session.
- The agent is `bbm-explorer` (Sonnet) with an explicit `model`; return contract ≤30 lines, heavy output to a scratchpad file.
- Exception: a targeted read of a known path (a file the owner or the brief named) is not recon.

## 3. The split is declared before the "go", not along the way

**The line's format belongs to this file** (task-cycle stage 1 requires the line in the plan and points here — no second spelling of the template). The plan is written to the owner in Russian, so the line stays verbatim Russian:

```
Диспатч: <тип агента + модель> на <часть> · лид оставляет себе <часть>
```

The owner sees the split BEFORE the "go". A plan whose lead column holds implementation, writing or bulk recon is wrong at the moment of approval, and that is caught at approval, not afterwards.

The deterministic half of §1–§3 is the zero-dispatch hook `tools/hooks/zero-dispatch-guard.mjs` (#322), which blocks a lead that keeps editing files without a single `Agent` dispatch; its threshold, one-shot bypass and severity live there and in `docs/ci-guardrails.md` §6. This file is the canon it enforces.
