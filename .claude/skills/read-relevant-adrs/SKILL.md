---
name: read-relevant-adrs
description: Load the architecture decisions that already govern a task before designing anything — the ADRs cited in the spec's "Prior decisions" plus the ones adjacent to the task's domain. Use before authoring a spec, before any brainstorm, and before an implementation plan that touches module boundaries, domains, auth or data. Project-local; this repo only.
---

# read-relevant-adrs — the ADRs before the design

**Kind:** procedural · **Mode:** inline (the lead runs this itself; it is not
dispatched).

Symptom this exists for: a session opens a brainstorm on a question that
`docs/adr/` already answers, re-derives a different answer, and the owner has to
be the one who remembers there was a decision. The cost is not the wasted turn —
it is a second, contradictory architecture landing in a spec he then approves.

## When to run it

Before **any** of: authoring a spec (`author-feature-spec` step 1), opening a
brainstorm, planning work that touches module boundaries, the domain topology,
auth, or the data core. Also before revising an ADR (`do-adr-revision`).

Not needed for: a copy fix, a CMS-contract edit, a dependency bump.

## Procedure

1. **Start from the spec, when there is one.** Read the spec's
   `## Prior decisions` section (`docs/specs/README.md` § Prior decisions) and
   collect the `ADR-NNN` ids cited there.
2. **Sweep for adjacency.** `docs/adr/README.md` is the index — read the table
   and pick every ADR whose title touches the task's domain. Then grep for
   loose citations the index does not carry:

   ```bash
   grep -rn "ADR-0*[0-9]" docs/ src/ --include="*.md" --include="*.ts" | grep -i "<domain keyword>"
   ```

   ADR ids here are unpadded three digits (`ADR-002`, `ADR-003`); ADR-001 lives
   in `bbm-public-website/docs/infrastructure-decisions.md`, not in this repo.

3. **Read the cited SECTIONS, not the whole file.** The section heading is the
   unit. If a section carries an **amendment block** (`A1`, `A2` — see
   `do-adr-revision`), read the amendment too: for a shipped decision the
   amendment, not the original body, is the current rule.
4. **Carry them into the work.** The ADR text is context for the design, not a
   quote to paste.
5. **Cite what was loaded in the first user-facing reply**, in the form
   `per ADR-003 §2 …`. That citation is the proof the step ran — a plan with no
   citation is a plan that did not read the decisions.

## Output

- The lead carries the cited ADR sections in context for the rest of the task.
- The first reply names at least one `ADR-NNN §X` — or states outright that no
  ADR governs this area, which is itself a finding worth saying.

## Failure modes

- **Brainstorming first, reading after.** By then the design exists and the ADR
  is read as a constraint to argue with instead of a decision to build on.
- **Reading the index only.** The README table gives titles; the constraint
  lives in the section body.
- **Ignoring amendments on a shipped ADR.** The original body explains why the
  running system looks the way it does; the amendment says what the rule is
  now. Reading only the first is how a superseded rule gets re-applied.
- **Silent no-op.** If nothing was loaded, say so. An absent citation reads
  identically to a skipped step.

## Related

- [`do-adr-revision`](../do-adr-revision/SKILL.md) — changing an ADR.
- [`author-feature-spec`](../author-feature-spec/SKILL.md) — step 1 is this skill.
- `docs/adr/README.md` — the index and the ADR canon.
