---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-11-24
---

# F3 — Reports: register, P&L, cash flow, unit cost, break-even (#340)

## Feature summary

What the owner actually opens `/p/finance` for. Five readings of the same
ledger (decision 5):

- **the operations register** — every posting, filterable, the audit view;
- **P&L** — income and expense by category, per period, for the fund and for
  each project;
- **period cash flow** — what actually moved in and out during the selected
  period, which is a different question from P&L;
- **unit cost (себестоимость)** — what one sellable unit of a project costs to
  produce, where the unit is a **lesson or a course** — the production units the
  owner confirmed at the wireframe review (decisions 9, 19);
- **break-even sale price** — the price at which that unit stops losing money.

Every one of them **computes from postings**; none stores its own numbers. A
report is a query, so a reversal in the ledger changes every report at once and
no report can drift from the books.

**Multi-currency reaches the reports, not just the schema** (decision 4). A
report that spans currencies has to state a rate policy, and the policy has to be
visible — the alternative is a total nobody can reproduce.

**The reporting currency is switchable — owner ruling, decision 13 (owner
2026-08-25).** Reports **default to RUB** and can be **viewed in another
currency**; the reporting currency is a property of the view, not of the data.
Operations always keep their own currency (consolidation spec §8): switching the
report re-presents the same postings, it never rewrites or re-denominates them,
and the amount in its own currency stays visible beside the converted total.

**The conversion rate is each operation's own actual rate — owner ruling,
decision 18 (owner 2026-08-25).** A report that spans currencies converts every
amount at the **actual rate the operation happened at, frozen at its date** —
never a period-end market rate and never a rate fetched at read time. A
RUB→USDT conversion records the factual rate it happened at, and that rate is
what every later reading uses, so any total is reproducible from the postings
behind it. This settles the rate-policy fork this PRD previously carried as its
first open question.

