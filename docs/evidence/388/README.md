# #388 — the expense-request board `/p/finance/requests`, stage-5 eyes-on matrix

The acceptance journey of [`.claude/skills/task-cycle/SKILL.md`](../../../.claude/skills/task-cycle/SKILL.md)
stage 5, points 2–3, run against PR #470. The folder holds TWO passes: the first
one (steps 01–22) was taken at `52ba515`, after the load crash was fixed
(`1cf0226` — the board reads the snapshot from `query.data`, not from
`useCustom`'s always-truthy `result.data`); the second one re-drove the surface
at head **`2860b42`**, where the owner ruling «заявка — это намерение, а не
платёж» (Антон, 2026-09-03, [#388 comment](https://github.com/bbm-academy-org/bbm-portal/issues/388#issuecomment-5526308133))
took the paying account and the money date OUT of the request and INTO the
posting act. Every step whose picture that ruling changed was RE-TAKEN under its
own filename (05, 06, 09, 18, 19, 20, 21, 22) and eight new states were added
(23–31).

**The stand.** `http://localhost:3000`, the lead's listener from
`.claude/worktrees/388` on `feat/388-requests-board-blocks`; data from that
worktree's own branch DB `platform_388` (migration `0015_finance_intake_money_facts`
applied). The fixture is `pnpm dev:seed` (64 people in `core.member`, 42 intake
rows) plus `pnpm platform:member:seed` for the two dev IdP logins, plus the acts
each pass drove through the UI. Driven with `@playwright/test` from the worktree,
signed in through the real dev Zitadel as `bbm-test` (`finance-approve` +
`finance-entry`); the password was read from a scratchpad file by the script
through `fs` and never entered a tool call.

**The matrix.** Every driven state × 2 breakpoints (desktop 1440×900, mobile
390×844) × 2 themes (light, and dark through the theme's own `.dark` class — the
workspace ships no user-facing switch), plus the primary control of each form
under three CDP-forced pseudo-states (`CSS.forcePseudoState`, one session per
state), never hoped for from a pointer.

| Step | What it shows                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 01   | `/p/finance` with the «Заявки» link at the title's right edge (`href=/p/finance/requests`)                |
| 02   | the board — four columns, live cards in «Ждут», muted archives in «Проведены» / «Отклонены»               |
| 03   | the «Обязательства» tab — what BBM owes for spends from members' own money                                |
| 04   | the «Мои заявки» tab, EMPTY RESULT: the reader has filed nothing                                          |
| 05   | the details sheet of a submitted request — «Одобрить» / «Отклонить…» / the attach block                   |
| 06   | an APPROVED request with no document: no «Провести» at all, the gate Alert, and the attach form           |
| 07   | the refusal dialog — a reason is mandatory (EARS-512), so it is a modal and not a field beside «Одобрить» |
| 08   | the same dialog submitted empty — «Укажите причину отказа.» under the field                               |
| 09   | «Новая заявка» submitted empty — FOUR messages, each under its own field; no money-date message any more  |
| 10   | an ILLEGAL drag (a submitted card dropped on «Проведены») — nothing moves, the toast says why             |
| 11   | a MUTATION FAILURE (the act route forced to 500) — the error toast, and the sheet deliberately stays open |
| 12   | the loading skeleton, caught with the snapshot request held open — four column blocks, no layout jump     |
| 13   | the same URL as a reader with no finance role: the board is legitimately empty, no act control anywhere   |
| 14   | «Новая заявка» under CDP-FORCED `:hover`, `:focus-visible` and `:active` (desktop, both themes)           |
| 15   | after «Одобрить» — the success toast and the card now in «Одобрены — ждут документа»                      |
| 17   | after a refusal with a reason — the card in «Отклонены», carrying the reason and the decider              |
| 18   | after «Приложить документ» — the sheet STAYS open, the PDF reads inline, «Провести» is now one click away |
| 19   | after «Провести» — the toast «Операция проведена» and the card in «Проведены» with its ledger date        |
| 20   | a SEEDED posted request — the ledger operation and its postings instead of controls                       |
| 21   | «Новая заявка» with a real purpose — the card lands in «Ждут» and the toast says exactly that             |
| 22   | the proposal branch («Нет подходящего — предложу новое») — saved as a DRAFT, toast points at «Мои заявки» |
| 23   | the form with «Уже потрачено» UNCHECKED — no account, no date, and the form says who fills them in        |
| 24   | the same form with «Уже потрачено» TICKED — own-funds, «Счёт списания» and «Дата движения денег» revealed |
| 25   | the board carrying pre-spend cards: no date, no «уже потрачено» flag, the words «деньги ещё не двигались» |
| 26   | the pre-spend request's sheet — «вводится при проведении» in BOTH money fields, never «—»                 |
| 27   | «Провести» → the posting act's own dialog, empty: the account and the date it is about to assert          |
| 28   | the same dialog submitted empty — both refusals under their own field                                     |
| 29   | the dialog filled — «Банк RUB» and 2026-09-03, the act ready to run                                       |
| 30   | the SAME request after the act — «Счёт списания: Банк RUB», «Дата движения денег: 03.09.2026», operation  |
| 31   | the posting dialog's «Провести» under CDP-FORCED `:hover`, `:focus-visible` and `:active` (desktop, both) |

Steps 14 and 31 are set through one `CSS.forcePseudoState` CDP session per state
on the located element, never hoped for from a pointer.

**The journey the second pass drove**, in order, as one member-then-finance
story: file a pre-spend request (23 → 24 → 09 → 21), see it on the board and in
its sheet with no money facts (25, 26), file the proposal branch as a draft (22),
approve it, attach the receipt (18), open the posting dialog and be refused for
the facts it does not have (27, 28), fill them (29, 31), post (19), and read the
posted request back with the account and the date the ACT — not the request —
supplied (30). Steps 05, 06 and 20 were re-taken on seeded rows (#8 submitted,
#15 approved-without-document, #14 posted) because the sheet's field block
changed shape.

**DoD check (stage 5 point 5).** Every kept frame was reviewed. None is red,
error-stuck or skeleton-stuck; the only skeleton in the folder is step 12, where
it is the state being accepted. The honest artefacts, each re-observed live
before being written down:

- **Modal states are captured at the viewport, not full-page.** A sheet/dialog is
  `position: fixed`, so a full-page frame of one shows the overlay ending at the
  first viewport and the board unobscured below — a capture artefact, not the
  screen. Steps 05–09, 11, 18, 20, 23, 24, 26–31 are therefore viewport frames.
- **A sheet taller than the viewport is SCROLLED to the part being accepted**
  before the shutter: 23 and 24 to «Как оплачено» (that section IS the state),
  05/06/18/20 to the document block and the footer, 26/30 to the field grid.
  Nothing is cropped away that the state depends on; the sheet scrolls on the
  real screen exactly the same way.
- **Step 19's frame is full-page.** The board is longer than 900 px, and the act's
  outcome is a card that moved between two columns.
- **The inline PDF pane needs a real browser AND a moment.** In HEADLESS Chromium
  the `<object type="application/pdf">` falls back to its download link; this pass
  ran HEADED throughout. The first take of step 20 still showed an EMPTY pane —
  the shutter beat the plugin by ~700 ms. Re-observed live with a 3.5 s settle and
  the receipt renders in place, which is the frame kept. It is a capture artefact,
  not a product defect: the same document renders in 18 and 30.
- **Step 19 exists at desktop-light only.** Posting is a one-way transition on the
  fixture — a request posts once — so the act cannot be replayed per breakpoint.
  The state it LEAVES BEHIND (30) is captured at all four combinations.
- **At 390 px the two-column field grid truncates its values** («вводится при
  п…», «ООО «Мосарен…»). It is the `truncate` rule doing its job in a 2-column
  grid on a narrow sheet, and it is visible in 18/26/30-mobile — recorded here so
  the frames are not read as a rendering failure.

**Rows this run changed in `platform_388`** (recorded so the next reader is not
surprised). The second pass filed 10 requests through the form — five pre-spend
intents (one per capture combo plus a first take) and five proposal drafts — and
drove one of them, **#65**, end to end: approved, given `receipt-388.pdf`, and
posted with «Банк RUB» / 2026-09-03 (ledger operation #13). Nothing was deleted
afterwards and nothing was hand-edited in the DB: the board now reads 11 «Ждут» /
5 «Одобрены — ждут документа» / 8 «Проведены» / 5 «Отклонены», with 13 rows
carrying no money date at all. The first pass's own acts (#6 approved, #7 refused,
#14 given a document and posted) are still there. `core.member` carries the two
dev IdP logins from `pnpm platform:member:seed` — without a `core.member` row
every write act on this board is refused, and `pnpm dev:seed`'s registry of 64
people does not include `bbm-test@bbm.local`.

**A defect this pass found and did NOT promote a frame for.** «Новая заявка» can
dead-end silently: pick a purpose whose `product_binding` is `required`
(«Продажи курса», «Партнёрская программа», «Продажи встреч BBM») together with a
project that has no products («Фонд BBM»), and the «Продукт» select is not
rendered at all (`productOptions` is empty) while the schema still demands
`productId`. «Подать заявку» then does nothing, forever, with no message anywhere
on the form — the failing field has no `<FormMessage>` on screen to land in. It
reproduces on every combination of those three purposes with «Фонд BBM», and it
is not new to the money-facts revision. The capture used «Операционные расходы»
(`forbidden`) so the journey could proceed.

**The journey scripts are not committed** — they were bound to this seed dataset
and deleted with the run, the same call #434 and #437 made; `DEBT.md` already
tracks that every task re-implements this harness
(`2026-09-03-437-journey-harness`).

**The «1 Issue» badge in the earliest frames was the harness, not the app.** Next's
dev overlay counted one console error: a React hydration mismatch on
`<html lang="ru">` (`src/app/(platform)/layout.tsx:42`) whose only differing
attribute is `style={{color-scheme:…}}` — the value the capture script itself
writes onto `document.documentElement` to force the theme. A plain load of the
board raises no issue at all. Every frame hides the dev-only overlay so it cannot
be misread as a product error.
