# docs/specs — light specs for owner sign-off

Part of the task-cycle regulation (`.claude/skills/task-cycle/SKILL.md`,
issue #65). The owner is a non-developer working through agents: the spec is
his control interface over what the agent is about to build — he approves the
spec, not an abstract plan or a diff.

## When a spec is required

A **new platform module** or **new user-facing behavior** (a page, route,
visible flow). The spec is written BEFORE any code (task-cycle stage 1a) and
is the subject of the owner's "go" (stage 2).

## When it is NOT required

CMS-contract upkeep (the source of truth is already code: `schemas.ts` + seed
fixtures), chore/fix/refactor tasks. When in doubt, ask at stage 1.

## Format (keep it light)

One markdown file per spec: `NNN-<slug>.md`, where `NNN` is the related
GitHub issue number.

```markdown
# <Feature name> — spec (issue #N)

## Why

1–3 sentences: the problem / goal, in product language.

## Requirements

Plain-language numbered list: what the thing must do. Constraints
(152-FZ, ADR-002 module boundaries, domain topology) called out explicitly.

## Acceptance scenarios

Numbered "how the owner verifies it works" walkthroughs: the real URL,
what he opens, clicks, and sees. These double as the TDD test scenarios
(task-cycle stage 3) and the stage-5 live-stand acceptance script.

## Out of scope

What this task explicitly does NOT include.
```

## EARS — deferred, not rejected

EARS clause syntax (WHEN/IF-THEN … shall), slicing issues per EARS handler,
`it('EARS-N: …')` test naming and spec-link CI guards are deliberately NOT
adopted now (issue #65 §4): their value shows up with many parallel specs,
which this repo does not have yet. **Revisit trigger:** ≥3–4 live specs at
once, and/or requirement ↔ test ↔ issue traceability starts getting confused.
The light format above is EARS-compatible — the road stays open.
