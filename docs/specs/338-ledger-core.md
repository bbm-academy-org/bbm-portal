---
status: In dev
issue: 338
updated: 2026-11-24
---

# Finance F1 — ledger core — spec (issue #338)

- **Issues:** #338 (this spec, the F1 parent under epic #115); the build is split
  in two — **#356** «Finance F1a — ledger backend core» carries the data model,
  the migrations, the module API and every fact-core invariant — §A, §B,
  EARS-323 and EARS-330…334 — and **#357** «Finance F1b — finance surfaces»
  carries the workspace declaration, `/p/finance` and the `/p/admin/finance/*`
  resources, which are EARS-324/325/326 and nothing else: the write gate, the
  binding as master data and the exception query are enforced in the module
  (#356) and only surfaced here. #357 is blocked by #356 and by the portal-workspace frame
  it plugs into — #314 (`/p` launcher and the registry rendering) and #315
  (`/p/admin` Refine shell); #312 (UI kit) and #313 (`platform-admin` claim gate)
  are already delivered. The split follows the owner's order of 2026-08-26 that
  the backend core is built first and the front-end dependency lives in the
  native issue graph rather than in prose.
- **Issues (§D, budget and funding, 2026-11-24):** #581 (this amendment) under
  #587 «project budget burn dashboard», a sub-issue of epic #115. #581 blocks
  #582, #583 and #584. The implementation of §D is #593 (sub-issue of #587,
  blocked by #581; #583 is blocked by #593), built once the owner accepts the
  amended text.

## Why

The finance epic (#115) needs its foundation: the definition of "a fact of
money" for BBM. F1 delivers the ledger itself — currencies, accounts, the
project→product dimension, immutable double-entry postings with reversal
(сторно), conversion groups with frozen rates, and the editable reference
tables — plus the `/p/admin` resources to maintain those references. Every
other finance feature (intake #339, reports #340, reconciliation #341,
scenarios #342) reads from or writes into what this spec fixes.

Product source: `docs/product/finance/338-product.md` (US-1…US-16); owner
decisions 1–22 live in the #115 issue body. The data model was validated by the
owner on the wireframe prototype (Stage A, 2026-08-25 — see "Design gate").

## Prior decisions

- **ADR-002 §3** — finance is a module in the modular monolith: a route +
  isolated library (`src/lib/finance/`) exposing a public API; it never imports
  another module's internals, and nothing imports its internals.
- **ADR-004 §1, §3** — tables live in the `platform` database, Postgres schema
  `core`, created only through the drizzle migration pipeline
  (`pnpm platform:migrate:generate` → committed migration).
- **ADR-004 §6** — table files live in `src/lib/platform/db/schema/finance/`;
  only the finance module may import them (`pnpm boundaries`); a route imports
  no table file. An FK into another module's table (here: `core.member`) is
  declared in SQL inside the migration, never as a drizzle import across module
  directories — the hours tables are the precedent, and the constraint is
  asserted by an integration test.
- **ADR-004 A1** — the application connects as the least-privilege role;
  migrations run as the migrating role. Nothing in this spec changes grants.
- **ADR-005 §2** — `/p/finance` computes and takes input, so it is a portal
  module; the normative finmodel text stays in the KB. F1 renders no text
  document.
- **Consolidation spec §8** (`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`)
  — the engineering frame, inherited and not re-decided: double-entry; postings
  immutable with reversal instead of edits; amounts as `bigint` in the
  currency's minimal units with currency-dependent precision; a conversion is a
  linked group of postings with each step's fee explicit and the rate frozen at
  the operation; links to `member` and the `/p/hours` data.
- **Finance PRDs, owner decisions 13 and 18**
  (`docs/product/finance/brief.md`, `docs/product/finance/340-product.md`) — a
  reporting view defaults to RUB and can switch currency without changing a
  posting; any cross-currency amount uses recorded actual conversion facts,
  never a market/current rate fetched at read time. For F1b's **current
  holdings** total, this spec applies that ruling as a chronological remaining-
  holding replay per currency pair and a deterministic graph over those pair
  rates (EARS-325), separate from EARS-328's write-time realized-FX calculation.
  Period reports
  continue to apply their broader per-operation actual-rate semantics in F3.
- **Spec 311 §A, §D** (EARS-401/402/409, EARS-431…439) — the workspace
  declaration contract: finance declares one `internal` entry with an `admin`
  section; its resources mount at `/p/admin/finance/<resource>` through the
  registry, with zod schemas, readable refusals and audited writes.
- **Spec 201 / ADR-004 A1** (`docs/specs/201-universal-edit-audit.md`, migration
  `0003`, coverage guard `tools/lint/audit-coverage-lint.mjs`) — every cabinet
  write runs through `platformTransaction` with the signed-in admin as actor, so
  reference edits are attributable in `core.audit_event` (spec 311 EARS-439).
  This is the who/when/what record for finance reference edits, including a
  change of a purpose's `product_binding`: F1 adds **no** dedicated
  binding-change journal on top of it (Accounting policy, ruling 2).

**Donor & benchmark pass:** the engineering constraints above are inherited from
the consolidation spec §8 and the hours schema conventions (spec 124), each
justified for this domain in place. The three accounting questions the PRD left
open (#338 OQ3/OQ4/OQ5) were researched against public canon — IAS 38.67,
IFRS 15.97(e)/15.98(a), IFRS 8.28, IAS 21 with the IFRIC June 2019 agenda
decision on cryptoassets, the IMA Conceptual Framework for Managerial Costing
(causality / attributability), CIMA's allocation-vs-apportionment distinction
and the Garrison segment-margin statement — and the resulting rulings in
"Accounting policy" below were **accepted by the owner at the stage-2 go
(2026-08-26, #338)**, the overhead ladder with five amendments. No owner
question in this spec asks what public research answers.

The F1b total correction on 2026-08-30 re-read the primary owner register
(#115 decisions 13 and 18) and the owner-validated `Overview.dc.html` artifact
rather than introducing another benchmark: the product policy is already
settled as switchable presentation over actual operation rates, with no
read-time market rate. EARS-325's deterministic pair-rate graph is the read-
model mechanism for that accepted policy.

**Scope note on IFRS.** No IFRS standard governs management accounting; this
register is an internal decision ledger, not a statutory measurement. Where a
standard is cited below it is cited for the reasoning it supplies, never as
authority over this ledger — and **IAS 2 is deliberately not cited in support of
non-allocation**: IAS 2.12 _requires_ a systematic allocation of production
overheads, it governs the balance-sheet carrying amount of inventory (which BBM
does not hold), and its old §19 on service providers was deleted by the IFRS 15
consequential amendments. The honest anchors are IAS 38.67(a) (selling,
administrative and other general overhead expenditure is not a component of an
internally generated intangible's cost _unless_ it can be directly attributed to
preparing the asset for use — IAS 38.66 does include directly attributable
costs), IFRS 15.97(e)/15.98(a), and — for the reporting shape — IFRS 8.28's
reconciliation of segment results to entity result with unallocated corporate
costs identified and described.

**IFRS 15.97 is borrowed for one criterion, not as a ban on allocation.** The
same trap that IAS 2 sets is set by IFRS 15: **97(c) expressly permits
«allocations of costs that relate directly to the contract or to contract
activities»**, so a reader must not take the citations below as IFRS
prohibiting allocation bases. Only **97(e)** («other costs that are incurred
only because an entity entered into the contract») is used here, and only for
its «would not exist without» criterion. The design choice to post no
allocation base is a **management-accounting** choice — IMA causality /
attributability, CIMA's allocation-vs-apportionment distinction, and IAS 38.67's
direct-attribution ladder — not the application of a prohibition that no
standard states.

## Current behavior → replacement delta

There is no finance counterpart today. `src/lib/` holds `finmodel` (a CI-only
snapshot guard, never routed — ADR-005 §3), `hours`, `member`, `okr`,
`platform`; `src/modules/` holds `hours`, `okr`. Money exists in the estate only
as `/p/hours` accruals (spec 124) and the finmodel plan. F1 creates the first
ledger; nothing is replaced, and no existing surface changes.

## Design gate (stage 1b)

The owner validated the finance wireframe prototype on 2026-08-25 (Claude
Design canvas «Финконтур BBM — вайрфреймы», recorded on #115). The artboards F1
builds against are vendored verbatim in `design-source/finance/`:

- `Main.dc.html` — the data-model diagram («Модель данных леджера — что мы
  утверждаем»), the approved shape of the schema;
- `References.dc.html` — the `/p/admin` reference tables;
- `Overview.dc.html` — `/p/finance`; F1 ships only its cash-balances card.

For avoidance of doubt, that accepted cash card includes its «Итого» column and
the reporting-currency switch in EARS-325. «The rest of the overview is F3»
means the other cards and report
navigation in `Overview.dc.html`; it does not remove part of the cash card.

The remaining nine artboards belong to F2–F5 and are vendored on their first
touch (design-source rule 4). F1's admin screens follow the accepted admin-shell
design (`design-source/p-admin-shell.html`, spec 311 EARS-432) — no new Stage-A
pick is needed.

## Data model (lead-level engineering decisions)

Directory `src/lib/platform/db/schema/finance/`, Postgres schema `core`, table
prefix `finance_`. No table stores a balance or a capitalization — both are
sums over postings, always. The balances-card total is likewise a chronological
read-model replay over existing immutable operations, postings and conversion
steps: it stores no total, display rate, valuation pool or valuation fact and
requires no F1a schema, migration, write-path or domain-model change. It does
not reuse or widen EARS-328's realized-FX pair pool.

| Table                     | Carries                                                                                                                                                                                                                                                                                                 | Key points                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `finance_currency`        | `code` PK (`RUB`, `THB`, `USDT`…), `name`, `precision` (decimal places of the minimal unit: RUB 2, THB 2, USDT 6), `retired_at`                                                                                                                                                                         | precision is frozen once a posting in the currency exists                                                                |
| `finance_account`         | `id`, `name`, `kind` (`bank`\|`card`\|`crypto`\|`cash`\|`income`\|`expense`\|`conversion`\|`fx_result`\|`liability`\|`equity` — `equity` added by §D, EARS-335), `currency` FK, `is_system`, `retired_at`                                                                                               | owner accounts are the four money kinds; system kinds are module-managed, one per (kind, currency), created on demand    |
| `finance_project`         | `id`, `name`, `is_fund`, `retired_at`                                                                                                                                                                                                                                                                   | one flat level (decision 16); exactly one fund row («Фонд BBM») seeded by migration                                      |
| `finance_product`         | `id`, `project` FK, `name`, `sale_price` + `sale_price_currency` (both nullable), `retired_at`                                                                                                                                                                                                          | sits directly under its project (decision 16); capitalization is derived, not stored                                     |
| `finance_purpose`         | `id`, `name`, `category` FK (nullable while the category list is empty), `product_binding` (`required`\|`forbidden`\|`optional`), `retired_at`                                                                                                                                                          | decision 21: a purpose is a reference pick; the binding is declared at creation (Accounting policy, ruling 2)            |
| `finance_category`        | `id`, `name`, `allocable` (boolean: flows into unit cost vs period cost), `retired_at`                                                                                                                                                                                                                  | ships **empty** (decision 11); first content is prepared from the real history and owner-approved                        |
| `finance_operation`       | `id`, `occurred_on` (date), `purpose` FK (nullable — transfers, conversions and income carry none), `source` (`request`\|`bank_import`\|`hours`\|`manual`\|`backfill`\|`reversal`), `source_ref` (nullable text, filled by F2's intakes), `backdated` (boolean), `reverses` FK (nullable, unique, self) | the unit the register shows; a conversion chain is ONE operation                                                         |
| `finance_posting`         | `id`, `operation` FK, `account` FK, `amount` (`bigint`, signed, minimal units; debit > 0, credit < 0), `currency` FK, `project` FK (nullable), `category` FK (nullable), `product` FK (nullable), `member_id` (nullable, SQL FK → `core.member`), `conversion_step` FK (nullable)                       | the atomic fact; immutable                                                                                               |
| `finance_conversion_step` | `id`, `operation` FK, `step_no`, `from_currency` FK, `to_currency` FK, `rate` (numeric text, as recorded)                                                                                                                                                                                               | one row per exchange step; its fee is a separate posting referencing the step                                            |
| `finance_budget`          | `id`, `project` FK (the fund in v1), `name`, `amount` (`bigint`, minimal units), `currency` FK, `starts_on` (date), `retired_at`, audit columns                                                                                                                                                         | §D, EARS-338: a limit, never a posting; at most one unretired row per project; the amount is data, never repository text |

Double-entry works over a chart of accounts that includes the system kinds: an
expense debits the per-currency system `expense` account and credits the money
account; the P&L dimensions (project, category, product, member) ride on the
expense-side posting. This keeps decision 11 intact (categories are data, not
accounts), keeps every operation balanced per currency, and gives F3 its
reports as plain sums.

## Requirements

Ids continue the flat corpus keyspace: this spec takes the next free
hundred-block, **EARS-301…** (spec 311 holds 401–499).

### A. Reference tables (справочники)

- **EARS-301.** The finance module shall store currencies, accounts, projects,
  products, purposes and expense categories as editable reference tables, per
  the vendored `design-source/finance/References.dc.html`.
- **EARS-302.** WHEN the owner adds a currency with its precision, the system
  shall accept postings in that currency immediately, with no release.
- **EARS-303.** IF a posting exists in a currency, THEN the system shall refuse
  a change to that currency's precision.
- **EARS-304.** The system shall seed exactly one fund project row («Фонд BBM»)
  in the migration, and shall refuse to retire it or to create a second fund
  row.
- **EARS-305.** The system shall create system accounts (income, expense,
  conversion, fx_result, liability) itself, one per kind and currency on first
  need, and the cabinet shall not offer creating, editing or retiring them.
  _(Amended 2026-11-24 by §D (#581): the system kinds gain `equity`, the
  contributed funds (EARS-335), created and protected exactly like the five
  above.)_
- **EARS-306.** WHEN a purpose is created, the system shall require its
  `product_binding` (`required` / `forbidden` / `optional`) to be declared, and
  shall link the purpose to an expense category WHERE the category list is
  non-empty.
- **EARS-307.** The expense category table shall ship empty: no migration, seed
  or fixture inserts a category (decision 11); each category row shall carry an
  `allocable` flag stating whether it flows into unit cost or is a period cost.
- **EARS-308.** IF a reference row (currency, account, project, product,
  purpose, category) is referenced by any posting, operation or purpose, THEN
  the system shall refuse to delete it and shall offer retirement instead;
  a retired row shall stay valid on every existing posting and shall stop
  being offered for new ones.
- **EARS-309.** The system shall never rewrite an existing posting as a
  consequence of a reference edit — renames and retirements change how rows
  read going forward, never what was recorded.

### B. The fact core: operations, postings, reversal, conversions

- **EARS-310.** The finance module shall record money only as operations made
  of postings: each posting names its account, a signed `bigint` amount in the
  currency's minimal units, and its currency; each amount keeps the currency it
  happened in. The one F1b cross-currency view is the current-holdings total in
  the balances card (EARS-325); conversion of period activity and every other
  reporting view is F3.
- **EARS-311.** The system shall refuse to record an operation whose postings
  do not sum to zero per currency.
- **EARS-312.** IF a posting's currency differs from its account's currency,
  THEN the system shall refuse the operation.
- **EARS-313.** The system shall refuse any update or delete of a recorded
  operation or posting, at the module API and — as an accident guard, per the
  spec-201 precedent — with database triggers on both tables; the only
  correction is reversal.
- **EARS-314.** WHEN an operation is reversed (сторно), the system shall record
  a new operation with `source = reversal`, referencing the original, whose
  postings mirror the original's with negated amounts and identical dimensions;
  both operations shall remain visible, and their sum shall be zero in every
  cut.
- **EARS-315.** IF an operation has already been reversed, THEN the system
  shall refuse a second reversal of it; a reversal operation itself shall be
  reversible (undoing a mistaken reversal).
- **EARS-316.** Every posting shall be traceable to its source: the operation
  carries one of `request` / `bank_import` / `hours` / `manual` / `backfill` /
  `reversal` (decision 3); backfilled operations carry the `backdated` flag
  (decision 17 context). F1 fixes the enum and the columns; F2 fills
  `source_ref` for the sources it actually implements. `bank_import` remains a
  reserved future source and does not imply an import surface in F2.
- **EARS-317.** The system shall provide no opening-balance mechanism: every
  account starts at zero and its balance is exclusively the sum of its postings
  (decision 17).
- **EARS-318.** The system shall record a currency conversion as ONE operation:
  its exchange steps as `finance_conversion_step` rows each carrying the actual
  rate as recorded at the operation (decision 18), each step's fee as its own
  posting, and the legs balanced per currency through the system conversion
  account.
- **EARS-319.** The system shall never restate a recorded rate or amount: a
  conversion read a year later shows the rate of its day (decision 18), and no
  process revalues crypto or currency balances by posting (Accounting policy,
  ruling 3).
- **EARS-320.** WHEN a purpose with `product_binding = required` is used on an
  expense operation, the system shall refuse to record it without a product;
  WHEN the binding is `forbidden`, the system shall refuse a product on it;
  WHERE the binding is `optional`, the product may be absent (decision 22;
  Accounting policy, ruling 2).
- **EARS-321.** Every posting on an income or expense system account shall name
  a project (the fund row counts as one), so P&L is computable per project and
  for the whole of BBM as their sum (decision 2).
- **EARS-322.** WHERE an amount is attributable to a person, the posting shall
  carry `member_id`, declared as an SQL FK to `core.member` in the migration
  (ADR-004 §6) and asserted by an integration test, so "what did we pay X" is a
  query.
- **EARS-327.** WHEN an operation carries a purpose whose category link is
  filled, the system shall set that category on the operation's expense-side
  postings itself and shall refuse a differing one — a purpose and its category
  can never disagree on a posting (decision 21).
- **EARS-328.** WHEN an operation's conversion steps dispose of a holding of
  crypto or another currency — an operation that itself establishes an actual
  rate (decision 18) — the system shall compute the realized difference
  between that rate and the holding's **weighted-average recorded rate**, and
  shall post it inside the same operation to the system `fx_result` account of
  the fund — never onto a product — with the system `conversion` account as
  the balancing counter-leg in the same currency, keeping EARS-311's
  per-currency zero-sum intact (Accounting policy, ruling 3; the recorded legs
  themselves are never restated).
  The average is of the **remaining** holding, moving-average cost flow: every
  disposal removes its quantity from the pool together with the share of cost
  that quantity carried, so an acquisition made after a disposal prices the next
  one and a lifetime average of every purchase ever made does not. It is derived
  from recorded postings rather than from re-applied rate strings — the exchange
  legs of the pair's prior steps, summed rather than sign-filtered, so a
  reversal cancels its original (EARS-314) — which keeps the arithmetic exact
  integer arithmetic and restates nothing (EARS-319). WHERE the ledger holds no
  remaining recorded acquisition of the disposed currency against the received
  one, the system shall post no FX result at all rather than invent a basis; the
  `conversion` account is a clearing account and shall read zero once every unit
  acquired has been disposed of. _(Recorded 2026-08-26 from the #370 review, so
  the clause and `src/lib/finance/conversions.ts` cannot drift; the F1a
  limitation that the pool is per currency PAIR is named in that module's
  header.)_
- **EARS-329.** IF an operation carries no conversion step (a payment or
  transfer in one currency), THEN the system shall post no FX result: the
  ledger holds no rate source for it (decision 18 records only actual
  operation rates), and any unrealised movement is an F3 display concern
  (ruling 3), never a posting.

### C. Module structure, admin resources, audit

- **EARS-323.** The finance module shall live as `src/lib/finance/` with its
  public API in `src/lib/finance/index.ts` (ADR-002 §3), exposing recording,
  reversal, reference management and balance/register queries; its tables shall
  appear only via the platform migration pipeline (ADR-004 §3), and
  `pnpm boundaries` shall stay green: only the finance module imports
  `schema/finance/`, and no route imports a table file.
- **EARS-324.** The module shall export one `internal` workspace declaration
  (slug `finance`, href `/p/finance`) carrying **no** `requiredClaim` — the
  owner's transparency policy makes BBM's money readable by every platform
  member, so the entry rides the workspace-wide `platform-user` gate (spec 311
  EARS-416) and nothing narrower — with an `admin` section declaring the
  reference resources, registered in the composition root (spec 311
  EARS-401/402), so they mount at `/p/admin/finance/<resource>` with no edit to
  the shell (EARS-409).
- **EARS-325.** WHEN any signed-in platform member opens `/p/finance`, the page
  shall render the cash card of the vendored
  `design-source/finance/Overview.dc.html`: every money account with
  its balance computed live from postings and shown in that account's own
  currency, plus an overall total in a selected reporting currency. The
  reporting currency shall default to RUB and shall be switchable without
  changing any operation, posting or native-currency account balance (owner
  decision 13).

  «Money account» is normatively the KIND, not the `is_system` flag: an account
  of kind `bank`, `card`, `crypto` or `cash` that is not system-managed. A row of
  any other kind — `income`, `expense`, `liability`, `conversion`, `fx_result`,
  and since §D `equity` (EARS-335) —
  is never a cash tile and never enters the total, whatever its flag says.

  A RETIRED money account is treated by its BALANCE, not by its retirement
  (owner ruling by Антон, 2026-08-31, recorded on #357): a retired account whose
  balance is zero shall be hidden from the card entirely — it holds nothing and
  is no longer offered for new postings (EARS-308) — while a retired account
  with a NONZERO balance shall keep its tile, marked «архивный», and shall
  count in the aggregates and the total exactly like any other money account.
  The money is still BBM's while the balance is not zero; retirement changes
  what the account is offered for, never what it holds. Retirement therefore
  never moves a number.

  A conversion step whose `from_currency` equals its `to_currency` is malformed:
  it establishes no rate and makes that pair unavailable.

  The total shall be a reproducible reading of recorded facts, never a silent
  conversion. The finance public API shall first aggregate all money-account
  balances by currency while the card still displays the individual
  account rows. It shall then replay the existing immutable conversion steps in
  chronological `(occurred_on, operation_id, step_no)` order into exactly one
  canonical remaining-holding pool for each unordered currency pair. The replay
  derives each step's disposed amount as the positive net of its step-linked
  system `conversion` postings in `from_currency`, and its received amount as
  the absolute negative net of those postings in `to_currency`. A missing or
  non-positive side, or a step-linked system conversion posting in any third
  currency, makes that pair unavailable. The stored rate text is shown as
  testimony but is not re-applied to restate the posted amounts (decisions 13
  and 18, EARS-318/319).

  Before replay, the read model shall remove both members of every fully
  reversed operation pair, so a reversal is exact even when unrelated
  operations occurred between the original and its reversal (EARS-314). The
  chain shall be resolved along the `reverses` pointer and NOT by date order:
  starting from the chain TIP — the reversal that is itself not reversed — it
  shall cancel pairs downward, so an odd number of reversal acts removes the
  original fact from the replay and an even number leaves it. Dates are not
  normative here: a backdated reversal must not change which facts survive.
  This is the same walk `resolveRealizedFxReversalOccurredOn`
  (`src/lib/finance/fx-pool-locks.ts`) already performs at write time.

  A pair pool carries `held_currency`, its positive `held_quantity`, the other
  `cost_currency`, and non-negative `held_cost`, all in their own minor units;
  initialization always starts with positive cost, while rounded partial
  disposal may leave zero cost. An
  empty pair has no direction; its first valid step `A→B` initializes it as
  `held_currency=B`, `held_quantity=received_B`, `cost_currency=A`,
  `held_cost=disposed_A`. A later step that receives the currently held currency
  adds its received quantity and disposed cost. A step that disposes the held
  currency removes quantity and
  `round_half_away_from_zero(disposed_quantity × held_cost ÷ held_quantity)`
  of its proportional moving-average cost. If a step disposes exactly the held
  quantity, the pair becomes empty. If it disposes more, the replay consumes
  the old pool, attributes
  `round_half_away_from_zero(step_received × held_quantity ÷ step_disposed)` to
  that consumption, and uses `step_disposed - held_quantity` as the opposite
  pool's cost and `step_received - attributed_received` as its held quantity. If
  either residual is non-positive, the pair becomes unavailable; a half-empty
  pool never creates an edge. Once a malformed fact makes a pair unavailable,
  that pair remains unavailable through the end of the replay; a later valid
  step cannot hide the earlier immutable defect.
  A non-positive or malformed leg makes that pair unavailable rather than
  inventing a rate. Conversion endpoints, fees, system postings and ordinary
  non-conversion operations do not create pair-rate events: only actual
  conversion-step amounts establish a cross-currency rate.

  A positive pair pool `Q_A` held in currency `A` at cost `K_B` in currency `B`
  creates two exact reciprocal graph edges: `A→B = K_B / Q_A` and
  `B→A = Q_A / K_B`. A zero or negative quantity or cost creates no edge. To
  value one nonzero native-currency aggregate in the selected reporting
  currency, the read model shall choose the simple path with the fewest edges;
  among equal-length paths it shall choose the lexicographically smallest full
  sequence of currency codes. It shall never traverse a cycle. Direct recorded
  pairs therefore win over inferred multi-hop paths.

  All path ratios shall be multiplied as exact `bigint` numerators and
  denominators. The read model shall apply half-away-from-zero exactly once to
  the final converted amount of each source-currency aggregate, then sum those
  converted integer amounts. The selected currency's own aggregate contributes
  1:1. There is no second rounding at total time.

  The reporting-currency selector shall start from `RUB ∪ account currencies`.
  RUB is always present and is the default. A non-RUB candidate shall be offered
  only when every nonzero native-currency aggregate has a path to it; when every
  aggregate is zero, every candidate is offered and every total is zero. Every
  offered non-RUB option shall therefore produce a numeric total. A stale or
  hand-written unavailable `currency` query shall fall back to RUB. IF RUB is
  unreachable from a nonzero aggregate, THEN the default RUB view shall keep
  every exact native balance visible, withhold the numeric total and name the
  unreachable currencies in ascending code order; this is a degraded data-
  quality state, not an enabled incomplete non-RUB selection. The card shall
  state that it uses actual recorded operation rates and never a market or read-
  time rate.

  The rest of the overview is F3's and shall not be stubbed. A request that does
  not carry `platform-user` (or `platform-admin`, which implies it — spec 311
  EARS-417) shall be refused by the module's own handlers regardless of how the
  URL was reached (spec 311 EARS-405/416): an unauthenticated request, and
  equally an **authenticated** session carrying neither role, which spec 311
  answers with a bare 403 (EARS-418). F1 exposes no public finance surface.

- **EARS-326.** Every cabinet write to a finance reference shall run through
  `platformTransaction` with the signed-in admin as actor (spec 311 EARS-439),
  and shall validate against the module's zod schemas (EARS-436); a refusal
  (EARS-303/304/308/311/312/313/320) shall reach the admin as the module's
  readable message, never a raw constraint error (EARS-473 shape).
- **EARS-330.** Every reference edit under `/p/admin/finance/*` shall be
  refused by the module's own handlers for a session that does not carry
  `platform-admin`, however the URL or API was reached; read access is
  EARS-325's and is deliberately wider.
  _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`, its
  role clauses in §A) — the F2 role model this clause deferred to, now settled.
  Reference administration stays `platform-admin`; the **ledger** writes,
  posting an operation and reversing one, are gated by the flow roles
  `finance-entry` / `finance-approve` instead, and `platform-admin` by itself
  no longer posts or reverses. **The code caught up with this amendment in #380
  (2026-08-27) and the drift this note recorded is closed:** the single F1a
  guard `assertFinanceWriteAccess` was replaced by the three gates that match
  the three questions — `assertFinanceReferenceAccess` (this clause),
  `assertFinanceLedgerAccess` (spec 339 EARS-501/529) and
  `assertFinanceIntakeAccess` (EARS-501/502) — in
  `src/lib/finance/core/actor.ts`, and `tests/unit/finance-invariants.spec.ts`
  and `tests/int/platform/finance-core.int.spec.ts` assert the amended clause,
  including that an admin without `finance-approve` is refused posting and
  reversal.)_
  _(Amended 2026-09-14 by owner decision 34 (#115) — reference administration
  is no longer `platform-admin` alone: it is open to `finance-entry` as well, so
  a session holding either role may edit the reference tables. The current
  wording lives in spec 339 EARS-529
  (`docs/specs/339-ledger-intake.md`). **The code caught up with this amendment
  in #479 (2026-09-16):** `assertFinanceReferenceAccess` admits
  `FINANCE_REFERENCE_ROLES` — `platform-admin` OR `finance-entry` — and the
  cabinet gate is asked per SECTION, from the claim set the finance entry
  declares in `financeAdminSection.additionalClaims`, so `/p/admin/finance/*`
  and `/api/p/finance/admin/*` admit the same two roles however the URL is
  reached. The audit trail per spec 201 is unchanged.)_
- **EARS-331.** The `product_binding` shall be master data, never a
  per-operation judgement: WHEN an operation is recorded, the system shall take
  the binding from the named purpose and shall accept from the operator only
  the product **value**, never a change of the binding itself; changing a
  binding shall be an edit of the purpose, available to `platform-admin` only
  (EARS-330) and recorded by the universal edit audit (spec 201).
- **EARS-332.** WHEN a purpose's `product_binding` changes, the system shall
  leave every already-recorded posting exactly as posted — it shall neither
  rewrite nor re-validate history against the new rule (EARS-309); the only
  correction of a recorded operation in F1 is reversal (EARS-313/314).
  Spec 339 keeps that rule: historical categories are approved before posting
  and stored on the reconstructed operations; later reference edits do not
  reclassify them at read time.
- **EARS-333.** The module's public API shall expose, as a query, the postings
  recorded against a purpose with `product_binding = optional` that carry no
  product — the exception list by which the taxonomy converges from use; its
  reporting surface is F3's.
- **EARS-334.** The system shall post no allocation of overhead onto a product
  or project: an amount reaches a cost object only as a posting recorded with
  that dimension (EARS-320/321), and no percentage base, absorption rate or
  allocation run shall write to the ledger. Cost-driver data (member time
  through `/p/hours`, usage) shall remain collected and queryable so an
  allocation view can be computed later in F3 without restating anything
  (Accounting policy, ruling 1).

### D. Budget and funding (2026-11-24, #581)

_New 2026-11-24 (#581, parent #587, epic #115). The clause text is the lead's
encoding and waits for the owner's acceptance on its PR. Each rule below is
labelled by where it comes from: **owner** — said by the owner, Антон, on
2026-11-24 (on #581 or in session); **lead reading, pending owner go** —
derived by the lead from those decisions or from research, and confirmed or
overridden at that acceptance._

**What the owner decided (owner, 2026-11-24):**

- BBM is the umbrella — the existing fund row «Фонд BBM» (EARS-304) — and
  Doctor School is a project done inside it, its first pilot. BBM's own
  infrastructure is kept apart from the Doctor School project, so it is spend of
  the fund row itself.
- A fixed initial budget is allocated to BBM for its launch and the Doctor
  School pilot; in the owner's words, the budget allocated to BBM goes to Doctor
  School too. It funds Doctor School's spend and BBM's own spend.
- The budget is a **limit**; the money is brought onto the company account
  **as needed**, not deposited up front. The model carries two separate facts:
  the limit, and the actual contributions, each with its date.
- An expense paid from a member's personal card is reimbursed to that member
  (owner-confirmed in session, 2026-11-24). It counts against the budget on its
  spend date like any other expense, and the reimbursement is a transfer that
  settles the debt, not a second expense (recorded on #581 as the lead's
  default and confirmed by the owner in session the same day).
- **Every** project under the fund — not only Doctor School and the fund row —
  draws on the budget (owner, #581, answer to question 1).
- A member's personal-card debt stays «owed to members» until a reimbursement
  settles it; it is never turned into a contribution (owner, #581, question 2).
- The money is the investor's funding of BBM, not a loan: no contribution is
  repayable, and no loan is modelled (owner, #581, question 3).
- `finance-approve` records the budget limit (owner, #581, question 5;
  EARS-339).
- A member's debt in a foreign currency has no recorded rouble cost, so it is
  valued **provisionally at the Bank of Russia rate of the spend day**; once
  it is reimbursed in roubles, the roubles that actually left the company
  account — the payment agent's fee and any withheld tax included — become its
  cost, and the difference from the provisional value lands in «spent» as the
  exchange/fee result (owner, #581, question 4; EARS-340 items 3 and 5). The
  owner's reason: many member-paid requests are in USD or THB, and withholding
  the figures for every one of them would blind the dashboard.

**How the money actually moves (owner, 2026-11-24, #581).** BBM has one money
account of its own: the rouble bank account of the company's Russian legal
entity. The investor funds BBM by transfers onto that account — those
transfers are the contributions of EARS-336. Rouble invoices issued to the
legal entity are paid from it directly. Services the legal entity cannot pay —
foreign services that take only a foreign card, small subscriptions — are paid
by a member from a personal card, a member's foreign card included, and become
that member's debt (spec 339 EARS-513). The legal entity reimburses the debt in
roubles through a payment agent, to the member's personal card or to the
member's sole-proprietor account under a services contract (spec 339
EARS-528/568). Whatever the member does with that money afterwards — moving it
abroad, exchanging it, buying crypto — is personal and outside BBM's ledger:
BBM holds no foreign-currency or crypto account. Whether a payment agent holds
a prepaid BBM balance is an open data question for #583; if one exists, it is a
money account (EARS-301) and nothing in this section is built for it here.

**Lead readings, pending owner go:** cash-basis recognition on the money date
(decision 14 keeps accrual deferred, so an approved but unpaid request is not
spending); everything in EARS-335…345 that the bullets above do not say.
One of those derivations is dictated by an owner requirement rather than open
to choice: the owner asked to read «contributed vs spent (cash)» against each
other (#581), so the reading must reconcile to the money actually contributed.
The ledger's per-pair pools (EARS-325, EARS-328) cannot do that once a holding
is spent or crosses pairs (§D fixtures 2 and 4), which is why EARS-340 builds
its own spend-aware cost basis instead of naming a limitation.

**The company account that pays requests** is not a new concept: it is an
ordinary money account (`bank`, EARS-301) created in the cabinet, and the
posting act names it (spec 339 EARS-533). A contribution lands on such an
account; an expense paid from it is an outflow of company money.

**Coexistence with #518 item 2** («who paid and from where»). #518 may add who
owns an account and may rule some of today's payment sources BBM's and others
personal. Nothing here depends on that answer. The budget reading (EARS-340)
reads money accounts **by kind** (EARS-325) and member-attributed liability
postings: whatever #518 rules is a company account is counted as company money,
and whatever it rules personal stays `personal_funds` and appears as «owed to
members» until reimbursed. This amendment adds no account-owner field and closes
no #518 item.

**Coexistence with EARS-317** (no opening balances): see EARS-337. A
contribution is a dated movement of money like an expense, not an asserted
starting state.

**Donor & benchmark pass:** the split «limit is plan, contributions are fact» is
the owner's (#581). It matches the budgetary-control practice of comparing a
budget with actuals measured on one basis (IPSAS 24, cited for its reasoning
only — no standard governs this internal register). Keeping a contribution out
of income follows the IFRS Conceptual Framework's definition of income, which
excludes contributions from holders of equity claims. The cost basis of
EARS-340 is the moving-average cost flow of ruling 3 and EARS-328, applied to
every disposal — a spend included — rather than to conversions alone. All of
these are cited for their reasoning, never as authority over this ledger (see the
scope note under «Prior decisions»). No owner question below asks what that
research answers.

- **EARS-335.** The system shall carry a sixth system account kind, `equity` —
  the funds contributed to BBM — created by the module like every system kind
  (EARS-305): one per currency on first need, never offered for creation,
  editing or retirement in the cabinet. An `equity` account shall never be a
  money account — never a cash tile, never part of the EARS-325 total — and
  shall be neither income nor expense, so no P&L reading includes it.
- **EARS-336.** An operation shall be a **contribution** exactly when it carries
  a posting on an `equity` account, and the system shall accept it only in this
  shape: one debit on a non-system money account and one credit on the system
  `equity` account of the same currency, for the same amount (EARS-311/312); the
  `equity` posting naming the fund project; no purpose, no product, no
  conversion step and no other posting; `occurred_on` the day the money landed
  on that account. The `equity` posting shall carry the contributor's
  `member_id` WHERE the contributor is a platform member (EARS-322); a
  contributor who is not a member is named only on the intake item (spec 339
  EARS-567), so «who funded BBM» is a query over intake items, while the posting
  answers it for members alone. A contribution shall never be recorded as
  income.
- **EARS-337.** IF an operation carries a posting on an `equity` account and is
  neither an EARS-336 contribution nor the reversal of one (EARS-314), THEN the
  system shall refuse it; the equity balance is therefore exclusively the sum of
  dated contributions, and no path exists to assert it. This is how funding
  coexists with EARS-317: a contribution is a real, dated, documented movement
  of money onto an account — not an opening balance — and every account still
  starts at zero. Contributions made before the ledger existed are reconstructed
  by the one-time history reconstruction (spec 339 §E) as dated contributions,
  never as an opening figure.
- **EARS-338.** The finance module shall keep a budget as a record, never as
  postings: a `finance_budget` row naming its project, a name, the limit amount
  (`bigint`, minimal units) and currency, a `starts_on` date and `retired_at`. A
  budget shall create no posting, move no balance and sit on no account — a
  limit is plan, and plan stays plan until the fact happens (decision 14
  principles, `340-product.md`). Its amount is data entered through EARS-339
  and shall appear in no migration, seed, fixture or repository text. In v1 the
  system shall accept a budget only on the fund project and shall refuse a
  second unretired budget on the same project; the project column exists so a
  per-project budget is a later relaxation of that refusal rather than a
  migration.
- **EARS-339.** The budget shall be recorded on `/p/finance`, beside the reading
  it governs, and not in `/p/admin/finance/*`: that cabinet section admits
  reference administration (`platform-admin` or `finance-entry`, EARS-330 and
  spec 339 EARS-529), and a limit is not a reference row. The module's own
  handlers shall refuse creating, editing (name, amount, currency, `starts_on`)
  or retiring a budget for a session that does not hold `finance-approve`,
  however the URL or API is reached _(owner decision, 2026-11-24, #581 —
  question 5's default accepted; the lead's reason, kept: a limit
  is an authorization ceiling on spending, so it sits with the role that
  authorizes spend, on the workspace surface where that role's other acts
  already live, as the approve acts of `/p/finance/requests` do; widening the
  cabinet section instead would show an approve-only holder every reference
  resource only to refuse each write. The form itself is #584's surface and
  passes the stage-1b design gate there)_. Every such write shall run through
  `platformTransaction` with the signed-in actor, so each change of the limit is
  recorded in `core.audit_event` (spec 201) and no budget history table exists;
  it shall validate through the module's zod schemas with readable refusals
  (EARS-326). A budget is retired, never deleted. Reading a budget and every
  figure of EARS-340…345 shall be open to every platform member (spec 339
  EARS-530, decision 32).
- **EARS-340.** The budget figures shall be computed by one **budget cost-basis
  replay** in the budget's currency `B`. It is separate from the EARS-325
  pair-rate graph and from EARS-328's per-pair pool, and it reads no
  `fx_result` posting: those pools are built from conversion steps alone, so a
  spend out of a foreign holding never depletes them, and a holding bought
  through one pair and sold through another recognises nothing there.
  1. **Input.** Every operation from BBM's first one, whatever the budget's
     `starts_on`, in `(occurred_on, operation_id)` order, after both members of
     every fully reversed pair are removed by EARS-325's chain walk. The
     `fx_result` postings and the non-step `conversion` postings that balance
     them are skipped — they cancel per currency (EARS-328), and the replay
     derives its own exchange result.
  2. **State.** For every currency `X ≠ B`: a **holding pool** (quantity, cost in
     `B`) mirroring the `X` balance of all company money accounts, and, per
     member, an **owed pool** mirroring that member's `X` balance of the
     liability postings this reading counts (item 3). The owed pool is kept as
     one **lot** per posted `personal_funds` item — the debt that item booked
     — holding the sum of ALL that item's credits on the liability: the money
     leg and, where the item records a fee, the fee leg the shipped posting
     books as a second credit on the same liability (spec 339 EARS-513;
     `feePostings` in `src/lib/finance/intake/posting.ts`). The lot's
     quantity is that item's liability amount, and its cost is the sum of the
     per-credit provisional values (item 3), each rounded once; the pool's
     carrying cost is the sum of its lots. A pool's cost may be unknown. **Drawing** `q` from a pool, a lot
     or a supply holding quantity `Q` at cost `K` costs `K` when `q = Q` and
     otherwise `round_half_away_from_zero(q × K ÷ Q)`; the drawn cost leaves
     `K` exactly, so every later draw prices what remains. A draw is the
     replay's only rounding point, apart from item 3's valuation of a member's
     debt.
  3. **Supply and use.** Within one operation, per currency, the postings are
     read as supplies and uses. Supply of `X`: the net decrease of company money
     accounts in `X`, drawn from the holding pool; a credit on a member liability
     (spec 339 EARS-513), which adds its quantity and cost to its item's lot
     in the member's owed pool (item 2); a credit on `equity` or `income`; and each conversion step's
     received quantity of `X`. Use of `X`: the net increase of company money
     accounts in `X`, added to the holding pool; a debit on an `expense`
     account; a debit on a member liability (spec 339 EARS-528/568), drawn from
     that member's owed pool — WHERE its reimbursement names the item it settles
     (`settles_item`), as that item's lot whole (the transfer is for exactly the
     item's liability amount, so the draw is exact), and otherwise (a `backfill`
     reimbursement, which is pair-level) from the member's lots of that currency,
     oldest first, the last one drawn per item 2; and each step's disposed
     quantity of `X`. A **non-step** supply in `B` costs its own amount. A
     member-liability credit in `X ≠ B` costs its **provisional value**: its
     quantity at the Bank of Russia rate of `X` on the operation's `occurred_on`
     (spec 339 §I — the EARS-552 lookup, the EARS-551 rule for USD-pegged
     stablecoins, through RUB where `B` is not RUB, as EARS-550 does), in decimal
     arithmetic from minor units of `X` to minor units of `B`, rounded once with
     `round_half_away_from_zero`; the debt's lot carries that same amount until
     the debt is reimbursed (owner, 2026-11-24, #581). This applies even when
     BBM holds `X` at a recorded cost: the member's card is not BBM's holding,
     so its cost says nothing about the member's debt — a deliberate extension
     of the owner's rule (lead decision, shown to the owner at the go), moot
     while BBM holds no foreign account. A credit on `equity` or
     `income` in `X ≠ B` has unknown cost — the owner's rule covers a member's
     expense only, and the investor's money arrives in roubles. A step's
     receipt, in `B` as in any other currency, carries the cost item 4 gives it.
     Any other posting — an `expense` credit, an `income` or `equity` debit, or
     a liability posting that is not one of spec 339 EARS-513/528 (a future
     accrual, a liability without `member_id`) — makes the figures unknown (item 7) rather than being guessed.
  4. **Steps, then allocation.** The operation's non-step supplies of each
     currency are pooled first (quantity, cost). Conversion steps run in
     `step_no` order: a step **draws** (item 2) its disposed quantity from the
     supply of its `from_currency` as it stands at that point — the non-step
     supply plus earlier steps' receipts, less earlier draws — and its received
     quantity joins the supply of its `to_currency` carrying exactly that drawn
     cost. So a chain RUB → USDT → THB carries the roubles' cost to the baht,
     and a chain passing through `B` carries cost through `B` without a result.
     Then each currency's non-step uses, in posting-id order, **draw** their cost
     from what is left of that currency's supply, the last use taking the
     remainder, so an operation's cost in equals its cost out exactly. A
     cross-currency payment therefore costs exactly what the paying side gave
     up — decision 18's «each operation's own actual rate».
  5. **Value and exchange result.** A non-step use's **value** is its own amount
     when it is in `B`, its owed-pool draw when it reduces a member's debt in
     `X ≠ B` — the debt's provisional value (item 3) — and its drawn cost
     (item 4) otherwise. WHERE a value differs from the drawn cost — only for
     those first two kinds of non-step use; a step's disposal never carries a
     result — the drawn cost minus the value is the operation's **exchange
     result**: positive is a loss, negative a gain. For a reimbursement of a
     foreign-currency debt (spec 339 EARS-568) the drawn cost is the roubles
     the conversion step disposed — what left the company account, less any fee
     recorded as the step's own expense posting (EARS-318), which counts as an
     expense in its own right — so the debt's provisional value is replaced by
     what its settlement actually cost, and the difference is the exchange/fee
     result the owner named (owner, 2026-11-24, #581).
  6. **Exactness.** Every cost is rounded once, where it is drawn or where a
     member's debt is valued (items 2 and 3), and the same rounded amount is
     used on both sides, so no residue survives anywhere and the per-operation
     balance of item 4 holds in integers.
  7. **Unknown cost.** A cost drawn from an unknown cost is unknown, and a
     holding pool with unknown cost stays unknown until its quantity returns to
     zero (EARS-325's reset). The same applies to a draw larger than the pool,
     lot or supply holds, a member-liability credit in a currency or on a date
     for which spec 339 EARS-551/552 finds no Bank of Russia rate, a credit on
     `equity` or `income` in `X ≠ B` whose cost item 3 leaves unknown — a
     contribution or income received directly in a foreign currency or crypto
     — and every posting item 3 sends here. A figure that sums an unknown
     cost shall be withheld, with the currencies that caused it named in
     ascending code order — never shown as a partial number (EARS-325's
     degraded-state rule). Because «spent» and «contributed» are cumulative,
     once an unknown cost has been spent or converted into a value, the figures
     that include it stay withheld for the life of the budget; a contribution
     received in a foreign currency withholds «contributed» from the day it is
     posted; only «cash at cost» recovers when the pool returns to zero.

  No Bank of Russia rate and no market rate shall enter the replay or any
  figure of EARS-341…345, except item 3's provisional value of a member's debt
  in `X ≠ B`. That exception narrows spec 339 EARS-553 for this reading alone:
  the provisional value is a read-time figure, shown and never stored, and no
  posting, conversion step or stored amount is computed from it (spec 339
  EARS-553 carries the matching note).

- **EARS-341.** «Spent» against a budget shall be the sum, in `B`, of (a) the
  value (EARS-340 item 5 — its own amount in `B`, its drawn cost otherwise) of
  every debit on a system `expense` account whose operation's
  `occurred_on` is on or after the budget's `starts_on`, and (b) the exchange
  results (EARS-340 item 5) of the operations in that window. Part (a) covers
  every project and every source: an expense paid from a member's personal funds
  counts on its own `occurred_on` like any other (owner, 2026-11-24; spec 339
  EARS-513) — a foreign-currency one at its provisional value (EARS-340 item 3)
  — and every fee is its own expense posting, a payment agent's fee recorded on
  a reimbursement included. Part (b) includes the exchange/fee result of a
  reimbursement that settles a foreign-currency debt: the roubles it actually
  cost minus the debt's provisional value, dated on the reimbursement's own
  `occurred_on` (owner, 2026-11-24, #581; spec 339 EARS-568). By construction
  «spent» excludes contributions, income, transfers between BBM's own accounts,
  the exchange legs of conversions, the reimbursement that settles a
  personal-funds expense beyond that result (spec 339 EARS-528/568 — the
  payment of a debt already counted), and every unposted request, approved or
  not. A vendor's refund lowers «spent» because it
  is recorded on the expense side (reversal of the paid operation, plus a new
  operation for any part kept), never as income; because the reversal removes
  the original from its date, a time series over this figure (#584's burn rate)
  shall say so rather than show the refund as a dated event.
- **EARS-342.** «Remaining» shall be the limit minus «spent», in `B`, and shall
  be shown negative when «spent» exceeds the limit, never clipped to zero.
  Income shall not raise the limit, and a contribution shall neither raise nor
  lower it: the limit is how much BBM may spend; the contributions are when the
  money arrives.
- **EARS-343.** Beside the glass, the reading shall show four figures, all in
  `B` from the same replay: «contributed» — the cost (EARS-340 item 3) of every
  `equity` credit, less that of every `equity` debit, whose operation's
  `occurred_on` is on or after `starts_on`, both members of a reversed pair
  removed as in EARS-340 item 1; «income» — the cost (EARS-340 item 3) of every
  credit on a system `income` account in the same window, shown even while it
  is zero so the relation of EARS-344 can be checked on the screen; «owed to
  members» — the `B`
  balance of the liability postings EARS-340 item 3 counts plus the carrying
  cost of every owed pool, that is, personal-funds spend not yet reimbursed —
  **provisional** while a foreign-currency debt is open, because its lot
  carries the Bank of Russia value of its spend day until the reimbursement
  replaces it with the roubles actually paid (EARS-340 items 3 and 5), and the
  reading shall mark the figure as provisional whenever it includes such a
  lot; and «cash at
  cost» — the `B` balance of company money accounts plus the cost of every
  holding pool. «Cash at cost» is the one cash figure of the budget reading. It
  equals the EARS-325 card total whenever all money is in `B`; otherwise the two
  differ, because the card values holdings through the recorded pair-rate graph
  and this reading through the spend-aware cost basis, and the reading shall
  label its figure «по себестоимости» rather than show a second number under the
  card's name.
- **EARS-344.** Over all of BBM's operations the reading shall satisfy, exactly
  and in `B`: contributed + income = spent + cash at cost − owed to members.
  The owner's «contributed vs spent (cash)» (#581) is this relation; «paid out»,
  where a reading needs the word, is spent − owed to members — what BBM's money
  has actually covered. The relation holds **on the screen** only WHERE the
  budget's `starts_on` is on or before BBM's first operation: then the windowed
  figures (spent, contributed, income) are the all-time ones that cash at cost
  and owed already are. WHERE `starts_on` is later, the windowed figures leave
  out what happened before it, and the reading shall not present the four
  figures as reconciling. The relation holds at every moment, a foreign-currency
  debt's two included: while it is open, «spent» and «owed» both carry its
  provisional value; when it is reimbursed, «owed» drops by that value, «cash at
  cost» by the roubles that left the account, and «spent» rises by their
  difference — the exchange/fee result — so the right-hand side's three
  changes cancel and the left-hand side does not move (§D fixture 12).
  Every figure of EARS-340…345 is a read model over postings, the budget row,
  the `settles_item` link of spec 339 EARS-528 and — for EARS-340 item 3's
  provisional value alone — the Bank of Russia rate store, stored nowhere (the data-model rule: no table stores a balance), and all of
  them are read in `B`: none follows the reporting-currency switch of decision
  13, because the limit is denominated in `B` and the cost basis is built in it.
  _(Amendment proposed 2026-11-24 by spec 584 EARS-722
  (`docs/specs/584-budget-dashboard.md`), pending the owner's go on that spec,
  and applying under either answer of its open question 1: the figures are
  still computed only in `B`, and the dashboard's switch converts what is
  shown at read time, never stored, and leaves every ratio in `B`. Under
  answer A (EARS-728) each item is converted at the Bank of Russia rate of
  its own operation's date and cash at cost is the balancing figure, so this
  identity also holds exactly in the converted currency; under answer B
  (EARS-729) one graph factor converts the whole reading, rounded once per
  shown figure, and the exactness claims stay in `B`. Only answer A also
  narrows spec 339 EARS-553, by the pending note written there; answer B
  needs nothing more. The dashboard lives at
  `/p/finance/reports/budget`, inside the `/p/finance` subtree, and its limit
  form is the one EARS-339 places «on `/p/finance`».)_
- **EARS-345.** The breakdown of «spent» shall be one line per project — each
  expense posting carries exactly one project (EARS-321) and counts once, under
  it; the fund row's line is BBM's own spend — plus one separate «exchange
  result» line for the EARS-340 item 5 results, which belong to no project. The
  lines shall sum exactly to «spent», because every value is rounded once where
  it arises (EARS-340 items 4 and 6).

## Accounting policy — rulings accepted at the stage-2 go

The owner ruled (decision 22) that overhead treatment follows proper-accounting
best practice, researched by this spec and signed off at the go. All three
rulings below were **accepted by the owner on 2026-08-26 (#338)** — ruling 1
with five amendments, folded into its text.

**Ruling 1 — product-less overhead (closes #338 OQ4).** The governing texts for
a service/digital product are IAS 38.67(a) (selling, administrative and other
general overhead expenditure is not part of an internally generated intangible's
cost _unless_ it can be directly attributed to preparing the asset for use) and
IFRS 15.97(e) / 15.98(a) (a fulfilment cost relates to a contract when it was
incurred _only because_ the entity entered into it; G&A is expensed as
incurred). Neither governs this internal register, and neither forbids
allocation — IFRS 15.97(c) expressly permits allocations of directly related
costs; see the scope note under "Prior decisions" for why 97(e) is borrowed for
its criterion alone. At BBM's scale (few, heterogeneous, low-volume products) an allocation base
distorts more than it informs: IMA's causality/attributability principles and
CIMA's allocation-vs-arbitrary-apportionment distinction both say attach only
what a cost object actually caused. The ladder:

1. a **direct** cost → its product;
2. **directly attributable overhead** → a product only if it passes ALL of:
   (a) it would not exist without the product, (b) it traces to ONE product
   without a percentage split, (c) its purpose is to create, deliver **or
   market** the product rather than to run the entity;
3. everything else → **period cost** of the fund or project, **no allocation
   base in v1**.

Throughout this ruling, **(a)–(e) in «amendment (…)» are the owner's amendment
letters** from the stage-2 go (#338), while the ladder's own tests are always
named «criterion (a)/(b)/(c)» — the two schemes are unrelated.

Amendment (a): a campaign run for exactly one product passes criteria (a) and
(b) and is a textbook traceable fixed cost of that product's segment — «does not sell» was
an inventory-valuation rule (IAS 2.16(d)) imported into a decision report, and
keeping it would overstate the margin of exactly the heavily marketed products.
Single-product marketing therefore IS attributable to that product.

Amendment (b) — **the level-lift.** A cost that fails criterion (b) only because it serves
several products of ONE product line or fund lands on that **line/fund** as its
own named subtotal, sitting between the product margins and the entity line.
This is the standard multi-level segment statement (Garrison); it introduces no
percentage base anywhere — a cost either traces to a level or moves up one.

Capitalization of a product = its direct costs + its directly attributable
overhead, read off postings (EARS-320/321 carry the mechanics). Trade-off,
stated: the sum of product margins exceeds holding profit by the unallocated
overhead. That gap is the reporting device, not an artefact (IFRS 8.28
reconciliation; Garrison's segmented income statement) — and, per amendment
(c), F3 shows it as **named buckets** (office, shared salaries, shared
hosting, fundraising/admin…), each identified and described in the IFRS 8.28
manner, never as one opaque «нераспределённое» line.

**Cost drivers are collected, allocations are not posted** (amendment (d),
EARS-334): member time through `/p/hours` and usage data stay in the estate so
a functional-expense or indirect-cost-rate view is later a query rather than a
data-archaeology project — but nothing writes an allocation into the ledger.
Because the ledger stores attributability per posting, an absorption/ABC view
can be added as an F3 overlay without restating anything.

**Prices are never derived from this register's product cost** (amendment (e)).
A cost base that deliberately excludes overhead would systematically underprice
if it were used cost-plus. Pricing takes a required-contribution target derived
top-down from the total unallocated block; the register measures, it does not
price.

**Ruling 2 — the attributability test (closes #338 OQ5).** Adapted from IFRS
15.92's incremental-cost wording (a cost the entity «would not have incurred if
the contract had not been obtained») into two questions: (1) «Если бы этого
продукта не было — мы бы всё равно потратили эти деньги?» yes → no product;
no → name it; (2) only if "partly": «Можешь назвать ОДИН продукт без деления по
процентам?» no → the cost moves up a level (ruling 1, amendment (b)), it is not
split by percentage. The operator recording an operation never answers them:
attributability is declared ONCE, on the **purpose**, as `product_binding`
(EARS-306/320/331) — whoever defines a purpose runs the test, and the form then
requires, hides or offers the product field.

This is the mainstream shape, not an invention: it is Dynamics 365 Business
Central's `Value Posting` (Code Mandatory / No Code / blank), SAP's field status
(Required / Optional / Suppressed), NetSuite's mandatory classifications and
Sage Intacct's required-dimension checkbox. What SMB tools (Xero, QuickBooks)
lack is precisely this master-data rule — per-transaction judgement is their
defect, not a design anyone defends. Four consequences, all accepted at the go:

- **the operator picks the value, never the binding** (EARS-331); the binding is
  a `platform-admin` edit of the purpose;
- **corrections of already-posted entries are role-gated and audited** — the
  only correction is reversal (EARS-313/314), with the actor recorded per spec 201. Spec 339 gates reversal by `finance-approve`; `platform-admin` covers
  reference administration only. No reclassification journal, read-time
  category fallback or posting mutation is introduced;
- **an exception report** lists `optional`-binding postings filed without a
  product (EARS-333), so the taxonomy converges from use;
- **a binding change never rewrites history** (EARS-332): postings made under
  the old rule stand exactly as posted. There is deliberately **no dedicated
  binding-change journal** — the universal edit audit
  (`docs/specs/201-universal-edit-audit.md`, migration `0003`, coverage guard
  `tools/lint/audit-coverage-lint.mjs`) already records who changed what and
  when on the core tables, and a second log of the same fact would drift.

**Ruling 3 — crypto holdings (closes #338 OQ3).** Per the IFRIC June 2019
agenda decision crypto is a non-monetary asset; IAS 21 does not retranslate
non-monetary items held at cost — the transaction-date rate persists, so the
ledger's frozen-rate principle IS the standard treatment. Proposal: the ledger
holds crypto at the recorded rate forever; **no revaluation postings ever**
(EARS-319); the difference is recognised only on disposal **through a
conversion** — the one operation class that itself establishes an actual rate
(decision 18) — computed against the holding's **weighted-average recorded
rate** (the standard cost-flow assumption for a fungible holding; no lot
tracking in v1) and posted to the system `fx_result` account of the fund,
against the `conversion` account, never onto a product (EARS-328). A payment
or transfer in one currency establishes no rate and recognises nothing
(EARS-329); unrealised movement is an F3 display concern — the market
equivalent of a holding is a computed, labelled report/dashboard line, never a
posting, while the **quantity** held is always shown as recorded. IAS 36
impairment is an explicit v1 deferral. Accepted as proposed at the go, with no
amendment.

Cross-cutting principle, verbatim in the model: the ledger records facts at the
rate and cost object they had when they happened; every judgement that can
change later — allocation, absorption, revaluation — lives in F3 as a computed
overlay, never as a posting. Policy changes become report changes, not
migrations.

## CRUD check (task-cycle stage 1a)

| Resource (`/p/admin/finance/…`) | Create                                                                        | Read                                  | Update                                                                        | Delete                                                             |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| currencies                      | yes (code, name, precision)                                                   | yes                                   | name; precision only while unused (EARS-303)                                  | retire; hard delete only if never referenced (EARS-308)            |
| accounts                        | yes (money kinds only)                                                        | yes (system accounts shown read-only) | name                                                                          | retire; same rule                                                  |
| projects                        | yes                                                                           | yes                                   | name                                                                          | retire; the fund row is neither retirable nor deletable (EARS-304) |
| products                        | yes (under a project)                                                         | yes                                   | name, sale price                                                              | retire; same rule                                                  |
| purposes                        | yes (binding mandatory, EARS-306)                                             | yes                                   | name, category link, binding (admin only, EARS-331; history stands, EARS-332) | retire; same rule                                                  |
| categories                      | yes (the table ships empty; first values follow owner review of real history) | yes                                   | name, allocable flag                                                          | retire; same rule                                                  |

Deliberately unsupported: creating/editing system accounts (EARS-305); any
cabinet surface for operations or postings — the fact core is written only by
the module API (intakes are F2); changing a currency's precision in use; a
second fund row. §D adds: a budget on a project other than the fund, or a
second unretired budget on one project (EARS-338); any budget surface in
`/p/admin` — the budget is recorded on `/p/finance` by `finance-approve`, read by
every member, edited with an audit trail and retired, never deleted (EARS-339);
a cabinet surface for contributions — they enter through intake (spec 339 EARS-567; EARS-337);
editing or retiring the system `equity` accounts (EARS-335).

## Acceptance scenarios

Owner walkthrough, on a live stand, after the go and the build:

1. **References exist and are mine to edit.** Open `/p/admin` → group «Финансы»
   lists the six resources (EARS-324). Create currency `THB` (precision 2),
   account «Карта THB» (kind card, THB), project «Doctor.School», product
   «Урок» under it, purpose «Продакшн урока» with binding `required` — each
   save answers with a visible confirmation (EARS-301/302/306, spec 311
   EARS-472).
2. **Representative money and an exact RUB total.** Seed four money accounts
   (all currencies precision 2): «Банк RUB» receives 1,500,000.00 RUB and
   «Наличные RUB» receives 500,000.00 RUB; convert 600,000.00 RUB → 10,000.00
   USD, then 4,000.00 USD → 140,000.00 THB; dispose 2,000.00 USD for 130,000.00
   RUB; then acquire 1,500.00 USD for 120,000.00 RUB. Open `/p/finance` and see
   the separate native rows «Банк RUB» 910,000.00 RUB, «Наличные RUB»
   500,000.00 RUB, «Карта USD» 5,500.00 USD and «Карта THB» 140,000.00 THB.
   The selector defaults to RUB. The remaining RUB/USD pair pool carries
   9,500.00 USD at 600,000.00 RUB recorded cost, and the USD/THB pair pool
   carries 140,000.00 THB at 4,000.00 USD recorded cost. Converting each native
   aggregate over the shortest pair path makes «Итого» exactly
   **2,010,000.00 RUB**. The card says «по фактическим курсам операций», not
   market/current rate (EARS-310/317/318/319/325).
3. **The same holdings produce complete totals in every offered currency.**
   Switch «Итого» from RUB to USD and then THB. All four native account rows
   stay unchanged. The pair-rate graph converts each native aggregate
   separately: USD is exactly **31,825.00 USD**, and THB is exactly
   **1,113,875.00 THB**.
   Reloading preserves the selected numeric total, and no market/current rate is
   fetched (EARS-318/319/325).
4. **Unknown foreign money does not become a partial total.** Return to RUB and
   add an ordinary 100.00 EUR inflow: every native row remains visible, but the
   total is withheld and `EUR` is named. Spend 40.00 EUR: the remaining 60.00
   EUR pool is still unknown and the total stays withheld. Spend the remaining
   60.00 EUR: the EUR pool returns to zero and resets, and the exact
   2,010,000.00 RUB total returns. No step fetches a rate (EARS-319/325/329).
5. **Money is visible to the team, references editable by reference
   administration.** Sign in as a member holding `platform-user` and neither
   `platform-admin` nor `finance-entry`: `/p/finance`
   opens and shows the same balances card (EARS-324/325), while
   `/p/admin/finance/purposes` is refused (EARS-330, spec 311 EARS-405). Sign
   out entirely and open `/p/finance` — refused, F1 has no public surface
   (EARS-325).
   _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
   EARS-529): this step checks the **reference** write gate only. Ledger writes
   — posting and reversal — are gated by `finance-entry` / `finance-approve`,
   so `platform-admin` alone is no longer the write role to walk here; that
   part of the walkthrough lives in spec 339's scenario 1.)_
   _(Amended 2026-09-14 by owner decision 34 (#115), shipped in #479: a session
   holding `finance-entry` and NOT `platform-admin` walks this step the other
   way — `/p/admin/finance/purposes` opens and an edit succeeds (EARS-529).)_
6. **The past is protected.** In `/p/admin`, try deleting the currency `THB`
   that the account uses — a readable refusal offers retirement instead
   (EARS-308/326). Rename the account — the rename is visible, nothing else
   changes (EARS-309).
7. **The fund is fixed.** Try retiring «Фонд BBM» — a readable refusal
   (EARS-304).
8. **Categories are not pre-invented.** Open the categories resource — the
   table is empty, with creation available (EARS-307).
9. **The budget is a limit, the money arrives as needed** (§D, 2026-11-24).
   As a `finance-approve` holder, record BBM's budget on «Фонд BBM» on
   `/p/finance` with the amount and start date of your choice — a second
   budget, one on «Doctor.School», or the same act by a member without
   `finance-approve` is refused (EARS-338/339). Record a contribution onto the
   company bank account with its bank statement attached (spec 339
   EARS-567): the account's tile on `/p/finance` grows by exactly that sum, no
   `equity` tile appears, and nothing shows as income (EARS-335/336). Pay one
   request from that account and have a member file one paid from a personal
   card: «spent» grows by both on their money dates, broken down by project;
   «remaining» is the limit minus «spent»; «owed to members» shows the card
   payment. Reimburse it: «spent» does not move, «owed» returns to zero, and
   «cash at cost» drops by the reimbursement; contributed = spent + cash at
   cost − owed throughout (EARS-341…345). Then have a member file a request
   paid from a foreign card in another currency than the invoice's: «owed»
   shows its Bank of Russia value of the spend day, marked provisional;
   reimburse it in roubles with a payment agent's fee (spec 339 EARS-568):
   «owed» returns to zero, «cash at cost» drops by the roubles paid, and
   «spent» moves by exactly their difference from the provisional value
   (EARS-340 items 3 and 5). The reading surface is #584's; until
   it ships, the agent reads the module's query on the stand and pastes the
   figures into the issue.

### Verified by CI, not by the owner

The fact-core invariants have no owner-facing surface until F2's intakes; they
are exercised by TDD tests named `it('EARS-N: …')` (task-cycle stage 3):
per-currency zero-sum (EARS-311/312), immutability incl. the DB trigger
(EARS-313), reversal mechanics (EARS-314/315), the source enum and backdated
flag (EARS-316), no-opening-balance (EARS-317), conversion steps with frozen
rates (EARS-318/319), product binding (EARS-320), the project dimension
(EARS-321), the `core.member` FK (EARS-322), boundaries (EARS-323), the
write-side claim gate (EARS-330), the binding as master data (EARS-331), a
binding change leaving history intact (EARS-332), the product-less `optional`
exception query (EARS-333), and the absence of any allocation posting
(EARS-334).

EARS-325's read model additionally has the following exact CI fixtures. Unless
stated otherwise currencies have precision 2 and values below are minor units.

**What is a fixture and what is a derivation.** Only the read model's public
output is asserted by CI — `total`, `status`, `missingCurrencies`,
`availableReportingCurrencies` and the account rows. The intermediate pair-pool
states quoted below are hand derivations offered so a reader can reproduce a
total by pencil; they are NOT asserted anywhere and no test imports the pool
type. Two of these fixtures — the fee (9) and the reversal (2) — additionally
run through the REAL writers `recordConversion` / `reverseOperation` in
`tests/int/platform/finance-current-money.int.spec.ts`, so the unit fixtures'
assumption about the posting shape a conversion and a сторно actually produce is
pinned rather than assumed.

1. **Representative replay.** The five operations of owner scenario 2 start
   with `200_000_000` RUB across two RUB accounts and end with aggregate
   quantities RUB `141_000_000`, USD `550_000`, THB `14_000_000`. The canonical
   RUB/USD pair ends holding USD `950_000` at RUB cost `60_000_000`; the USD/THB
   pair ends holding THB `14_000_000` at USD cost `400_000`. In the RUB view,
   USD contributes `34_736_842`, THB contributes `25_263_158`, and the exact
   final sum is `201_000_000`; the separate RUB rows still sum to their native
   aggregate.
2. **Intervening operation plus reversal.** RUB ordinary inflow `100_000`, a
   conversion RUB `60_000` → USD `1_000`, an unrelated later RUB inflow `5_000`,
   then the exact reversal of the conversion shall replay as RUB `105_000`, USD
   zero and total `105_000`: both conversion members are excluded before
   chronology, not replayed as a late disposal/acquisition. Reversing that
   reversal in turn restores the conversion into the replay — the chain's
   parity decides, and a reversal dated EARLIER than the reversal it undoes
   changes nothing about which facts survive.
3. **Half-away-from-zero only after a full path, once per source.** Given pair
   edges AAA→BBB `1/2` and BBB→CCC `1/2`, an aggregate AAA `1` in a CCC view
   shall multiply the exact path ratio first and produce CCC `0`; rounding after
   each edge would incorrectly produce `1`. Given two separate source
   aggregates AAA `1` and DDD `1`, each with a direct `1/2` edge to CCC, each
   source rounds independently to CCC `1` and the total is `2`; summing the two
   fractional conversions before rounding would incorrectly produce `1`.
4. **Disconnected ordinary foreign inflow.** A USD inflow `10_000` with no
   recorded RUB/USD conversion leaves USD unreachable in the default RUB view;
   the card keeps the native USD amount, withholds the total and names `USD`.
   An outflow `4_000` leaves the same degraded state at USD `6_000`; outflow of
   the final `6_000` makes every aggregate zero, after which RUB and USD are both
   offered with total zero.
5. **Pair pool crosses through zero.** A RUB/USD pool holding USD `100` at RUB
   cost `6_000`, followed by a step USD `150` → RUB `9_750`, shall consume the
   USD pool, attribute RUB `6_500` of proceeds to that disposal, and establish
   the opposite pool holding RUB `3_250` at USD cost `50`. The graph exposes one
   reciprocal edge from that positive opposite pool and never two contradictory
   directional pools for the pair. With a pool holding USD `1` at RUB cost `1`,
   a step USD `2` → RUB `1` attributes the one received RUB unit to the old pool
   and leaves residual quantity RUB `0` at cost USD `1`; it shall mark the pair
   unavailable rather than create that half-empty edge.
6. **Partial disposal rounds moving-average cost half away from zero.** A pool
   holding USD `2` at RUB cost `1`, followed by a step USD `1` → RUB `1`, shall
   remove
   `round_half_away_from_zero(1 × 1 ÷ 2) = 1` RUB of cost and leave a pool
   holding USD `1` at RUB cost `0`; truncation would incorrectly remove zero.
   Because a zero-cost remainder cannot create a reciprocal rate, the pair has
   no graph edge until a later same-direction conversion adds positive cost.
   Separately, once a malformed step has marked a pair unavailable, later valid
   steps shall not restore it during the same replay.
7. **Path selection is stable.** When both a direct USD→RUB edge and a longer
   USD→THB→RUB path exist, the direct edge wins. When two equal-length simple
   paths exist, the lexicographically smaller complete currency-code sequence
   wins. Insertion order, object-key order and graph traversal order shall not
   change the selected path; cycles are never candidates.
8. **Reporting-currency switch.** Fixture 1 shall offer RUB, USD and THB. Its
   RUB total `201_000_000` shall become exact selected totals USD `3_182_500`
   and THB `111_387_500` through the pair graph. Native balances shall remain
   unchanged. A currency unreachable from any nonzero aggregate shall not be
   offered, and a stale query naming it shall fall back to the RUB default,
   which shows the degraded state if RUB itself is unreachable.
9. **Fees and endpoints do not contaminate pair rates.** In a RUB view, an ordinary
   inflow of RUB `40_000`, followed by a conversion RUB `20_000` → USD `10_000`,
   then a conversion RUB `10_000` → USD `10_000` whose step charges a USD fee of
   `5_000`, shall produce a RUB/USD pair pool holding USD `20_000` at RUB cost
   `30_000`: the fee changes the native USD account balance to `15_000` but does
   not alter the pair rate. The final RUB aggregate `10_000` plus converted USD
   `22_500` makes an exact RUB total `32_500`. Endpoint money postings, the fee
   and system legs create no additional pair-rate event.

### §D fixtures — budget and funding (CI)

_New 2026-11-24 (#581)._ The amounts below are synthetic minor units chosen for
hand arithmetic — they are not BBM's figures, and no real budget amount appears
in this repository (EARS-338). Every fixture has one budget on the fund, in RUB,
with `starts_on` before the first operation unless stated; the projects are the
fund and one project «P». Only the read model's public output is asserted, and
every fixture whose figures are numeric also asserts EARS-344's identity.

1. **The plain path.** Contribute `100_000` RUB onto a bank account; pay a
   `30_000` RUB expense of «P» from it; a member pays a `5_000` RUB expense of
   the fund from a personal card (`personal_funds`); approve, without posting,
   a `10_000` RUB request of «P». Then: «spent» `35_000` (the approved request is
   not counted), breakdown «P» `30_000` + fund `5_000` + exchange result `0`;
   «contributed» `100_000`; «owed» `5_000`; «cash at cost» `70_000`. Reimburse
   the member `5_000`: «spent» stays `35_000`, «owed» becomes `0`, «cash at
   cost» becomes `65_000` (EARS-336/341/343/344/345).
2. **A spend depletes the cost basis — the case the per-pair pools get wrong.**
   Contribute `160_000` RUB; convert `100_000` RUB → `10_000` THB; pay a
   `5_000` THB expense of «P» from the THB account (cost `50_000`; the THB pool
   keeps `5_000` at `50_000`); convert `60_000` RUB → `5_000` THB (pool
   `10_000` at `110_000`); convert `10_000` THB → `110_000` RUB. The last step
   draws `110_000` of cost and receives `110_000` RUB: exchange result `0`.
   «Spent» `50_000`, «cash at cost» `110_000`, «contributed» `160_000` =
   `50_000` + `110_000`. The ledger's own EARS-328 pool, which the expense did
   not deplete, holds `15_000` THB at `160_000` and posts a `3_333` gain on that
   last step; the reading ignores it, and a reading that added it would show
   «spent» `46_667` and break the identity (EARS-340/341/344).
3. **A loss on a round trip is spent.** Contribute `100_000` RUB; convert
   `100_000` RUB → `10_000` THB; pay a `5_000` THB expense from it (`50_000`);
   convert the remaining `5_000` THB → `45_000` RUB: exchange result `5_000`.
   «Spent» `55_000` = «P» `50_000` + exchange result `5_000`; «cash at cost»
   `45_000` (EARS-340/341/345).
4. **A multi-hop chain carries its cost.** Contribute `100_000` RUB; in ONE
   operation convert `100_000` RUB → `1_000` USDT → `30_000` THB onto a THB
   account (pool `30_000` at `100_000`); later convert `30_000` THB → `90_000`
   RUB: exchange result `10_000`, «spent» `10_000`, «cash at cost» `90_000`.
   EARS-328's per-pair pool finds no THB-against-RUB acquisition and posts no
   result; the reading still counts the loss (EARS-340 items 4–5).
5. **A cross-currency payment and a conversion fee.** An invoice of `3_500` THB
   paid from a RUB account charged `8_750` RUB adds exactly `8_750` to «spent»,
   whatever the THB pool holds. A conversion of `10_000` RUB → `10_000` USD
   whose step charges a `5_000` USD fee costs the fee `5_000` RUB and leaves
   `5_000` USD in the pool at `5_000` (EARS-340 item 4).
6. **A rouble expense paid out of a foreign holding is counted once.**
   Contribute `100_000` RUB; convert it to `10_000` THB; pay a `9_000` RUB
   invoice of «P» from the THB account, which is charged `1_000` THB (one step,
   THB `1_000` → RUB `9_000`). The step draws `10_000` of cost; the RUB expense's
   value is its own `9_000`, so the exchange result is `1_000`. «Spent» `10_000`
   = «P» `9_000` + exchange result `1_000`, and «cash at cost» `90_000`. A
   reading that summed the expense's drawn cost and the result would show
   `11_000` and break EARS-344 (EARS-340 item 5, EARS-341).
7. **A chain through the budget currency carries cost, not a result.** Hold
   `10_000` THB at a cost of `100_000`, then in ONE operation convert THB
   `10_000` → RUB `90_000` → USD `1_000` onto a USD account. The RUB leg is a
   step's disposal, not a non-step use: exchange result `0`, and the USD pool
   holds `1_000` at `100_000`. «Spent» does not move; a reading that booked
   `10_000` on the RUB leg would raise «spent» with cash unchanged (EARS-340
   items 4–5).
8. **Rounding that does not divide evenly.** Contribute `10` RUB; convert it to
   `3` THB (pool `3` at `10`); pay a `1` THB expense of «P» — the draw is
   `round_half_away_from_zero(1 × 10 ÷ 3) = 3`, leaving `2` at `7`; then, in one
   operation, pay two `1` THB expenses from the THB account, the fund's first
   by posting id and then one of «P». The operation draws the whole pool, `7`;
   the first use draws `round_half_away_from_zero(1 × 7 ÷ 2) = 4` and the last
   takes the remaining `3`. «Spent» `10` = «P» `6` + fund `4`, «cash at cost»
   `0`, «contributed» `10`, and the breakdown sums exactly (EARS-340 items 2, 4
   and 6, EARS-345).
9. **No recorded cost, no number.** Contribute `1_000` USDT onto a crypto
   account: «contributed» and «cash at cost» are withheld from that day and
   `USDT` is named; the native amounts stay visible. Pay a `100` USDT expense
   from it: «spent» and «remaining» are withheld too. Then spend the remaining
   `900` USDT: the USDT pool returns to zero, «cash at cost» reappears, and
   «spent», «remaining» and «contributed» stay withheld — the unknown cost is
   inside them for good. A member's personal-card expense dated before the
   stored Bank of Russia series begins has no provisional value and is
   withheld the same way, its currency named (EARS-340 items 3 and 7).
10. **Reversal, window, sign.** A `10_000` RUB expense and its reversal leave
    «spent» unchanged, including when the reversal is dated before `starts_on`;
    an expense dated the day before `starts_on` is not counted; with a limit of
    `20_000` and «spent» `25_000`, «remaining» is `−5_000`, not `0`
    (EARS-340/341/342).
11. **The guards.** An operation carrying an `equity` posting with a purpose, a
    conversion step, a second money leg, a mismatched amount or a non-fund project
    is refused, as is a reversal-shaped operation that reverses no contribution
    (EARS-336/337); the `equity` account is neither a cash tile nor part of the
    EARS-325 total (EARS-335); a budget on «P» and a second unretired budget on
    the fund are refused, as is any budget write from a session without
    `finance-approve` (EARS-338/339); a budget write appears in
    `core.audit_event` (EARS-339); a reporting-currency switch leaves every
    budget figure in RUB (EARS-344).
12. **A foreign-card debt reimbursed in roubles through a payment agent.**
    Contribute `100_000` RUB onto the bank account. A member pays a `300` USD
    invoice of «P» from a personal THB card, which is charged `10_000` THB; the
    liability is `10_000` THB (spec 339 EARS-513), and the Bank of Russia rate
    of THB on that day is `2.5` RUB per THB, so the debt's provisional value is
    `25_000`. Then: «spent» `25_000` («P» `25_000`), «owed» `25_000` and marked
    provisional, «cash at cost» `100_000`, «contributed» `100_000` = `25_000` +
    `100_000` − `25_000`. Later the debt is reimbursed through a payment agent
    in ONE operation (spec 339 EARS-568): the bank account loses `27_000` RUB,
    of which the agent's `1_000` RUB fee is the step's own expense posting of
    the fund and one step converts `26_000` RUB → `10_000` THB onto the
    liability. The step draws `26_000`; the liability debit's value is the lot's
    `25_000`, so the exchange result is `1_000`. Then: «spent» `27_000` = «P»
    `25_000` + fund `1_000` + exchange result `1_000` — the roubles that left
    the account; «owed» `0`; «cash at cost» `73_000`; and the identity reads
    `100_000` = `27_000` + `73_000` − `0`. Without an itemized fee the step
    converts the whole `27_000` RUB, the exchange result is `2_000`, and «spent»
    is `27_000` all the same. Moving the rate or the agent's charge moves only the exchange/fee
    result, never the identity (EARS-340 items 3 and 5, EARS-341, EARS-343,
    EARS-344). The agent's fee sits on the fund's line and the rest of the
    difference on the projectless «exchange result» line, so «P» stays at the
    provisional `25_000`: a payout's cost is the overhead of the reimbursement
    process, not of the service reimbursed (lead decision, shown to the owner
    at the go).
13. **A fee on the member's own charge settles with its debt.** As fixture 12,
    but the member's THB card is also charged a `400` THB card fee recorded on
    the request (spec 339 EARS-513), so the liability amount is `10_400` THB
    booked as two credits — `10_000` and the fee leg `400`. At `2.5` the lot
    holds `10_400` THB at `25_000` + `1_000` = `26_000`; «spent» `26_000`
    («P» `26_000`: the invoice `25_000` and the card fee's own expense
    posting on the item's project, `1_000`) and «owed» `26_000`. Reimburse it in
    ONE operation: the bank account loses `27_000` RUB with no itemized agent
    fee, and one step converts `27_000` RUB → `10_400` THB onto the
    liability. The reimbursement draws the item's whole lot, `26_000`, so the
    exchange result is `1_000`; «owed» returns to exactly `0`, «spent» is
    `27_000`, «cash at cost» `73_000`, and `100_000` = `27_000` + `73_000` −
    `0`. A lot per liability credit would leave the `400` THB fee lot undrawn
    and «owed» above zero after a full reimbursement (EARS-340 items 2–3).

## Out of scope

- Every intake: the request form, approval queue, manual entry and hours
  accruals — **F2 (#339)**. The one-time history reconstruction is #387; a bank
  import surface is not part of F2. F2 also settles the full role model
  (decision 8). F1 already opens **reading**
  `/p/finance` to every platform member (EARS-324/325, the owner's transparency
  policy) and keeps every reference catalogue at `platform-admin` (EARS-330 —
  widened to `finance-entry` as well by decision 34, see the note on EARS-330).
  _(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
  EARS-501/529): the finer split deferred here is settled. Reference
  administration stays `platform-admin`; ledger writes — posting and reversal —
  are gated by the flow roles `finance-entry` / `finance-approve`, and
  `platform-admin` by itself no longer posts or reverses.)_
- Reclassification of a posted operation (moving a dimension without reversing
  it): in F1 and F2 the only correction is reversal (EARS-313/314/332). There is
  no read-time category substitution or posting-mutation reclassification.
- Any allocation, absorption or ABC run: F1 posts none by design (EARS-334) and
  F3 computes such views as overlays.
- Reports beyond the balances card: operations register UI; period P&L and
  period cash flow; project/category/product cuts; unit cost, break-even and
  capitalization display; comparison and drill-down — **F3 (#340)**. The
  selected-currency total of **current money-account balances** is part of the
  EARS-325 F1b cash card, not an F3 report. _(Amended 2026-11-24 by §D,
  #581: the budget figures — «spent», «remaining», «contributed», «owed to
  members», «cash at cost» — are DEFINED here, in EARS-340…345, because they are
  readings of ledger facts this spec owns; the surface that renders them is
  #584's dashboard spec, and the rest of F3 stays #340's.)_ Reconciliation remains **F4
  (#341)**; scenarios remain **F5 (#342)**.
- Obligations (decision 14): the `liability` account kind exists in the enum so
  F2's accruals and reimbursements have a home, but no obligation flow ships in
  F1.
- Documents/attachments — arrive with the request flow (F2).
- Payout/token/waterfall mechanics, tax filing, statutory forms
  (`338-product.md` Out of scope).

## Open questions

None. #338 OQ1/OQ2 were closed by decisions 16/17; OQ3/OQ4/OQ5 are closed by the
three rulings above, accepted by the owner at the stage-2 go on 2026-08-26
(#338) — ruling 1 with the five amendments folded into its text. The lead's
`platform-admin`-everywhere default was **reversed** by the owner in the same
go: reading `/p/finance` is open to every platform member, the reference
catalogues stay `platform-admin`, and F1 exposes no unauthenticated surface
(EARS-324/325/330).
_(Amended 2026-08-26 by spec 339 (`docs/specs/339-ledger-intake.md`,
EARS-501/529) — F2's role model (decision 8) is settled and this entry no
longer defers to it: reference administration stays `platform-admin`, while
ledger writes — posting and reversal — are gated by the flow roles
`finance-entry` / `finance-approve`, and `platform-admin` alone no longer posts
or reverses.)_

### Open questions — §D (2026-11-24, #581)

None open for the owner. The five forks this section raised were answered by
the owner on 2026-11-24 (#581, issue comment 7131136652), and the answers are
the owner-decision bullets at the top of §D: every project under the fund
draws on the budget (question 1); a personal-card debt stays owed until it is
reimbursed and never becomes a contribution (question 2); the investor's money
is funding, not a loan (question 3); `finance-approve` records the limit
(question 5, EARS-339). Question 4 — what foreign money with no recorded cost
counts as — was answered with a different rule than the lead's default: a
member's foreign-currency debt is valued provisionally at the Bank of Russia
rate of the spend day and takes the roubles actually paid as its cost once it
is reimbursed (EARS-340 items 3 and 5, §D fixture 12); strict withholding
stays only for a contribution or income received directly in a foreign
currency or crypto and for a currency or date with no Bank of Russia rate
(EARS-340 item 7, §D fixture 9). The previous default — withhold the figures —
is recorded here as superseded.

One data question is routed, not open here: whether a payment agent holds a
prepaid BBM balance. It belongs to #583 (opening the real money accounts in production); if such a balance
exists it is a money account (EARS-301) and enters this reading as company
money, and nothing in this amendment is built for it.
