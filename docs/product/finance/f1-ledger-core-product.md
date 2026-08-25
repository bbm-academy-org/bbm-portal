---
status: Draft
epic: finance (#115) — see ./brief.md
surface: backend-only # the ledger itself has no screen; its reference tables are administered in /p/admin (epic #112)
updated: 2026-08-25
---

# F1 — Ledger core: accounts, project dimension, postings, currencies, reversal (#115)

## Feature summary

The definition of "a fact of money" for BBM: what is recorded, in what unit,
against what, and how a mistake is undone. Everything else in the epic reads
from here or writes into here.

The owner chose **full accounting with the ledger as the source of truth** over a
manual-aggregates calculator (decision 1). That choice is what this feature
carries: an amount is not a cell someone typed into a report — it is a posting,
in a currency, on a date, on an account, tagged with a project, traceable to the
source that produced it.

**The engineering frame is already fixed and is not re-decided here** —
consolidation spec §8: double-entry; postings immutable, with reversal
(«сторно») instead of edits; amounts in the currency's minimal units as bigint
with currency-dependent precision (RUB kopecks, BTC satoshi); a conversion is a
**linked group** of postings carrying each step's fee explicitly and the rate
frozen at the moment of the operation; the ledger links to `member` and to the
`/p/hours` data (contextual rates, #103). Storage follows ADR-004: the
`platform` database, tables owned by the finance module alone
(`schema/finance/`), with `core` deliberately not predetermining the finance
schema. The module is a route + isolated library per ADR-002 §3.

**Perimeter:** all of BBM, with a per-project analytical dimension — the fund
plus each project — so P&L and cost are computable per project, matching the
finmodel's "pool = project" frame (decision 2).

**Currencies from day one:** RUB, crypto, and other fiat — THB is live spend
today (decision 4). Multi-currency is a product property, not only a schema
property: it reaches the UI in F2 and F3.

**Reference data is editable, not hard-coded** (decision 10): accounts, expense
categories, projects, products, currencies and rates are reference tables an
owner maintains. Their administration surface is the `/p/admin` shell of epic
#112 — this feature contributes the resources, not a second cabinet.
_(`agent-proposed — UNCONFIRMED` that all six live in `/p/admin` rather than in
`/p/finance`; decision 10 fixes only that the taxonomy is an editable table.)_

## Starter expense taxonomy — `agent-proposed — UNCONFIRMED`

Decision 10 says the agents propose a starter taxonomy and the owner approves it
at the design gate. This is that proposal. It is grounded in the only real cost
model in the estate — the DS lesson-cost calculator, which models per-role
payroll with employment-mode tax loading (штат ≈ ×2, ИП/УСН +8%, самозанятый/НПД
+6%), external vendors, and a contingency buffer (prior art §4) — plus BBM's
actual spend shape.

Two levels: a **category** (stable, the P&L line) and a free **subcategory**
(added during operation without a schema change).

| #   | Category                    | What lands here                                                               | Typical currency | Feeds                       |
| --- | --------------------------- | ----------------------------------------------------------------------------- | ---------------- | --------------------------- |
| 1   | Payroll — team via hours    | accruals from `/p/hours`: role rate × actual hours; cash and invest parts     | RUB              | auto (F2), unit cost        |
| 2   | Payroll — taxes and charges | the employment-mode loading on category 1 (штат / ИП / НПД), as its own line  | RUB              | derived or manual           |
| 3   | Contractors and vendors     | external people and studios paid per work, not per hour                       | RUB, THB, USD    | expense request             |
| 4   | SaaS and infrastructure     | hosting, domains, AI/API spend, tools — the recurring foreign spend           | THB, USD, crypto | bank import, card statement |
| 5   | Marketing and acquisition   | ads, promotion, content distribution                                          | RUB, USD         | expense request             |
| 6   | Content production          | production spend attributable to a sellable unit (a lesson, a course)         | RUB              | unit cost                   |
| 7   | Legal, banking and fees     | accounting services, bank fees, conversion and network fees                   | any              | linked to conversions       |
| 8   | Equipment and one-off       | hardware and capitalisable one-off purchases                                  | RUB, THB         | expense request             |
| 9   | Other operating             | the residual line; a category that grows here is a candidate for its own line | any              | manual                      |

Three properties the taxonomy must have, independent of the exact list:

- **Every category is allocatable or not**, explicitly — categories 1, 3, 6 flow
  into a unit's cost; 5 and 9 are period costs by default. The flag is data, not
  code.
- **Tax loading is a line, not a multiplier hidden in a rate** — the DS model's
  lesson is that the employment mode changes the true cost by up to 2×, and the
  owner must see it.
- **A contingency buffer is a scenario input, never a posting** — the DS model
  applies +15% payroll / +25% external as a planning cushion. A ledger records
  what happened; the cushion belongs in F5.

## User stories

- **US-1** — As the owner, every amount I look at is a posting in a ledger with
  a date, a currency, an account and a project, not a number someone typed into a
  report. _(decision 1)_
- **US-2** — As the owner, I see the fund and each project separately, and the
  whole of BBM as their sum, from the same records. _(decision 2)_
- **US-3** — As the owner, I record spend in RUB, in THB and in crypto, and each
  amount keeps its own currency rather than being pre-converted into roubles at
  entry. _(decision 4)_
- **US-4** — As the owner, when money moves between currencies I see what left,
  what arrived, what the conversion cost in fees, and at what rate — as one
  linked operation rather than two unrelated entries. _(consolidation spec §8)_
- **US-5** — As the owner, a wrong entry is corrected by a reversal that leaves
  the original visible, so the history of the books never silently changes.
  _(consolidation spec §8)_
- **US-6** — As the owner, every posting tells me where it came from — a bank
  import, an approved expense request, an hours accrual, or a person's manual
  entry. _(decision 3)_
- **US-7** — As the owner, I edit the list of expense categories myself when the
  spend shape changes, without waiting for a release. _(decision 10)_
- **US-8** — As the owner, I define the sellable products of a project (a
  Doctor.School lesson, a course) so that cost and break-even have a unit to
  attach to. _(decision 9)_
- **US-9** — As the owner, an amount attributable to a person is linked to that
  member, so "what did we pay X" is a query and not an archaeology exercise.
  _(consolidation spec §8: link to `member`)_
- **US-10** — As the owner, an accrual raised by `/p/hours` is the same kind of
  fact as anything else in the ledger, so hours money and bank money add up in
  one P&L. _(decision 3)_
- **US-11** — As the owner, my accounts (bank, card, crypto wallet, cash) are a
  list I maintain, and each posting names the account it moved on.
  _(`agent-proposed — UNCONFIRMED`: decisions 3–5 imply accounts exist; the owner
  never enumerated them)_
- **US-12** — As the owner, income is recorded with the same machinery as
  expense, so P&L and cash flow have both sides. _(decision 5 requires P&L and
  cash flow, which require revenue)_

## Flows

**Recording one operation.**
A source produces an operation (F2) → it becomes a balanced set of postings on
accounts, dated, in one currency, tagged with fund-or-project and, where the
category is allocatable, with a product → it is visible in the register (F3) from
that moment.

**A conversion (RUB → USDT → THB).**
One operation, a linked group of postings: the amount leaving, the amount
arriving, the fee of each step as its own posting, and the rate as recorded at
the moment of the operation. The group is read and displayed as one thing, never
as loose entries. _(consolidation spec §8)_

**Correcting a mistake.**
The original posting is never edited. A reversal is issued, referencing it; both
remain visible; the reversed pair nets to zero in every report. If the fact was
also wrong (not just mis-entered), a new correct operation is recorded after the
reversal. _(consolidation spec §8)_

**Changing the taxonomy.**
The owner adds or renames a category in the reference table. Existing postings
keep pointing at the category they carry; a category in use cannot simply
disappear — it is retired rather than deleted. _(`agent-proposed — UNCONFIRMED`:
decision 10 fixes editability, not the retirement rule)_

**Adding a currency.**
The owner adds a currency with its minimal unit and precision; amounts in it are
recordable immediately, and every report gains it. No release is needed.
_(`agent-proposed — UNCONFIRMED` as a product rule; §8 fixes only the storage
form)_

## Product acceptance criteria

- The owner can see every recorded operation of BBM in one place, with its date,
  amount, currency, account and project.
- Any amount in the ledger can be traced to the project it belongs to, or is
  explicitly the fund's.
- An amount recorded in THB is displayed in THB, and an amount in crypto in that
  crypto, without silent conversion at entry.
- A conversion between two currencies is shown as one operation with its fees and
  its rate, not as separate unexplained entries.
- The rate used for a conversion still shows the rate of the day of the
  operation, even when read a year later.
- No recorded amount can be altered after the fact; a correction always appears
  as an additional visible entry.
- A reversed operation leaves the reports as if it had not happened, while both
  entries remain visible in the register.
- The owner can tell, for any posting, which source produced it.
- The owner can add, rename and retire an expense category without a developer.
- A category in use by existing postings cannot be removed in a way that leaves
  those postings uncategorised.
- The owner can define the sellable products of a project and attach costs to
  them.
- Money attributable to a member can be listed per member.
- An hours accrual and a bank payment appear in the same P&L without a manual
  merge step.

## Out of scope

- The schema, table names and migration order — the feature spec's job
  (ADR-004 §6 fixes only where the tables live and who may import them).
- Who is allowed to post — the roles are F2's subject (decision 8).
- Any report — F3.
- Payout, token and waterfall mechanics: the profit-share proportions, the
  royalty cascade and the OPEX-tier fork are holding-level questions with open
  owner forks (prior art §2, §3). The ledger records what happened; it does not
  decide who gets it.
- Tax filing and any statutory reporting form.

## Open questions

1. **The starter taxonomy above needs the owner's approval** at the design gate,
   including whether the payroll split into two lines (accrual vs employment-mode
   loading) matches how he thinks about the cost of a person. _(decision 10)_
2. **Does a project's P&L need sub-projects** (a project → a course → a lesson),
   or is one flat project level with a product beneath it enough? Decision 2
   fixes only "per project"; decision 9 puts the sellable unit under it.
3. **How far back does the history backfill go**, and does the opening state of
   each account get an explicit opening-balance operation? _(affects F2)_
4. **Are crypto holdings revalued** when the rate moves, or held at the recorded
   rate until they move again? The frozen-rate rule (§8) covers the operation,
   not the holding.
