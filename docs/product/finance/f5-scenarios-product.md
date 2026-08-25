---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-08-25
---

# F5 — Scenario calculator on top of the fact (#115)

## Feature summary

The **final deliverable of the epic** (decision 7): a calculator where the owner
plays with future expenses and incomes, product cost and sale price, and sees the
impact on P&L and cash flow.

Its distinguishing property is the words _on top of the fact_. The estate already
has calculators that start from sliders — the money-route model projects from six
parameters (`I`, `cost0`, `gCost`, `rev0`, `gRev`, `k`, `T`), and the DS
lesson-cost calculator from per-role rates (prior art §1, §4). Both begin at zero
because there was no ledger to begin from. Here the baseline is the recorded
past: today's account balances, the real cost structure of the last periods, the
real unit cost — and the scenario changes only what the owner chooses to change.

A scenario is a **what-if, never a fact**: it writes nothing into the ledger,
appears in no report of F3, and is visibly separated from the actuals it sits on.

The money-route model also supplies the three questions worth answering, which
this feature answers from the fact rather than from parameters: **operational
break-even, the cash-zero point, and investor payback** (prior art §1).
_(`agent-proposed — UNCONFIRMED` as scope: decision 7 names P&L and cash-flow
impact, not these three milestones by name.)_

## Design pick (Stage A)

_Not yet run._ The scenario surface — inputs beside a projected P&L and cash-flow
curve — needs a Stage-A pick vendored into `design-source/` before markup. The
money-route calculator is a functional reference, not a template to reproduce
(`.claude/rules/design-process.md`).

## User stories

- **US-1** — As the owner, I start a scenario from where BBM actually is today —
  real balances, real cost structure, real unit cost — instead of from an empty
  model. _(decision 7: "on top of the fact")_
- **US-2** — As the owner, I add or change a future expense — a hire, a
  subscription, a one-off purchase — and see P&L and cash flow move.
  _(decision 7)_
- **US-3** — As the owner, I add or change future income and see the same.
  _(decision 7)_
- **US-4** — As the owner, I change a product's sale price and see the effect on
  the result. _(decision 7)_
- **US-5** — As the owner, I change what a unit costs to produce and see the
  effect on margin and break-even. _(decisions 7, 9)_
- **US-6** — As the owner, I change the volume — how many units we make or sell —
  and see the result. _(`agent-proposed — UNCONFIRMED`; decision 7 names cost and
  price, not volume, but neither break-even nor a projection resolves without
  it)_
- **US-7** — As the owner, I see when the scenario reaches operational
  break-even, when cash goes to zero, and when the investor is paid back.
  _(`agent-proposed — UNCONFIRMED`; the three milestones of the money-route model,
  prior art §1)_
- **US-8** — As the owner, I see how much cash a scenario needs at its worst
  month, because that number decides whether the plan is possible at all.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-9** — As the owner, I keep a scenario and come back to it later, and I
  keep several side by side to compare. _(`agent-proposed — UNCONFIRMED`)_
- **US-10** — As the owner, a scenario is never confused with the actuals: it
  changes nothing in the ledger and appears in no fact report. _(decision 1: the
  ledger is the source of truth)_
- **US-11** — As the owner, a scenario I made a month ago is re-based on today's
  facts when I reopen it, or clearly tells me it is frozen at the baseline it was
  built on. _(`agent-proposed — UNCONFIRMED`)_
- **US-12** — As the owner, I can see what a scenario changed relative to the
  fact — the list of my own assumptions — rather than only its result.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-13** — As the owner, I can apply a planning cushion to a scenario — a
  percentage on payroll and on external spend — because plans built on exact
  numbers are wrong in one direction. _(`agent-proposed — UNCONFIRMED`; the DS
  model's +15% / +25% contingency, prior art §4)_
- **US-14** — As the owner, a scenario works in the same currencies as the
  ledger, and states the rate it assumes for the future. _(decision 4;
  `agent-proposed — UNCONFIRMED` in the future-rate part)_

## Flows

**Building a scenario.**
Owner opens `/p/finance/scenarios` → a new scenario is created from the current
fact: balances as of today, the recent cost structure, the current unit cost →
the owner adds assumptions (a hire from March, a price change, a new
subscription) → P&L and cash flow over the horizon recompute as each assumption
is entered → the milestones update.

**Comparing.**
Two scenarios are placed side by side on the same baseline, and the owner reads
the difference. _(`agent-proposed — UNCONFIRMED`)_

**A scenario becomes real.**
An assumption actually happens → it is recorded through F2 as a real operation →
nothing is copied from the scenario, and the scenario's baseline moves with the
fact on the next reading. There is no "promote scenario to ledger" act.
_(`agent-proposed — UNCONFIRMED` as an explicit rule; it follows from decision 1)_

**Reading a stale scenario.**
A scenario built on an older baseline either re-bases on today's fact or says
which baseline it is frozen at — never silently mixes the two. _(see US-11 open
question)_

## Product acceptance criteria

- A new scenario starts from BBM's real current position without the owner
  entering any of it.
- The owner can add a future expense and see the projected P&L and cash flow
  change.
- The owner can add future income and see the same.
- The owner can change a product's sale price and see the effect on the result.
- The owner can change a unit's production cost and see the effect on margin.
- The owner can see the month in which a scenario runs out of cash, or that it
  does not.
- The owner can see when a scenario reaches operational break-even.
- A scenario writes nothing into the ledger.
- No number produced by a scenario appears in any fact report.
- The owner can see the list of assumptions a scenario makes, separately from its
  results.
- A saved scenario can be reopened, and it states the baseline it uses.
- Two scenarios can be compared on the same baseline.

## Out of scope

- Anything that changes the ledger. A scenario is read-only against the fact.
- Token, royalty and profit-share mechanics — an open owner fork
  (prior art §2, §3); a scenario projects the operating business.
- Replacing the money-route calculator as the holding's investment model: that
  one answers a different question, for a different audience, with hard-coded
  royalty and 4/2/1 proportions (prior art §1).
- Multi-user scenario collaboration.
- Automatic forecasting from history — every assumption is entered by the owner.

## Open questions

1. **Is a scenario re-based on the fact when reopened, or frozen at its
   baseline?** The two behaviours are both defensible and only the owner can pick
   which one matches how he uses it.
2. **What is the horizon** — 12 months, 36, the finmodel's `T`?
3. **Do the three milestones (operational break-even, cash zero, investor
   payback) belong here?** They come from the money-route model, which has open
   owner forks; decision 7 does not name them.
4. **Which future currency rate does a scenario assume** — today's, or a rate the
   owner sets per scenario?
5. **Does a scenario need to be shareable** with Eduard or an investor, given
   `/p/*` requires a workspace login?
