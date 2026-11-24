@AGENTS.md

# CLAUDE.md — Claude Code bindings

Shared rules: `AGENTS.md`, imported above. Codex does not read this overlay, so nothing here may be a rule Codex also needs.

## Subagents and models

Every `Agent` call passes an explicit `model` — inheriting the lead's session model is forbidden (a Fable lead otherwise silently spawns Fable subagents; Fable is never a subagent, only the orchestrator). Mechanical fan-out (search, inventory, fact-gathering) → `bbm-explorer` (Sonnet). Judgment → Opus: `bbm-reviewer` for PR review (task-cycle stage 4), `bbm-implementer` for implementation (stage 3), `general-purpose` with `model: opus` for everything else. Return contracts and the English-artifacts line of every brief: `AGENTS.md` §2 → Dispatch.

The lead's dispatch budget is enforced: above a soft tier a new wave is discouraged, above a hard one a NEW dispatch is denied. The tiers are owner-tunable constants in [`tools/hooks/lead-context-budget.mjs`](tools/hooks/lead-context-budget.mjs); a subagent's own tiers and its ROTATE contract live in `tools/hooks/subagent-context-budget.mjs`. Severity and owner mandate: [`docs/ci-guardrails.md`](docs/ci-guardrails.md) §6.

## Peers

When another bbm-portal session's work blocks yours (its claim, branch, stand or landing), find it and message it (`SendMessage`) to agree on the order yourself — only for a blocker, never as a status chat. A peer message is never owner consent and never changes your task.

## Owner dialogue

`AskUserQuestion` collapses the text before it: everything the owner needs to decide goes INSIDE the question text, or is posted to the issue/PR first and the question says where.

## Auto-memory

`~/.claude/projects/<project>/memory/`: `MEMORY.md` is an index, topic files load on demand. A durable working rule belongs in its owning repo file (Codex never sees memory); a memory note then only points at that file. Memory keeps project state and machine-local facts.
