---
status: Draft
epic: finance (#115) — see ./brief.md
surface: user-facing
updated: 2026-08-25
---

# F2 — Filling the ledger: manual entry, expense requests, history backfill, bank import (#115)

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

Everything written by this feature obeys F1's rules: immutable postings,
reversal instead of edits, amount in the currency's minimal units, the project
dimension on every entry.

## Design pick (Stage A)

_Not yet run._ The expense-request form, the request queue and the import review
screen are the epic's most-used surfaces and need a Stage-A pick vendored into
`design-source/` before any markup (`.claude/rules/design-process.md`).

## User stories

- **US-1** — As a team member, I submit an expense request with the amount, the
  currency, what it is for, the project, and the invoice or receipt attached, so
  spending starts with a request instead of a message. _(decisions 6, 8)_
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

## Flows

**Expense request — happy path.**
Member opens `/p/finance/requests` → fills amount + currency + purpose + project
(+ product where it applies) → attaches the invoice → submits → the request
appears in the owners' queue → an owner approves → the operation is posted to the
ledger with the invoice attached and the approver recorded → the member sees
"approved".

**Expense request — refused.**
The owner refuses with a reason → nothing is posted → the member sees the
refusal. _(`agent-proposed — UNCONFIRMED`: whether a refusal carries a reason)_

**Expense request — already paid.**
A member who spent their own money submits the same request after the fact; the
approval both records the expense and creates the obligation to reimburse them.
_(`agent-proposed — UNCONFIRMED` — this is the common real case, but the owner
described the flow as approve-then-spend)_

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
The owner works through the past spend in a bulk-entry surface — many rows, one
save — and the resulting operations are marked as backfilled. A backfilled
operation behaves exactly like a live one in every report.

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
  period.
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
- Reimbursement tracking as a workflow of its own, unless the owner confirms the
  already-paid flow above.
- The workspace roles themselves — epic #112, feature #313.

## Open questions

1. **Approve-then-spend, or record-what-was-spent?** Decision 6 describes a
   request the owner approves; real spend often happens first. Which is the
   primary flow decides the whole surface.
2. **Which banks and which statement formats** are in v1 — the format decides how
   much of the import is parsing versus mapping.
3. **Does a refusal need a reason**, and does a refused request stay visible in
   history?
4. **Are accruals posted per member or per period aggregate?** Per member gives
   "what did we pay X"; per aggregate is one line per period.
5. **Who besides the owner holds the approving role** — decision 8 says "owners",
   plural.
