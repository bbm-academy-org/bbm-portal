# `design-source/` — the design of a surface, as a repo file

This folder holds the **design source of every UI surface this repo renders**:
the owner-approved mockup/canvas itself, vendored **verbatim** as a file, not a
link to it.

> **Build to these files, NOT to issue-body prose.** The source carries the exact
> values — spacing, sizes, colors, states, placeholder copy. An issue
> description is a lossy transcription of it: a coverage checklist, never the
> fidelity spec. Where prose and the source disagree, **the source wins**.
>
> **Vendor EVERY source the surface renders — not only the headline one.** If a
> screen renders a card, a block or a fragment whose design lives in its own
> canvas/file, that file lands here **before** the build starts. A surface whose
> design bytes are not in this folder is **not ready to build**; it is not
> "prose in the issue".

Why this exists: 2026-07-27, a **build** (`deploy/index.html`) and an **export**
were each taken for the original mockup, and it took three owner escalations to
reach the actual Claude Design original. The prose "artifact passport" rule
(task-cycle stage 1) named the problem; this folder is its structural fix — the
original is a committed file with a recorded provenance, so the next session
cannot mistake a derivative for it.

## What goes here

Whatever the owner actually approved at **Stage A** (task-cycle stage 1b), in its
most original available form:

| Form                                           | Vendored as                       |
| ---------------------------------------------- | --------------------------------- |
| Claude Design canvas                           | `<surface>.dc.html` (exact bytes) |
| A rendered HTML mockup (agent- or owner-built) | `<surface>.html`                  |
| A wireframe / picked screenshot                | `<surface>.<png\|webp>` + a note  |

A **described layout** (the lowest fidelity Stage A permits) is vendored as
`<surface>.md` — the description the owner picked, verbatim, not re-narrated.

Never vendored: a **build** or an **export** of our own implementation. Those are
derivatives; vendoring one recreates the 2026-07-27 incident inside the folder
meant to prevent it.

## Vendoring rules

1. **File, not link.** A link does not survive the next session, and a canvas is
   edited in place. The bytes live in the repo.
2. **Verbatim.** Do not reformat, minify, translate or "clean up" a vendored
   source. It is a reference artifact, not shipped code — nothing imports it.
3. **Provenance row, always.** Every file gets a row in the index below: what
   surface it is, which `src/` paths it is the design source **for** (`Covers`),
   its **fidelity**, where it came from (URL / project id / who produced it), its
   type (**original / export / build** — the artifact passport of task-cycle
   stage 1), and the issue that built against it.
