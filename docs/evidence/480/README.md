# #480 — a PROPOSED purpose reads with its text, stage-5 eyes-on matrix

The acceptance journey of [`.claude/skills/task-cycle/SKILL.md`](../../../.claude/skills/task-cycle/SKILL.md)
stage 5, points 2–3, run against PR #503.

**The stand.** `http://localhost:3000`, the lead's listener, driven at the
INTEGRATION head **`0f0371b6`** of `wave/115-tails` — the merge of PR #503
(#480), PR #504 (#479) and PR #505 (#473) — so every frame shows this fix beside
the other two, not on its own branch. Data from the branch DB `platform_473`:
`pnpm dev:seed` (64 people in `core.member`, 32 requests walked through the
spec-339 status machine, 6 counterparties, 5 ledger operations),
`pnpm platform:member:seed` for the two dev IdP logins, and the two
proposal-branch requests this journey filed through the UI (see «What this pass
wrote» below).

Driven with `@playwright/test` from the worktree, signed in through the real dev
Zitadel as **`bbm-member`** (`platform-user` alone — no finance role, not the
submitter) and as **`bbm-test`** (`platform-admin` + `finance-entry` +
`finance-approve`); the password was read from a scratchpad file by the script
through `fs` and never entered a tool call.

**The matrix.** Every driven state × 2 breakpoints (desktop 1440×900, mobile
390×844) × 2 themes (light, and dark through the theme's own `.dark` class — the
workspace ships no user-facing switch), plus the surface's primary control under
three CDP-forced pseudo-states (`CSS.forcePseudoState`, one session per state),
never hoped for from a pointer.

| Step | What it shows                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 01   | the register on «Все» as **`bbm-member`** — another member's row reads «Назначение предложено: Подписка на AI-инструменты…», not a bare label |
| 02   | the details sheet of that same foreign request as `bbm-member` — the whole proposal text, wrapped, under «НАЗНАЧЕНИЕ»                          |
| 03   | the kanban as `bbm-test` — it carries NO card for either proposal request, and that is the surface's own rule (see below)                       |
| 04   | the register on «Все» as **`bbm-test`** — the mirror direction: `bbm-member`'s proposal text on `bbm-test`'s screen                           |
| 05   | the details sheet of `bbm-member`'s request as `bbm-test` — «Назначение предложено: Оплата участия в отраслевой конференции…»                 |
| 06   | «Новая заявка», the surface's primary control, under CDP-FORCED `:hover`, `:focus-visible` and `:active` (desktop, both themes) plus its base   |

**Why step 03 shows an absence, and why that is the honest frame.** A request
whose purpose is only PROPOSED cannot be submitted: the module refuses it with
«Назначение обязательно перед отправкой; выберите строку справочника или
дождитесь решения по предложению» (spec 339 EARS-508/526), so such a request is
always a DRAFT, and the four kanban columns are the four states of the SUBMITTED
machine. The register and the details sheet are therefore the only two surfaces
on which a pending proposal is ever read, and both are covered above. The card
line PR #503 also fixed is reachable only after a proposal is resolved — at which
point the request carries a real purpose and the label is not used at all.

**What this pass wrote to `platform_473`**, both through the UI and both left in
place as the stand's representative data:

- request **#43**, filed by `bbm-test` — «Подписка на AI-инструменты для
  аналитического отдела», 48 900,00 RUB, ООО «Нейросети и партнёры»;
- request **#44**, filed by `bbm-member` — «Оплата участия в отраслевой
  конференции по образовательным продуктам», 31 500,00 RUB, ИП Конференц-Сервис.

Each is the OTHER login's foreign request, which is what makes steps 01/02 and
04/05 a real open-book read rather than a self-read.

**DoD check (stage 5 point 5).** Every kept frame was reviewed. None is red,
error-stuck or skeleton-stuck. The honest artefacts:

- **The sheet frames (02, 05) are captured at the viewport, not full-page.** A
  sheet is `position: fixed`, so a full-page frame of one shows the overlay
  ending at the first viewport and the register unobscured below — a capture
  artefact, not the screen.
- **The register CLIPS the purpose cell** («Назначение предложено: Опл…») and
  that is the register's rule, not this fix failing: the column is clipped on the
  promise that the sheet carries the whole text, which steps 02 and 05 show it
  now does (#473 item 3, PR #505).
- **The account avatar reads «BBM Test» in every frame, for both logins.** The
  two dev IdP users share a display name; the identity being driven is visible in
  the rows instead — «Тестовый Участник» is `bbm-member` and «Тестовый
  Администратор» is `bbm-test`, the names their `core.member` rows carry.
