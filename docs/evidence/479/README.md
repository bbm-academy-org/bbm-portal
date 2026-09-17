# #479 — the finance reference write gate, stage-5 eyes-on matrix

The acceptance journey of [`.claude/skills/task-cycle/SKILL.md`](../../../.claude/skills/task-cycle/SKILL.md)
stage 5, points 2–3, run against PR #504.

**The stand.** `http://localhost:3000`, the lead's listener, driven at the
INTEGRATION head **`0f0371b6`** of `wave/115-tails` — the merge of PR #503
(#480), PR #504 (#479) and PR #505 (#473), including the merge fix that makes the
reference refusal follow #473's no-repo-path copy rule. Data from the branch DB
`platform_473`: `pnpm dev:seed` plus `pnpm platform:member:seed` for the two dev
IdP logins.

Driven with `@playwright/test` from the worktree, signed in through the real dev
Zitadel as **`bbm-test`** (`platform-admin` + `finance-entry` + `finance-approve`)
and as **`bbm-member`** (`platform-user` alone); the password was read from a
scratchpad file by the script through `fs` and never entered a tool call.

**The matrix.** Every driven state × 2 breakpoints (desktop 1440×900, mobile
390×844) × 2 themes (light, and dark through the theme's own `.dark` class — the
workspace ships no user-facing switch), plus the surface's primary control under
three CDP-forced pseudo-states (`CSS.forcePseudoState`, one session per state).

| Step | What it shows                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 01   | `/p/admin` as `bbm-test` — the index and the sidebar list only the sections this viewer may enter (Часы, OKR, Финансы, Участники) |
| 02   | `/p/admin/finance/purposes` as `bbm-test` — the reference register with its per-row «Открыть / Изменить / В архив / Удалить» |
| 03   | the edit card of «Продажи курса», open — name, expense category, product binding, «Изменения фиксируются с автором и временем» |
| 04   | the SAME card after a real save — the name carries the edit, «Изменения сохранены.» stands in the card, and the toast confirms |
| 05   | `/p/admin` as `bbm-member` — refused                                                                                     |
| 06   | `/p/admin/finance/purposes` as `bbm-member` — refused the same way, however the URL is reached                            |
| 07   | «Добавить назначение», the register's primary control, under CDP-FORCED `:hover`, `:focus-visible` and `:active` plus its base |

**Steps 05 and 06 are BLANK on purpose, and the frame is the point.** Both
answer **HTTP 403** and render nothing at all: `src/app/forbidden.tsx` returns
`null`, the bare refusal of spec 311 EARS-418 / D-5 — «bare means bare: a plain
response with no layout, no top bar, no explanation and no contact block». The
frames are therefore NOT error-stuck screens that slipped through the stage-5 DoD;
they are the shipped refusal, re-observed live (status 403, `document.body`
innerText empty) before being written down.

**The API half of the same gate**, driven in the same session and recorded here
because it has no screen of its own — `POST /api/p/finance/admin/purposes`:

| Caller       | Status | Meaning                                                                 |
| ------------ | ------ | ----------------------------------------------------------------------- |
| `bbm-member` | `403`  | refused at the claim gate, before any field is read                     |
| `bbm-test`   | `400`  | ADMITTED past the gate — the refusal is field validation, not the claim |

**The limitation this pass could not close.** Acceptance criterion 1 of #479 asks
for a caller holding `finance-entry` **without** `platform-admin`. The dev IdP
seeds exactly two users (`infra/dev-stand/idp/provision.sh` steps 2 and 8):
`bbm-test`, which holds both, and `bbm-member`, which holds neither. Removing
`platform-admin` from `bbm-test` is a write to the live dev Zitadel that would
change every parallel session's stand, so this journey did NOT fake it: the
frames above prove the ADMITTED path (through a holder of both roles) and the
REFUSED path (through a holder of neither), and the `finance-entry`-only branch
is covered by the unit tests PR #504 adds against
`assertFinanceReferenceAccess` / `cabinetClaimsForPath` / `adminRoute`.

**DoD check (stage 5 point 5).** Every kept frame was reviewed. None is
skeleton-stuck; steps 05/06 are blank by the design quoted above. Two honest
artefacts, both re-observed live rather than inferred:

- **Step 03/04 are captured at the viewport, not full-page** — the card is short
  and the page does not scroll, so the two are the same picture.
- **The name edited in step 04 was restored** to «Продажи курса» at the end of
  the pass; the frames keep the edited value because that IS the state being
  accepted.
