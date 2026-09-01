---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-09-01
---

# F2 — Filling the ledger: manual entry, expense requests and one-time history reconstruction (#339)

## Feature summary

The ledger is only as good as what reaches it, and the owner ruled that reaching
it must not be his own typing. This feature is the lasting intake: **manual
posting entry** plus the workflow that produces most future expenses —
**expense requests with invoice attachments** (decision 6). Existing history is
reconstructed once as private operator work through those already-shipped
single-item primitives; it is not another product surface.

**Intake keeps a source boundary without pre-building hypothetical producers.**
The owner's intent (decision 3) is that sources may vary later. F2 proves only
the sources it actually has: requests and manual entry. A bank parser or agent
producer is scoped when a real recurring input exists, not reserved through an
unused implementation.

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
The private historical mapping groups real spend before posting; the owner
approves the initial categories, and the resulting purposes/categories are
created through F1's editable references before the historical items are posted.
Nothing is invented or seeded in advance, and no permanent derivation view is
needed.

**The purpose of a request is a pick, not prose — owner ruling, decision 21
(owner 2026-08-25).** "What for" is chosen from the **purpose reference**
(«справочник назначений») that F1 (#338) owns: finer-grained than the category
list, each purpose linked to its expense category, so the category follows from
the pick. The purpose is **a reference pick, not free text** — «максимально
упрощаем и систематизируем всё».

**The backfill starts at the first operation ever — decision 17 (owner
2026-08-25).** The owner locates it; from there the books run forward, accounts
open at zero, and balances come from the backfilled operations themselves. No
opening-balance entry is filed by this feature.

Everything written by this feature obeys F1's rules: immutable postings,
reversal instead of edits, amount in the currency's minimal units, the project
dimension on every entry.

## Design pick (Stage A)

_Not yet run._ The expense-request form, request queue and manual-entry surface
need a Stage-A pick vendored into
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
- **US-7–US-9 — retired unbuilt.** A bank-statement product was speculative
  without a real statement format or demonstrated recurring operation. It gets
  a separate product decision if that need appears.
- **US-10** — As an owner, hours accruals reach the ledger automatically from
  `/p/hours` — hours × rates feed expenses with no manual duplication.
  _(decision 3)_
- **US-11** — As an owner, a closed hours period produces its accruals once, and
  re-running or re-publishing the period does not double the expense.
  _(`agent-proposed — UNCONFIRMED`)_
- **US-12** — As an owner, I enter an operation by hand when nothing else can
  produce it, and it is an operation like any other. _(decision 3)_
- **US-13** — As an owner, I have everything already spent reconstructed once
  from the records we already hold, so the first P&L is not empty and no
  permanent import tool remains afterward. _(decision 3; owner correction
  2026-09-01)_
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
  spending on the same thing never file it under two different words, and the
  form does not let me type one instead. _(decision 21)_
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
product, the product, which is then mandatory _(decision 22)_ → attaches the
invoice → submits → the request
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
The private historical table groups recorded expenses by purpose before any
production write → the owner approves or reshapes the category list → the
categories and purpose links are created through F1's ordinary audited reference
edits → historical operations store that approved classification when posted.
_(decision 11; owner correction 2026-09-01)_

**Hours accruals.**
A hours period closes → its accruals (role rate × actual hours, cash and invest
parts) become payroll operations in the ledger, tagged to the project and to the
member → they appear in P&L as payroll without anyone entering them.
_(decision 3; the accrual columns exist today — prior art §5)_

**History backfill.**
The owner locates BBM's **first operation ever**; that date opens the books
_(decision 17)_ → a private temporary table is prepared from Mattermost posts and
documents → ambiguous mappings and the category list are approved → a temporary
operator runner sends each row through the existing one-item finance path → the
runner and private working files are removed after verification. Every account
starts at zero; **no opening-balance entry is created**. No reusable backfill
backend, CLI or UI is shipped.

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
- Closing an hours period produces the corresponding payroll expenses in the
  ledger without manual entry.
- Re-publishing or re-closing an hours period does not double the payroll expense
  already recorded.
- The one-time reconstruction reaches a populated P&L from the first operation,
  with no opening balance and no permanent import surface left in the product.
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
- Permanent bulk-backfill/import APIs, CLIs and UIs; the historical transfer is
  one-time private operator work.
- Bank statement parsing/import until a real format and recurring need are
  presented and separately approved.
- Reimbursement tracking as a workflow of its own — decision 12 confirms the
  retroactive filing path, not a payables/settlement workflow on top of it.
- The workspace roles themselves — epic #112, feature #313.

## Open questions

1. **Does a refusal need a reason**, and does a refused request stay visible in
   history?
2. **Are accruals posted per member or per period aggregate?** Per member gives
   "what did we pay X"; per aggregate is one line per period.
3. **Who besides the owner holds the approving role** — decision 8 says "owners",
   plural.
4. **What makes an expense "attributable" to a product?** This form blocks a
   submit on it, and no owner decision defines the test — the definition is owned
   by F1's open question 5 (#338) and is answered at the F1 spec go, not here.

_Settled since the first draft:_ approve-then-spend vs record-what-was-spent is
no longer open — decision 12 rules that both paths run through the same form and
the same approval.
