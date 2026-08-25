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
   surface it is, where it came from (URL / project id / who produced it), its
   type (**original / export / build** — the artifact passport of task-cycle
   stage 1), and the issue that built against it.
4. **Vendor on first touch.** Retroactive vendoring of already-shipped pages is
   explicitly out of scope (#138). A shipped surface gets its source vendored the
   next time a task touches it — that task's PR carries the file.
5. **The skills enforce it.** `author-design-mockup` (surface layout) inventories
   this folder before claiming anything is "new"; `build-ui-from-design-system`
   refuses to start a UI diff whose source is not here.

## Index

| File | Surface | Provenance (original / export / build) | Built by |
| ---- | ------- | -------------------------------------- | -------- |
| `p-launcher.html` | `/p` home launcher (member-facing app catalogue) | **original** — static-HTML wireframe authored by the Claude lead session for #311 Stage A (option "launcher-a", flat uniform grid); owner pick by Антон, 2026-08-25, recorded in #314 | #314 |
| `p-admin-shell.html` | `/p/admin` cabinet shell (Refine, left sidebar with module groups) | **original** — static-HTML wireframe authored by the Claude lead session for #311 Stage A (option "admin-a"); owner pick by Антон, 2026-08-25 with two amendments (explicit sub-section nesting; OKR gets a cabinet section — see the file's header comment), recorded in #315 | #315 |
| `finance/Main.dc.html` | Finance ledger data model («Модель данных леджера — что мы утверждаем») — not a screen, the approved schema shape | **original** — artboard of the Claude Design canvas «Финконтур BBM — вайрфреймы» (artifact `ead41905-c726-42b8-bcdb-4f79b80aab09`), authored by the Claude lead session for #115 discovery; owner validation by Антон, 2026-08-25, recorded on #115; bytes extracted verbatim from the artifact's `appifact-doc` block | #338 |
| `finance/References.dc.html` | `/p/admin` → Финансы reference tables (счета, проекты, продукты, назначения, статьи, валюты) | **original** — same canvas, same validation and extraction as `finance/Main.dc.html` | #338 |
| `finance/Overview.dc.html` | `/p/finance` overview; F1 builds only its cash-balances card, the rest is F3 (#340) | **original** — same canvas, same validation and extraction as `finance/Main.dc.html` | #338 |

## Tooling notes

- **No DesignSync/MCP canvas sync is wired in this repo** (that tooling lives in
  the ds-platform setup this convention was adapted from). Getting the bytes out
  of Claude Design today is a manual step by the owner or the lead — record in
  the provenance row **how** the file was obtained, so the next session can
  refresh it the same way.
- These files are reference artifacts: they are **not** imported, built, linted
  or type-checked. Keep them out of `src/`.
