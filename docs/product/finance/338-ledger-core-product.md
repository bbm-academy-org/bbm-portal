---
status: Draft
epic: finance (#115) — see ./brief.md
surface: backend-only # the ledger itself has no screen; its reference tables are administered in /p/admin (epic #112)
updated: 2026-08-25
---

# F1 — Ledger core: accounts, project dimension, postings, currencies, reversal (#338)

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
finmodel's "pool = project" frame (decision 2). **Projects are one flat level —
owner ruling, decision 16 (owner 2026-08-25, wireframe review):** there are no
sub-projects in v1; the sellable product sits directly under the project, and the
project → product pair is the whole hierarchy the ledger carries.

**The books start at the first operation ever — owner ruling, decision 17 (owner
2026-08-25).** The owner locates BBM's first operation and that date is the start
of the books. Everything since is on record («всё зафиксировано»), so **every
account opens at zero** and its balance is built by the backfilled operations
themselves. There is no synthetic opening-balance operation in this model, and no
"as of" cutover state to reconcile against. _(The backfill mechanism itself is
F2's; F1 only fixes that nothing but real operations creates a balance.)_

**Product is mandatory on product-attributable expenses — owner ruling, decision
22 (owner 2026-08-25).** Every expense attributable to a product ties to one,
because the module must be able to compute the **capitalization of each product**
— its accumulated invested cost. Per-product capitalization is therefore a
deliverable of the module, not an optional report. For overhead that has no
product by nature (bank fees, the fund's domain, legal), the owner ruled: follow
**proper-accounting best practices** — and made the research a duty of the F1
feature spec, which proposes the standard treatment (direct cost → cost object;
overhead → period cost or an allocation base; capitalization = direct +
attributable overhead) for the owner's sign-off at the spec go. This PRD fixes
the requirement, not the accounting rule.

**Currencies from day one:** RUB, crypto, and other fiat — THB is live spend
today (decision 4). Multi-currency is a product property, not only a schema
property: it reaches the UI in F2 and F3.

**Reference data is editable, not hard-coded** (decisions 10, 11, 21): accounts,
expense categories, **request purposes**, projects, products, currencies and
rates are reference tables an owner maintains. Their administration surface is
the `/p/admin` shell of epic #112 — this feature contributes the resources, not a
second cabinet. _(`agent-proposed — UNCONFIRMED` that all seven live in
`/p/admin` rather than in `/p/finance`; decisions 10–11 and 21 fix only that
these are editable tables.)_

**The purpose reference — owner ruling, decision 21 (owner 2026-08-25):** the
"what for" of an expense is picked from a **separate purpose reference**
(«справочник назначений»), finer-grained than the category list, with **each
purpose linked to its expense category** — «максимально упрощаем и
систематизируем всё». Free text survives only as an optional details comment
beside the picked purpose, never as the purpose itself. F1 owns the reference
table and the link from purpose to category; the request form that picks from it
is F2 (#339).

## Expense taxonomy — derived from the fact, not invented upfront

**Owner ruling, decision 11 (owner 2026-08-25):** the categories are **not**
invented upfront — «не будем выдумывать того, чего нет». When the filling
mechanism is built (F2, and in particular the backfill of what has actually been
spent), the category list is **derived from the real recorded expenses** and
brought to the owner for approval. This supersedes the "agents propose a starter
taxonomy" half of decision 10; the other half stands — categories live as an
**editable reference table** in the system, never hard-coded, and the owner adds,
renames and retires them without a release.

What F1 therefore delivers is the **slot, not the list**: a posting carries a
category, and the category reference table ships empty. Filling it is F2's
derivation step followed by the owner's approval; no seeded taxonomy is part of
this feature.

### Requirements on whatever taxonomy emerges — `agent-proposed — UNCONFIRMED`

These are **lead-proposed constraints on the derived list, not a list**, and none
of them is owner-confirmed. They come from the only real cost model in the estate
— the DS lesson-cost calculator, which models per-role payroll with
employment-mode tax loading (штат ≈ ×2, ИП/УСН +8%, самозанятый/НПД +6%),
external vendors and a contingency buffer (prior art §4).

- **Allocatable-or-period is a flag on the category, and it is data** — some
  categories flow into a sellable unit's cost, others are period costs. Whichever
  categories the derivation produces, the split must be settable per category
  without a release, not compiled into code.
- **Tax loading is visible as its own line, not a multiplier hidden in a rate** —
  the DS model's lesson is that the employment mode changes the true cost of a
  person by up to 2×, and the owner must be able to see that part separately.
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
  linked operation rather than two unrelated entries; the rate recorded is the
  **actual rate the conversion happened at**, frozen at its date, not a market
  quote fetched afterwards. _(consolidation spec §8; decision 18, owner
  2026-08-25 — the same actual-rate rule governs how F3 (#340) converts across
  currencies in reports)_
- **US-5** — As the owner, a wrong entry is corrected by a reversal that leaves
  the original visible, so the history of the books never silently changes.
  _(consolidation spec §8)_
- **US-6** — As the owner, every posting tells me where it came from — a bank
  import, an approved expense request, an hours accrual, or a person's manual
  entry. _(decision 3)_
- **US-7** — As the owner, I edit the list of expense categories myself when the
  spend shape changes, without waiting for a release — and the list I start from
  is the one derived from what we actually spent, not one invented for me.
  _(decisions 10, 11)_
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
  expense, so P&L and cash flow have both sides.
  _(`agent-proposed — UNCONFIRMED`: decision 5 requires P&L and cash flow, which
  require revenue; the owner never named income recording as its own
  requirement)_
- **US-13** — As the owner, my projects are one flat list with their sellable
  products directly beneath them, so there is one place a cost can be attributed
  to and no nesting to reason about. _(decision 16)_
- **US-14** — As the owner, the books begin at BBM's first real operation and
  every account opens at zero, so a balance is always the sum of operations I can
  open — never an opening figure someone asserted. _(decision 17)_
- **US-15** — As the owner, an expense that belongs to a product carries that
  product, so I can read the accumulated invested cost — the capitalization — of
  each product from the ledger rather than reconstructing it. _(decision 22)_
- **US-16** — As the owner, an expense that genuinely belongs to no product
  (bank fees, the fund's domain, legal) is still recorded correctly, under the
  treatment proper accounting prescribes, and I approve that treatment once at
  the F1 spec go rather than deciding it per operation. _(decision 22)_
- **US-17** — As a person filing an expense, I pick what it is for from the
  purpose reference, and the category follows from the purpose; anything I want
  to add in my own words is a comment beside it, not the purpose.
  _(decision 21)_

## Flows

**Recording one operation.**
A source produces an operation (F2) → it becomes a balanced set of postings on
accounts, dated, in one currency, tagged with fund-or-project and — whenever the
expense is attributable to a product at all — with that product, which is
mandatory there rather than optional _(decision 22)_ → it is visible in the
register (F3) from that moment.

**Opening the books.**
The owner names BBM's first operation; that date starts the books. Every account
is created at zero and reaches its real balance only through backfilled
operations (F2). No opening-balance entry is ever posted. _(decision 17)_

**Filing what an expense is for.**
The purpose is picked from the purpose reference; its expense category comes with
it through the purpose → category link, so a purpose and its category can never
disagree. Free text is an optional details comment on the operation.
_(decision 21)_

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
decisions 10–11 fix editability and where the initial list comes from, not the
retirement rule)_

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
- No expense category is shipped pre-invented: the category table starts empty
  and its first content is the list derived from real recorded spend in F2 and
  approved by the owner.
- A category in use by existing postings cannot be removed in a way that leaves
  those postings uncategorised.
- The owner can define the sellable products of a project and attach costs to
  them, with projects one flat level deep and products directly beneath them.
- No account carries a balance that is not the sum of recorded operations: there
  is no opening-balance entry anywhere in the books.
- An expense attributable to a product cannot be recorded without naming that
  product.
- The accumulated invested cost (capitalization) of any product can be read off
  the ledger.
- An expense that belongs to no product is recorded under the treatment the F1
  spec proposes and the owner signs off, not left uncategorised.
- The "what for" of an expense is a pick from the purpose reference, its category
  follows from the purpose, and free text is only an accompanying comment.
- Money attributable to a member can be listed per member.
- An hours accrual and a bank payment appear in the same P&L without a manual
  merge step.

## Out of scope

- The schema, table names and migration order — the feature spec's job
  (ADR-004 §6 fixes only where the tables live and who may import them).
- Who is allowed to post — the roles are F2's subject (decision 8).
- **Deriving the actual list of expense categories** — that step runs in F2, off
  the backfilled spend, and ends with the owner's approval (decision 11). F1 owns
  only the reference table it lands in.
- Any report — F3.
- Payout, token and waterfall mechanics: the profit-share proportions, the
  royalty cascade and the OPEX-tier fork are holding-level questions with open
  owner forks (prior art §2, §3). The ledger records what happened; it does not
  decide who gets it.
- Tax filing and any statutory reporting form.

## Open questions

1. ~~**Does a project's P&L need sub-projects** (a project → a course → a
   lesson), or is one flat project level with a product beneath it enough?~~
   **Closed by decision 16** (owner 2026-08-25, wireframe review): one flat
   project level, no sub-projects in v1, the sellable product directly beneath
   the project.
2. ~~**How far back does the history backfill go**, and does the opening state of
   each account get an explicit opening-balance operation?~~ **Closed by decision
   17** (owner 2026-08-25): back to BBM's very first operation, which the owner
   locates; accounts open at zero and no synthetic opening-balance operation
   exists. _(The bulk-entry mechanism remains F2's.)_
3. **Are crypto holdings revalued** when the rate moves, or held at the recorded
   rate until they move again? The frozen-rate rule (§8) and decision 18 cover
   the operation, not the holding.
4. **What is the standard treatment of product-less overhead?** Decision 22 fixes
   that proper-accounting best practice governs and that the **F1 feature spec**
   researches and proposes it (direct → cost object; overhead → period cost or an
   allocation base; capitalization = direct + attributable overhead) for the
   owner's sign-off at the spec go. Open as a research duty, not as a product
   fork.
