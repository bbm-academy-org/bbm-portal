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

| Step | What it shows                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 01   | `/p/finance` with the «Заявки» link at the title's right edge (`href=/p/finance/requests`)                          |
| 02   | the board — four columns, live cards in «Ждут», muted archives in «Проведены» / «Отклонены»                         |
| 03   | the «Обязательства» tab — what BBM owes for spends from members' own money                                          |
| 04   | the «Мои заявки» tab — the reader's own filings, including the drafts and the withdrawn                             |
| 05   | the details sheet of a submitted request — «Одобрить» / «Отклонить…» / the attach block                             |
| 06   | an APPROVED request with no document: no «Провести» at all, the gate Alert, and the attach form                     |
| 07   | the refusal dialog — a reason is mandatory (EARS-512), so it is a modal and not a field beside «Одобрить»           |
| 08   | the same dialog submitted empty — «Укажите причину отказа.» under the field                                         |
| 09   | «Новая заявка» submitted empty — FOUR messages, each under its own field; no money-date message any more            |
| 10   | an ILLEGAL drag (a submitted card dropped on «Проведены») — nothing moves, the toast says why                       |
| 11   | a MUTATION FAILURE (the act route forced to 500) — the error toast, and the sheet deliberately stays open           |
| 12   | the loading skeleton, caught with the snapshot request held open — four column blocks, no layout jump               |
| 13   | the same URL as a reader with no finance role: only their OWN card, and no approve / post / refuse control anywhere |
| 14   | «Новая заявка» under CDP-FORCED `:hover`, `:focus-visible` and `:active` (desktop, both themes)                     |
| 15   | after «Одобрить» — the success toast and the card now in «Одобрены — ждут документа»                                |
| 17   | after a refusal with a reason — the card in «Отклонены», carrying the reason and the decider                        |
| 18   | after «Приложить документ» — the sheet STAYS open, the PDF reads inline, «Провести» is now one click away           |
| 19   | after «Провести» — the toast «Операция проведена» and the card in «Проведены» with its ledger date                  |
| 20   | a SEEDED posted request — the ledger operation and its postings instead of controls                                 |
| 21   | «Новая заявка» with a real purpose — the card lands in «Ждут» and the toast says exactly that                       |
| 22   | the proposal branch («Нет подходящего — предложу новое») — saved as a DRAFT, toast points at «Мои заявки»           |
| 23   | the form with «Уже потрачено» UNCHECKED — no account, no date, and the form says who fills them in                  |
| 24   | the same form with «Уже потрачено» TICKED — own-funds, «Счёт списания» and «Дата движения денег» revealed           |
| 25   | the board carrying pre-spend cards: no date, no «уже потрачено» flag, the words «деньги ещё не двигались»           |
| 26   | the pre-spend request's sheet — «вводится при проведении» in BOTH money fields, never «—»                           |
| 27   | «Провести» → the posting act's own dialog, empty: the account and the date it is about to assert                    |
| 28   | the same dialog submitted empty — both refusals under their own field                                               |
| 29   | the dialog filled — «Банк RUB» and 2026-09-03, the act ready to run                                                 |
| 30   | the SAME request after the act — «Счёт списания: Банк RUB», «Дата движения денег: 03.09.2026», operation            |
| 31   | the posting dialog's «Провести» under CDP-FORCED `:hover`, `:focus-visible` and `:active` (desktop, both)           |
| 32   | «Продажи курса» on «Фонд BBM» — the disabled product field: the FACT in its description, the instruction on submit  |
| 33   | «Продажи курса» with NO project yet — the «Продукт» field is not on the form at all, and no project is blamed       |
| 34   | a LEGAL drag in flight — «Одобрены» carries the drop treatment and no text is selected (desktop)                    |
| 35   | the act that drop opened — «Одобрить» in the sheet; «Ждут» still holds 9 cards, so nothing moved by itself          |

