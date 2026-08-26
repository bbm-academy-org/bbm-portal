---
name: build-ui-from-design-system
description: The gate every UI diff in this repo passes before markup — vendor the design into design-source/, then climb the reuse ladder (design-source → whitelist registry → bespoke with a justification), then Stage A/B per task-cycle. Use before writing or reshaping any *.tsx view layer or *.css. Project-local; this repo only.
---

# build-ui-from-design-system — the UI gate

**Kind:** procedural · **Mode:** inline (the lead, or the implementer it
dispatches, runs this itself).

This is the **thin gate** in front of every UI diff. It does not restate the
standards; it points at where they live and enforces the order of operations:

- [`design-source/`](../../../design-source/README.md) — the design of each
  surface, vendored as a file. **The fidelity source of truth.**
- [`docs/design/ui-whitelist.md`](../../../docs/design/ui-whitelist.md) — the
  registry of settled, reusable element classes, plus the state of the kit —
  `src/ui` exists since #312; whether the registry has rows yet is that file's
  to say.
- [`.claude/rules/design-process.md`](../../rules/design-process.md) — the two
  repo rules this skill enforces.
- [`task-cycle`](../task-cycle/SKILL.md) stages **1b** (Stage A) and **5**
  (Stage B) — the owner's two check-ins. This skill never replaces them.

## When this applies

Any task that creates or reshapes an interface: a page, form, control, layout,
overlay, or an empty / error / loading state. Mechanically: any non-test `*.tsx`
or `*.css` under `src/` (the same definition `pnpm lint:stage-b` uses).

**Classify by the touched surface, not by the issue's label.** A task filed as
`chore`, "tooling" or "a small fix" that changes what the owner can see is a UI
task and runs this gate. The Payload admin surface counts.

## The ladder (the whole procedure, in order)

**0. Is the design in the repo?** `ls design-source/` and grep it for the
surface. If the surface's design source is **not** vendored, stop and vendor it
first (rule 1 of `design-process.md`) — a link, a screenshot pasted in the issue,
or an owner's prose description does **not** substitute. If no design exists at
all, this is a Stage-A task: go to
[`author-design-mockup`](../author-design-mockup/SKILL.md) for a whole surface,
or to step 2 below for a single element class.

**Never build from a build.** If the only artifact you were handed is our own
rendered page or an export of it, say so and ask for the original — that
substitution cost three owner escalations on 2026-07-27.

**1. Reuse from `design-source/`.** The unit you need may already be designed —
for this surface or another one. Grep the folder before claiming anything is
new. Build the unit from the vendored file's actual values, not from a
re-narration of them; if you hand the work to a subagent, hand it the **file
path** plus "the source overrides any prose in this brief".

**2. Adopt from the kit and the whitelist registry.** `src/ui` exists since #312
— read [`src/ui/README.md`](../../../src/ui/README.md) for what it covers and
import from `@/ui` rather than rebuilding it (EARS-430: hand-rolled styles are a
review stop-factor). Then check
[`docs/design/ui-whitelist.md`](../../../docs/design/ui-whitelist.md) for the
element class; that file states whether the registry has rows yet. If the class
is missing and the look is genuinely open,
dispatch [`research-ui-element`](../research-ui-element/SKILL.md) rather than
inventing a look at the keyboard.

**3. Bespoke — allowed, never silent.** With rungs 1–2 empty, bespoke is the
correct outcome. The PR body then carries the justification line the whitelist
doc specifies (`bespoke — whitelist empty for <class>; searched <sources>; not
adopted because <reason>`). If the same class goes bespoke on a second surface,
that is decision-debt: file it (`surface-decision-debt`), it is the signal the
class belongs in the registry or in #112.

**4. Enumerate the states before writing markup.** default / hover /
focus-visible / active / disabled / loading / empty / error — and state
explicitly which of them the design source does **not** show. A mockup shows the
happy path; the states you did not ask about are the ones that get reworked.
(This is also task-cycle stage 3's standing instruction, together with loading
the `frontend-design` skill before markup.)

**5. Keep app glue out of the presentation.** Data fetching, auth gating, error
copy and routing live in the route/module; the component is the presentation
scaffold. Module boundaries are machine-checked (`pnpm boundaries`, ADR-002).

**6. Live-verify yourself, then hand the owner a URL.** Take a port with
`pnpm dev:ports`, run `PORT=<n> pnpm dev` (`.claude/rules/parallel-sessions.md`),
drive the real journey in a browser — every branch, not just the green path —
and only then invite the owner. Per task-cycle stage 5 a browser E2E pass
(Playwright) of the acceptance scenarios is the **precondition** for the
invitation; curl plus unit tests is not. The invitation carries URL + login +
where to get the password, and the stand stays up until the verdict.

**7. Record Stage-B in the PR.** The PR body's `Stage-B:` line gets the real
value — `GO — <owner, date>`, `batched at #<gate>`, or
`N/A (no visual surface) — lead-certified`. Check it with
`pnpm lint:stage-b <PR>` before merging.

## Output

- A UI diff whose every value traces to a file in `design-source/`.
- An explicit reuse decision in the PR body: reused / adopted / **bespoke +
  justification**.
- A filled `Stage-B:` line, and — when the class became reusable — a new row in
  `docs/design/ui-whitelist.md`.

## Failure modes

- **Building from issue prose while the canvas sits unvendored** — the founding
  error this whole convention exists to stop.
- **Taking a build or an export for the original** (2026-07-27).
- **Skipping Stage A** — markup before the owner picked a direction; the price
  was the #76 and #84 rework cycles.
- **A screenshot instead of a live URL** at Stage B, or tearing the stand down
  before the verdict.
- **"There is no kit, so the procedure does not apply."** The ladder is designed
  to run with an empty registry; skipping it is how bespoke becomes invisible.
- **Silent bespoke** — no justification line, so nobody can see the debt
  accumulating.
