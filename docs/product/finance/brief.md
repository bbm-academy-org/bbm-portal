---
status: Draft
epic: 115
features:
  - F1 (#338) — Ledger core plus F1b current-money balances card and conservative recorded-cost total
  - F2 (#339) — Filling the ledger: manual entry, expense requests, one-time private history reconstruction
  - F3 (#340) — Reports: register, P&L, cash flow, unit cost, break-even (user-facing)
  - F4 (#341) — Fact-vs-finmodel reconciliation (user-facing)
  - F5 (#342) — Scenario calculator on top of the fact (user-facing)
updated: 2026-08-30
---

# Finance — epic brief (#115)

The reader is the owner. This brief is deliberately thin: it says what
`/p/finance` is for and how its surfaces compose. Stories, flows and acceptance
criteria live in the per-feature PRDs listed above.

The decomposition issues were filed on 2026-08-25 (#338–#342), so the PRDs now
carry the house name `<NNN>-product.md`, where `NNN` is the feature's GitHub
issue number. The F-ids stay as the reading shorthand inside this epic's
documents.

## Problem

BBM has money moving through it and no accounting of it.

- **There is no ledger.** The only money-shaped tables in the platform database
  are `hours/hours-assessment.*` — accruals of hours × role rate for one module.
  There is no account, no posting, no expense, no invoice, no P&L
  (prior art §5).
- **There is no expense taxonomy anywhere in the estate.** The money-route
  calculator models expenses as a single aggregated line (`cost0` + growth); the
  smart-contract prototype has waterfall payout tiers (CAPEX / OPEX /
  co-authors / …), which is an order of distribution, not a cost structure. The
  one real cost model — the Doctor.School lesson-cost calculator — is scoped to
  DS lessons (prior art §1, §3, §4). So "what did we spend it on" currently has
  no answer that a system could give. The answer is not invented here either: the
  owner ruled that the category list is derived from the spend once it is
  recorded, not written up front _(decision 11)_.
- **Every number about BBM's money is a model, not a fact.** `finmodel`
  variables and the money-route calculator project the future from parameters;
  the cap-table figures in the prototype are an explicit hypothetical
  (prior art §6, §3). Nobody can put the plan next to the actuals, because the
  actuals are not recorded anywhere.
- **The spend is already multi-currency.** Foreign services are paid in THB
  today, crypto moves alongside RUB, and no surface in the estate handles more
  than one currency.
- **Spending is untracked at the point where it happens.** The team spends and
  tells the owner; there is no request, no invoice attached to the money, no
  approval that becomes a record.

The consequence: the owner cannot answer "what did this project cost", "what
does one lesson cost to produce", "at what price does it break even" or "are we
where the finmodel said we would be" — and cannot decide a price or a hire from
data.

## Jobs-to-be-done

`lead-drafted — ratified at spec go` as a formulation; each job is derived from
the owner-approved discovery decisions 1–22 in issue #115.

- **J1 — "Record what actually happened."** As the owner, I want every rouble,
  baht and satoshi that moved to exist as a fact in one ledger, so that the
  numbers I look at are accounting, not a model. _(decisions 1, 3)_
- **J2 — "Per project, not just per company."** As the owner, I want every
  amount to carry the project it belongs to, so the fund and each project have
  their own P&L. _(decision 2)_
- **J3 — "Filling it must not be my job."** As the owner, I want the ledger fed
  from where the data actually exists, with team requests and manual entry as
  the present paths and future automation added only when a recurring source is
  real.
  _(decision 3)_
- **J4 — "Spending passes approval, before or after."** As a team member, I want
  to submit an expense request with its invoice and get an answer — asking before
  I spend, or filing on the same form what I already spent; as an owner, I want
  approving it to be the act that puts it in the ledger, on both paths.
  _(decisions 6, 8, 12)_
- **J5 — "What does a unit cost, and what must it sell for?"** As the owner, I
  want the cost of one sellable unit of a project and the price at which it
  breaks even. _(decisions 5, 9)_
- **J6 — "Is reality where the model said?"** As the owner, I want the fact put
  next to the finmodel — reserve %, pool sectors, royalty — and the gap named.
  _(decision 5)_
- **J7 — "Let me try a future."** As the owner, I want to change a future
  expense, a price or a volume on top of the real fact and see P&L and cash flow
  move. _(decision 7)_
- **J8 — "History counts."** As the owner, I want everything already spent
  entered once, so the first P&L is not empty — starting from the very first
  operation BBM ever had, with the accounts opening at zero and their balances
  built by the backfill rather than by a synthetic opening entry.
  _(decisions 3, 17)_

## Information architecture

How the epic's surfaces compose into one cabinet.

**The route tree below is `agent-proposed — UNCONFIRMED`.** The owner named the
outputs and the mechanisms (decisions 5–7), never a URL structure: every path,
every split and the order they appear in are the lead's proposal and are settled
at the design gate, not here.

```
portal.bbm.academy  (Zitadel OIDC gate over /p/*, ADR-003 §3; ADR-005 §2: a tool → the portal)
└── /p/finance                     the finance module (ADR-002 §3: route + isolated library)
    ├── /p/finance                 overview: current-money card ← F1b; current period P&L ← F3
    ├── /p/finance/register        the operations register — every posting, filterable       ← F3
    ├── /p/finance/reports         P&L · cash flow · unit cost · break-even                  ← F3
    ├── /p/finance/requests        expense requests: submit (everyone) / approve (owners)    ← F2
    ├── /p/finance/reconciliation  fact vs finmodel — reserve %, pool sectors, royalty       ← F4
    ├── /p/finance/scenarios       what-if on top of the fact                                ← F5
    └── /p/admin → finance         reference tables: accounts, expense categories, request
                                   purposes, projects, products, currencies, rates      ← F1 + #112
```

Seven structural facts:

1. **The ledger is the source of truth; every other surface is a reading of
   it.** Reports, reconciliation and scenarios compute from postings — none of
   them stores its own numbers. _(decision 1: full accounting, ledger as source
   of truth)_
2. **Double-entry and immutability are already decided upstream.** Postings are
   immutable with reversal («сторно») instead of edits; amounts are bigint
   minimal units with currency-dependent precision; a conversion is a linked
   group of postings with each step's fee explicit and the rate frozen at the
   moment of the operation. Consolidation spec §8 fixes this; this epic does not
   re-decide it, it designs the product on top.
3. **Ingestion is a layer, not a form.** Manual entry, `/p/hours` accruals, bank
   statements and invoice uploads are sources plugged into one intake; adding a
   fifth source adds a source, not a second ledger. _(decision 3, owner's
   verbatim intent)_
4. **The project dimension is on the posting, not in the account tree.** Every
   posting carries fund-or-project; P&L and cost are the same computation with a
   different filter. **Projects are one flat level** — no sub-projects in v1, and
   the sellable product sits directly under the project _(decision 16, owner
   2026-08-25)_. `agent-proposed — UNCONFIRMED` as a modelling choice (the
   dimension on the posting rather than in the account tree); decisions 2 and 16
   fix that the dimension exists, is per project, and has exactly one level.
5. **Reference data is editable, not hard-coded — and the taxonomy is derived,
   not invented.** Expense categories, request purposes, accounts, projects,
   products and currencies live as reference tables an owner edits
   _(decisions 10, 21)_. The purpose reference is finer-grained than the category
   list and each purpose is linked to its category, so an expense request picks
   its "what for" instead of typing it _(decision 21)_. The
   category list in particular is **not** written up front: it is derived from
   the real recorded expenses once the filling mechanism has put spend into the
   ledger, and the owner approves the derived list _(decision 11)_. That
   derivation step belongs to **F2**; F1 owns only the empty reference table it
   lands in. The admin surface for all of them is the `/p/admin` shell of epic
   #112, not a second cabinet.
6. **The module owns its own tables.** ADR-004 §1 puts them in the `platform`
   database, §6 in `src/lib/platform/db/schema/finance/`, importable only by the
   finance module; `core` deliberately does not predetermine the finance schema
   (consolidation spec §8, epic #111).
7. **Presentation currency is a view, and plan is never a fact.** Every
   operation keeps the currency it happened in _(decision 13)_. F1b's accepted
   current-money card shows each account in that native currency and offers a
   reproducible total, RUB by default: a chronological replay builds remaining-
   holding rates for each currency pair from the actual conversion operations.
   Each native-currency aggregate is converted separately to the selected
   currency through those recorded pair rates; it never fetches a current/market
   rate _(decisions 13, 18; spec 338 EARS-325)_. F3 owns the
   broader report semantics: register, period cash flow and P&L, cuts and
   drill-down convert the operations they report at each operation's own actual
   rate, frozen at its date. Whether an expense is recognised on accrual or on
   cash is deliberately **not** decided yet — the owner decides it from
   practice; the binding principles are that the math is honest, that debts and
   obligations (including accrued-unpaid team accruals) are counted and shown,
   and that plan stays plan until the fact, with plan-vs-fact an explicit
   distinction _(decision 14)_. The period-report side lives in F3, with the plan
   side in F5.

## Feature decomposition

| Feature | Issue | PRD              | Blocked by | Surface     | What it settles                                                                                                                                                                                              |
| ------- | ----- | ---------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1      | #338  | `338-product.md` | —          | mixed       | what a fact of money is here plus F1b's `/p/finance` current-money card: native account balances and a conservative recorded-cost total — including the empty, editable category table, but no category list |
| F2      | #339  | `339-product.md` | #338       | mixed       | lasting intake through manual entry and expense requests; one-time private reconstruction of existing history and owner-approved categories, with no permanent import surface                                |
| F3      | #340  | `340-product.md` | #338       | user-facing | broader readings: register, period cash flow and P&L, cuts, drill-down, unit cost, break-even price                                                                                                          |
| F4      | #341  | `341-product.md` | #340       | user-facing | fact next to finmodel: reserve %, pool sectors, royalty — expected vs actual, and the gap                                                                                                                    |
| F5      | #342  | `342-product.md` | #340       | user-facing | the epic's final deliverable: what-if on top of the fact, feeding back into P&L and cash flow                                                                                                                |

**The graph:** F1 is the head of the critical path and the only takeable issue at
filing time; F2 and F3 are blocked by F1 (nothing fills or reads a ledger that
does not exist yet); F4 and F5 are blocked by F3 (both read through the report
layer — reconciliation compares against it, scenarios project on top of it).

The decomposition is the lead's, adopted unchanged from the dispatch brief, and
**confirmed by the owner on 2026-08-25** at the wireframe review («в целом ок»,
decision 15) with the ordering amendment recorded under "Design gate" below. Each
feature maps to owner decisions named in its PRD.

Not PRD'd here, deliberately:

- **`/p/hours` accrual export** — the accrual source (decision 3) is consumed by
  F2; the hours module's own product design was its own cycle (#124, closed) and
  its outcome lives in [`docs/specs/124-hours-on-core.md`](../../specs/124-hours-on-core.md),
  not in this epic.
- **The `/p/admin` resources for finance reference tables** — the cabinet is
  epic #112's; this epic contributes resources to it (F1 names them).
- **Payout / token / waterfall mechanics** — the smart-contract prototype's
  cascade and the profit-share proportions are holding-level mechanics with open
  owner forks (prior art §2, §3). This epic records what money did; it does not
  decide who gets it.

## Success metrics

`lead-drafted — ratified at spec go` — the owner has not set numeric targets.

- The owner can answer "what did project X cost last month" from the portal,
  without asking anyone and without opening a spreadsheet.
- Every expense that happens after the module ships arrives in the ledger through
  a source — a request, an import or an accrual — rather than a person retyping
  it. Manual entry is the exception, and its share is visible.
- The cost of one sellable unit of a project, and its break-even price, are on a
  screen rather than in a per-project calculator built for the occasion.
- The finmodel's reserve %, pool sectors and royalty can be compared to the fact
  on any day, and the gap is a number rather than a discussion.
- No number in the ledger is edited in place: every correction is a reversal that
  leaves the original visible.

## Prior art — what exists today

Reference material only; it is a functional reference, never a template to
reproduce. Full digest with passports: [`prior-art.md`](./prior-art.md)
(agent recon, 2026-08-25).

| Source                                                                  | Passport                                                                      | What it contributes                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bbm/outputs/2026-07-24-bbm-finmodel/2026-08-05-money-calculator.html`  | `bbm` (Anton's research repo, sibling) — owner Anton (+Claude) — build/export | the money-route P&L shape and the three milestones; and the proof that expenses are one aggregated line                |
| `.../2026-08-05-money-mechanics-and-forks.md`                           | `bbm` — owner Anton — original (session protocol)                             | salary is an expense before profit; accrual = role rate by grade × actual hours; the open owner forks                  |
| `.../2026-08-01-smart-contract-calculator.html`                         | `bbm` — owner Eduard (with Claude Code) — build (prototype)                   | waterfall tiers CAPEX/OPEX/…: an order of payout, explicitly not a cost structure; numbers hypothetical                |
| `.../2026-08-04-smart-contract-calculator-export.md`                    | `bbm` — maths by Eduard, export by Claude Code — export                       | the same mechanics in text form                                                                                        |
| `bbm/outputs/ds-lesson-cost-calculator/index.html`                      | `bbm` — derived from the DS re-estimate (DSP-218) — build/derived             | **the only real unit-cost model**: per-role payroll with employment-mode tax loading, external vendors, contingency    |
| `src/lib/platform/db/schema/`                                           | bbm-portal (this repo) — original (live schema)                               | hours accruals exist (`monthlyRate`, `hourlyRate`, `accrual`, `cashAmount`, `investAmount`); nothing else money-shaped |
| `src/lib/finmodel/{variables.ts,types.ts}`                              | bbm-portal — original (snapshot of `ssot/finmodel.yaml` in `bbm-kb`)          | the finmodel side of the reconciliation: reserve %, royalty, profit shares, unit price, mining weights                 |
| `docs/superpowers/specs/2026-08-04-platform-consolidation-design.md` §8 | bbm-portal — original (accepted spec)                                         | the fixed engineering frame: double-entry, immutable postings, bigint minimal units, frozen rates                      |
| `docs/adr/002` §3 · `docs/adr/004` · `docs/adr/005` §2                  | bbm-portal — original (accepted ADRs)                                         | module of the monolith; `platform` DB with per-module table ownership; a tool belongs in the portal                    |

**No accounting prior art exists.** Nothing in the estate records a fact of
money; every source above models or projects it. The ledger starts from zero,
which is why discovery ran before the build.

## Design gate

**Wireframe-first ordering — owner ruling, decision 15 (owner 2026-08-25):**
before the F1 ledger-core spec is written, a wireframe prototype of the key
surfaces is drawn and reviewed, so the data model is validated visually and its
gaps surface before it is frozen.

**That epic-level wireframe pass RAN on 2026-08-25 and validated the model.**
12 artboards — the data-model board plus every `/p/finance` surface (overview,
register, operation card, request form and queue, import and sources, references
in `/p/admin`, P&L + cash flow, unit cost and break-even, finmodel
reconciliation, scenarios), every field tagged with the ledger entity it binds
to. The review turned the five open data-model questions carried on its sticky
notes into owner rulings — decisions 16–20 (flat project level, history from the
first operation, actual per-operation frozen rate, lessons/courses as the unit,
scenario baseline recomputed on open) — plus decisions 21–22 on request purpose
and product attribution. Those rulings are absorbed into the PRDs below.

- Artifact: <https://claude.ai/code/artifact/ead41905-c726-42b8-bcdb-4f79b80aab09>
- Record: [issue #115, comment of 2026-08-25](https://github.com/bbm-academy-org/bbm-portal/issues/115#issuecomment-5410131406)

**The per-feature Stage A is still pending for F2–F5.** The wireframe pass
validated the data model and the F1b current-money card now vendored as
`design-source/finance/Overview.dc.html`; that accepted card includes its
«Итого» column and reporting-currency switch. It is **not** the Stage-A layout
pick for F2–F5. Each of those is `user-facing` and carries an empty "Design pick
(Stage A)" slot; per `.claude/rules/design-process.md`, none of those surfaces
is ready to build until its own design is vendored into `design-source/`.
