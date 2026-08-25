---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-08-25
---

# F3 — Reports: register, P&L, cash flow, unit cost, break-even (#115)

## Feature summary

What the owner actually opens `/p/finance` for. Five readings of the same
ledger (decision 5):

- **the operations register** — every posting, filterable, the audit view;
- **P&L** — income and expense by category, per period, for the fund and for
  each project;
- **cash flow** — what actually moved in and out, and what is on the accounts
  now, which is a different question from P&L;
- **unit cost (себестоимость)** — what one sellable unit of a project costs to
  produce, where the unit is a lesson, a course, or whatever the project sells
  (decision 9);
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
- **US-4** — As the owner, I see cash flow — what came in, what went out, and
  what is on each account now — and I understand why it differs from the P&L
  result. _(decision 5)_
- **US-5** — As the owner, I see the balance of each account in its own currency,
  and a total in the reporting currency with the rate policy stated.
  _(decisions 4, 13)_
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
A report opens in RUB and converts amounts to it at the stated policy, saying
which policy and which rates it used; the owner can switch the reporting currency
to another one and the same report re-presents itself there (decision 13).
Amounts in their own currency remain visible next to the converted total, and the
operations themselves keep their currency. _(`agent-proposed — UNCONFIRMED`:
which conversion policy — rate at the operation date, or period-end rate — is an
owner question below; decision 13 fixes the switchable presentation, not the
rate rule.)_

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
- The owner can see the current balance of every account in its own currency.
- A total that spans currencies states the rate policy it used.
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

## Out of scope

- What-if and future projections — F5. Everything here is fact.
- Comparison against the finmodel — F4.
- Statutory or tax reporting forms of any kind.
- Payout, royalty and profit-share distribution views — holding-level mechanics
  with open owner forks (prior art §2, §3).
- Charts as a deliverable: the shape of the visualisation is a Stage-A design
  question, not a product decision.

## Open questions

1. **The conversion policy for a multi-currency total** — the rate at each
   operation's date, or one rate at period end? The two give different totals and
   the choice is the owner's. _(The reporting currency itself is settled:
   decision 13 — RUB by default, switchable.)_
2. **What counts as a unit produced in a period?** Unit cost needs a denominator
   — lessons published, courses released, units sold. Decision 9 fixes the unit,
   not how it is counted.
3. **Is revenue per unit known** (a price on the product), or is break-even
   computed purely from cost? The DS model takes the price as an input
   (prior art §4).
4. **Does the owner need an export**, and in what form?

_Settled since the first draft:_ cash-versus-accrual recognition timing is no
longer an open product question here — decision 14 defers the rule to practice
and fixes the principles instead (honest math; obligations counted and shown;
plan-vs-fact explicit). The feature spec inherits the principles, not a timing
rule.
