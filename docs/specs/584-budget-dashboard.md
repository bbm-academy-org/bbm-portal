---
status: Draft
issue: 584
updated: 2026-11-25
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
  for the amendment notes named in §E and §G. The product text, by contrast, is an
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
  «Итого»; a current-holdings read model, distinct from period reports
  (`340-product.md`). The currency switch does not use it: the switch reads
  each operation's own recorded amounts (EARS-728), not the current state of
  BBM's holdings.
- **Spec 339 §A, EARS-530 / decision 32** — every finance reading is open to
  every signed-in member; **EARS-532** — the counterparty reference (stored on
  the intake item, see EARS-716); **EARS-549/550/552/553** — the ₽ / $ / € display
  currency (decision 39), whose order for a posted request — the ledger's own
  recorded amount, else the recorded conversion-step rate, else the Bank of
  Russia rate of the operation's date (EARS-550) — is the order EARS-728 and
  EARS-729 follow; the rate store and its isolation, narrowed by §D for the
  provisional value alone.
- **Spec 339 §J, EARS-557/558/561 / decision 41** — a payment's «Факт» is
  what the account actually lost, fees included, and a chain's Факт is what
  left its source account; the Bank of Russia rate of a date is found by
  EARS-558's rate rule. EARS-728 converts by the actual figures, and EARS-729
  uses EARS-558's rule for the fallback alone.
- **Cross-currency payments** (spec 339 «Data model») — both recorded
  amounts of a cross-currency payment are facts and authoritative, joined by
  one `finance_conversion_step` row (spec 338 EARS-318); the rate is derived
  from the pair and never used to compute an amount.
- **ADR-002 §3** — finance is a module with one public API
  (`src/lib/finance/index.ts`); the read model that buckets and groups lives in
  the module, the route only renders it. **ADR-004 §6** — no route imports a
  table file. **ADR-005 §2** — a page that computes over live data is a portal
  module.
- **Spec 311 EARS-416/418** — the `platform-user` workspace gate and the bare
  403 for a session without it; **spec 201** — every limit change is an audited
  `platformTransaction` write, so no budget history table exists.
