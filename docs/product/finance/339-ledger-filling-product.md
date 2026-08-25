---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-08-25
---

# F2 — Filling the ledger: manual entry, expense requests, history backfill, bank import (#339)

## Feature summary

The ledger is only as good as what reaches it, and the owner ruled that reaching
it must not be his own typing. This feature is the intake: **manual posting
entry, history backfill of everything already spent, automatic accruals from
`/p/hours`, and bank-statement import** (decision 3), plus the workflow that
produces most future expenses — **expense requests with invoice attachments**
(decision 6).

**Ingestion is a pluggable layer, not a single form.** The owner's verbatim
intent (decision 3): sources and formats will vary — invoice uploads, API pulls,
AI-agent entry, manual UI. Bank-statement import is the **first** plugged source
and the shape the layer is proven against; a fifth source later adds a source,
not a second ledger.

**Roles (decision 8):** the whole team submits expense requests — any platform
login, invoice attached. Owners approve, and approval is what posts to the
ledger; that is a claim-gated role. The gate mechanics are the workspace's
(epic #112, feature #313), not re-decided here.

**Both expense paths are in scope — owner ruling, decision 12 (owner
2026-08-25).** The pre-spend request is the normal path: ask, get approved,
spend. Money that was already spent is filed **retroactively through the same
form**, and it still passes owner approval before anything is posted. There is
one form, one queue and one approval act; the difference between the two paths is
only whether the money had already left when the request was filed. This settles
the approve-then-spend vs record-what-was-spent fork that this PRD previously
carried as an open question.

**The expense taxonomy is derived here, not shipped with F1 — decision 11.**
Once the backfill and the first live sources have put real spend into the ledger,
the category list is derived from those recorded expenses and brought to the
owner for approval; it then lives on as the editable reference table F1 defines.
Nothing seeds it in advance.

**The purpose of a request is a pick, not prose — owner ruling, decision 21
(owner 2026-08-25).** "What for" is chosen from the **purpose reference**
(«справочник назначений») that F1 (#338) owns: finer-grained than the category
list, each purpose linked to its expense category, so the category follows from
the pick. Free text survives only as an optional details comment on the request —
«максимально упрощаем и систематизируем всё».

**The backfill starts at the first operation ever — decision 17 (owner
2026-08-25).** The owner locates it; from there the books run forward, accounts
open at zero, and balances come from the backfilled operations themselves. No
opening-balance entry is filed by this feature.

Everything written by this feature obeys F1's rules: immutable postings,
reversal instead of edits, amount in the currency's minimal units, the project
dimension on every entry.

## Design pick (Stage A)

_Not yet run._ The expense-request form, the request queue and the import review
screen are the epic's most-used surfaces and need a Stage-A pick vendored into
`design-source/` before any markup (`.claude/rules/design-process.md`).

## User stories

- **US-1** — As a team member, I submit an expense request with the amount, the
  currency, what it is for — **picked from the purpose reference**, not typed —
  the project, the product where the expense is attributable to one, and the
  invoice or receipt attached, so spending starts with a request instead of a
  message. _(decisions 6, 8, 21, 22)_
- **US-18** — As a team member who has already spent the money, I file it on the
  same form after the fact, and it goes through the same owner approval before it
  is posted — nothing is recorded around the approval just because the money has
  already left. _(decision 12)_
- **US-19** — As an owner, I approve the derived list of expense categories once
  real spend is in the ledger, and from then on it is mine to edit — no category
  was invented before there was spend to read it off. _(decision 11)_
- **US-2** — As a team member, I can see what happened to my request — waiting,
  approved, refused — without asking. _(`agent-proposed — UNCONFIRMED`; decision
  6 fixes the request, not the status view)_
- **US-3** — As an owner, I see the queue of requests waiting for me, each with
  its invoice, and approve or refuse it. _(decisions 6, 8)_
- **US-4** — As an owner, approving a request is what puts the expense in the
  ledger — there is no second act of entering it by hand. _(decision 8)_
- **US-5** — As an owner, a request I refuse leaves no trace in the ledger, and
  the refusal is visible to the person who submitted it.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-6** — As an owner, the invoice stays attached to the resulting operation,
  so a number in the register can be opened and its document read. _(decision 6)_
- **US-7** — As an owner, I upload a bank statement and the operations in it
  arrive in the ledger without me retyping them. _(decision 3)_
- **US-8** — As an owner, an imported operation that the system has seen before
  is not added twice, however many times I upload the statement.
  _(`agent-proposed — UNCONFIRMED`; a property of import, never named by the
  owner)_
- **US-9** — As an owner, an imported operation that the system cannot classify
  waits for me to name its category and project instead of guessing.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-10** — As an owner, hours accruals reach the ledger automatically from
  `/p/hours` — hours × rates feed expenses with no manual duplication.
  _(decision 3)_
- **US-11** — As an owner, a closed hours period produces its accruals once, and
  re-running or re-publishing the period does not double the expense.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-12** — As an owner, I enter an operation by hand when nothing else can
  produce it, and it is an operation like any other. _(decision 3)_
- **US-13** — As an owner, I enter everything already spent historically, in a
  form built for bulk rather than one screen at a time, so the first P&L is not
  empty. _(decision 3)_
- **US-14** — As an owner, I can tell a backfilled historical operation from an
  operation captured live. _(`agent-proposed — UNCONFIRMED`)_
- **US-15** — As the owner, adding a new source later — an API pull, an
  AI-agent entry, another bank — does not require redesigning intake or touching
  the other sources. _(decision 3, owner's verbatim intent)_
- **US-16** — As an owner, an operation entered wrongly by any source is
  corrected by reversal, and the correction says which source produced the
  original. _(F1, consolidation spec §8)_
- **US-17** — As a team member without the owner role, I cannot post to the
  ledger, only request. _(decision 8)_
- **US-20** — As a team member, I choose the purpose of my request from the
  purpose reference and the expense category follows from it, so two people
  spending on the same thing never file it under two different words. Anything I
  need to say in my own words goes in a details comment beside the picked
  purpose. _(decision 21)_
- **US-21** — As an owner, when a purpose I need is missing from the reference, I
  add it to the reference (linked to its category) rather than letting the form
  accept free text. _(decision 21; `agent-proposed — UNCONFIRMED` as to who may
  add a purpose and whether it can be added inline from the form)_
- **US-22** — As an owner backfilling history, I start from BBM's first operation
  and carry it forward; the accounts stand at zero until the backfilled
  operations move them, so I never enter an opening balance. _(decision 17)_

## Flows

**Expense request — happy path.**
Member opens `/p/finance/requests` → fills amount + currency → **picks the
purpose from the purpose reference**, which carries its expense category with it
_(decision 21)_ → picks the project and, where the expense is attributable to a
product, the product, which is then mandatory _(decision 22)_ → optionally adds a
free-text details comment → attaches the invoice → submits → the request
appears in the owners' queue → an owner approves → the operation is posted to the
ledger with the invoice attached and the approver recorded → the member sees
"approved".

**Expense request — refused.**
The owner refuses with a reason → nothing is posted → the member sees the
refusal. _(`agent-proposed — UNCONFIRMED`: whether a refusal carries a reason)_

**Expense request — retroactive (money already spent).**
A member who has already spent the money — their own or the company's — submits
the same form after the fact, marked as already paid, with the receipt attached →
it lands in the same owners' queue → an owner approves → only then is the
operation posted. The pre-spend and the retroactive path differ in nothing but
that flag. _(decision 12)_ Where the member spent their own money, the approval
also creates an obligation to reimburse them. _(`agent-proposed — UNCONFIRMED`:
decision 12 fixes the path and the approval, not the reimbursement obligation as
a modelled entity)_

**Deriving the category list.**
Once the backfill and the first live sources have populated the ledger, the
recorded expenses are read off into a proposed category list → the owner approves
or reshapes it → it becomes the content of F1's editable reference table, and
existing operations are classified against it. _(decision 11)_

**Bank-statement import.**
Owner uploads the statement file → the system parses it into candidate
operations → each candidate is matched against what is already recorded, and
duplicates are dropped → unclassified candidates are presented for category and
project → the owner confirms → the operations are posted. Nothing is posted
before the owner confirms. _(`agent-proposed — UNCONFIRMED` in its confirmation
step; decision 3 fixes only that bank import is a source)_

**Hours accruals.**
A hours period closes → its accruals (role rate × actual hours, cash and invest
parts) become payroll operations in the ledger, tagged to the project and to the
member → they appear in P&L as payroll without anyone entering them.
_(decision 3; the accrual columns exist today — prior art §5)_

**History backfill.**
The owner locates BBM's **first operation ever**; that date opens the books
_(decision 17)_ → every account starts at zero → the owner works forward through
the past spend in a bulk-entry surface — many rows, one save — and the resulting
operations are marked as backfilled. Balances are produced by those operations
alone: **no opening-balance entry is created for any account**, because
everything since the first operation is on record. A backfilled operation behaves
exactly like a live one in every report.

**A new source arrives.**
A source declares what it produces; intake validates and posts it through the
same path as every other source. No existing source changes.

## Product acceptance criteria

- Any member with a platform login can submit an expense request with an invoice
  attached.
- A member can see the current state of every request they submitted.
- An owner sees all requests awaiting a decision in one place, with their
  invoices readable without leaving the screen.
- Approving a request results in a ledger operation, with no further manual entry
  step.
- A refused request produces no ledger operation.
- Money that was already spent can be filed on the same request form after the
  fact, and it reaches the ledger only through the same owner approval.
- The expense-category list the system runs on was derived from recorded spend
  and approved by the owner; no category list is shipped pre-invented.
- The invoice attached to a request is reachable from the resulting operation in
  the register.
- A member without the owner role cannot post to the ledger by any route,
  including a direct request to the endpoint.
- Uploading the same bank statement twice does not produce duplicate operations.
- An imported line the system cannot classify is presented to the owner rather
  than posted with a guessed category.
- Closing an hours period produces the corresponding payroll expenses in the
  ledger without manual entry.
- Re-publishing or re-closing an hours period does not double the payroll expense
  already recorded.
- The owner can enter past spend in bulk and reach a populated P&L for a past
  period, starting from the first operation of the books, with no account ever
  given an opening balance.
- The request form offers the purpose as a pick from the purpose reference and
  accepts no free-text purpose; the category is derived from the picked purpose.
- A request for an expense attributable to a product cannot be submitted without
  a product.
- A backfilled operation is distinguishable from one captured live.
- Every operation in the register names the source that produced it.
- A wrong operation from any source is corrected by reversal, never by editing.

## Out of scope

- What a posting is and how it is stored — F1.
- Any report over the resulting data — F3.
- Bank API connections (as opposed to statement files), AI-agent entry, and any
  further source — decision 3 names them as future sources the layer must admit,
  not as v1 deliverables.
- Payment execution: nothing here moves money, it records that money moved.
- Reimbursement tracking as a workflow of its own — decision 12 confirms the
  retroactive filing path, not a payables/settlement workflow on top of it.
- The workspace roles themselves — epic #112, feature #313.

## Open questions

1. **Which banks and which statement formats** are in v1 — the format decides how
   much of the import is parsing versus mapping.
2. **Does a refusal need a reason**, and does a refused request stay visible in
   history?
3. **Are accruals posted per member or per period aggregate?** Per member gives
   "what did we pay X"; per aggregate is one line per period.
4. **Who besides the owner holds the approving role** — decision 8 says "owners",
   plural.
5. **How much spend is enough to derive the taxonomy from?** Decision 11 fixes
   that the list comes from the fact, not when the derivation is run — after the
   backfill alone, or after some period of live operation.

_Settled since the first draft:_ approve-then-spend vs record-what-was-spent is
no longer open — decision 12 rules that both paths run through the same form and
the same approval.