Steps 14 and 31 are set through one `CSS.forcePseudoState` CDP session per state
on the located element, never hoped for from a pointer. Steps **34 and 35 are
desktop-only**, and that is the nature of the state rather than a gap in the
matrix: a native HTML5 drag needs a pointer that presses and travels, which a
touch screen does not give. The board never depended on it — every act the drag
opens also lives in the sheet, reachable by tap and by keyboard.

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

**A FOURTH pass at head `1ff67ad`** re-took step 32 in place and added step 33,
after the review round that produced `95c6b1a` (the product field states only what
the member's choices make true). The earlier note in this file said the empty-product
sentence being on screen TWICE after the submit was deliberate emphasis; it was the
bug (#473 item 7), and these frames replace it. Each slot now carries its own half:
the `FormDescription` says the FACT — «У проекта «Фонд BBM» нет продуктов.» in muted
text, present before the submit — and the `FormMessage` says what to do about it —
«Это назначение требует продукт, а у проекта «Фонд BBM» нет продуктов — выберите
другой проект или другое назначение.» in destructive red, only after «Подать заявку».
Re-observed in the DOM at all four combinations: the two slots hold different
strings, neither of them repeated. Step 32's frames also fill the amount and the
counterparty, so the product refusal is the ONLY red left on the form.

**Step 33 is the state the same round created.** `productFieldMode` returns `hidden`
while no project is chosen — «у проекта X нет продуктов» is a statement ABOUT a
project, and there is none yet — and the schema stops raising a product refusal
there too, because «Выберите проект.» is the whole answer. The frames show «Продажи
курса» picked with «Выберите проект» still on its placeholder and NO «Продукт» field
anywhere on the form. Picking «Фонд BBM» turns it into step 32 immediately: both
states were driven in that order, in one run, at all four combinations.

**A FIFTH pass at head `84dbd30`** re-drove the surfaces the BOARD READ paints,
after the pool deadlock that wedged `GET /p/finance/api/requests` at `6291a7a`
was fixed (`8d31a30` — one batched documents query on the transaction's own
executor, plus an explicit pool ceiling). The read was measured live before the
shutter: **200 in 62–163 ms** on three consecutive reloads and **35–93 ms** on two
tabs loading at once; no skeleton stuck, no request outstanding. Re-taken in place
at all four combinations: **02**, **03**, **04**, **05**, **06**, **12**, **13**,
**20**, **25**, **26**, **30** — every state whose picture the board read draws.
Nothing else was driven: the acts, the forms and the dialogs (07–11, 14–19, 21–24,
27–29, 31–33) were left as their own passes took them, and no row in `platform_388`
was changed by this pass.

**Step 04 lost the word «empty», and the files were renamed with it.** The tab is
`04-tab-mine-*` now, not `04-tab-mine-empty-*`: `bbm-test` has filed through this
form since the first pass, so «Мои заявки» legitimately lists its own requests and
the empty result is no longer reachable on this fixture without a fresh user. The
frame shows what the tab actually renders — the table of the reader's filings with
their statuses — which is the state that exists.

**A SIXTH pass re-took step 04 alone**, at the head that fixes the defect the
stage-5 UX sanity pass found in it. At 390 px the kit's `TableCell` default
(`whitespace-nowrap`) met the one free-text column: «Что» measured 543 px of a
968 px table inside a 343 px scroll container, so Сумма, Статус and the row's
«Открыть» were ~600 px to the right of the frame. The note now wraps and is
capped, the table keeps a `34rem` floor, and below `sm` a line says the rest is
to the right — 968 px → 544 px. Only **04** was re-driven; **03** measures
343 px in the same 343 px container and never overflowed, so its frames are
untouched.

**A SEVENTH pass at head `f7ff3c1`** — `d2ca78b` merged with `main` (`0a1c402`) —
drove the WHOLE matrix, states 01–33, end to end at all four combinations,
because the previous two passes had re-driven only what the BOARD READ paints
(02–06, 12, 13, 20, 25, 26, 30) while the WRITE flows still stood on `6291a7a`
or earlier. Every frame in this folder is from this pass. What «end to end»
means here, per combination: file a pre-spend intent through the form (23 → 24
→ 09 → 21), read it back with no money facts (26), approve it (15), attach
`receipt-388.pdf` (18), be refused by the posting dialog for the facts the
request does not have (27, 28), fill them (29, 31), post (19), and read the
posted request back with the account and the date the ACT supplied (30) — plus
the proposal draft (22), the two product-field states (32, 33), the refusal
dialog and its empty submit (07, 08), the illegal drop (10), the forced
mutation failure (11), the held-open skeleton (12) and the CTA pseudo-states
(14). Four requests were driven the full length, one per combination: **#82**
(desktop-light), **#84** (desktop-dark), **#86** (mobile-light), **#88**
(mobile-dark) — each approved, given the receipt, and posted with «Банк RUB» /
2026-09-08, producing ledger operations **#16–#19**.

**Every act was observed live, not inferred from a screenshot.** The board moved
each time: the filed card landed in «Ждут» (1), the approved one in «Одобрены —
ждут документа» (1), the posted one in «Проведены» (1); the illegal drop left
«Ждут» at 8 cards before and after and opened no sheet; the forced 500 left the
sheet open. The refusal act ran once, on `[seed:req-submitted-09]` (#32), with
the reason «Нет подтверждающего документа и бюджета на квартал.» — steps 07 and
08 are non-mutating and were driven at all four combinations.

**API timings, measured on this head across the four runs.** `GET
/p/finance/api/requests` — n=137, 28–163 ms in the steady state; the single
2.8 s reading in each run is step 12's deliberately held request. `POST
/p/finance/api/requests` 201 in 54–99 ms, `POST …/actions` 200 in 71–105 ms,
`POST /p/finance/api/documents` 201 in 50–123 ms, `GET
/p/finance/api/documents/<id>` 200 in 1–51 ms. Nothing took over 10 s, nothing
stayed pending, and the only non-2xx in the whole matrix is the 500 the harness
itself forces for step 11.

**Step 31's forcing was proved by diff again, and the assertion is narrowed by
four pixels.** Each forced frame was diffed against an unforced base of the same
screen: in DARK every changed pixel falls inside the CTA's own box (x 812–894,
y 577–608) — hover 2458 px, focus-visible 1078 px, active 2585 px. In LIGHT the
same three frames change **four** pixels outside it, and only four: the corner
antialiasing of the «Счёт списания» field's rounded border at (551,464),
(888,464), (551,494) and (888,494), identical in all three frames and therefore
a property of the base, not of the forcing. Everything else — 2470 / 1094 /
2589 px — is inside the CTA. The earlier «every changed pixel» wording is
replaced by this count.

**The defect this pass found, and FIXED: «Новая заявка» scrolled sideways at
390 px.** The journey measured it live in the DOM, before and after a submit:
the sheet's `clientWidth` was 277 px while its `scrollWidth` was 299 px, because
the «Назначение» `SelectTrigger` and its label had an intrinsic width of
281–283 px and ended at x=398 — 8 px past the 390 px viewport, so the form
carried a horizontal scrollbar and the select's chevron sat off-screen. It was
NOT a regression of this head: the frames the fourth and fifth passes left on
file show the identical strip.

It was then fixed in this PR, test-first, in two RED → GREEN pairs — `266082f`
→ `1010fb4` (`min-w-0` on every `SelectTrigger` of the surface, so the grid
column stops taking the longest option's min-content as its floor) and
`232c397` → `c87c89a` (the currency cell takes `6rem` below `sm`, so «Сумма
документа» keeps a usable width once the sheet no longer grows). **After the
fix, measured on the same live stand at 390×844:** the sheet's `scrollWidth` is
**277 px == its `clientWidth`, 277 px**, the «Назначение» trigger's right edge
is at x=359 instead of x=398, and the «Сумма документа» input measures 137 px
instead of 88.5 px. Frames `09`, `23`, `24`, `32` and `33` were re-driven on the
fixed head and replaced in place at both breakpoints and both themes; every one
of those captures asserts `scrollWidth <= clientWidth` before it shoots, and the
run log for each of the four combinations prints the measurement it asserted.

**Two defects the owner's own pass on the live stand found, and both FIXED
here.**

- **Dragging a card «only selected text».** The drag machinery was correct — a
  raw-pointer drag «Ждут» → «Одобрены» fires `dragstart`, the column's
  `dragover` calls `preventDefault`, the drop lands and the approve act opens.
  What the owner met was the rest of the board: Chromium suppresses text
  selection only INSIDE a `[draggable="true"]` subtree, so every card the
  reader cannot drag — the two archive columns, and every card at all for a
  reader without `finance-approve` — answered a press-and-drag by selecting its
  own body. Measured before the fix: a «Проведены» card read `user-select: auto`
  and a drag attempt on it selected «… · Фонд BBM / операция в реестре ·
  08.09.2026 …», while the «Ждут» card beside it read `none` and dragged.
  `select-none` now sits on the card unconditionally. The same report's other
  half — a native drag paints a ghost and gives the TARGET nothing, so a drag
  that works looks like one that does not — is answered by states **34** and
  **35** below. RED → GREEN: `46b197b` → `8af6db5`.
- **«Новый контрагент» was asked even when one was picked from the reference.**
  EARS-508/532 asks for ONE counterparty, «picked from the reference or created
  inline»; the free-text field stood under the select unconditionally, and
  nothing on the screen said which of the two would be filed. It is now
  rendered only while the select stands on «Нет в списке — впишу нового»,
  `toRequestBody` drops the free text whenever a reference id is set (for BOTH
  exclusive pairs — an unrendered field keeps its value), and the API gained
  the refusal its purpose pair already had: a body naming both was accepted and
  `resolveRequestCounterpartyId` preferred the NAME, filing against a
  counterparty the member never picked. RED → GREEN: `1061aec` → `4a6a254`.
  Visible in the re-taken `32` frames: «Контрагент: Yandex Cloud» with no
  free-text field beneath it.

**Step 13 changed meaning, deliberately.** `bbm-member` reads `canApprove:false,
canEnter:false` but the reference tables come back full, and filing is NOT gated
by the finance roles — the member filed a request through the form and the
endpoint answered `201`. So «Новая заявка» being on that screen is the contract,
not a leak, and the state worth accepting is not «empty» but «the reader sees
only their OWN card and none of the approver's acts». The frames were re-taken
after that probe and show exactly that: one card in «Ждут», and no «Одобрить» /
«Провести» / «Отклонить…» anywhere.

**A SIXTH pass** — the one that answers the owner's two live-stand reports and
the review's evidence blocker — re-drove `09`, `23`, `24`, `32`, `33` at BOTH
breakpoints and both themes on head `348d1aa`, and drove the two new drag
states `34` / `35`. It filed nothing: the form states end in a refusal and the
drag ends in an act that was closed, not run, so the row list below is
unchanged by it.

**Rows this pass changed in `platform_388`.** Eight requests filed through the
form — four pre-spend intents (**#82, #84, #86, #88**, all approved, documented
and posted) and four proposal drafts (**#81, #83, #85, #87**) — plus **#79** and **#80**,
filed by an aborted first attempt of the desktop-light run (#80 was carried to
«Проведены» by it), **#32** refused,
and one request filed by `bbm-member` while probing the paragraph above. Ledger
operations **#16–#19** are this pass's. Nothing was hand-edited in the database
and nothing was deleted.

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
