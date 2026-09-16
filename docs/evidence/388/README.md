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

## 2026-09-14 — decisions 35/36, the two-role journey

A **SEVENTH pass**, and the first one driven as **two roles in one browser**:
owner decisions **35** (the requests TABLE is the default view for every
signed-in member; the kanban becomes a board toggle for `finance-approve`, which
also gets approve / refuse as row actions) and **36** (the «paid from a company
account» branch is offered — and accepted — only for a submitter holding
`finance-entry` or `finance-approve`), both taken by Антон on 2026-09-14 on
[#115](https://github.com/bbm-academy-org/bbm-portal/issues/115).

**The stand.** `http://localhost:3000`, the listener this session started from
`.claude/worktrees/388` on `feat/388-requests-board-blocks`; data from that
worktree's own branch DB `platform_388`, carrying everything the earlier passes
left in it. Driven with the **Playwright MCP tools** (`browser_run_code_unsafe`
with the scripts under the worktree's git-ignored `.playwright-mcp/`), signed in
through the real dev Zitadel. The password was read by the script from a
scratchpad file through a `file://` page read — the MCP code sandbox has no `fs`
— and never appeared in a tool call or in this repo.

**Two roles, logged out in between.** `bbm-member` (`platform-user` only) first,
then `Выйти` + a cookie and `localStorage` clear, then `bbm-test`
(`platform-user`, `platform-admin`, `finance-entry`, `finance-approve`). The
`localStorage` clear is part of the journey, not tidiness: the stored view is
per browser, and the second role must start from the DEFAULT the decision names.

**The matrix** is the folder's usual one: every state × 2 breakpoints
(desktop 1440×900, mobile 390×844) × 2 themes (light, and dark through the
theme's own `.dark` class — the workspace still ships no user-facing switch).
Next's dev overlay is hidden in every frame so it cannot be misread as a product
error.

| Step | What it shows                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 36   | `bbm-member` opens the route: the TABLE, «Мои» preselected, **no** board toggle and **no** row action anywhere           |
| 37   | the same reader on «Все» — 57 rows from 34 different submitters, i.e. the whole queue, not just their own                |
| 38   | a row opened into the details sheet: «Отозвать» and nothing else — no «Одобрить», no «Отклонить…», no «Провести»         |
| 39   | «Новая заявка» + «Уже потрачено» as a role-less submitter: the date, and **no** account picker and **no** own-funds box  |
| 40   | the crafted POST from that logged-in page: `403` with the decision-36 refusal, and `400` for the older EARS-508 clause   |
| 41   | `bbm-test` opens the SAME default: the table, «Мои» preselected — the toggle is beside it, the board is not rendered     |
| 42   | the approver on «Все»: 9 «Одобрить» and 14 «Отклонить…» row actions over the 57 rows, exactly on the actionable statuses |
| 43   | the board toggle pressed — the four columns are back, and a reload keeps them (`bbm.finance.requests.view` = `board`)    |
| 44   | _frames removed_ — «Одобрить» from a row on the PRE-wave-3 table; this head's frame of that act is **67**                |
| 45   | _frames removed by the eighth pass_ — the refusal `Dialog` is a sheet section now (**54**/**55**)                        |
| 46   | _frames removed_ — the refusal reason had its OWN column then; since `9bc2a51` it lives in the «Статус» cell (**69**)    |
| 47   | «Новая заявка» + «Уже потрачено» as a finance role: «Оплачено своими средствами» AND «Счёт списания» both present        |

Files: `<step>-<name>-{desktop,mobile}-{light,dark}.png`, 48 frames.

**What the numbers in 42 mean.** 9 + 14 is not 2 × 57: the acts follow the
status. `submitted` carries both «Одобрить» and «Отклонить…», `approved` carries
only «Отклонить…», and `posted` / `refused` / `draft` / `cancelled` carry none —
a terminal row is offered nothing rather than something the server would refuse.
`confirm` is deliberately not a row act at all: posting needs the confirming
document read and, for a pre-spend item, the money facts entered
(EARS-511/533), and neither is readable from a table row.

**Step 44 and step 45 act on the SAME request (#89)** — the member's own filing
from step 40's neighbourhood. The approve ran first and left it «Одобрена»; the
refuse then ran on it from the `approved` row and left it «Отклонена» with the
reason. That is a legal pair (EARS-524 allows `approved → refused`), and it is
why no separate «approved» row survives in the final frames.

**A defect this pass found and fixed, not a state it merely recorded.** Under
«Все», `bbm-member` first saw exactly ONE row — their own. The cause was in the
module, not the screen: `listIntakeItems` restricted a reader with no flow role
to their own items, so decision 35's «everyone sees every request in every
status» was a promise the endpoint did not keep and the «Все» tab was a lie.
`listExpenseRequests` now reads with the `every-member` audience; the widening is
that ONE list's, and it carries no documents with it — `listFinanceDocumentsByItems`
keeps its own restriction (EARS-523), so a role-less member still reads only the
documents of their own requests. Step 37 is the re-taken frame.

**Rows this pass changed in `platform_388`.** Request **#89** (filed by
`bbm-member` in an earlier pass) was approved and then refused with the reason
«#388 прогон решения 35 — отказ из строки таблицы». Nothing else was written:
the two form states end before a submit, and the crafted POSTs of step 40 were
both refused, so they created nothing. No ledger operation is this pass's.

**The top bar says «BBM Test» in the member frames too.** That is the dev IdP's
seed, not the app: `infra/dev-stand/idp/provision.sh` gives the seeded profile
`givenName: "BBM", familyName: "Test"`. The session really is `bbm-member` —
steps 36, 38 and 40 are exactly what proves it (no toggle, no act, `403` from
the endpoint), and the «Кто подал» column says «BBM Member» on their own row.

**The journey scripts are not committed** — they live in the worktree's
git-ignored `.playwright-mcp/` and were bound to this seed dataset, the same call
#434, #437 and the sixth pass made; `DEBT.md` already tracks that every task
re-implements this harness (`2026-09-03-437-journey-harness`).

## 2026-09-16 — wave 3, the register on the whitelist List block

**AN EIGHTH pass at head `6bb6d6c`** — wave 3, the rebuild the owner's «go» of
2026-09-15 ordered: `RequestsTable.tsx` and `LiabilityPanel.tsx` render through
`@/ui/refine-ui/data-table/data-table`, the block grew a `TableFooter`, the two
overlays that were `Dialog`s became SECTIONS of the details sheet, and «Подать
заявку» says why it is still grey. Every state whose picture that changed was
re-driven; the states whose shape no longer exists were REMOVED rather than kept
as a record of a screen that is gone (named below). The pass **did not finish
clean**: it found one blocking defect and three smaller ones, all listed under
«What this pass found».

**The stand.** `http://localhost:3000`, the lead's listener from
`.claude/worktrees/388` on `feat/388-requests-board-blocks` at head `6bb6d6c`;
data from that worktree's own branch DB `platform_388`, which has been RE-SEEDED
since the seventh pass — it now carries `pnpm dev:seed`'s 65 people in
`core.member` and 42 intake rows, of which **32 are expense requests** (5 draft,
9 submitted, 5 approved, 6 posted, 4 refused, 3 cancelled), one liability
(Ксения Панова, −7 800,00 RUB) and no leftovers of the earlier passes' acts.
Because the re-seed dropped them, `bbm-test` and `bbm-member` had **no
`core.member` row** and every write act answered `403` («у bbm-test@bbm.local
нет записи в общем реестре людей»); `pnpm platform:member:seed` put the two dev
IdP logins back, which is the documented step for this stand and not a product
finding. Driven with `@playwright/test` from the worktree, HEADED, signed in
through the real dev Zitadel as `bbm-test` (`finance-approve` + `finance-entry`)
and as `bbm-member` (`platform-user` only); the password was read from a
scratchpad file by the script through `fs` and never entered a tool call.

**The matrix** is the folder's usual one — every state × 2 breakpoints
(desktop 1440×900, mobile 390×844) × 2 themes (light, and dark through the
theme's own `.dark` class) — plus the primary control of each form and one
column sorter under three CDP-forced pseudo-states. Next's dev overlay is hidden
in every frame.

| Step | What it shows                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 03   | the «Обязательства» register, now the same List block, with its `TableFooter` total and the block's pager               |
| 11   | a forced `500` on the act route — the error toast, and the sheet deliberately stays open                                |
| 12   | the loading state, caught with the read held open — was the KANBAN's four-block skeleton (defect C); **re-taken below** |
| 36   | `bbm-member` opens the route: the table, «Мои» preselected, no board toggle, and the EMPTY state of that scope          |
| 37   | the same reader on «Все» — was «Заявок пока нет» over a 1 106 390,00 RUB footer (defect A); **re-taken below**          |
| 39   | «Новая заявка» + «Уже потрачено» as a role-less submitter: the date, and no account picker and no own-funds box         |
| 41   | `bbm-test` opens the same default: the table, «Мои», two rows, the totals row in TWO currencies; **re-taken below**     |
| 42   | the same reader on «Все»: was two rows and a refusal column no row filled (defect A/B); **re-taken below**              |
| 43   | the board toggle pressed — the four columns are back, 26 cards, the board's own one-row toolbar                         |
| 48   | «Сумма» sorted ASCENDING — the block's own arrow, and the rows really reordered (240,00 USD above 12 400,00 RUB)        |
| 49   | the same column DESCENDING                                                                                              |
| 51   | «Новая заявка» idle: «Подать заявку» disabled, its reason beside it («Заполните: …»), `aria-describedby` wired          |
| 52   | a MALFORMED «Сумма документа» («сто рублей»): the button stays LIVE, and pressing it delivers that field's FormMessage  |
| 53   | the details sheet opened by the row's named «Открыть» — the pre-spend pair says «вводится при проведении»               |
| 54   | «Отклонить…» → the refusal SECTION inside the sheet (it was a `Dialog` before wave 3), titled and described             |
| 55   | that section submitted empty — «Укажите причину отказа.» under the field                                                |
| 56   | «Провести» → the posting SECTION (also a `Dialog` before wave 3), idle, with the receipt readable above it              |
| 57   | the same section submitted empty — both refusals under their own field                                                  |
| 58   | the section filled — «Банк RUB · RUB» and 11.09.2026, the act ready to run                                              |
| 62   | «Подать заявку» under CDP-FORCED `:hover`, `:focus-visible`, `:active` (desktop, both themes)                           |
| 63   | the refusal section's «Отклонить заявку» under the same three                                                           |
| 64   | the posting section's «Провести» under the same three                                                                   |
| 65   | the «Сумма» column sorter under the same three                                                                          |

**The forcing of 62–65 is proved by diff, not asserted.** Each control was
resolved by a JS expression evaluated INSIDE the overlay on screen (the third
pass of this folder was caught forcing a button behind a dialog), an unforced
base was taken in the same context with the pointer parked at (4, 4), and each
forced frame was diffed against it. All 24 frames change pixels only inside the
control's own box (±8 px for the focus ring): 62 — 3158/1196/779 px light,
3226/1196/768 dark; 63 — 3853/1387/903 and 3763/1387/909; 64 — 2352/940/552 and
2392/940/543; 65 — 236/324/44 and 248/324/44. The parked pointer is part of the
method: the first run left the mouse where the reach step had clicked, the base
frame was ALREADY hovered, and 64's `:hover` diff came back 0 px — a frame that
would have been promoted as evidence of a state it never showed.

**Frames REMOVED, and why.** `04-tab-mine-*` — the «Мои заявки» TAB does not
exist; it is the «Мои» scope of the same table. `07-refuse-dialog-*`,
`08-refuse-dialog-error-*`, `45-approver-row-refuse-dialog-*`,
`27/28/29-posting-dialog-*`, `31-post-cta-*` — both `Dialog`s are gone, and the
frames of a modal that no longer renders are not evidence of this head; their
states are 54/55 and 56/57/58, and 31's CTA is 64's.
`42-approver-table-row-acts-*` — the state it asserted (9 «Одобрить» and 14
«Отклонить…» over the whole 57-row queue) is currently UNREACHABLE, see defect A.
`02-board-*` and `25-board-pre-spend-cards-*` — board frames on the pre-wave-3
toolbar; 43 is this head's board frame.

**What this pass found.** Four defects, each re-observed live in the DOM, not
read off a screenshot.

- **A — BLOCKING: «Все» never reaches the data provider.** The scope toggle
  changes nothing: `getList` is called only ever with
  `[{"field":"own","operator":"eq","value":true}]`, on mount and on every later
  re-fetch, so the register keeps showing the reader's OWN rows under both
  scopes. Instrumented live at head `6bb6d6c` by patching the served chunk's
  `getList` to record its arguments: mount → `own:true`, «Все» pressed → no new
  call, a sorter pressed → `own:true` again, «Мои» pressed → `own:true`. Two
  readers, same result. What the reader sees is worse than «nothing happened»,
  because the FOOTER does change: it is computed by the screen from its own
  `useCustom` snapshot, so under «Все» it sums the whole register
  («Итого 1 106 390,00 RUB / 240,00 USD») beneath two rows — and for
  `bbm-member`, beneath «Заявок пока нет» (step 37). The «Причина отказа»
  column appears for the same reason while no visible row carries a refusal.
  The board, reading the same snapshot, shows all 26 cards (step 43) — the data
  is there. Mechanism: `useTable` receives the scope as
  `refineCoreProps.filters.permanent`, and Refine's own `useTable` folds
  `permanent` into its filters STATE once, at mount (`setInitialFilters` inside
  `useState`); a later change of `permanent` never removes the entry already in
  state, and `unionFilters(permanent, filters)` keeps the mounted `own eq true`.
- **B — the register overflows its container at the design breakpoint.**
  Measured live at 1440×900: the table is **1214 px inside a 1110 px container**,
  so the trailing acts column is clipped — «Отклонить…» is cut mid-word and the
  row's named «Открыть», the only control wave 3 leaves for opening a request,
  is laid out at x 1291–1369 and never painted. The reader must scroll the table
  sideways on a full desktop. In the «Все» scope the refusal column adds 220 px
  more. Visible in every 41/42/48/49/65 desktop frame.
- **C — the loading state of the default view draws a BOARD.** Held the read
  open and measured: the screen renders its «Загружаем заявки» branch — five
  `Skeleton` blocks in `lg:grid-cols-4`, the kanban's — and no table, at both
  breakpoints (`RequestsBoardScreen.tsx`, the `query.isLoading` branch, and the
  route's own `loading.tsx`). The default view is the table, so the route paints
  four grey columns and then swaps the whole layout; on a phone that is four
  stacked 256-px blocks, over 1000 px of it. Step 12.
- **D — the empty register's second line is cut off at 390 px.** The block's
  `DataTableNoData` switches to `width: fit-content` + `translateX(-50%)` once
  the table overflows horizontally, and the description does not wrap, so it
  runs off BOTH edges of the 341-px scroll container: «ы подадите, появится
  здесь — включая черновики и от». Steps 36 and 37, mobile. The same cell is a
  hard-coded 490 px tall, which is a large void on this surface in every combo.

**Three observations that are NOT wave-3 regressions**, recorded so the next
pass does not re-discover them. The kit's `destructive` variant renders as a
pale tint with red text in light and a dark red with red text in dark, never the
stock solid fill — identical in the pre-wave-3 `07-refuse-dialog-*` frames this
pass deleted, so it is the theme, not this diff. The document picker still shows
the browser's own English «Choose File / No file chosen», truncated to «N…n».
And the «Контрагент» select opens on the sentinel «Нет в списке — впишу
нового», so a fresh form always renders «Новый контрагент» while the
disabled-submit reason simultaneously lists «контрагент» as unanswered.

**What could not be driven, and why.** Pagination past page 1, the status badge
in all six variants, the row acts over the whole queue, and the details sheet of
another member's request (the old step 38) all need the «Все» register to
actually render its 32 rows — defect A. They are the first thing to re-drive
once it is fixed. Steps 05, 06, 09, 10, 13–24, 26, 30, 32–35, 38, 40, 44, 46 and
47 were left as their own passes took them.

**Rows this pass changed in `platform_388`.** Two requests filed through the
form by `bbm-test` — **#43** (12 400,00 RUB, a pre-spend intent, then approved
and given `receipt-388.pdf` so the posting section is reachable) and **#44**
(240,00 USD, already paid from «Карта USD»); the second currency is deliberate,
so the totals row has more than one line to add up. Nothing else was written:
the refusal and posting sections were opened and cancelled, never submitted, and
the forced `500` of step 11 wrote nothing. No ledger operation is this pass's.
`core.member` gained the two dev IdP logins (`pnpm platform:member:seed`).

**The journey scripts are not committed** — they live in the worktree's
git-ignored `.playwright-mcp/` (`w3-lib.cjs`, `w3-capture.cjs`, `w3-prove.cjs`
and friends) and are bound to this seed dataset, the same call every earlier
pass made; `DEBT.md` already tracks that every task re-implements this harness
(`2026-09-03-437-journey-harness`).

**A NINTH pass at head `9bc2a51`** — the fix round of 2026-09-16, which answered
all four defects the eighth pass found: **A** `useTable` is remounted per scope,
so «Все» reaches the provider (`1cd49d0`); **B** the columns follow an explicit
1110 px plan — «Кто подал» is dropped under «Мои» and the refusal reason moved
INTO the «Статус» cell instead of taking a seventh column (`84f7b74`); **C**
`RequestsSkeleton.tsx` draws the table chrome the default view is loading
(`93ede37`); **D** the block's no-data cell wraps and holds no 490 px void
(`9bc2a51`). Everything defect A had blocked was driven for the first time on
this surface: the whole «Все» register for both readers, its second page, every
reachable status badge, the approver's row acts run to completion, and another
member's sheet.

**The stand.** `http://localhost:3000`, the lead's listener from
`.claude/worktrees/388` on `feat/388-requests-board-blocks` at head `9bc2a51`
(the fixes reached it through Fast Refresh); data from that worktree's own branch
DB `platform_388`, carrying what the eighth pass left in it — `pnpm dev:seed`'s
42 intake rows plus that pass's **#43** (12 400,00 RUB pre-spend, approved, with
`receipt-388.pdf`) and **#44** (240,00 USD), which is why the register counts
**34 records** and the footer has two currency lines. Driven with
`@playwright/test` from the worktree, HEADED, signed in through the real dev
Zitadel as `bbm-test` (`finance-approve` + `finance-entry`) and as `bbm-member`
(`platform-user` only); the password was read from a scratchpad file by the
script through `fs` and never entered a tool call. Harness:
`.playwright-mcp/w3c-capture.cjs` and `w3-prove.cjs`, both git-ignored.

| Step | What it shows                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 12   | the loading state of the DEFAULT view, the read held open — the table chrome, NO kanban columns, at 1440 AND at 390   |
| 36   | `bbm-member` on «Мои» — the empty register: both lines readable, and «Итого —», not a total over «нет заявок»         |
| 37   | the same reader on «Все» — 25 of 34 records from every submitter, «Кто подал» present, and «Открыть» the only act     |
| 38   | ANOTHER member's request opened from that register: the sheet is read-only — «Закрыть» and nothing else               |
| 41   | `bbm-test` on «Мои» — five columns (no «Кто подал»), the row whole, and the footer that equals those two rows         |
| 42   | the approver on «Все» — six columns, 25 rows, 9 «Одобрить» / 15 «Отклонить…» / 25 «Открыть», the reason in «Статус»   |
| 48   | «Сумма» sorted ASCENDING over the whole register                                                                      |
| 49   | the same column DESCENDING — 210 000,00 RUB on top                                                                    |
| 65   | the «Сумма» sorter under CDP-forced `:hover`, `:focus-visible`, `:active` (desktop, both themes), re-taken            |
| 66   | PAGE 2 of the «Все» register — the remaining 9 rows, and the badge «Проведена» that only lives there                  |
| 67   | «Одобрить» straight from a row (№32): the toast «Заявка одобрена», and the row really reads «Одобрена» on the re-read |
| 68   | «Отклонить…» straight from a row: the sheet opens ARMED with the refusal SECTION and its reason field                 |
| 69   | that refusal COMPLETED (№43): «Отклонена» plus its reason INSIDE the status cell, and no «Причина отказа» column      |

**Defect B, re-measured live at 1440×900 under BOTH scopes.** «Мои»: the table is
1110 px in a container whose `scrollWidth` is **1110 px** against a `clientWidth`
of **1110 px** — no horizontal scroll, and every row's «Открыть» is painted
inside the container (`allOpensPainted=true`). «Все», the wider six-column plan:
the same **1110 / 1110**, still `overflow=false`, still every «Открыть» painted.
The eighth pass measured 1214 px in 1110 px here. At 390 px the register still
scrolls sideways — 1094 / 341 under «Все», 952 / 341 under «Мои» — which is the
deliberate behaviour the surface announces in words above the table.

**Defect C, re-measured.** With the snapshot request held open, the
«Загружаем заявки» region carries `kanbanGrid=false`, `registerBox=true`, 10
`Skeleton` blocks and a height of 456 px, identically at 1440 and at 390: the
route now paints the chrome of the view that is coming, and swaps no layout.

**Defect D, re-measured at 390 px.** The empty register's cell is **224 px**
tall, not the hard-coded 490 px, and both lines read whole inside the 341 px
container — «Вы ещё не подавали заявок» and «Всё, что вы подадите, появится
здесь — включая черновики и отозванное.» (step 36, both themes). The «Все» scope
of the same reader is not empty on this fixture — it is the whole 34-record
register (step 37) — so the empty state exists in one scope only, which is the
truth of the data and not a gap in the matrix.

**The totals were checked by arithmetic, not by eye.** Under «Мои» the footer
reads «Итого 12 400,00 RUB / 240,00 USD» and the sum of the visible scoped rows
is exactly `{RUB 12 400,00, USD 240,00}` — the script adds the amount cells it
can see and compares. Under «Все» the footer reads «Итого 1 106 390,00 RUB /
240,00 USD» over 34 records across two pages. The eighth pass's worst symptom —
`bbm-member` reading «Заявок пока нет» above a 1 106 390,00 RUB total — is GONE:
that reader's empty «Мои» now carries «Итого —».

**Step 65 was re-taken; 62, 63 and 64 were not.** The column plan moved the
sorter, so its frames were of a layout that no longer exists; the three form CTAs
live in `RequestDetailsSheet.tsx` and the request form, untouched by the fix
round, so their frames stand. The re-take was proved the same way: hover /
focus-visible / active change **236 / 324 / 44 px** in light and **248 / 324 /
44 px** in dark, every changed pixel inside the sorter's own box (±8 px ring).

**Frames.** 48 promoted — 38 replacing a same-name predecessor (12, 36, 37, 38,
41, 42, 48, 49 at all four combinations, and the six 65 frames) and 10 new
(`66-table-page-two-*`, `68-row-refuse-armed-*`, `67-row-approve-done-desktop-light`,
`69-row-refused-reason-in-status-desktop-light`). 67 and 69 are desktop-light
only because each is a one-way act on this fixture. **Removed:**
`44-approver-row-approve-*` and `46-approver-row-refused-*` — both are the
PRE-wave-3 table, and 46 shows the «Причина отказа» column that this head no
longer has; their states are 67 and 69.

**What this pass found.** No blocking defect. One small one, re-observed live in
the DOM:

- **The «Деньги ушли» placeholder is truncated under «Все», with no tooltip.**
  At 1440 in the six-column plan the cell holding «ещё не двигались» (a pre-spend
  request, the normal state of a request before posting) needs 114 px and has
  102 px, so it renders «ещё не двига…»; the `div.truncate` carries no `title`,
  so the full words are nowhere on the screen. Under «Мои» (five columns) and for
  `bbm-member` under «Все» the same cell renders whole, so it is the acts column's
  share of the 1110 px budget. Steps 42, 48, 49, 66.

**Two observations that are NOT defects of this diff.** The sorter's `:active`
is barely perceptible — 44 changed pixels against 236 for `:hover` — which is the
kit's ghost-button treatment, identical before the fix round. And the details
sheet heads its document block «ДОКУМЕНТ — ЧИТАЕТСЯ ПРЯМО ТУТ» even for a reader
who may not read it, whose body then says «Документ виден подавшему заявку и
финансовой роли» (step 38); that copy predates wave 3. The three observations the
eighth pass recorded (the `destructive` tint, the browser's English file picker,
the «Контрагент» sentinel) are unchanged and were seen again in 68.

**The top bar says «BBM Test» in the member frames too**, as it has since the
seventh pass: `infra/dev-stand/idp/provision.sh` seeds both dev logins with the
same profile name. The session really is `bbm-member` — verified this pass
against `/api/auth/session`, which answers `platform-user` alone for it and the
four roles including `finance-approve` for `bbm-test` — and the frames prove it
on screen: no row act anywhere in 37, and a read-only sheet in 38.

**Rows this pass changed in `platform_388`.** Two acts, both from a table row:
**#32** approved (step 67) and **#43** refused with the reason «Нет
подтверждающего документа» (step 69). Nothing else was written — 68 opens the
refusal section and closes it, and the read-only steps write nothing. No ledger
operation is this pass's. Frames taken BEFORE 69 (12, 41, 42, 48, 49, 66, 67, 68)
show #43 still «Одобрена»; that is the chronology of the run, not a
disagreement.