- **Owner decisions 13, 14, 18, 39, 41** (`docs/product/finance/brief.md`,
  `340-product.md`, spec 339 «Prior decisions», epic #115) — reporting
  currency switchable, RUB by default; cash basis stays the reading (accrual
  deferred); a cross-currency figure uses each operation's own actual rate,
  frozen at its date, never a read-time market rate; the queue's display
  currency is the Bank of Russia rate, display only; Факт is what the
  account actually lost. **Owner, 2026-11-25 (on PR #600):** the dashboard's
  ₽/$/€ switch converts at the actual rate — what was really paid — and the
  Bank of Russia rate serves only where no actual figure exists, labelled
  (EARS-728, EARS-729); and the switch converts every figure on the page,
  the budget block included, the charts changing only their units (EARS-722).
- **Decision 18, narrowed for display only (lead's reading of the owner's
  answer of 2026-11-25, «the switch recalculates all current figures»,
  recorded on #584, comment 7151477118).** Decision 18 governs totals of
  operations, and EARS-728 applies it to every flow figure, «paid out»
  included. A current balance — remaining, owed to members, cash at cost —
  and the limit are not sums of dated operations; in a display currency other than `B` they
  are converted at the latest Bank of Russia rate and labelled (EARS-722
  item 2). Ledger amounts and every `B` figure are untouched. The lot-wise
  alternative — converting each balance by the operations that built it —
  is the owed-lot and balancing-cash rule that review findings B4 and B5 on
  PR #600 removed, because it let a converted glass contradict its own share
  and left a repaid rouble debt non-zero in $.
- **`.claude/rules/design-process.md` §1** — composition, grouping, states and
  feedback are the agent's and are recorded below; the visual language of the
  charts is the owner's and arrives through #585.

**Platform-primitive cross-check:** limit history → `core.audit_event` (spec
201), no new table; who may set the limit → the `finance-approve` flow role
(spec 339 §A, EARS-339), no new role; who may read → the `platform-user` gate
(spec 311 EARS-416); currency display → each operation's own recorded amounts
and conversion steps (spec 338 EARS-318), with the existing Bank of Russia
rate store (spec 339 EARS-552) as the labelled fallback (EARS-729) and for the stock figures (EARS-722); drill-down
links → the request source link the queue already renders (spec 339
EARS-542); success feedback → the whitelist's Feedback row (toasts through
Refine's notification provider, `docs/design/ui-whitelist.md`). No table, role,
rate source or audit trail is added.

**Donor & benchmark pass:** gross burn (total spend per month), net burn (spend
less operating income, financing excluded) and runway (a reserve divided by a
burn rate, usually over a trailing three-month average to smooth lumpy months)
are the standard start-up reporting definitions. Two choices adapt them here.
The runway's reserve is the **remaining limit**, not the cash balance — money is
contributed as needed (#581), so cash is not what runs out (owner). And the
runway divides by **gross** burn, not net burn: income never refills the limit
(EARS-342), so remaining falls by gross spend whatever income does, and a net
divisor would overstate the runway as soon as income exists. _(Lead decision,
2026-11-24, recorded on #584: #584's scope line «runway = budget remaining
divided by average net burn» is read as the owner's intent «how long the limit
lasts», which only gross burn measures; net burn stays on screen as the cash
view.)_ A contribution is financing and enters neither burn, as it never enters
income (§D, IFRS Conceptual Framework reasoning cited there). No owner question
below asks what this answers.

## Current behavior → replacement delta

Today `/p/finance` renders the cash card (EARS-325) and two header links,
«Курс против рынка» (`/p/finance/reports/market-rate`, spec 339 EARS-564) and
«Заявки». No budget exists anywhere: §D is specified and merged but not built
(#593). This spec adds one route, `/p/finance/reports/budget`, its write
handlers under `/p/finance/api/budget`, and one header link beside «Курс против
рынка»; no existing surface changes.

## Composition (agent's decision, recorded)

The screen answers three questions in this order, and the order is the
hierarchy: **how much is left** (dominant), **where the cash stands**, **how fast
it goes and where it went**.

| Tier              | Block                                                                                                                                                                                                                                 | Chart form (input to #585)                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header            | Title «Бюджет BBM», the budget's name, currency and start date, the moment computed; the reporting-currency switch with its rate line, governing every tier (EARS-721); the limit action for `finance-approve`                        | —                                                                                                                                                                                            |
| 1 — dominant      | **The glass**: limit, spent, remaining, share used; beside it **runway** in months with the gross burn it divides by, and the net burn as the cash view; follows the switch (EARS-722)                                                | **F1** fill gauge / bullet bar with an overflow state (spent past the limit); **F2** KPI tile                                                                                                |
| 2 — money         | **Contributed vs spent**: contributed, spent, owed to members, cash at cost, income; the reconciliation line; follows the switch (EARS-722)                                                                                           | **F2** KPI tiles in one row + a one-line equation                                                                                                                                            |
| 3 — dynamics      | **Monthly burn** (gross and net per month, the trailing average) and **the waterline** (cumulative net result, cumulative contributions, the −limit reference level); the period selector sits on this tier and governs tiers 3 and 4 | **F3** monthly columns, two series, negative values allowed, with a line overlay; **F4** cumulative line with a zero baseline, a negative region, a second step series and a reference level |
| 4 — where it went | **Breakdown** with three tabs — project · category · counterparty — each with the exchange-result line; a line opens its operations                                                                                                   | **F5** ranked horizontal bar list (label, value, share); the drill-down is the whitelist's settled data-table block in a sheet                                                               |

Grouping rationale: tiers 1–2 are cumulative since the budget started and do
not move with the period selector; tiers 3–4 are period readings, so the
selector is placed on tier 3, not in the header, where it would read as
governing the glass. The currency switch sits in the header because it
converts every figure on the page (EARS-722). The limit form opens in a sheet from the header, beside the
figure it governs (EARS-339), and is the kit's settled Form block; its outcome
is the kit's Feedback row. Each of F1–F5 also needs its withheld and
provisional rendering (EARS-719/720); how any of it looks is #585's whitelist
row and the owner's Stage-A pick — this spec fixes forms and data only, and
names no colour, font or library.

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
| Runway                         | remaining ÷ trailing average **gross** burn                                                       | EARS-707, EARS-712 |
| Net burn (cash view)           | trailing average net burn, shown beside the runway, not divided into it                           | EARS-712           |
| Contributed / income           | windowed `equity` / `income` credits at cost                                                      | EARS-343           |
| Owed to members / cash at cost | all-time balances at cost                                                                         | EARS-343           |
| Reconciliation                 | contributed + income = spent + cash at cost − owed                                                | EARS-344, EARS-709 |
| Monthly gross / net burn       | EARS-341 items and income bucketed by `occurred_on` month                                         | EARS-710           |
| Trailing averages              | mean gross and mean net burn of the last ≤ 3 complete months                                      | EARS-712           |
| Waterline                      | running Σ (income − gross) per month end; running Σ contributed                                   | EARS-713           |
| Breakdown lines                | EARS-341 part (a) values grouped by project / category / counterparty, + one exchange-result line | EARS-345, EARS-716 |
| Drill-down rows                | the operations behind one line, each with its value                                               | EARS-718           |

## Requirements

Ids continue the flat corpus keyspace: this spec takes the next free
hundred-block, **EARS-701…** (spec 553 holds 601–615). `B` is the budget's
currency (spec 338 EARS-340); «today» is the Moscow calendar date, as in spec
339 EARS-550. Unless a clause says otherwise, a percentage is shown with one
decimal, rounded half away from zero.

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
  shown figure includes a provisional value (EARS-719), or a Bank of Russia
  rate converts what is shown (EARS-722 item 2, EARS-729), and EARS-552's staleness condition
  holds, the header shall also say the Bank of Russia rates are stale and from
  which date.
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
  remaining (EARS-342) and the share used, spent ÷ limit as a percentage. WHEN
  spent exceeds the limit, remaining shall be shown negative and the glass
  shall show the overflow past the limit — never clipped at full. The limit and
  the fact shall be labelled as plan and fact and never summed into one figure
  (decision 14, US-17). The glass's state — the share filled, the overflow,
  «лимит исчерпан» — and the share used are decided in `B` in every display
  currency, so the glass keeps its shape when the switch moves (EARS-722
  item 3).
- **EARS-707.** Runway shall be remaining (EARS-342) divided by the trailing
  average **gross** burn (EARS-712), in months, computed exactly as
  `remaining × N ÷ Σ gross burn of those N months` and shown with one decimal,
  rounded toward zero, beside the average gross burn it divides by and «за N
  мес.». Beside it the trailing average **net** burn shall be shown as the cash
  view, labelled as burn after income and as not entering the runway — income
  never raises the limit (EARS-342). The cases shall be decided in this order,
  the first that holds giving the answer:
  1. remaining is withheld (EARS-720) → runway withheld;
  2. remaining is zero or negative → «лимит исчерпан»;
  3. any averaged month is withheld → runway withheld;
  4. no complete month exists yet → «нужен хотя бы один полный месяц», no number;
  5. the average gross burn is zero or negative → «за последние N мес. расходов
     по бюджету не было», no number;
  6. otherwise the number.

  Runway shall not depend on the period selector, and shall carry the
  provisional mark under EARS-719. It is computed in `B` and is the same
  number in every display currency; in another currency the averages beside
  it are the converted ones (EARS-722 items 3 and 4).

### C. Contributed vs spent (cash)

- **EARS-708.** The money tier shall show contributed, income (even while
  zero), owed to members and cash at cost exactly as EARS-343 defines them,
  beside spent; cash at cost shall carry the label «по себестоимости» and owed
  to members its provisional mark per EARS-343. WHERE a line needs «paid out»,
  it shall be spent − owed to members (EARS-344) in `B`, and in another
  display currency the flow sum of EARS-722 item 1.
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
  spent in every display currency: each item enters exactly one month at the
  value the replay gave it, and in another currency spent is the same sum of
  converted items (EARS-722 item 1, EARS-728). Contributions shall enter
  neither series.
- **EARS-711.** Today's month shall be shown as incomplete — «неполный месяц,
  по <today>» — and so shall the month of `starts_on` when `starts_on` is not
  its first day — «неполный месяц, с <starts_on>»; neither enters the trailing
  averages.
- **EARS-712.** A month is **complete** when it ended before today's month and
  `starts_on` is on or before its first day. The **trailing average gross
  burn** and the **trailing average net burn** shall be the mean gross and the
  mean net burn of the same last `N` complete months, `N = min(3, complete
months available)`, months with no spend counted as zero, each rounded once
  half away from zero to minor units of the shown currency. They are shown
  beside the runway and on the chart as levels over the `N` months they
  average, and follow the switch as the months do (EARS-722 item 1); the
  runway itself divides by the `B` averages (EARS-707).
- **EARS-713.** The waterline shall show, at the end of each month of
  EARS-710 and at today, the **cumulative net result** — Σ (income − gross
  burn) from `starts_on` through that point, which lies below zero while income
  is zero — and, on the same axis, **cumulative contributed** — the EARS-343
  contributed items bucketed by `occurred_on`, summed through that point. The
  zero line and the level −limit shall be marked; −limit is a **reference
  level only**. The glass is empty when cumulative gross burn reaches the
  limit; at that moment the waterline stands at −limit + cumulative income, so
  the waterline crossing −limit coincides with the glass running empty only
  while cumulative income is zero, and the chart shall say so in those words
  whenever cumulative income is not zero (the **income note**). In every display currency the final
  points shall equal income − spent and contributed of tiers 1–2, all being
  sums of the same converted items (EARS-722 item 1). WHILE the display
  currency is not `B`, the level −limit is the converted limit, a stock
  figure (EARS-722 item 2), while the waterline is a flow at the operations'
  own rates; the crossing therefore need not coincide with «лимит исчерпан»,
  which is decided in `B` (EARS-722 item 3), and the chart shall say so in
  those words whatever cumulative income is (the **rate note**). The chart
  shows at most one of the two notes: WHILE `D` is not `B` the rate note
  replaces the income note, being the more specific one — it holds only in
  that view, and its claim (the crossing need not coincide) already covers
  the income cause.
- **EARS-714.** The dynamics tier shall say that a reversal removes the
  original operation from its own month (spec 338 EARS-341): a vendor's refund
  lowers the month the expense was in, not the month of the refund, so a past
  month can change.
- **EARS-715.** The period selector shall offer the periods of «Курс против
  рынка» (spec 339 EARS-564, `src/lib/finance/fx/market-report.ts`): «Этот
  месяц», «Этот квартал», «Этот год», «Последние 12 месяцев» — the current
  month and the eleven before it, whole — and «С начала бюджета» in place of
  «Всё время», which is the default. The choice shall travel in the page URL as
  `period`, an unknown value falling back to the default, and the selected
  period shall be clipped to `[starts_on, today]`. It shall govern the monthly
  burn chart, the waterline's visible range — whose values stay cumulative
  from `starts_on` and never reset at the period start — and the breakdown; it
  shall not change the glass, the money tier, the trailing averages or the
  runway, and those blocks shall say «с <starts_on>».

### E. Where the money went

- **EARS-716.** The breakdown shall offer three groupings of the period's
  EARS-341 part (a) values: **by project** — the EARS-345 lines, the fund
  row's line reading as BBM's own spend; **by category** — by the expense
  posting's category, with «без категории» for a posting that has none; **by
  counterparty** — by the counterparty of the intake item that posted the
  operation, with «без контрагента» for an operation with no item or an item
  with none. The counterparty is read from `finance_intake_item.counterparty_id`
  (an operation has at most one item, `operation_id` being unique): spec 339 EARS-532
  (wording revised 2026-11-24) stores it there, and no posting column shall
  be added for this grouping. Each grouping shall carry one separate «курсовой
  результат» line for the period's part (b) exchange results, which belong to
  no project, category or counterparty, and each grouping's lines shall sum
  exactly to the period's spent. A retired category, project or counterparty
  keeps its line under its current name.
- **EARS-717.** Lines shall be ordered by value, largest first, with the
  exchange-result line last; each shall show its value in the reporting
  currency and its share of the grouping's shown total as a percentage
  (EARS-722).
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
  every figure that sums it or is derived from one that does shall carry the
  mark «предварительно»: spent, remaining, share used, runway (whenever
  remaining or an averaged month is provisional), the trailing averages that
  average its month, its month in the burn chart, every waterline point from
  that month on, its breakdown line and its drill-down row. The glass shall name
  the provisional part: the sum of those values and the number of open debts.
  WHEN such a debt is reimbursed, its value and its exchange result are what
  the replay then produces, and the mark shall disappear from every figure no
  other open debt keeps provisional.
- **EARS-720.** IF a figure sums an unknown cost (spec 338 EARS-340 item 7),
  THEN its widget shall show no number, name the causing currencies in
  ascending code order, and never show a partial sum; every figure derived from
  it shall be withheld the same way — remaining, share used and runway from a
  withheld spent (EARS-707's order); a withheld month, and the cumulative net
  result from that month on; the trailing averages and runway when any
  averaged month is withheld; a breakdown line and the grouping's total; and,
  WHILE contributed is withheld, the cumulative-contributed series from the
  month of the contribution that caused it on. Figures that sum no unknown
  cost stay shown. WHILE any line is withheld, the grouping shall not claim
  that its lines add up; WHILE contributed is withheld, the reconciliation of
  EARS-709 shall not be shown.

### G. Reporting currency

The switch converts **every amount on the page** into the display currency
`D`, the budget block included; the charts keep their shape and change only
their units (owner, 2026-11-25). Each amount takes the rate that fits what it
is. A **flow figure** is a sum of operations, and each operation is converted
at the **actual rate**, which is what its own operation really recorded
(EARS-728 — decision 18's «each operation's own actual rate» and decision
41's «Факт»). The Bank of Russia rate of the operation's date enters only
where that operation recorded nothing in `D`, labelled (EARS-729). A **stock
figure** is a balance as of today, not a sum of dated operations, so it is
converted at the latest Bank of Russia rate, labelled (EARS-722 item 2). With `B` selected every figure is
exact and nothing is converted. In another currency the charts match the `B`
view in shape up to the differences between the operations' own rates.

- **EARS-721.** The header shall offer a reporting-currency switch over ₽, $
  and € (and `B` where it is none of them), beside the budget's currency, RUB
  by default (decision 13); it governs every tier, and the choice shall
  travel in the page URL as `currency`. An unknown or unavailable value shall
  fall back to RUB, or to `B` WHERE RUB is unavailable. A candidate other
  than `B` that EARS-722, EARS-728 and EARS-729 together cannot convert to
  shall be shown disabled with the reason of EARS-729 item 4.
- **EARS-722.** The computation stays in `B`, and the switch converts what is
  shown, at read time; no converted value shall be stored. WHILE `D` is `B`,
  nothing is converted.
  1. **Flow figures** — spent, contributed and income (tiers 1–2), the monthly
     gross and net burn and the trailing averages wherever they are shown
     (EARS-707, EARS-710, EARS-712), the waterline's two series (EARS-713), the
     breakdown lines (EARS-716, EARS-717), the drill-down rows (EARS-718) and
     the amount of the glass's provisional part (EARS-719) and «paid out»
     (EARS-708) — shall each be the integer sum of their items converted by
     EARS-728, or by EARS-729 where an item's own chain misses `D`. «Paid
     out» is a cumulative outflow, not a balance: in `B` it is spent − owed
     to members (EARS-344), and its items are spent's items less the part
     still owed to members, each converted at its own operation's rate. So
     in every display
     currency spent equals the months' gross burn and every grouping's total,
     and the waterline's final points equal income − spent and contributed.
     A breakdown line's share is its shown value divided by the grouping's
     shown total. An expense's own-currency amount in a drill-down row is
     shown as recorded.
  2. **Stock figures** — the limit, remaining, owed to members and cash at
     cost — shall each be taken in `B` and converted once from `B` to `D` at
     the **latest Bank of Russia rate**. That rate is found by spec 339
     EARS-558's rule applied to today: the stored rate of today or the
     nearest previous one at most 14 days older, through RUB, with USDT and
     USDC as USD. The conversion is an exact rational rounded half away from
     zero once to `D`'s minor units, and each such figure carries «по курсу ЦБ
     на <date>». Remaining shall be computed in `B` first (EARS-342) and then
     converted, never as converted limit − converted spent, so it is always
     the money actually left. The −limit level of the waterline is the
     converted limit. IF no rate qualifies, THEN every stock figure in `D`
     shall be withheld with «нет курса ЦБ на <today>», and the flow figures
     are unaffected.
  3. **Ratios and states** — the share used, the runway with its EARS-707
     case, the glass's state (EARS-706), the number of open debts in the
     glass's provisional part and which figures carry «предварительно»
     (EARS-719), and the moment the glass runs empty (EARS-713) — shall be computed in `B` and be the same in every display
     currency, so the glass and the runway keep their shape when the switch
     moves.
  4. **Relations across the two kinds.** WHILE `D` is not `B`, a relation
     that joins flow figures to stock figures holds only up to the difference
     between the operations' rates and the latest rate. The relations, and
     what each shows:
     - limit = spent + remaining: the glass shall carry «в <D> лимит ≠
       потрачено + остаток на <difference>: лимит и остаток — по курсу ЦБ на
       <date>, расходы — по курсу операций; точно — в <B>», where
       `<difference>` = limit − (spent + remaining), all three as shown in
       `D`, with its sign;
     - the EARS-344 equation (EARS-709): the money tier shall show both
       sides' values with the same kind of line in place of «equal», where
       `<difference>` = (contributed + income) − (spent + cash at cost − owed
       to members), as shown in `D`, with its sign;
     - spent = «paid out» + owed to members (EARS-344, EARS-708): wherever
       «paid out» is shown, beside it «в <D> потрачено ≠ выплачено + долги
       участникам на <difference>: долги участникам — по курсу ЦБ на <date>,
       расходы и выплаты — по курсу операций; точно — в <B>», where
       `<difference>` = spent − («paid out» + owed to members), all three as
       shown in `D`, with its sign;
     - the provisional part vs owed to members (EARS-719, EARS-343): in `B`
       the provisional part equals the part of owed to members held by the
       open debts it counts (an open foreign debt carries the same
       provisional value in both, EARS-344); in `D` the first is a flow at
       the operations' rates and the second a stock at the latest rate, so
       they can differ either way. The glass shall carry, beside the
       provisional part, «в <D> предварительная часть ≠ её доле в долгах
       участникам на <difference>: долги участникам — по курсу ЦБ на <date>,
       предварительная часть — по курсу операций; точно — в <B>», where
       `<difference>` = (that part of owed to members, converted as item 2
       converts owed to members) − the provisional part as shown, with its
       sign;
     - the waterline crossing −limit (EARS-713): the chart's rate note of
       EARS-713 applies;
     - remaining ÷ the shown average beside the runway: no line is shown —
       the runway is the `B` one (item 3), and EARS-707's own words say so.

     Where a difference rounds to zero, its line is not shown. WHILE a figure
     a relation needs is withheld (EARS-720, EARS-729 item 3, or item 2's
     missing rate), neither the relation nor its line shall be shown, as
     EARS-720 withholds the reconciliation.

  5. **The rate line** beside the switch shall say, WHILE `D` is `B`, «все
     суммы в <B>, точно, без пересчёта». Otherwise it shall say «операции,
     выплаты и предварительная часть — по фактическому курсу каждой
     операции; лимит, остаток, долги участникам и деньги на счетах — по
     курсу ЦБ на <date>; графики совпадают по форме с видом в <B>
     с точностью до разницы курсов операций», followed by EARS-729's count.

  _(Owner, 2026-11-25: every figure follows the switch, the budget block
  included, as in the owner's own budgeting app. The lead's decisions are
  the split into flow and stock figures, the latest Bank of Russia rate for
  stock figures, remaining computed in `B` first, and ratios and states
  decided in `B`. The last keeps review findings B4 and B5 on PR #600
  closed. A repaid rouble member debt is zero in `B`, so it is zero in every
  currency. And no converted glass can contradict its own share or runway.
  This narrows the last sentence of spec 338 EARS-344, «none follows the
  reporting-currency switch of decision 13», to the computation; the
  amendment note sits on EARS-344.)_

- **EARS-728.** WHILE the reporting currency `D` is not `B`, every item behind
  a flow figure — an EARS-341 part (a) expense value, a part (b) exchange
  result, an EARS-343 income posting and an EARS-343 contribution posting
  (equity credits and debits alike), which is the whole list — shall be
  converted once into `D` at the **actual rate of its own operation**: the
  amounts that operation recorded, which are what the account actually lost,
  fees included (decision 41's Факт, spec 339 EARS-557, and for a chain
  EARS-561), never a rate fetched at read time (decision 18).
  1. **The item's own chain** is the item's own currency and amount — the
     posting's currency and amount for an expense, income or contribution
     item; `B` and the result itself for a part (b) exchange result — plus
     the `finance_conversion_step` rows of the item's own operation (spec 338
     EARS-318), each joining its two currencies by its two recorded amounts.
     The legs of a cross-currency payment (spec 339 «Cross-currency
     payments») and the step of a reimbursement (spec 339 EARS-568) are such
     rows. A holding the operation drew on, bought by an earlier conversion,
     is not on the chain: the replay already carries what it cost into the
     item's `B` value (spec 338 EARS-340 items 2 and 4), and the intermediate
     currencies of that earlier conversion are not traced.
  2. **The actual amount in `D`.** WHERE `D` is the item's own currency, the
     converted amount shall be the item's own amount. Otherwise, WHERE a path
     of the item's own steps links its own currency to `D` — a step may be
     walked in either direction; the path with the fewest steps wins, and
     among equally short paths the one whose sequence of `step_no` values,
     in path order, is lexicographically lowest — the amount shall be the own
     amount multiplied, for each step on the path, by the step's recorded
     amount on the side toward `D` divided by its recorded amount on the
     other side, as an exact rational rounded half away from zero once to
     `D`'s minor units. WHERE `D` is USD, a USDT or USDC currency on the
     chain counts as reaching `D`, its amount read as the same number of
     dollars, one to one — the peg of decision 41, extended to USDC on #559,
     that EARS-558 applies (lead's decision) — so a chain RUB → USDT → THB
     shows in $ the USDT it actually cost. Otherwise EARS-729 applies.
     _Example, `B` = RUB: a
     USD invoice paid from the baht account posts a USD expense and one
     THB → USD step. In $ its row shows the invoice's dollars; in ฿, the
     baht the step disposed; the fee, posted in baht, shows in $ at that
     step's own baht-to-dollar ratio; in ₽ both show the roubles the replay
     drew. A reimbursement's exchange result, in `B`, shows in $ at the
     reimbursement step's own rouble-to-dollar ratio._
  3. Every flow amount — spent, contributed, income, a month's gross burn,
     income and net burn, a waterline point, a breakdown line, a drill-down
     row — shall be the
     integer sum of its converted items, so the sums of EARS-710, EARS-716
     and EARS-718 hold exactly in `D`; the chart's trailing averages are the
     means of the converted months, rounded as EARS-712 rounds.
  4. The rate line (EARS-722 item 5) names this rule as «по фактическому
     курсу каждой операции».
  5. Past figures shall not move with the market: an actual amount is a
     recorded fact and changes only when the ledger changes (a reversal,
     EARS-714).

- **EARS-729.** IF an item's own chain does not reach `D` (EARS-728 item 2),
  THEN — and only then — its amount in `D` shall be its `B` value converted
  from `B` to `D` at the Bank of Russia rate of its operation's `occurred_on`,
  under spec 339 EARS-558's rate rule (the stored rate on that date or the
  nearest previous one at most 14 days older, never a later one; cross pairs
  through RUB; USDT and USDC as USD), as an exact rational rounded half away
  from zero once to `D`'s minor units, and frozen with that date. This is the
  rate §J uses for «Рынок» on that date; the dashboard shows no Рынок or
  Переплата figure of its own, and the rate line shall link to «Курс против
  рынка» (spec 339 EARS-564) for that comparison. _Example, `B` = RUB: in €,
  a payment from roubles into baht has no euro on its chain, so its roubles
  are converted at the Bank of Russia euro rate of its date._
  1. **Item mark.** A drill-down row whose amount in `D` is converted this
     way shall carry «по курсу ЦБ на <date>», the date being the rate's
     effective date.
  2. **Aggregate mark.** A flow figure that sums at least one such item shall
     carry «частично по курсу ЦБ» with the sum of those items in `D`, or «по
     курсу ЦБ» WHERE every item it sums is one; a figure that sums none
     carries no mark. The marks propagate as the sums do: spent, contributed
     and income, «paid out», the glass's provisional part, a month column, a
     breakdown line, the trailing-average levels WHERE any averaged month is
     marked, and every waterline point from the first marked month on. The
     rate line shall add «по курсу ЦБ: N из M операций периода», or say that
     none was.
  3. **No rate.** IF no rate qualifies under EARS-558's rule, THEN the item
     has no amount in `D`, and every flow figure in `D` that sums it shall be
     withheld with «нет курса ЦБ на <date>» — never converted 1:1, never a
     silent zero (as in spec 339 EARS-560) — «paid out», the glass's
     provisional part and the waterline from that month on included; the stock figures, ratios and states of EARS-722 items 2–3
     are unaffected. A fallback amount changes
     only when the ledger changes or when a rate is newly stored inside its
     date's window.
  4. **Disabled candidate.** A candidate `D` shall be shown disabled with
     «нет курса ЦБ для <D>» only WHERE no operation's own chain reaches `D`
     and the rate store holds no rate for the `B` → `D` conversion.
  5. The Bank of Russia rates read here are display only: this fallback
     requires the pending note on spec 339 EARS-553, written out there, and
     EARS-703's stale-rate notice applies WHILE a fallback amount or a stock
     figure in `D` is shown.

### H. The budget limit form (spec 338 EARS-339)

The writes go through `POST /p/finance/api/budget` (create),
`PATCH /p/finance/api/budget/<id>` (edit) and
`POST /p/finance/api/budget/<id>/retire` (retire), route handlers over the
module's EARS-339 functions (#593), so `endpoint-authz` coverage has paths to
check.

- **EARS-723.** WHERE the session holds `finance-approve`, the header shall
  offer «Задать бюджет» when no unretired budget exists, and «Изменить лимит»
  and «Закрыть бюджет» when one does; any other session shall see none of these
  controls. The module's handlers refuse every such write without
  `finance-approve` however it is reached (EARS-339), and the page shall show
  that refusal as the module's readable message.
- **EARS-724.** The create form shall ask for the name, the limit amount (a
  positive decimal no finer than the chosen currency's precision, stored as
  minor units), the currency (a pick from the currency reference, RUB first)
  and `starts_on` (a date, prefilled with the date of BBM's first operation —
  or with today when the ledger has none — and explaining that a later date
  leaves earlier spend outside the glass, EARS-709). Submitting shall create
  the budget through EARS-339's handler.
- **EARS-725.** The edit form shall open prefilled with the current name,
  amount, currency and `starts_on`, and saving shall write one audited change
  (spec 201). A change of currency shall convert nothing: the amount is the one
  entered, in the new currency, and every figure is then computed in the new
  `B`.
- **EARS-726.** «Закрыть бюджет» shall ask for confirmation, saying that the
  figures disappear until a budget is set again and that the change stays in
  the audit trail; it shall retire the budget (EARS-338/339) and the page shall
  then show EARS-704's state. No delete shall be offered.
- **EARS-727.** WHEN a limit write succeeds, the form shall close, a success
  toast shall appear through the whitelist's Feedback row (Refine's
  notification provider) and the page shall re-read every figure. IF it is
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
   a limit → save: the sheet closes, a toast shows, the glass appears; the
   audit trail holds the write (EARS-723, EARS-724, EARS-727, EARS-703).
3. **The glass and the money.** Spent, remaining and share used are shown;
   contributed, income (zero), owed to members and cash at cost «по
   себестоимости» are shown, and the equation's two sides are equal
   (EARS-706, EARS-708, EARS-709).
4. **Overrun.** Edit the limit below spent: remaining goes negative, the glass
   shows the overflow, runway reads «лимит исчерпан»; restore the limit
   (EARS-725, EARS-706, EARS-707).
5. **Burn and runway.** The monthly columns show gross and net per month, the
   current month marked incomplete; the trailing averages name their N months;
   runway equals remaining × N ÷ the months' gross burn, checked by hand from
   the chart's values; the net burn is shown beside it as the cash view
   (EARS-710, EARS-711, EARS-712, EARS-707).
6. **Waterline.** The cumulative net result runs below zero, the contributions
   line sits on the same axis, the −limit reference level is marked, and the
   last points match tiers 1–2 (EARS-713).
7. **Period.** Switch to «Последние 12 месяцев» and to «Этот месяц»: the URL
   carries the period, the burn and breakdown narrow; the glass, money tier and
   runway do not move and say «с <starts_on>» (EARS-715, EARS-714's note
   visible).
8. **Where it went.** By project, by category, by counterparty: each grouping's
   lines plus «курсовой результат» add up to the period's spent; open the
   largest line — its rows sum to it, and a row opens its request
   (EARS-716, EARS-717, EARS-718).
9. **Provisional.** With at least one unreimbursed USD member debt in the real
   data, spent, remaining, runway and the debt's line carry «предварительно»
   and the glass names the provisional part; owed to members is marked too
   (EARS-719, EARS-708).
10. **Currency.** With `B` selected the rate line says every figure is exact.
    Switch to $ in the header: every amount on every tier changes into
    dollars, while the share used, the runway, the glass's fill and the
    charts' shape do not. The limit, remaining, owed to members and cash at
    cost carry «по курсу ЦБ на <date>». Remaining equals the `B` remaining
    converted at that rate, and the glass shows the one-line note on how
    limit differs from spent + remaining. The waterline's −limit level is the
    converted limit. The rate line names both rules and how many of the
    period's operations fell back to the Bank of Russia rate. Open a
    drill-down: a row paid in or invoiced in $ shows its recorded dollars
    unmarked, a rouble-only row carries «по курсу ЦБ на <date>», and a line
    or month summing both carries «частично по курсу ЦБ» (where the real data
    holds no such row, CI covers it); € is offered or shown disabled with its
    reason (EARS-713, EARS-721, EARS-722, EARS-728, EARS-729).
11. **Later start.** Edit `starts_on` to a date after the first operation: the
    equation disappears and the sentence about earlier operations shows;
    restore it (EARS-709, EARS-725).
12. **Refusals.** As the member without the role, `POST /p/finance/api/budget`
    is refused; as the approver, a second create is refused with the readable
    message and the form keeps its input (EARS-723, EARS-727).
13. **Close.** «Закрыть бюджет» → confirm: the page returns to «Бюджет не
    задан»; set the budget again to leave the stand as found (EARS-726,
    EARS-704).

### Verified by CI, not by the owner

On synthetic ledgers built from spec 338's §D fixtures (no real amounts):

- months and lines summing exactly to spent in `B` (EARS-702, EARS-710,
  EARS-716, EARS-718); a refund's reversal moving its month (EARS-714);
- **a ledger with income > 0**: runway divides remaining by gross burn and is
  unchanged by income, net burn is lower than gross, the waterline's final
  point is income − spent, and the −limit note of EARS-713 appears
  (EARS-707, EARS-710, EARS-712, EARS-713);
- the complete-month rule at a mid-month `starts_on` (its first month marked
  incomplete), N = 0…3, and every case of EARS-707 in its stated order,
  including overlapping ones (EARS-707, EARS-711, EARS-712);
- the empty window and the empty-ledger prefill (EARS-705, EARS-724);
- withholding propagation from a foreign-currency contribution — the
  cumulative-contributed series included — and from a currency with no Bank of
  Russia rate (EARS-720; real data may hold neither);
- provisional marks appearing on every derived figure and clearing across a
  reimbursement (EARS-719);
- **every figure follows the switch** (EARS-713, EARS-722): with `currency`
  set to $ and to €, spent, contributed and income are sums of converted
  items. They equal the months' sum and every grouping's total, and the
  waterline's final points equal them. The limit, remaining, owed to members
  and cash at cost are their `B` figures converted once at the latest Bank of
  Russia rate under EARS-558's rule, each labelled. Remaining is
  convert(remaining in `B`), never converted limit − converted spent, and a
  repaid rouble member debt is zero in every currency. The share used,
  runway, EARS-707's case and the glass's state equal their `B` readings
  byte for byte. The limit ≠ spent + remaining line and the equation's
  difference line carry the signed differences of EARS-722 item 4, appear
  only when the difference does not round to zero, and disappear when a
  figure they need is withheld. «Paid out» is a sum of converted items (its
  `B` value spent − owed to members), and beside it the spent ≠ «paid out» +
  owed to members line carries the signed difference of EARS-722 item 4 under
  the same show/hide rules. The provisional part's amount is a sum of
  converted items and its count is the `B` one; on a ledger whose open
  foreign debt is converted at a rate that differs from the latest one, the
  provisional-part-vs-owed line carries the signed difference of item 4,
  either sign included, under the same show/hide rules. With zero income in
  `D`, the waterline's rate note that the −limit crossing need not coincide
  with «лимит исчерпан» is shown, and with income > 0 in `D` it is the only
  note shown (EARS-713).
  The stock figures are withheld when no rate qualifies, and −limit is the
  converted limit. With `B` selected nothing is converted and the «точно»
  rate line shows;
- the actual-rate conversion of the flow figures (EARS-728): an item in `D`
  shows its own amount; a cross-currency payment shows its other recorded
  amount through its own step; a fee in the paid currency and a
  reimbursement's exchange result convert at their own operation's step
  ratio; a multi-step chain (RUB → USDT → THB) resolves along the
  fewest-step path, equal-length paths by their `step_no` sequences, and
  shows in $ through its USDT leg one to one; a holding bought by an earlier conversion is not traced
  and falls back; every expense value, exchange result, income posting and
  contribution posting (equity debits included) is converted once, and
  months, waterline points, lines and drill-down rows sum exactly in `D`, a
  line's share taken of the shown total;
- the fallback (EARS-729): only an item whose own chain misses `D` is
  converted from `B` at the Bank of Russia rate of its date under EARS-558's
  rule (14-day window, never a later rate, USDT/USDC as USD); the item mark,
  «частично по курсу ЦБ» with its sum and «по курсу ЦБ» on the aggregates,
  their propagation into averages and waterline points, the rate line's
  count, the per-date withholding with no 1:1 substitute, past figures
  unmoved by a newer rate; plus the URL fallbacks for `currency` and
  `period` and the disabled reason (EARS-715, EARS-721, EARS-722); the
  stale-rate notice (EARS-703);
- the route importing no table and computing no figure (EARS-702,
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

1. **Which rate converts the ₽/$/€ switch — answered (owner, 2026-11-25).**
   The actual rate: what was really paid, what the account actually lost —
   the «Факт» of decision 41 (spec 339 §J). Each flow item is converted by
   its own operation's recorded amounts (EARS-728); the Bank of Russia rate
   serves only where an item's own operation recorded nothing in the chosen
   currency, and every figure it enters is labelled (EARS-729).
2. **Does the budget block follow the switch — answered (owner,
   2026-11-25).** Yes: the switch converts every figure on the dashboard,
   the limit, spent, remaining, contributed and cash included, as in the
   owner's own budgeting app; the charts keep their shape and change only
   their units (EARS-722).