_Note, 2026-11-24 (spec 584, pending the owner's go on its open question 1):
the budget dashboard's ₽/$/€ switch converts only the flow figures — the
monthly burn, the waterline, the breakdown and its drill-down; the budget
block (limit, spent, remaining, runway, contributed, income, owed, cash at cost and
the reconciliation) always stays in the budget's own currency. Under answer
A, spec 584 EARS-728, the switch keeps this ruling: each operation is
converted at a rate frozen at its own date, never a period-end rate and never
one fetched at read time, so past figures do not move with the market
(US-18). An item in the budget currency records no rate into $ or € of its
own, so the frozen rate of its date is the Bank of Russia rate; where BBM
itself paid in a foreign currency, the drill-down row also shows the amount it
recorded in that currency. The conversion is display only. Answer B,
EARS-729, would convert by the current recorded-conversion graph instead and
says that it does not apply this ruling._

**Current money is already F1b, not a sixth F3 report.** The accepted
`Overview.dc.html` card that lists current non-system money-account balances and
its reproducible current-holdings total moved to #357 / spec 338 EARS-325. Its
formula is deliberately narrower: chronological remaining-pool replay per
currency pair, followed by deterministic conversion of each native balance
through recorded pair rates. F3 retains the broader semantics of
decision 18 for **period activity and report lines** — each operation is
re-presented at its own actual recorded rate — plus the register, period cash
flow and P&L, cuts, drill-down, unit cost, break-even and capitalization. The two
views read the same immutable facts but answer different questions.

**Product capitalization is a reading of this layer — decision 22 (owner
2026-08-25).** Because every product-attributable expense carries its product
(F1, #338), the reports can show the **accumulated invested cost of each
product** — its capitalization — beside the per-period unit cost. The treatment
of overhead that belongs to no product follows the accounting rule the F1 spec
proposes and the owner signs off; this feature reads that rule, it does not set
it.

**Recognition timing (accrual vs cash) is deferred — owner ruling, decision 14
(owner 2026-08-25).** The owner decides accrual-vs-cash **from practice**, once
there is a real ledger to decide against; no rule is fixed here. What is fixed is
the set of principles the reports obey either way:

- **the math is always honest** — no report shows a number it cannot derive from
  postings, and no timing convention is applied silently;
- **debts and obligations are counted and shown** — an accrued but unpaid team
  accrual is visible as an obligation, not omitted because no money has moved;
- **plan stays plan until the fact happens**, and plan-vs-fact is an explicit,
  visible distinction — never two numbers blended into one line.

**Per project, and the fund** (decision 2): the same report with a different
dimension filter, never a separate report per project.

**BBM's budget — the first reading the owner asked for (2026-11-24, #581,
#587).** BBM, the fund, has one fixed budget for its launch and the Doctor
School pilot _(owner)_; every other project's spend draws on it too _(owner,
2026-11-24, #581)_. The reading answers two questions with
separate numbers. **Against the limit:** how much has been spent since the
budget started — every project's expenses, fees, spend from members' own cards
on the day it happened _(owner-confirmed)_, and the gain or loss on currency
exchanges shown as its own line — and what remains, which goes below zero when
the limit is exceeded rather than stopping at zero. **Against the money:** how
much has been contributed, how much is owed back to members who paid from their
own cards, and how much cash the accounts hold at what it cost us; income is
shown beside them even while it is zero. The two answers reconcile exactly —
contributed plus income equals spent plus cash at cost minus what is owed to
members — whenever the budget starts on or before BBM's first operation; a
budget started later leaves earlier spend and contributions out of the glass,
and the screen then does not claim the sum. That holds because every foreign-currency
holding carries the cost it was bought for in the budget currency, and spending it or
converting it back uses up that cost — including chains such as RUB → USDT →
THB. Two numbers therefore differ on purpose: the budget's «cash at cost» is
not the cash total on `/p/finance` whenever foreign money is held — that card
values holdings at the recorded exchange rates between currency pairs, not at
what they cost and what is left of that cost — and the budget's exchange-result
line is not the ledger's own exchange-result entries, which are kept per
currency pair and miss holdings already spent. The budget reading is the one
that adds up to the money contributed. Approved but unpaid requests are not spending (cash basis, decision 14
stays deferred); income does not extend the limit. The limit is plan and the
rest is fact, so the two are never blended into one line. Every number is in
the budget's own currency and built from recorded operations (decision 18), with
one exception the owner set: a member's card debt in a foreign currency counts
at the Bank of Russia rate of the day it was spent, marked provisional, until it
is paid back — then the roubles that actually left the account, the payment
agent's fee and any withheld tax included, replace that value, and the
difference lands in spent as the exchange and fee result _(owner, 2026-11-24,
#581)_. Many member-paid requests are in USD or THB, so withholding them would
blind the reading. Where money arrived directly in a foreign currency or crypto,
or a debt's day has no Bank of Russia rate, the reading says which currency and
withholds the number rather than guess. Definitions: spec 338 §D
(`docs/specs/338-ledger-core.md`); the screen is #584's.

**Budget dashboard (#584) — the screen for that reading (owner, 2026-11-24).**
The owner's three questions — how much have we spent, where did the money go,
what is the spending dynamic — are answered on one page, «Бюджет BBM» under the
finance reports, open to every member like every finance reading (decision 32).
Top to bottom, in the order of importance: **the glass** — the limit, what is
spent, what remains and how many months that lasts at the recent pace of
spending (the runway — counted on spending before income, because income never
raises the limit; the pace after income is shown beside it as the cash view); **contributed versus spent** — the money brought in, what is owed to
members, the cash at cost and income, with the check that they add up; **the
dynamic** — spending per month, before and after income, with the average of
the last three full months, and the cumulative result sinking below zero while
there is no income, the contributions drawn beside it and the limit marked as a reference level —
the line meets that level exactly when the glass empties only while there is
no income; **where it went** — spend by project, by
expense category and by counterparty, each adding up to the total with the
exchange result as its own line, and every line opening the operations behind
it. A period choice narrows the dynamic and the breakdown; the glass and the
cash always read from the budget's start. The dynamic and the breakdown can be
shown in roubles, dollars or euros, converted for display only (which rate
converts is spec 584's open question); the glass, the runway and the cash stay
in the budget's own currency, with a line saying so, so they never disagree
with each other whatever the switch shows. The person holding the
approve role sets, changes or closes the limit on this same page; nobody
deletes it, and every change stays in the audit trail. What is provisional
(a foreign-currency card debt not yet repaid) is marked as such, and what
cannot be counted honestly is withheld with the reason. Definitions, states and
the widget-by-widget mapping: spec 584 (`docs/specs/584-budget-dashboard.md`);
how the charts look is #585's and the owner's pick.

The unit-cost model has one real precedent: the Doctor.School lesson-cost
calculator, which computes a per-lesson cost from per-role payroll with
employment-mode tax loading plus external vendors, and derives margin against a
price (prior art §4). This feature reproduces its **questions**, not its
structure — there the inputs are sliders, here they are facts from the ledger.

## Design pick (Stage A)

_Not yet run._ Five reading surfaces plus the overview are the largest visual
surface in the epic and need a Stage-A pick vendored into `design-source/` before
markup (`.claude/rules/design-process.md`). The register and the P&L table are
the two that decide the rest.

## User stories

- **US-1** — As the owner, I open a register of every operation and filter it by
  period, project, category, account, currency and source, so any number in a
  report can be opened down to the entries behind it. _(decision 5)_
- **US-2** — As the owner, I see a P&L for a period: income and expense by
  category, and the result. _(decision 5)_
- **US-3** — As the owner, I see that same P&L for one project alone, and for the
  fund alone. _(decision 2)_
- **US-4** — As the owner, I see what came in and what went out during a period,
  and understand why that cash flow differs from the P&L result.
  _(decision 5)_
- **US-5** — _Moved to F1b #357 / spec 338 EARS-325._ The current balance of
  each account in its own currency and the switchable current-holdings total
  ship before F3. The id stays here so the remaining US ids are stable.
  _(decisions 4, 13, 18)_
- **US-15** — As the owner, I read a report in roubles by default and can switch
  it to another currency without the underlying operations changing currency.
  _(decision 13)_
- **US-16** — As the owner, an accrued but unpaid obligation to the team is
  visible to me as a debt rather than absent because no money has moved yet.
  _(decision 14)_
- **US-17** — As the owner, a planned amount is never mixed into a fact: where a
  report shows both, the plan and the fact are separate and labelled.
  _(decision 14)_
- **US-6** — As the owner, I see what one sellable unit of a project costs to
  produce, from the facts in the ledger rather than from a per-occasion
  spreadsheet. _(decisions 5, 9)_
- **US-7** — As the owner, I see what the unit cost is made of — which categories
  and how much each contributes — because the number alone does not tell me what
  to cut. _(prior art §4: the DS model's value is the breakdown)_
- **US-8** — As the owner, I see the break-even sale price of a unit, and how far
  today's price is from it. _(decision 5)_
- **US-9** — As the owner, I see the payroll part of a unit's cost including its
  employment-mode tax loading, because a person at ~×2 loading and a person at
  +6% are not the same cost. _(prior art §4; `agent-proposed — UNCONFIRMED` that
  the loading is shown separately in the report)_
- **US-10** — As the owner, I can compare periods — this month against last —
  without exporting anything. _(`agent-proposed — UNCONFIRMED`)_
- **US-11** — As the owner, I can take any report out as a file for someone who
  does not have a login. _(`agent-proposed — UNCONFIRMED`; the money-route
  calculator has CSV export — prior art §1)_
- **US-12** — As the owner, a reversal in the ledger is reflected in every report
  immediately, with no rebuild step. _(F1)_
- **US-13** — As the owner, an expense that is not attributable to any unit still
  appears in the P&L as a period cost, and I can see which costs those are.
  _(`agent-proposed — UNCONFIRMED`: the allocatable/period split proposed in F1)_
- **US-14** — As the owner, every report tells me the period it covers and the
  moment it was computed, so a screenshot is never ambiguous.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-18** — As the owner, a cross-currency total is built from each operation's
  own recorded rate, so I can reproduce it from the register and it does not
  change when market rates move. _(decision 18; the budget dashboard's switch
  keeps it under spec 584 EARS-728 — see the note beside decision 18)_
- **US-19** — As the owner, unit cost is expressed per **lesson** and per
  **course** — the production units of the business — rather than per an abstract
  unit I have to define each time. _(decision 19)_
- **US-20** — As the owner, I see the accumulated invested cost — the
  capitalization — of each product, so I know what has been put into a lesson or
  a course to date, not only what it cost in one period. _(decision 22)_
- **US-21** — As the owner, I see BBM's budget as a glass: the limit, what
  has been spent against it since it started, and what remains — negative
  if we have overspent. _(owner, 2026-11-24, #581)_
- **US-22** — As the owner, I see where the budget went — spend per project,
  BBM's own spend as the fund's line, and the currency-exchange result as a
  line of its own — and the parts add up to the whole. _(owner, 2026-11-24,
  #581; the exchange line is a lead reading)_
- **US-23** — As the owner, I see how much has been contributed, how much we
  owe members who paid from their own cards, and how much cash the accounts
  hold at what it cost us, separately from the budget glass, and the two
  reconcile exactly while the budget starts on or before BBM's first
  operation. _(owner, 2026-11-24, #581)_
- **US-24** — As a member, I see how much BBM spends per month, before and
  after income, and the average of the last three full months, so I know the
  pace. _(owner, 2026-11-24, #584)_
- **US-25** — As a member, I see how many months the remaining limit lasts at the recent pace of spending — the runway — counted on spending
  before income, since income does not raise the limit; the pace after income
  is shown beside it. _(owner, 2026-11-24, #584; the gross divisor is the
  lead's decision recorded in spec 584)_
- **US-26** — As a member, I see the cumulative result of BBM over time — below
  zero while there is no income — with the contributions drawn beside it.
  _(owner, 2026-11-24, #584)_
- **US-27** — As a member, I see the spend by expense category and by
  counterparty as well as by project, and I can open any line down to the
  operations behind it. _(owner, 2026-11-24, #584)_
- **US-28** — As a member, I read the dashboard's dynamic and breakdown in
  roubles, dollars or euros, and the glass, the runway and the cash stay in
  the budget's own currency when I switch. _(owner, 2026-11-24, #584; which
  rate converts — spec 584 open question 1; the budget block staying in its
  own currency is the lead's decision recorded in spec 584 EARS-722)_
- **US-29** — As the holder of the approve role, I set, change or close BBM's
  budget limit on the page that shows it, and no one else can.
  _(owner, 2026-11-24, #581 question 5 / spec 338 EARS-339)_
- **US-30** — As a member, I can tell a provisional or withheld figure from a
  final one at a glance, and I see why it is so. _(lead reading of #581's
  provisional rule, recorded in spec 584)_

## Flows

**From a total to the facts.**
Owner opens P&L for a period → clicks a category line → the register opens
filtered to exactly the postings behind that number → clicks one posting → sees
its source, and where it came from a request, its invoice. Every aggregate is
one click from its entries.

**Reading one project.**
Owner picks the project → P&L, cash flow, unit cost and break-even all narrow to
it → picking "the fund" or "all of BBM" widens them again. The same screens.

**Unit cost.**
Owner picks a project and its product (decision 9) → the report shows the
allocatable cost attributed to the unit, its breakdown by category, the number of
units the period produced, and the cost per unit → beside it, the break-even
price and the current price if one is set.

**Multi-currency total.**
A period report opens in RUB and converts its operation amounts at **each
operation's own actual rate, frozen at its date** _(decision 18)_, saying so and
showing the rates it used; the owner can switch the reporting currency to
another one and the same period report re-presents itself there _(decision 13)_.
Amounts in their own currency remain visible next to the converted report line,
and the operations themselves keep their currency. This is not F1b's
current-holdings replay.

**An empty period.**
A period with no operations reports zero and says so, rather than showing a blank
screen that could equally mean "not loaded". _(`agent-proposed — UNCONFIRMED`)_

## Product acceptance criteria

- The owner can list every operation of any period and narrow it by project,
  category, account, currency and source.
- Any aggregate number in a report can be opened down to the operations it is
  made of.
- The owner can read a P&L for any period for the whole of BBM.
- The owner can read that P&L for a single project.
- The owner can see what actually moved in and out of each account in a period.
- A period-report total that spans currencies states the rate policy it used,
  and that policy is each operation's own recorded rate — the total is
  reproducible from the register and does not move with the market.
- Unit cost is reported per lesson and per course.
- The owner can see the accumulated invested cost (capitalization) of a product.
- A report opens in RUB and can be switched to another reporting currency without
  any operation changing the currency it was recorded in.
- An accrued but unpaid obligation is visible in the reports rather than absent
  until it is paid.
- Where a report shows a planned amount at all, it is labelled as plan and not
  summed into a fact.
- The owner can see the production cost of one sellable unit of a project.
- The owner can see which cost categories make up that unit cost, and in what
  proportion.
- The owner can see the sale price at which a unit breaks even.
- The owner can see how the current price of a unit compares to that break-even
  price.
- A reversal recorded in the ledger changes every affected report without any
  further action.
- No report shows a number that does not come from a posting.
- A report states the period it covers.
- The owner can see BBM's budget limit, what has been spent against it since
  it started, and what remains, with the remainder shown below zero when the
  limit is exceeded.
- An expense paid from a member's own card counts against the budget on the
  day it was paid, and paying the member back does not count it again.
- Contributions, money owed to members and cash at cost are shown as separate
  facts beside an income figure; contributed plus income equals spent plus
  cash at cost minus money owed to members, exactly, whenever the budget
  starts on or before BBM's first operation.
- A member's foreign-currency card debt counts at the Bank of Russia rate of
  its spend day, marked provisional, until it is paid back; paying it back in
  roubles makes spent equal to the roubles actually paid for it, the agent's
  fee included, and the four figures still reconcile before and after.
- The budget's cash at cost and exchange result are labelled so that they are
  not mistaken for the `/p/finance` cash total or the ledger's own exchange
  entries, which differ whenever foreign money is held.
- The per-project spend plus the exchange-result line adds up to the total
  spend.
- In the budget's own currency the months of the spending chart add up to
  the total spend, and the runway
  can be checked by hand from the remaining limit and the average shown beside
  it.
- The spend by category and by counterparty each add up to the total spend
  with the exchange-result line, and every line opens to operations that add
  up to it.
- Only the approve role can set, change or close the limit; every member can
  read it.

## Out of scope

- What-if and future projections — F5. Everything here is fact.
- Comparison against the finmodel — F4.
- Statutory or tax reporting forms of any kind.
- Payout, royalty and profit-share distribution views — holding-level mechanics
  with open owner forks (prior art §2, §3).
- Charts as a deliverable: the shape of the visualisation is a Stage-A design
  question, not a product decision.

## Open questions

1. ~~**The conversion policy for a multi-currency period-report total** — the
   rate at each operation's date, or one rate at period end?~~ **Closed by
   decision 18** (owner 2026-08-25): each operation's own actual rate, frozen at
   its date. _(The reporting currency itself was already settled by decision 13
   — RUB by default, switchable. The recorded-cost current-holdings total is the
   distinct F1b EARS-325 read model.)_
2. **What counts as a unit produced in a period?** Decision 19 (owner 2026-08-25,
   wireframe review) settled the **unit** — the production units are **lessons
   and courses**, as drawn on the wireframe — but not the **counting rule**: when
   a lesson or a course counts as "produced" in a given period (published,
   released, sold) is still undecided, and unit cost per period cannot be
   computed without it. Deferred to the F3 feature spec, not closed.
3. **Is revenue per unit known** (a price on the product), or is break-even
   computed purely from cost? The DS model takes the price as an input
   (prior art §4).
4. **Does the owner need an export**, and in what form?

_Settled since the first draft:_ cash-versus-accrual recognition timing is no
longer an open product question here — decision 14 defers the rule to practice
and fixes the principles instead (honest math; obligations counted and shown;
plan-vs-fact explicit). The feature spec inherits the principles, not a timing
rule. The cross-currency rate policy (decision 18) and the unit denominator
(decision 19) are likewise no longer open — both were ruled at the 2026-08-25
wireframe review. The **counting rule** for a produced unit is a different
question and stays open above (question 2).
