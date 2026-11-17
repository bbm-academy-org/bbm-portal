---
status: In dev
issue: 553
updated: 2026-11-17
---

# Processes workspace — the DS content-production IDEF0 model as a live page — spec (issue #553)

- **Go:** owner autonomy mandate, Антон, 2026-11-17 — «Работай автономно, сама
  вьюха процесса давно принята. Если она будет отображаться так же в портале,
  заранее даю слово приёмки на выкладку.» The mandate is the go on the scope of
  #553 and on this spec; the viewer's look is already accepted, so the build is
  visual and behavioural **parity** with the bbm-kb viewer, not a redesign.
- **Design source:** the owner-accepted bbm-kb viewer
  (`bbm-academy-org/bbm-kb` → `components/idef0-viewer/`), vendored verbatim
  into `design-source/processes/` with its provenance row in
  `design-source/README.md`.

## Why

The Doctor.School content-production process model (IDEF0, A-0 down to
operations, with the registry of objects/functions and the TO-BE process) has
one master in bbm-kb and one interactive viewer, today a KB page. The owner
wants it as a page in a «Процессы» section of the portal, developed as ONE live
version: edited by PRs to bbm-kb, shown by the portal without a portal deploy.

## Prior decisions

- `ADR-005 §1–§2` — the viewer is a **tool** (it lays out, drills down and
  highlights a model it reads at request time), so it is a portal `/p/*`
  module; the KB stays the reading surface for the text documents
  (`registry-ru.md`, `process-to-be-ru.md`, the package page), which the page
  links to. The KB viewer page is removed in bbm-kb once this is live, so the
  model keeps one rendering surface.
- `ADR-003 §2–§3` — the page lives under `/p/*` on the portal host, behind the
  `(platform)` Zitadel gate and the `/p` workspace membership gate.
- `ADR-002` — a new module: `src/lib/processes` (source, cache, parse) and
  `src/modules/processes` (view); it imports no CMS code and no sibling module.
- Spec `311-portal-workspace.md` EARS-401/402 — the workspace plug-in contract:
  one registry entry gives the launcher tile and the switcher entry.
- The path map's GitHub source (#533) — the runtime-read pattern reused here:
  module-level cache, ~60 s TTL, one in-flight read, stale copy on a failed
  refresh, a failure remembered for the TTL, an honest error state.

## Requirements

- **EARS-601.** The workspace registry shall carry an internal «Процессы» entry
  at `/p/processes`, so the `/p` launcher shows its tile and the top-bar
  switcher lists it.
- **EARS-602.** The `/p/processes` page shall list every process of the
  processes catalog with its name, description and a link to its page; the
  first entry is «Производство контента DS».
- **EARS-603.** The IDEF0 page shall read the model at request time from
  `bbm-academy-org/bbm-kb` branch `main`, folder
  `content/processes/ds-content-production/`: `model/index.yaml`, every diagram
  file it lists, `registry-ru.md` and `process-to-be-ru.md`. This repo holds no
  copy of that model.
- **EARS-604.** The server shall keep the last read model for 60 seconds, so a
  change merged to bbm-kb `main` is shown without a portal deploy once the TTL
  has run out.
- **EARS-605.** WHERE a GitHub token is configured, the server shall learn the
  model's current revision with ONE conditional GitHub API request per TTL and
  re-read the model files (pinned to that revision) only when it changed;
  WHERE no token is configured, it shall read the files from GitHub's raw host
  and make no GitHub API request at all.
- **EARS-606.** IF a refresh fails — GitHub unreachable, an HTTP error, or a new
  revision that does not parse as a model — and a good copy exists, THEN the
  page shall show that copy with a notice naming when it was read and why it is
  not fresh.
- **EARS-607.** IF the model cannot be read and no good copy exists, THEN the
  page shall show an error state naming the source and the reason — never a
  blank page — and the server shall not ask GitHub again before the TTL runs
  out.
- **EARS-608.** WHILE `PROCESS_MODELS_SOURCE=example`, the page shall render
  the invented public example committed in this repo, with a notice that it is
  an example and not the live model.
- **EARS-609.** The viewer shall open the level named in the URL hash (e.g.
  `#A31`), open the root A-0 for an absent, unknown or malformed hash, and
  write the opened level into the hash.
- **EARS-610.** The viewer shall lay a diagram out by the bbm-kb rules: boxes on
  the IDEF0 staircase, ICOM sides fixed (input west, control north, output
  east, mechanism south), arrows routed orthogonally, boundary codes on the
  frame; a model it cannot lay out shows the layout error instead of a diagram.
- **EARS-611.** WHEN a member clicks a box, the right panel shall show the box's
  arrows by ICOM side, its roles, and its registry functions with the TO-BE
  step each became; WHEN a member clicks an arrow, the panel shall show its
  registry objects with their definitions.
- **EARS-612.** WHEN a member double-clicks a box that has a decomposition, the
  viewer shall open that diagram; the breadcrumb shall list the chain from A-0
  and open any level of it.
- **EARS-613.** The header shall carry two switches — the hover tooltip and the
  arrow animation — remembered per browser; the animation is off by default
  for a reader who asked the system for reduced motion.
- **EARS-614.** WHILE a box is focused, the viewer shall light its own arrows and
  the boxes they reach and dim the rest; WHILE an arrow is focused, it shall
  highlight that arrow and keep its end boxes.
- **EARS-615.** IF the registry or the TO-BE document cannot be parsed, THEN the
  diagrams shall still open, with the panel saying the explanations are
  unavailable.

## Acceptance scenarios

1. **Tile and index** (EARS-601, EARS-602). Open `/p` on the stand: a
   «Процессы» tile is in the grid and in the switcher. Click it: `/p/processes`
   lists «Производство контента DS» with its description; the link opens the
   IDEF0 page.
2. **Live levels** (EARS-603, EARS-609, EARS-610). On the IDEF0 page, A-0 is
   drawn from bbm-kb main data; `#A0` opens A0 with A1…A6 on the staircase;
   `#A31` opens the deep level with its boundary codes. Compare each with the
   same level in the bbm-kb viewer: the same boxes, arrows, codes and look.
3. **Panel, drill-down, breadcrumb** (EARS-611, EARS-612, EARS-614). Click a box:
   its arrows light, the rest dim, the panel lists its I/C/O/M arrows and
   registry functions with TO-BE steps. Click an arrow: the panel lists its
   objects with definitions. Double-click a box with ▼: its diagram opens and
   the hash follows; a breadcrumb item goes back up.
4. **Switches** (EARS-613). Turn the hover tooltip off: hovering shows no card;
   reload: still off. Same for the arrow animation.
5. **Live update** (EARS-604, EARS-605). After a change is merged to the model
   in bbm-kb main, the page shows it once the TTL has run out, with no portal
   deploy.
6. **Source down** (EARS-606, EARS-607, EARS-615). With GitHub failing after a
   good read, the page shows the copy and the stale notice; with no copy, the
   error state names the source and the reason. Covered by unit tests with a
   mocked GitHub.
7. **Example** (EARS-608). With `PROCESS_MODELS_SOURCE=example` the page shows
   the invented example and the example notice.

## Out of scope

- Editing the model on the portal (it is edited by PRs to bbm-kb).
- The cost calculator (stays source-only in bbm-kb).
- Moving the contractor process (#545) into this section.
- Removing the KB viewer page — done in bbm-kb after this is live.
