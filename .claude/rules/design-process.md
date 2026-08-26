# Design process — build from `design-source/`, record Stage-B

Two rules, both structural replacements for prose that failed in practice.
Canon: task-cycle stages 1b (Stage A) and 5 (Stage B); introduced by #138 (task
7.7 of epic #117).

## 1. The design of a surface is a file in `design-source/` — or a standard system named there

- **Build to the file, not to issue-body prose.** The owner-approved mockup /
  canvas / layout is vendored **verbatim** into [`design-source/`](../../design-source/README.md)
  BEFORE the build starts. Issue text is a lossy transcription of it; where the
  two disagree, the file wins — **but only at `visual`/`canvas` fidelity**, see
  the fidelity clause below.
- **A standard design system + version is a legitimate visual source.** A
  provenance row may name one at `fidelity: visual` — the `system:` form, e.g.
  the shadcn/ui default theme via ui.refine.dev — instead of pointing at a
  vendored file; the system's published theme is then the source, and nothing is
  vendored. Owner decision, Антон, 2026-08-26 (#359/#360): an internal tool on a
  stock theme does not get mockup ceremony.
- **Vendor EVERY source the surface renders**, not only the headline one — a
  screen that renders a card whose design lives in its own canvas needs THAT
  canvas vendored too.
- **A build or an export is not the original.** Every vendored file carries its
  provenance row (path + who produced it + original / export / build) — the
  artifact passport of task-cycle stage 1, now a committed artifact. (2026-07-27:
  a build and an export were each taken for the original mockup; three owner
  escalations.)
- **On first touch, not retroactively.** Surfaces shipped before #138 are
  back-filled only when a task next touches them.
- **A surface whose source is not in `design-source/` is not ready to build.**
  That is a stop-state question to the owner, not a licence to build from prose.
- **Fidelity is its own axis, and it is the one that licenses a build.** Every
  provenance row carries `fidelity: wireframe | visual | canvas` next to the
  original/export/build lineage. A `wireframe` records a LAYOUT decision and no
  visual language: byte-fidelity to it is **not** the mandate, and a surface
  whose only source is one is **not ready to build**. The correct verdict — the
  reviewer's and the gate's — is **STOP** (ask the owner for the visual
  decision), never `REQUEST_CHANGES` toward the wireframe. 2026-08-26: the `/p`
  launcher wireframe was built, pinned by a spec and defended in review as if it
  were the design; the owner rejected the stand.

**The check:** `pnpm lint:design-fidelity <PR>`
(`tools/lint/design-fidelity-lint.mjs`) — a UI diff whose covering row is
`fidelity: wireframe` needs an explicit owner record in the PR body or a
linked-issue comment, in one of two shapes:

| Value                                                       | Means                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Design-fidelity: GO — <owner, date> — <what was approved>` | the owner settled the visual language (a mockup, or adopting a standard system) |
| `Design-fidelity: batched at #<gate> covers <glob>`         | deferred to a named gate issue that must name the surfaces it covers            |

A NEW route under `src/app` with no row at all fails outright, and a row whose
`fidelity` is missing or unknown fails too. **Severity: BLOCK** from day one
(register: [`docs/ci-guardrails.md`](../../docs/ci-guardrails.md) §5) — unlike
the WARN plane of §2 below, this job carries no `continue-on-error`. The fidelity
values themselves are defined where they live:
[`design-source/README.md`](../../design-source/README.md) → «The fidelity axis».

The reuse ladder for any UI work — `design-source/` → the whitelist registry
([`docs/design/ui-whitelist.md`](../../docs/design/ui-whitelist.md), empty today)
→ bespoke with a written justification → Stage A/B — is run by the skill
[`build-ui-from-design-system`](../skills/build-ui-from-design-system/SKILL.md).
Surface **layout** (how a whole screen is composed) is
[`author-design-mockup`](../skills/author-design-mockup/SKILL.md); researching an
uncovered element class is
[`research-ui-element`](../skills/research-ui-element/SKILL.md).

## 2. Every PR carries a `Stage-B:` line

The PR body (or a comment on the linked issue) records the Stage-B outcome
explicitly, in exactly one of three shapes:

| Value                                               | Means                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Stage-B: GO — <owner, date>`                       | the owner said «принято» on a LIVE stand (task-cycle stage 5)                |
| `Stage-B: batched at #<gate>`                       | acceptance is deferred to a named batched gate issue the owner agreed to     |
| `Stage-B: N/A (no visual surface) — lead-certified` | the diff changes no visual surface; the **lead** puts its name on that claim |

**The tail is part of the record.** A bare `GO`, a bare `N/A`, a `TBD`, or the
unfilled template placeholder is **not** a record: the GO stands in for a
«принято» said by a named person on a named day, and the self-certification is
the lead putting its own name on the absence of an owner verdict. Text that only
_talks about_ the marker — the template's `<!-- … -->` instructions, a quoted
example in a fenced code block — is never evidence; the check strips it.

The lead self-certification is not an owner verdict and is never used to skip a
pending design question — it exists so a behavioural or backend-shaped PR that
happens to touch a `.tsx` file does not fake an acceptance it never needed.

**The check:** `pnpm lint:stage-b <PR>` (`tools/lint/stage-b-lint.mjs`) classifies
the PR by touched path — a non-test `*.tsx` / `*.css` under `src/` is a UI diff,
the same definition task-cycle stage 3 uses — and reports whether a valid marker
exists in the PR body or in a linked-issue comment.

**Severity: WARN**, recorded in the guard register
([`docs/ci-guardrails.md`](../../docs/ci-guardrails.md) §5). Mind the two different
WARNs: run locally the guard reports the violation and exits 0, while in the canon WARN
means `continue-on-error` on the CI job. The CI wiring (#136) uses both deliberately —
the `stage-b` job passes `--severity block` so the script gives a real signal, and carries
`continue-on-error: true` so the plane stays WARN. Promotion to BLOCK follows the canon's
§4 clauses (earliest 2026-09-02) and is a one-line workflow change. A guard **error** (the PR cannot be read at all) is not a
violation and always exits non-zero: a check that never ran must not look clean.
