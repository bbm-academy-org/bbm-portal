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

**A THIRD, narrow pass at head `3a08136`** re-drove four states in place, after
the review round that produced `fa09f96` (the impossible product is said, not
swallowed) and `3a08136` (the sheet says the state whole at 390 px): **26** and
**30** because the field grid now collapses to one column below `sm` and wraps
instead of truncating; **31** because the previous take forced the pseudo-states
on the WRONG node — the sheet's «Приложить документ», sitting behind the dialog —
and the CTA that was being accepted was never lit; and **32**, new, for the
refusal the silent dead-end became.

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
| 32   | «Продажи курса» on «Фонд BBM» — the product field DISABLED with its reason, and the refusal on submit     |

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
- **The 390 px clipping of the field grid is GONE as of `3a08136`.** The block is
  one column below `sm` and the value WRAPS; 26- and 30-mobile now read «вводится
  при проведении» and «Банк RUB» / «03.09.2026» whole, and the desktop half of the
  same clipping (#473 item 3 — «Операционные …») is gone with it, because
  `truncate` was the single cause of both. The earlier note in this file said the
  truncation was the rule doing its job; it was the bug, and these frames are the
  ones that replace it.
- **Step 31 was forced on the WRONG NODE the first time.** `DOM.querySelector`
  from the document root matched the SHEET's «Приложить документ» — still in the
  DOM behind the dialog — so three frames were promoted in which nothing inside
  the dialog changed. The retake resolves the node in two hops
  (`[data-slot="dialog-content"]` → `[data-slot="dialog-footer"] button[type="submit"]`,
  one CDP session per state) and then PROVES it by diffing each frame against the
  unforced base: every changed pixel falls inside the CTA's own box
  (x 810.7–896.0, y 576.5–608.5 at 1440×900) — hover 2304/2361 px, focus-visible
  928 px in a ring 4 px outside the box, active 664/658 px, light/dark. Nothing
  changed anywhere else on the screen, which is the assertion the first take could
  not make.
- **Steps 27–29 were re-observed live at desktop-dark and NOT re-taken.** The
  dialog's «Провести» is the filled primary (`data-variant="default"`) and
  «Отмена» the outline, in both themes — the frames on file already show that.

**Rows the THIRD pass changed in `platform_388`.** Two, both through the UI:
**#16** (seeded, approved, already carrying its own money facts) was POSTED — the
first attempt at step 31 used it, and an approved request that already knows its
account and date posts straight from «Провести» with no dialog at all, which is
`postingActNeedsMoneyFacts` working exactly as written. **#69** (a pre-spend
intent of the second pass) was approved and given `receipt-388.pdf` twice — the
attach block stays available after a document is attached, so the second theme's
run added a second copy; it is visible in the sheet BEHIND the dialog in
`31-*-dark`. Neither touches the states being accepted. Step 32 filed nothing:
the form is refused, which is the point.

**Rows the second pass changed in `platform_388`** (recorded so the next reader is not
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

**The defect the second pass found is FIXED, and step 32 is its frame.** «Новая
заявка» used to dead-end silently: a purpose whose `product_binding` is `required`
(«Продажи курса», «Партнёрская программа», «Продажи встреч BBM») on a project with
no products («Фонд BBM») removed the «Продукт» select entirely (`productOptions`
was empty) while the schema still demanded `productId`, so «Подать заявку» did
nothing and said nothing. Since `fa09f96` the model answers the question itself
(`productFieldMode`) and the field STAYS on the form in its empty state — a
disabled select reading «У проекта нет продуктов» plus the reason — which is where
the refusal now lands. Step 32 drives exactly that pair, submits, and shows the
form still open with the message under the field, at both breakpoints and both
themes.

**One observation on step 32, not a defect.** The sentence «Это назначение требует
продукт, а у проекта «Фонд BBM» нет продуктов — выберите другой проект или другое
назначение.» is on screen TWICE after the submit: once as the field's
`FormDescription` (there before the submit, in muted text) and once as its
`FormMessage` (in destructive red). That is the deliberate consequence of
`productEmptyMessage` being one string used in both places, and it reads as
emphasis rather than as an error; it is recorded here so the frame is not read as
a double-render bug.

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