4. **Vendor on first touch.** Retroactive vendoring of already-shipped pages is
   explicitly out of scope (#138). A shipped surface gets its source vendored the
   next time a task touches it — that task's PR carries the file.
5. **The skills enforce it.** `author-design-mockup` (surface layout) inventories
   this folder before claiming anything is "new"; `build-ui-from-design-system`
   refuses to start a UI diff whose source is not here.

## The fidelity axis (`Fidelity`)

**Fidelity is orthogonal to lineage.** `original / export / build` says how far the
file is from what the designer produced; `fidelity` says **what kind of decision
the file records**, and only the second one answers «may I build the look from
this?».

| Value       | What the source fixes                                                                                                                         | Ready to build the look? |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `wireframe` | LAYOUT only — where things sit, in what order, at what hierarchy. Greys, borders and placeholder type are scaffolding, not a visual decision. | **No.**                  |
| `visual`    | A visual language: a visual mockup, **or a named standard design system + version** (see below)                                               | Yes                      |
| `canvas`    | A visual design that lives as a Claude Design canvas                                                                                          | Yes                      |

A `wireframe` row is a **stop-state**: the surface has a layout and no visual
language, so building it is the 2026-08-26 incident (#312/#314 — the `/p` launcher
wireframe was built as if it were the design; the owner rejected the stand). The
correct move is to ask the owner for the visual decision, not to reproduce the
wireframe faithfully.

**A standard design system is a legitimate visual source** (owner decision, Антон,
2026-08-26, on #359/#360). Such a row names the system in the `File` column
instead of a vendored file and carries `fidelity: visual`:

```text
| `system: shadcn/ui via ui.refine.dev @ default theme` | … | `src/ui/**` | visual | … |
```

Nothing is vendored for it — the system's own published default theme is the
source, and the version/theme in the cell is what makes it a record rather than a
gesture.

**`Covers`** is the machine-readable half of the row: the `src/` path globs this
source is the design source **for** (`**` = any depth, `*` = one segment). It is
what lets a guard connect a touched view file to the row behind it; a row that
covers no code path (a data-model artboard, say) writes `—`.

**The check:** `pnpm lint:design-fidelity <PR>`
(`tools/lint/design-fidelity-lint.mjs`), severity **BLOCK** —
[`docs/ci-guardrails.md`](../docs/ci-guardrails.md) §5. It fails a UI diff whose
covering row is `fidelity: wireframe` with no recorded owner GO, a new `src/app`
route no row covers at all, and a row whose `Fidelity` cell is missing or unknown.

## Index

| File                                                          | Surface                                                                                                           | Covers                                  | Fidelity  | Provenance (original / export / build)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Built by |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `system: shadcn/ui via ui.refine.dev @ default neutral theme` | The visual language of the whole `/p/*` workspace and of the UI kit that renders it                               | `src/ui/**`                             | visual    | **original** — the standard system's own published default theme; nothing is vendored. Refine's official shadcn/ui integration (registry `ui.refine.dev`, copy-paste model — components are project source, no UI component npm dependency), base `radix`, shadcn CLI `4.19.0`, preset `nova` (`baseColor`/`theme` both `neutral`), Tailwind `4.3.3`. Owner Stage-A decision by Антон, 2026-08-26, recorded on #360; consolidation spec §3 decision 9 / §6 / §10, revision `2026-08-26-g`. The theme's values live in `src/ui/theme.css` exactly as the CLI generated them | #360     |
| `p-launcher.html`                                             | `/p` home launcher (member-facing app catalogue) **and the shared top bar** it draws above it                     | `src/app/(platform)/p/*`                | wireframe | **original** — static-HTML wireframe authored by the Claude lead session for #311 Stage A (option "launcher-a", flat uniform grid); owner pick by Антон, 2026-08-25, recorded in #314                                                                                                                                                                                                                                                                                                                                                                                      | #314     |
| `p-admin-shell.html`                                          | `/p/admin` cabinet shell (Refine, left sidebar with module groups)                                                | `src/app/(platform)/p/admin/**`         | wireframe | **original** — static-HTML wireframe authored by the Claude lead session for #311 Stage A (option "admin-a"); owner pick by Антон, 2026-08-25 with two amendments (explicit sub-section nesting; OKR gets a cabinet section — see the file's header comment), recorded in #315                                                                                                                                                                                                                                                                                             | #315     |
| `finance/Main.dc.html`                                        | Finance ledger data model («Модель данных леджера — что мы утверждаем») — not a screen, the approved schema shape | —                                       | wireframe | **original** — artboard of the Claude Design canvas «Финконтур BBM — вайрфреймы» (artifact `ead41905-c726-42b8-bcdb-4f79b80aab09`), authored by the Claude lead session for #115 discovery; owner validation by Антон, 2026-08-25, recorded on #115; bytes extracted verbatim from the artifact's `appifact-doc` block                                                                                                                                                                                                                                                     | #338     |
| `finance/References.dc.html`                                  | `/p/admin` → Финансы reference tables (счета, проекты, продукты, назначения, статьи, валюты)                      | `src/app/(platform)/p/admin/finance/**` | wireframe | **original** — same canvas, same validation and extraction as `finance/Main.dc.html`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #338     |
| `finance/Overview.dc.html`                                    | `/p/finance` overview; F1 builds only its cash-balances card, the rest is F3 (#340)                               | `src/app/(platform)/p/finance/**`       | wireframe | **original** — same canvas, same validation and extraction as `finance/Main.dc.html`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #338     |

**Why every FILE row above says `wireframe`.** The two `/p` files say so in their own
provenance («static-HTML wireframe»), and the three finance artboards come from a
canvas whose own title is «Финконтур BBM — **вайрфреймы**». That is the honest
reading of what exists today, and it is deliberately not softened: none of those
five files carries a visual language, and the gate is what makes that state
visible instead of letting the next session infer a look from grey boxes.

**What the first `system:` row changes, and what it does not.** The visual
language of `/p/*` was settled in #360 — that row is the record, and it is why
the table is no longer wireframe-only. It licenses the LOOK: a `/p` surface
built out of `src/ui` on the adopted theme has a `visual` source behind it. It
does **not** promote the two `/p` wireframes, which still fix layout and
coverage only and still say `wireframe` for that reason. A UI PR that follows
one of them for LAYOUT while taking its look from the kit is the intended
shape; a PR that reproduces wireframe greys as a visual decision is the
2026-08-26 incident, and it still records the owner decision explicitly
(`Design-fidelity: GO — <owner, date>`) or is deferred to a named gate.

## Tooling notes

- **No DesignSync/MCP canvas sync is wired in this repo** (that tooling lives in
  the ds-platform setup this convention was adapted from). Getting the bytes out
  of Claude Design today is a manual step by the owner or the lead — record in
  the provenance row **how** the file was obtained, so the next session can
  refresh it the same way.
- These files are reference artifacts: they are **not** imported, built, linted
  or type-checked. Keep them out of `src/`.
