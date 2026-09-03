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

**0. Is the design in the repo, and is it a VISUAL one?** Two questions, both
asked before any markup — presence, then fidelity.

**0a. Presence.** `ls design-source/` and read its index (`Covers` names the
`src/` paths each row owns). If the surface's design source is **not** there,
stop and vendor it first (rule 1 of `design-process.md`) — a link, a screenshot
pasted in the issue, or an owner's prose description does **not** substitute. If
no design exists at all, this is a Stage-A task: go to
[`author-design-mockup`](../author-design-mockup/SKILL.md) for a whole surface,
or to step 2 below for a single element class.

**0b. Fidelity.** Read the row's `fidelity` cell. `visual` / `canvas` — build to
it. **`wireframe` — STOP: the surface has a layout and no visual language, and
building the look from one is the 2026-08-26 incident (#312/#314 — owner rejected
the stand).** That is a stop-state question to the owner, not a licence to
reproduce the grey boxes faithfully. The build resumes only once the owner's
decision is recorded — a visual source vendored, a standard design system + version
named in the row (`system: … @ default theme`, `fidelity: visual`), or a
`Design-fidelity: GO — <owner, date>` line in the PR / linked issue. Check with
`pnpm lint:design-fidelity <PR>` (BLOCK, `.claude/rules/design-process.md` §1).

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

**4. Decide the UX, and sign the decision in the PR — the `UX-record:` block.**
Composition, control choice, grouping, states, feedback and post-submit
behaviour are YOURS to decide (owner ruling, Антон, 2026-09-02 —
[`.claude/rules/design-process.md`](../../rules/design-process.md) §1); the
visual language and product forks are the owner's. Decide them before writing
markup and record them in the PR body, all six facets, one line each:

```
UX-record:

- Composition: what dominates the screen, what recedes, and why that matches its purpose
- Controls: which `@/ui` controls carry each input, and why not a hand-rolled one
- Grouping: how the fields and blocks are grouped (a flat list of N inputs is a decision too)
- States: default / hover / focus-visible / active / disabled / loading / empty / error /
  permission-denied / long content — and which of them the design source does NOT show
- Feedback: what the user sees after each action, and where it appears
- Post-submit: where the user lands, and what changed there
```

The fence above marks this as an EXAMPLE: paste the real block into the PR body
**unfenced**, because the guard strips fenced text and HTML comments
(`tools/lint/lib/guard.mjs`) — a fenced copy records nothing.

A view-layer diff that decides no UX at all (a rename, a prop rewire) records
the self-certification instead, on one line:
`UX-record: N/A (no UX decisions) — lead-certified`.

This replaces an unsigned checklist: until #433 the state list here was a
reminder nobody had to sign and nothing read, and the price is in that issue —
eleven ungrouped fields on the finance request form because no one was licensed
to group them, and a hand-rolled select beside `src/ui/select.tsx`. Check it with
`pnpm lint:ux-record <PR>` (WARN — [`docs/ci-guardrails.md`](../../../docs/ci-guardrails.md) §5).
The `frontend-design` skill is still loaded before markup, per task-cycle stage 3.

**5. Keep app glue out of the presentation.** Data fetching, auth gating, error
copy and routing live in the route/module; the component is the presentation
scaffold. Module boundaries are machine-checked (`pnpm boundaries`, ADR-002).

**6. Live-verify yourself, then hand the owner a URL.** The acceptance protocol
— a seeded stand booted by the LEAD's session on a `pnpm dev:ports` port, every
state driven through Playwright, the full-page 2 breakpoints × 2 themes ×
forced `:hover` / `:focus-visible` / `:active` matrix, the UX sanity pass, the
artifacts under `docs/evidence/<issue>/`, and the live URL as the invitation's
first line — lives in ONE place and is not restated here:
[`task-cycle`](../task-cycle/SKILL.md) stage 5. Run it as written; a red,
error-stuck or skeleton-stuck screen is a stop state, not something to hand over.

**7. Record Stage-B in the PR.** The PR body's `Stage-B:` line gets the real
value — `GO — <owner, date>`, `batched at #<gate>`, or
`N/A (no visual surface) — lead-certified`. Check it with
`pnpm lint:stage-b <PR>` before merging.

## Output

- A UI diff whose every value traces to a file in `design-source/`.
- An explicit reuse decision in the PR body: reused / adopted / **bespoke +
  justification**.
- A filled `UX-record:` block (step 4) — or the one-line lead self-certification.
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
- **Waiting for the owner to compose the screen** — what a missing or
  `wireframe`-only source does and does not stop is
  [`design-process.md`](../../rules/design-process.md) §1; step 4 above is where
  your composition is recorded.
