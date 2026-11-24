---
status: Draft
issue: 584
updated: 2026-11-24
---

# Finance — BBM budget dashboard: burn, runway, waterline — spec (issue #584)

- **Issues:** #584 (this spec) under #587 «project budget burn dashboard», a
  sub-issue of epic #115. #584 blocks #585 (the chart and KPI-tile element
  class for the whitelist — the visual language) and #586 (the build). #586 is
  also blocked by #583 (real posted data) and depends on #593, which builds the
  spec 338 §D read model this screen renders.
- **Product source:** `docs/product/finance/340-product.md` → «BBM's budget» and
  «Budget dashboard (#584)» (US-21…US-30). The owner's requirements of
  2026-11-24 (session, relayed on #584/#587) are the input; #581's comments
  carry the budget decisions §D encodes.
- **Why a new spec file and not an amendment of 340:** F3 (#340) has no spec in
  `docs/specs/` yet — only its product draft — and this is a narrowed slice of
  it that ships on its own. `docs/specs/README.md` names a spec after its issue,
  #586's `## Spec reference` declares «the dashboard spec from #584», and the
  figures it reads are owned by spec 338 §D, which is not re-opened here except
  for the one amendment note named in §G. The product text, by contrast, is an
  amendment of `340-product.md`, so the F3 user stories keep one home.

## Why

The owner asked for classic management reporting on BBM's budget: how much has
been spent, where the money went, and what the spending dynamic is — the budget
glass, contributed versus spent, monthly burn, a trailing average, the runway in
months against the remaining limit, the cumulative net result («waterline»)
with the contributions overlaid, and spend by project, category and
counterparty down to the operations. Every number already has a definition in
spec 338 §D; this spec fixes the screen that shows them, how each widget maps
onto a §D figure, the period and currency controls, the states, and the limit
form EARS-339 placed on this surface.

## Prior decisions

- **Spec 338 §D, EARS-335…345** (`docs/specs/338-ledger-core.md`) — the only
  source of every figure here: the budget cost-basis replay (EARS-340), spent
  (EARS-341), remaining (EARS-342), contributed / income / owed to members /
  cash at cost (EARS-343), the reconciliation (EARS-344), the per-project lines
  (EARS-345); the limit record and its `finance-approve` gate (EARS-338/339).
  This spec groups and buckets §D's per-item values; it defines no new cost,
  rate or valuation.
- **Spec 338 EARS-325** — the recorded pair-rate graph behind the `/p/finance`
  «Итого» and its reporting-currency switch; reused, not re-implemented, by §G.
- **Spec 339 §A, EARS-530 / decision 32** — every finance reading is open to
  every signed-in member; **EARS-532** — the counterparty is a reference on the
  intake item; **EARS-552/553** — the Bank of Russia rate store and its
  isolation, narrowed by §D for the provisional value alone (not widened here).
- **ADR-002 §3** — finance is a module with one public API
  (`src/lib/finance/index.ts`); the read model that buckets and groups lives in
  the module, the route only renders it. **ADR-004 §6** — no route imports a
  table file. **ADR-005 §2** — a page that computes over live data is a portal
  module.
- **Spec 311 EARS-416/418** — the `platform-user` workspace gate and the bare
  403 for a session without it; **spec 201** — every limit change is an audited
  `platformTransaction` write, so no budget history table exists.
- **Owner decisions 13, 14, 18** (`docs/product/finance/brief.md`,
  `340-product.md`) — reporting currency switchable, RUB by default; cash basis
  stays the reading (accrual deferred); cross-currency amounts use recorded
  facts, never a read-time market rate.
- **`.claude/rules/design-process.md` §1** — composition, grouping, states and
  feedback are the agent's and are recorded below; the visual language of the
  charts is the owner's and arrives through #585.

**Platform-primitive cross-check:** limit history → `core.audit_event` (spec
201), no new table; who may set the limit → the `finance-approve` flow role
(spec 339 §A, EARS-339), no new role; who may read → the `platform-user` gate
(spec 311 EARS-416); currency translation → the EARS-325 graph; drill-down links
→ the request source link the queue already renders (spec 339 EARS-542). No
table, role, rate source or audit trail is added.

**Donor & benchmark pass:** gross burn (total spend per month), net burn (spend
less operating income, financing excluded) and runway (a reserve divided by net
burn, usually over a trailing three-month average to smooth lumpy months) are
the standard start-up reporting definitions; they are applied unchanged except
for one owner choice: the runway's reserve is the **remaining limit**, not the
cash balance — money is contributed as needed (#581), so cash is not what runs
out. A contribution is financing and never enters net burn, as it never enters
income (§D, IFRS Conceptual Framework reasoning cited there). No owner question
below asks what this answers.

## Current behavior → replacement delta

Today `/p/finance` renders the cash card (EARS-325) and two header links,
«Курс против рынка» (`/p/finance/reports/market-rate`, spec 339 EARS-564) and
«Заявки». No budget exists anywhere: §D is specified and merged but not built
(#593). This spec adds one route, `/p/finance/reports/budget`, and one header
link beside «Курс против рынка»; no existing surface changes.

## Composition (agent's decision, recorded)

The screen answers three questions in this order, and the order is the
hierarchy: **how much is left** (dominant), **where the cash stands**, **how fast
it goes and where it went**.

| Tier              | Block                                                                                                                                                                                                                       | Chart form (input to #585)                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header            | Title «Бюджет BBM», the budget's name, currency and start date, the moment computed; the reporting-currency switch; the limit action for `finance-approve`                                                                  | —                                                                                                                                                                                            |
| 1 — dominant      | **The glass**: limit, spent, remaining, share used; beside it **runway** in months with the average it divides by                                                                                                           | **F1** fill gauge / bullet bar with an overflow state (spent past the limit); **F2** KPI tile                                                                                                |
| 2 — money         | **Contributed vs spent**: contributed, spent, owed to members, cash at cost, income; the reconciliation line                                                                                                                | **F2** KPI tiles in one row + a one-line equation                                                                                                                                            |
| 3 — dynamics      | **Monthly burn** (gross and net per month, the trailing average) and **the waterline** (cumulative net result, cumulative contributions, the −limit level); the period selector sits on this tier and governs tiers 3 and 4 | **F3** monthly columns, two series, negative values allowed, with a line overlay; **F4** cumulative line with a zero baseline, a negative region, a second step series and a reference level |
| 4 — where it went | **Breakdown** with three tabs — project · category · counterparty — each with the exchange-result line; a line opens its operations                                                                                         | **F5** ranked horizontal bar list (label, value, share); the drill-down is the whitelist's settled data-table block in a sheet                                                               |

Grouping rationale: tiers 1–2 are cumulative since the budget started and do
not move with the period selector; tiers 3–4 are period readings, so the
selector is placed on tier 3, not in the header, where it would read as
governing the glass. The limit form opens in a sheet from the header, beside the
figure it governs (EARS-339), and is the kit's settled Form block. Each of F1–F5
also needs its withheld and provisional rendering (EARS-719/720); how any of it
looks is #585's whitelist row and the owner's Stage-A pick — this spec fixes
forms and data only, and names no colour, font or library.

**Design-source:** the covering provenance row for `src/app/(platform)/p/finance/**`
is `finance/Overview.dc.html` at `fidelity: wireframe`. No new row is written
here: #585 supplies the chart element and the owner's visual pick, and #586's PR
carries the design-fidelity record that the pick produces.

## Widget → figure map

Every value below is produced by the finance module's budget read model (#593
plus the grouping of EARS-702) and only rendered by the route. «Window» is
`[starts_on, today]` for tiers 1–2 and the selected period clipped to it for
tiers 3–4 (EARS-715).

| Widget                         | Figure                                                                                            | Source             |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------ |
| Limit                          | the unretired budget's amount in `B`                                                              | EARS-338           |
| Spent                          | Σ expense values + exchange results, window since `starts_on`                                     | EARS-341           |
| Remaining                      | limit − spent, negative allowed                                                                   | EARS-342           |
| Share used                     | spent ÷ limit, as a percentage                                                                    | EARS-706           |
| Runway                         | remaining ÷ trailing average net burn                                                             | EARS-707, EARS-712 |
| Contributed / income           | windowed `equity` / `income` credits at cost                                                      | EARS-343           |
| Owed to members / cash at cost | all-time balances at cost                                                                         | EARS-343           |
| Reconciliation                 | contributed + income = spent + cash at cost − owed                                                | EARS-344, EARS-709 |
| Monthly gross / net burn       | EARS-341 items and income bucketed by `occurred_on` month                                         | EARS-710           |
| Trailing average               | mean net burn of the last ≤ 3 complete months                                                     | EARS-712           |
| Waterline                      | running Σ (income − gross) per month end; running Σ contributed                                   | EARS-713           |
| Breakdown lines                | EARS-341 part (a) values grouped by project / category / counterparty, + one exchange-result line | EARS-345, EARS-716 |
| Drill-down rows                | the operations behind one line, each with its value                                               | EARS-718           |

## Requirements

Ids continue the flat corpus keyspace: this spec takes the next free
hundred-block, **EARS-701…** (spec 553 holds 601–615). `B` is the budget's
currency (spec 338 EARS-340); «today» is the Moscow calendar date, as in spec
339 EARS-550.

### A. Surface and access

- **EARS-701.** WHEN any signed-in platform member opens
  `/p/finance/reports/budget` «Бюджет BBM», the page shall render the budget
  dashboard; the `/p/finance` header shall link to it beside «Курс против
  рынка». No finance role shall be needed to read it (decision 32, spec 339
  EARS-530, spec 338 EARS-339), and a request without `platform-user` shall be
  refused by the module's own handlers exactly as EARS-325 prescribes for
  `/p/finance`.
- **EARS-702.** Every number on the page shall be a spec 338 §D figure
  (EARS-340…345) or a sum, bucket or ratio of §D's per-item values as this
  spec defines it, computed by the finance module's public API (ADR-002 §3) in
  one replay per page read and stored nowhere. The route shall compute no
  figure, read no posting and import no table file (ADR-004 §6), and no
  bucket or group shall re-value an item: a value enters a month, a line or a
  drill-down row exactly as the replay produced it.
- **EARS-703.** The header shall show the budget's name, its currency `B`, its
  `starts_on`, and the moment the reading was computed (US-14). WHILE any
  shown figure includes a provisional value (EARS-719) and EARS-552's
  staleness condition holds, the header shall also say the Bank of Russia
  rates are stale and from which date.
- **EARS-704.** IF no unretired budget exists, THEN the page shall show no
  figure, chart or breakdown — every §D figure is defined against a budget —
  and shall say «Бюджет не задан»; a `finance-approve` session shall get the
  create action of EARS-724 there, and any other session the sentence that the
  limit is set by the `finance-approve` role.
- **EARS-705.** IF a budget exists and no operation counts in the window, THEN
  every figure shall show zero and the page shall say «С <starts_on> операций
  нет» rather than leave a blank that could mean «not loaded» (340-product,
  «An empty period»).

### B. The glass and the runway

- **EARS-706.** The glass shall show the limit (EARS-338), spent (EARS-341),
  remaining (EARS-342) and the share used, spent ÷ limit as a percentage with
  one decimal. WHEN spent exceeds the limit, remaining shall be shown negative
  and the glass shall show the overflow past the limit — never clipped at full.
  The limit and the fact shall be labelled as plan and fact and never summed
  into one figure (decision 14, US-17).
- **EARS-707.** Runway shall be remaining (EARS-342) divided by the trailing
  average net burn (EARS-712), in months, computed exactly as
  `remaining × N ÷ Σ net burn of those N months` and shown with one decimal,
  rounded toward zero, beside the average it divides by and «за N мес.». IF
  remaining is zero or negative, THEN runway shall read «лимит исчерпан». IF
  the average is zero or negative, THEN runway shall read «расход не
  сокращает остаток» with no number. IF no complete month exists yet, THEN
  runway shall read «нужен хотя бы один полный месяц» with no number. Runway
  shall not depend on the period selector.

### C. Contributed vs spent (cash)

- **EARS-708.** The money tier shall show contributed, income (even while
  zero), owed to members and cash at cost exactly as EARS-343 defines them,
  beside spent; cash at cost shall carry the label «по себестоимости» and owed
  to members its provisional mark per EARS-343. WHERE a line needs «paid out»,
  it shall be spent − owed to members (EARS-344).
- **EARS-709.** WHERE the budget's `starts_on` is on or before BBM's first
  operation, the tier shall show the EARS-344 relation as an equation with both
  sides' values, equal. WHERE `starts_on` is later, the tier shall show the
  same figures with the sentence that operations before `starts_on` are outside
  the glass and the figures therefore do not add up — and shall show no
  equation.

### D. Dynamics

- **EARS-710.** For each calendar month `m` from the month of `starts_on`
  through today's month, **gross burn** shall be the sum of the EARS-341 part
  (a) values of expense debits and the part (b) exchange results whose
  operation's `occurred_on` falls in `m` and on or after `starts_on`; **income**
  shall be the EARS-343 income credits in `m`; **net burn** shall be gross burn
  − income, and may be negative. The months' gross burn shall sum exactly to
  spent, because each item enters exactly one month at the value the replay
  gave it. Contributions shall enter neither series.
- **EARS-711.** Today's month shall be shown as incomplete — «неполный месяц,
  по <today>» — and shall be excluded from the trailing average.
- **EARS-712.** A month is **complete** when it ended before today's month and
  `starts_on` is on or before its first day. The **trailing average net
  burn** shall be the mean net burn of the last `N` complete months, `N =
min(3, complete months available)`, months with no spend counted as zero;
  shown once rounded half away from zero to minor units of `B`. The chart shall
  draw it as a level over the `N` months it averages.
- **EARS-713.** The waterline shall show, at the end of each month of
  EARS-710 and at today, the **cumulative net result** — Σ (income − gross
  burn) from `starts_on` through that point, which lies below zero while income
  is zero — and, on the same axis, **cumulative contributed** — the EARS-343
  contributed items bucketed by `occurred_on`, summed through that point. The
  zero line and the level −limit shall be marked: the waterline reaching
  −limit is the glass running empty. The final points shall equal −(spent −
  income) and contributed of tiers 1–2.
- **EARS-714.** The dynamics tier shall say that a reversal removes the
  original operation from its own month (spec 338 EARS-341): a vendor's refund
  lowers the month the expense was in, not the month of the refund, so a past
  month can change.
- **EARS-715.** The period selector shall offer «с начала бюджета» (the
  default), «последние 12 месяцев», a calendar year, a quarter and a month, and
  the selected period shall be clipped to `[starts_on, today]`. It shall govern
  the monthly burn chart, the waterline's visible range — whose values stay
  cumulative from `starts_on` and never reset at the period start — and the
  breakdown; it shall not change the glass, the money tier, the trailing
  average or the runway, and those blocks shall say «с <starts_on>».

### E. Where the money went

- **EARS-716.** The breakdown shall offer three groupings of the period's
  EARS-341 part (a) values: **by project** — the EARS-345 lines, the fund
  row's line reading as BBM's own spend; **by category** — by the expense
  posting's category, with «без категории» for a posting that has none; **by
  counterparty** — by the counterparty (spec 339 EARS-532) of the intake item
  that posted the operation, with «без контрагента» for an operation with no
  item or an item with none. Each grouping shall carry one separate «курсовой
  результат» line for the period's part (b) exchange results, which belong to
  no project, category or counterparty, and each grouping's lines shall sum
  exactly to the period's spent. A retired category, project or counterparty
  keeps its line under its current name.
- **EARS-717.** Lines shall be ordered by value, largest first, with the
  exchange-result line last; each shall show its value in the reporting
  currency and its share of the period's spent with one decimal.
- **EARS-718.** WHEN a member opens a breakdown line, the page shall list the
  operations behind it in the period, newest first: date, purpose, project,
  counterparty, the expense amount in its own currency, its value in the
  reporting currency, its provisional mark (EARS-719), and a link to the
  request it came from where it came from one (spec 339 EARS-542). An operation
  with several expense postings in one line is one row carrying their sum. The
  rows shall sum exactly to the line. For the exchange-result line the rows
  shall be the operations carrying a result — a reimbursement links to the
  request it settles (spec 339 EARS-528) — with the result signed: a loss
  positive, a gain negative (spec 338 EARS-340 item 5).

### F. Provisional and withheld

- **EARS-719.** WHILE an expense value is the provisional value of a
  foreign-currency member debt not yet reimbursed (spec 338 EARS-340 item 3),
  every figure that sums it — spent, remaining, share used, runway when its
  average includes it, its month, its breakdown line and its drill-down row —
  shall carry the mark «предварительно», and the glass shall name the
  provisional part: the sum of those values and the number of open debts. WHEN
  such a debt is reimbursed, its value and its exchange result are what the
  replay then produces, and the mark shall disappear from every figure no
  other open debt keeps provisional.
- **EARS-720.** IF a figure sums an unknown cost (spec 338 EARS-340 item 7),
  THEN its widget shall show no number, name the causing currencies in
  ascending code order, and never show a partial sum; every figure derived from
  it shall be withheld the same way — remaining, share used and runway from a
  withheld spent; a withheld month, and the waterline from that month on; the
  trailing average and runway when any averaged month is withheld; a
  breakdown line and the grouping's total. Figures that sum no unknown cost
  stay shown. WHILE any line is withheld, the grouping shall not claim that
  its lines add up; WHILE contributed is withheld, the reconciliation of
  EARS-709 shall not be shown.

### G. Reporting currency

- **EARS-721.** The header shall offer a reporting-currency switch over ₽, $
  and € (and `B` where it is none of them), RUB by default (decision 13); the
  choice shall travel in the page URL, like the `/p/finance` card's, and an
  unknown or unavailable value shall fall back to RUB. A candidate other than
  `B` shall be offered only WHERE EARS-325's recorded pair-rate graph has a path
  from `B` to it; an unavailable candidate shall be shown disabled with the
  reason «нет записанной конвертации <B> → <currency>».
- **EARS-722.** In a reporting currency other than `B`, every shown amount —
  the limit, every §D figure, every month, line and drill-down value — shall be
  its `B` figure converted once through EARS-325's graph as it stands at the
  reading (one path ratio, exact rational, rounded half away from zero once per
  shown figure), and the page shall say so: «пересчёт из <B> по записанному
  курсу пар, как в «Итого»; рыночный курс не используется». The computation
  stays in `B`: share used, runway and every ratio are taken in `B` and do not
  change with the switch; an expense's own-currency amount in a drill-down row
  is shown as recorded; the exactness of sums (EARS-710, EARS-716, EARS-718,
  EARS-344) is asserted in `B`, and a converted view shall say that a sum may
  differ from its lines by rounding.
  _(This presentation narrows the last sentence of spec 338 EARS-344 — «none
  follows the reporting-currency switch of decision 13» — to the computation:
  the figures are still computed only in `B`, and the switch converts what is
  shown. The amendment note sits on EARS-344 and stands or falls with the
  owner's answer to «Open questions» 1.)_

### H. The budget limit form (spec 338 EARS-339)

- **EARS-723.** WHERE the session holds `finance-approve`, the header shall
  offer «Задать бюджет» when no unretired budget exists, and «Изменить лимит»
  and «Закрыть бюджет» when one does; any other session shall see none of these
  controls. The module's handlers refuse every such write without
  `finance-approve` however it is reached (EARS-339), and the page shall show
  that refusal as the module's readable message.
- **EARS-724.** The create form shall ask for the name, the limit amount (a
  positive decimal no finer than the chosen currency's precision, stored as
  minor units), the currency (a pick from the currency reference, RUB first)
  and `starts_on` (a date, prefilled with the date of BBM's first operation and
  explaining that a later date leaves earlier spend outside the glass,
  EARS-709). Submitting shall create the budget through EARS-339's handler.
- **EARS-725.** The edit form shall open prefilled with the current name,
  amount, currency and `starts_on`, and saving shall write one audited change
  (spec 201). A change of currency shall convert nothing: the amount is the one
  entered, in the new currency, and every figure is then computed in the new
  `B`.
- **EARS-726.** «Закрыть бюджет» shall ask for confirmation, saying that the
  figures disappear until a budget is set again and that the change stays in
  the audit trail; it shall retire the budget (EARS-338/339) and the page shall
  then show EARS-704's state. No delete shall be offered.
- **EARS-727.** WHEN a limit write succeeds, the form shall close, a
  confirmation shall appear and the page shall re-read every figure. IF it is
  refused — a validation failure, a second unretired budget (EARS-338), a
  missing role — THEN the form shall stay open with the input kept and the
  module's readable message (spec 338 EARS-326 shape) beside the field it
  concerns, or above the form when it concerns none. The submit control shall
  be disabled while a write is pending.

## CRUD check (task-cycle stage 1a) — the budget limit

| Op     | Supported | How                                                                                                  |
| ------ | --------- | ---------------------------------------------------------------------------------------------------- |
| Create | yes       | `finance-approve`, EARS-724; refused while an unretired budget exists (EARS-338)                     |
| Read   | yes       | every member, EARS-701; the limit is shown in the glass                                              |
| Update | yes       | `finance-approve`, EARS-725 — name, amount, currency, `starts_on`; each change audited               |
| Delete | **no**    | retire instead (EARS-726): a limit that governed real spending is a decision record, kept in history |

Not supported in v1: a screen listing the limit's change history — the history
is in `core.audit_event` (spec 201) and readable there; a budget on a project
other than the fund (EARS-338 v1).

## Acceptance scenarios

Live stand with real data (#586, stage 5): a worktree stand whose branch
platform DB carries BBM's real posted ledger (#583) with §D built (#593); the
test users of `infra/dev-stand/idp/bootstrap.md` §5a — one holding
`finance-approve`, one member with no finance role. Run by the agent through
Playwright; screenshots and the URL go to the owner. No amount from the real
ledger is written into the repo or the PR.

1. **Open book.** As the member with no finance role, open `/p/finance`, follow
   «Бюджет BBM»: the page opens with no limit controls (EARS-701, EARS-723).
   Without a budget it says «Бюджет не задан» and who sets it (EARS-704).
2. **Set the limit.** As the `finance-approve` user: «Задать бюджет» →
   `starts_on` is prefilled with the first operation's date → enter a name and
   a limit → save: the sheet closes, a confirmation shows, the glass appears;
   the audit trail holds the write (EARS-723, EARS-724, EARS-727, EARS-703).
3. **The glass and the money.** Spent, remaining and share used are shown;
   contributed, income (zero), owed to members and cash at cost «по
   себестоимости» are shown, and the equation's two sides are equal
   (EARS-706, EARS-708, EARS-709).
4. **Overrun.** Edit the limit below spent: remaining goes negative, the glass
   shows the overflow, runway reads «лимит исчерпан»; restore the limit
   (EARS-725, EARS-706, EARS-707).
5. **Burn and runway.** The monthly columns show gross and net per month, the
   current month marked incomplete; the trailing average names its N months;
   runway equals remaining × N ÷ the months' net burn, checked by hand from the
   chart's values (EARS-710, EARS-711, EARS-712, EARS-707).
6. **Waterline.** The cumulative net result runs below zero, the contributions
   line sits on the same axis, the −limit level is marked, and the last points
   match tiers 1–2 (EARS-713).
7. **Period.** Switch to «последние 12 месяцев» and to one month: the burn and
   breakdown narrow; the glass, money tier and runway do not move and say «с
   <starts_on>» (EARS-715, EARS-714's note visible).
8. **Where it went.** By project, by category, by counterparty: each grouping's
   lines plus «курсовой результат» add up to the period's spent; open the
   largest line — its rows sum to it, and a row opens its request
   (EARS-716, EARS-717, EARS-718).
9. **Provisional.** With at least one unreimbursed USD member debt in the real
   data, spent and its line carry «предварительно» and the glass names the
   provisional part; owed to members is marked too (EARS-719, EARS-708).
10. **Currency.** Switch to $: every amount changes, runway and the shares do
    not, the page names the recorded-pair-rate policy; € is offered or shown
    disabled with its reason (EARS-721, EARS-722).
11. **Later start.** Edit `starts_on` to a date after the first operation: the
    equation disappears and the sentence about earlier operations shows;
    restore it (EARS-709, EARS-725).
12. **Refusals.** As the member without the role, a direct write to the budget
    endpoint is refused; as the approver, a second create is refused with the
    readable message and the form keeps its input (EARS-723, EARS-727).
13. **Close.** «Закрыть бюджет» → confirm: the page returns to «Бюджет не
    задан»; set the budget again to leave the stand as found (EARS-726,
    EARS-704).

### Verified by CI, not by the owner

On synthetic ledgers built from spec 338's §D fixtures (no real amounts):
months and lines summing exactly to spent in `B` (EARS-702, EARS-710,
EARS-716, EARS-718); a refund's reversal moving its month (EARS-714); the
complete-month rule at a mid-month `starts_on`, N = 0…3, and the runway's four
cases (EARS-707, EARS-711, EARS-712); the empty window (EARS-705); withholding
propagation from a foreign-currency contribution and from a currency with no
Bank of Russia rate (EARS-720 — real data may hold neither); provisional marks
appearing and clearing across a reimbursement (EARS-719); the translated view's
single-ratio rule and its fallback (EARS-721, EARS-722); the stale-rate notice
(EARS-703); the route importing no table and computing no figure (EARS-702,
`pnpm boundaries`).

## Out of scope

- The chart and KPI element class and the screen's visual language — #585.
- The build and the live-stand acceptance — #586; the §D read model — #593.
- A project filter over the whole screen (the per-project numbers are the
  project grouping and its drill-down); per-project budgets (EARS-338 v1).
- A forecast exhaustion date or any what-if — F5 (#342); runway is the one
  forward-looking ratio the owner asked for.
- The register, P&L, cash-flow, unit-cost and break-even reports — F3 (#340).
- A limit-history screen; export (340-product open question 4); accrual
  recognition (decision 14).

## Open questions

1. **Which rate the ₽/$/€ switch uses.** The owner asked for the switch «per
   340-product», and the two finance rulings on it point different ways. This
   spec's default is decisions 13 and 18 as the `/p/finance` «Итого» already
   applies them (EARS-325): a recorded pair rate, no market rate, so the
   figures stay reproducible from the ledger — but € is offered only once BBM
   has recorded a rouble-euro conversion, which may not exist, and dollars are
   at the rate of BBM's recorded rouble-dollar conversions, not today's. The alternative is
   decision 39's display currency at the Bank of Russia rate, as the requests
   queue and «Курс против рынка» show it: all three currencies always
   available, but a market rate would enter the budget's figures, which needs a
   second narrowing of spec 339 EARS-553. Decision needed: recorded pair rate
   (default) or Bank of Russia rate.
