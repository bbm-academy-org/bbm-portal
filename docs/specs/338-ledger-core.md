---
status: Draft
issue: 338
updated: 2026-08-25
---

# Finance F1 — ledger core — spec (issue #338)

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
- **Spec 311 §A, §D** (EARS-401/402/409, EARS-431…439) — the workspace
  declaration contract: finance declares one `internal` entry with an `admin`
  section; its resources mount at `/p/admin/finance/<resource>` through the
  registry, with zod schemas, readable refusals and audited writes.
- **Spec 201 / ADR-004 A1** — every cabinet write runs through
  `platformTransaction` with the signed-in admin as actor, so reference edits
  are attributable in `core.audit_event` (spec 311 EARS-439).

**Donor & benchmark pass:** the engineering constraints above are inherited from
the consolidation spec §8 and the hours schema conventions (spec 124), each
justified for this domain in place. The three accounting questions the PRD left
open (#338 OQ3/OQ4/OQ5) were researched against public canon — IAS 2.16, IAS
38.67, IFRS 15.92/98, IAS 21, the IFRIC June 2019 agenda decision on
cryptoassets, and small-entity cost-accounting practice — and are answered as
**proposed rulings** in "Accounting policy" below, for the owner's sign-off at
the stage-2 go. No owner question in this spec asks what public research
answers.

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

The remaining nine artboards belong to F2–F5 and are vendored on their first
touch (design-source rule 4). F1's admin screens follow the accepted admin-shell
design (`design-source/p-admin-shell.html`, spec 311 EARS-432) — no new Stage-A
pick is needed.

## Data model (lead-level engineering decisions)

Directory `src/lib/platform/db/schema/finance/`, Postgres schema `core`, table
prefix `finance_`. No table stores a balance or a capitalization — both are
sums over postings, always.

| Table                     | Carries                                                                                                                                                                                                                                                                                                 | Key points                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `finance_currency`        | `code` PK (`RUB`, `THB`, `USDT`…), `name`, `precision` (decimal places of the minimal unit: RUB 2, THB 2, USDT 6), `retired_at`                                                                                                                                                                         | precision is frozen once a posting in the currency exists                                                             |
| `finance_account`         | `id`, `name`, `kind` (`bank`\|`card`\|`crypto`\|`cash`\|`income`\|`expense`\|`conversion`\|`fx_result`\|`liability`), `currency` FK, `is_system`, `retired_at`                                                                                                                                          | owner accounts are the four money kinds; system kinds are module-managed, one per (kind, currency), created on demand |
| `finance_project`         | `id`, `name`, `is_fund`, `retired_at`                                                                                                                                                                                                                                                                   | one flat level (decision 16); exactly one fund row («Фонд BBM») seeded by migration                                   |
| `finance_product`         | `id`, `project` FK, `name`, `sale_price` + `sale_price_currency` (both nullable), `retired_at`                                                                                                                                                                                                          | sits directly under its project (decision 16); capitalization is derived, not stored                                  |
| `finance_purpose`         | `id`, `name`, `category` FK (nullable while the category list is empty), `product_binding` (`required`\|`forbidden`\|`optional`), `retired_at`                                                                                                                                                          | decision 21: a purpose is a reference pick; the binding is declared at creation (Accounting policy, ruling 2)         |
| `finance_category`        | `id`, `name`, `allocable` (boolean: flows into unit cost vs period cost), `retired_at`                                                                                                                                                                                                                  | ships **empty** (decision 11); first content is F2's derivation, owner-approved                                       |
| `finance_operation`       | `id`, `occurred_on` (date), `purpose` FK (nullable — transfers, conversions and income carry none), `source` (`request`\|`bank_import`\|`hours`\|`manual`\|`backfill`\|`reversal`), `source_ref` (nullable text, filled by F2's intakes), `backdated` (boolean), `reverses` FK (nullable, unique, self) | the unit the register shows; a conversion chain is ONE operation                                                      |
| `finance_posting`         | `id`, `operation` FK, `account` FK, `amount` (`bigint`, signed, minimal units; debit > 0, credit < 0), `currency` FK, `project` FK (nullable), `category` FK (nullable), `product` FK (nullable), `member_id` (nullable, SQL FK → `core.member`), `conversion_step` FK (nullable)                       | the atomic fact; immutable                                                                                            |
| `finance_conversion_step` | `id`, `operation` FK, `step_no`, `from_currency` FK, `to_currency` FK, `rate` (numeric text, as recorded)                                                                                                                                                                                               | one row per exchange step; its fee is a separate posting referencing the step                                         |

Double-entry works over a chart of accounts that includes the system kinds: an
expense debits the per-currency system `expense` account and credits the money
account; the P&L dimensions (project, category, product, member) ride on the
expense-side posting. This keeps decision 11 intact (categories are data, not
accounts), keeps every operation balanced per currency, and gives F3 its
reports as plain sums.

## Requirements

Ids continue the flat corpus keyspace: this spec holds **EARS-501…**.

### A. Reference tables (справочники)

- **EARS-501.** The finance module shall store currencies, accounts, projects,
  products, purposes and expense categories as editable reference tables, per
  the vendored `design-source/finance/References.dc.html`.
- **EARS-502.** WHEN the owner adds a currency with its precision, the system
  shall accept postings in that currency immediately, with no release.
- **EARS-503.** IF a posting exists in a currency, THEN the system shall refuse
  a change to that currency's precision.
- **EARS-504.** The system shall seed exactly one fund project row («Фонд BBM»)
  in the migration, and shall refuse to retire it or to create a second fund
  row.
- **EARS-505.** The system shall create system accounts (income, expense,
  conversion, fx_result, liability) itself, one per kind and currency on first
  need, and the cabinet shall not offer creating, editing or retiring them.
- **EARS-506.** WHEN a purpose is created, the system shall require its
  `product_binding` (`required` / `forbidden` / `optional`) to be declared, and
  shall link the purpose to an expense category WHERE the category list is
  non-empty.
- **EARS-507.** The expense category table shall ship empty: no migration, seed
  or fixture inserts a category (decision 11); each category row shall carry an
  `allocable` flag stating whether it flows into unit cost or is a period cost.
- **EARS-508.** IF a reference row (currency, account, project, product,
  purpose, category) is referenced by any posting, operation or purpose, THEN
  the system shall refuse to delete it and shall offer retirement instead;
  a retired row shall stay valid on every existing posting and shall stop
  being offered for new ones.
- **EARS-509.** The system shall never rewrite an existing posting as a
  consequence of a reference edit — renames and retirements change how rows
  read going forward, never what was recorded.

### B. The fact core: operations, postings, reversal, conversions

- **EARS-510.** The finance module shall record money only as operations made
  of postings: each posting names its account, a signed `bigint` amount in the
  currency's minimal units, and its currency; each amount keeps the currency it
  happened in, with conversion for display left to reports (F3).
- **EARS-511.** The system shall refuse to record an operation whose postings
  do not sum to zero per currency.
- **EARS-512.** IF a posting's currency differs from its account's currency,
  THEN the system shall refuse the operation.
- **EARS-513.** The system shall refuse any update or delete of a recorded
  operation or posting, at the module API and — as an accident guard, per the
  spec-201 precedent — with database triggers on both tables; the only
  correction is reversal.
- **EARS-514.** WHEN an operation is reversed (сторно), the system shall record
  a new operation with `source = reversal`, referencing the original, whose
  postings mirror the original's with negated amounts and identical dimensions;
  both operations shall remain visible, and their sum shall be zero in every
  cut.
- **EARS-515.** IF an operation has already been reversed, THEN the system
  shall refuse a second reversal of it; a reversal operation itself shall be
  reversible (undoing a mistaken reversal).
- **EARS-516.** Every posting shall be traceable to its source: the operation
  carries one of `request` / `bank_import` / `hours` / `manual` / `backfill` /
  `reversal` (decision 3); backfilled operations carry the `backdated` flag
  (decision 17 context). F1 fixes the enum and the columns; the intake flows
  that fill `source_ref` are F2's.
- **EARS-517.** The system shall provide no opening-balance mechanism: every
  account starts at zero and its balance is exclusively the sum of its postings
  (decision 17).
- **EARS-518.** The system shall record a currency conversion as ONE operation:
  its exchange steps as `finance_conversion_step` rows each carrying the actual
  rate as recorded at the operation (decision 18), each step's fee as its own
  posting, and the legs balanced per currency through the system conversion
  account.
- **EARS-519.** The system shall never restate a recorded rate or amount: a
  conversion read a year later shows the rate of its day (decision 18), and no
  process revalues crypto or currency balances by posting (Accounting policy,
  ruling 3).
- **EARS-520.** WHEN a purpose with `product_binding = required` is used on an
  expense operation, the system shall refuse to record it without a product;
  WHEN the binding is `forbidden`, the system shall refuse a product on it;
  WHERE the binding is `optional`, the product may be absent (decision 22;
  Accounting policy, ruling 2).
- **EARS-521.** Every posting on an income or expense system account shall name
  a project (the fund row counts as one), so P&L is computable per project and
  for the whole of BBM as their sum (decision 2).
- **EARS-522.** WHERE an amount is attributable to a person, the posting shall
  carry `member_id`, declared as an SQL FK to `core.member` in the migration
  (ADR-004 §6) and asserted by an integration test, so "what did we pay X" is a
  query.

### C. Module structure, admin resources, audit

- **EARS-523.** The finance module shall live as `src/lib/finance/` with its
  public API in `src/lib/finance/index.ts` (ADR-002 §3), exposing recording,
  reversal, reference management and balance/register queries; its tables shall
  appear only via the platform migration pipeline (ADR-004 §3), and
  `pnpm boundaries` shall stay green: only the finance module imports
  `schema/finance/`, and no route imports a table file.
- **EARS-524.** The module shall export one `internal` workspace declaration
  (slug `finance`, href `/p/finance`) with an `admin` section declaring the
  reference resources, registered in the composition root (spec 311
  EARS-401/402), so they mount at `/p/admin/finance/<resource>` with no edit to
  the shell (EARS-409).
- **EARS-525.** WHEN a signed-in member opens `/p/finance`, the page shall
  render the accounts with their balances computed live from postings, each in
  its own currency (the cash card of the vendored
  `design-source/finance/Overview.dc.html`); the rest of the overview is F3's
  and shall not be stubbed.
- **EARS-526.** Every cabinet write to a finance reference shall run through
  `platformTransaction` with the signed-in admin as actor (spec 311 EARS-439),
  and shall validate against the module's zod schemas (EARS-436); a refusal
  (EARS-503/504/508/511/512/513/520) shall reach the admin as the module's
  readable message, never a raw constraint error (EARS-473 shape).

## Accounting policy — proposed rulings for the stage-2 go

The owner ruled (decision 22) that overhead treatment follows proper-accounting
best practice, researched by this spec and signed off at the go. Three rulings
are proposed; each is a **spec proposal awaiting the owner's sign-off**, and the
sign-off is recorded with the go on #338.

**Ruling 1 — product-less overhead (closes #338 OQ4).** Canon (IAS 2.16, IAS
38.67, IFRS 15.98) excludes administrative, selling and general overhead from
the cost of a product; allocation is reserved for overhead incurred inside
making the thing, and at BBM's scale (few, heterogeneous, low-volume products)
an allocation base distorts more than it informs. Proposal — a three-rung
ladder:

1. a **direct** cost → its product;
2. **directly attributable overhead** → a product only if it passes ALL of:
   (a) it would not exist without the product, (b) it traces to ONE product
   without a percentage split, (c) its purpose is to create/deliver the product
   rather than to sell it or run the entity;
3. everything else → **period cost** of the fund or project, **no allocation
   base in v1**.

Capitalization of a product = its direct costs + its directly attributable
overhead, read off postings (EARS-520/521 carry the mechanics). Trade-off,
stated: the sum of product margins exceeds holding profit by the unallocated
overhead, which F3 shows as one explicit line — never smeared. Because the
ledger stores attributability per posting, an absorption/ABC view can be added
later as an F3 overlay without restating anything.

**Ruling 2 — the attributability test (closes #338 OQ5).** Adapted from IFRS
15.92's incremental-cost wording into two filer questions: (1) «Если бы этого
продукта не было — мы бы всё равно потратили эти деньги?» yes → no product;
no → name it; (2) only if "partly": «Можешь назвать ОДИН продукт без деления по
процентам?» no → no product (v1 does not split). The filer rarely answers them:
attributability is declared ONCE, on the **purpose**, as `product_binding`
(EARS-506/520) — whoever defines a purpose runs the test, and the form then
requires, hides or offers the product field. `optional` is the pressure valve;
F3 reports optional filings left product-less so the taxonomy converges from
use.

**Ruling 3 — crypto holdings (closes #338 OQ3).** Per the IFRIC June 2019
agenda decision crypto is a non-monetary asset; IAS 21 does not retranslate
non-monetary items held at cost — the transaction-date rate persists, so the
ledger's frozen-rate principle IS the standard treatment. Proposal: the ledger
holds crypto at the recorded rate forever; **no revaluation postings ever**
(EARS-519); the difference is recognised only on disposal, posted at the
disposal-date rate to the system `fx_result` account of the fund, never onto a
product; unrealised movement is an F3 display concern (a computed, labelled
non-posting line). IAS 36 impairment is an explicit v1 deferral.

Cross-cutting principle, verbatim in the model: the ledger records facts at the
rate and cost object they had when they happened; every judgement that can
change later — allocation, absorption, revaluation — lives in F3 as a computed
overlay, never as a posting. Policy changes become report changes, not
migrations.

## CRUD check (task-cycle stage 1a)

| Resource (`/p/admin/finance/…`) | Create                                               | Read                                  | Update                                       | Delete                                                             |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| currencies                      | yes (code, name, precision)                          | yes                                   | name; precision only while unused (EARS-503) | retire; hard delete only if never referenced (EARS-508)            |
| accounts                        | yes (money kinds only)                               | yes (system accounts shown read-only) | name                                         | retire; same rule                                                  |
| projects                        | yes                                                  | yes                                   | name                                         | retire; the fund row is neither retirable nor deletable (EARS-504) |
| products                        | yes (under a project)                                | yes                                   | name, sale price                             | retire; same rule                                                  |
| purposes                        | yes (binding mandatory, EARS-506)                    | yes                                   | name, category link, binding                 | retire; same rule                                                  |
| categories                      | yes (from F2's derivation on; the table ships empty) | yes                                   | name, allocable flag                         | retire; same rule                                                  |

Deliberately unsupported: creating/editing system accounts (EARS-505); any
cabinet surface for operations or postings — the fact core is written only by
the module API (intakes are F2); changing a currency's precision in use; a
second fund row.

## Acceptance scenarios

Owner walkthrough, on a live stand, after the go and the build:

1. **References exist and are mine to edit.** Open `/p/admin` → group «Финансы»
   lists the six resources (EARS-524). Create currency `THB` (precision 2),
   account «Карта THB» (kind card, THB), project «Doctor.School», product
   «Урок» under it, purpose «Продакшн урока» with binding `required` — each
   save answers with a visible confirmation (EARS-501/502/506, spec 311
   EARS-472).
2. **The ledger starts honest.** Open `/p/finance` — every account shows
   balance 0 in its own currency, because no operation exists yet
   (EARS-517/525).
3. **The past is protected.** In `/p/admin`, try deleting the currency `THB`
   that the account uses — a readable refusal offers retirement instead
   (EARS-508/526). Rename the account — the rename is visible, nothing else
   changes (EARS-509).
4. **The fund is fixed.** Try retiring «Фонд BBM» — a readable refusal
   (EARS-504).
5. **Categories are not pre-invented.** Open the categories resource — the
   table is empty, with creation available (EARS-507).

### Verified by CI, not by the owner

The fact-core invariants have no owner-facing surface until F2's intakes; they
are exercised by TDD tests named `it('EARS-N: …')` (task-cycle stage 3):
per-currency zero-sum (EARS-511/512), immutability incl. the DB trigger
(EARS-513), reversal mechanics (EARS-514/515), the source enum and backdated
flag (EARS-516), no-opening-balance (EARS-517), conversion steps with frozen
rates (EARS-518/519), product binding (EARS-520), the project dimension
(EARS-521), the `core.member` FK (EARS-522), boundaries (EARS-523).

## Out of scope

- Every intake: the request form, approval queue, bank import, backfill, hours
  accruals — **F2 (#339)**, which also derives the category list (decision 11)
  and settles roles/claims (decision 8). F1's `/p/finance` and `/p/admin`
  screens are reachable to signed-in members; narrowing by claim is F2's.
- Reports beyond the balances card: register UI, P&L, cash flow, unit cost,
  capitalization display — **F3 (#340)**; reconciliation — **F4 (#341)**;
  scenarios — **F5 (#342)**.
- Obligations (decision 14): the `liability` account kind exists in the enum so
  F2's accruals and reimbursements have a home, but no obligation flow ships in
  F1.
- Documents/attachments — arrive with the request flow (F2).
- Payout/token/waterfall mechanics, tax filing, statutory forms
  (`338-product.md` Out of scope).

## Open questions

None remain open as questions. #338 OQ1/OQ2 were closed by decisions 16/17;
OQ3/OQ4/OQ5 are answered by the three proposed rulings above and close when the
owner signs them off at the stage-2 go.
