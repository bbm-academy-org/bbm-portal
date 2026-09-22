# Evidence — #517: «Подана» and «Источник» on the requests register

Captured on the live stand this task's session booted: `PORT=3000 pnpm dev` from
`.claude/worktrees/517`, against the branch database `platform_517` loaded with
the **47 reconstructed Mattermost requests copied from production**, signed in
as the dev test user `bbm-test`. Task-cycle stage 5 item 3.

## How the stand was made

| Step | Command                                                              | What it did                                                                                                           |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | `pnpm dev:db:branch`                                                 | created, migrated and seeded `platform_517`                                                                           |
| 2    | `pnpm platform:migrate`                                              | applied `0017_finance_intake_provenance.sql` (the repair found nothing — the corpus was not there yet)                |
| 3    | `psql` over ssh, read-only                                           | exported the 47 rows of `core.finance_intake_item` whose `note` carries `source_post_id=`, with reference NAMES       |
| 4    | one-off loader script, run from the scratchpad (see below)           | loaded them into `platform_517` with their production ids, `source_ref` null and `note` verbatim, references by name  |
| 5    | one-off repair runner, run from the scratchpad (see below), twice    | ran `0017`'s repair block, lifted verbatim from the committed migration: **47 rows** the first time, **0** the second |
| 6    | one `insert` (in the PR body)                                        | added request **52**, a ref-less request, so the register carries the «no source» state too                           |
| 7    | `pnpm exec tsx docs/evidence/517/capture.ts http://localhost:3000 …` | drove the matrix below                                                                                                |

Nothing was written to production: step 3 is a `select`, and both one-off
scripts refused to run against anything but a `platform_<N>` branch database.

### Steps 4 and 5 are NOT repo artifacts

Both were single-use stand loaders written for this one acceptance run, so they
live in the session scratchpad (`517-load-prod-corpus.mjs`,
`517-run-0017-repair.mjs`) and not in the repository — a one-time repair is a
private temporary script, not a committed tool (task-cycle stage 1,
proportionality). What they did, in words and in the SQL they ran:

**Step 4 — the loader.** It read the 47-row JSON export of step 3, matched each
row's reference names (`finance_project`, `finance_product`, `finance_purpose`,
`finance_counterparty`, `member`) against the branch database by `name` and
created the missing ones, then re-inserted the intake rows with their
PRODUCTION ids — the acceptance criterion of #517 names «request 6
(Higgsfield)». It is an `insert … from json`: nothing is derived, `source_ref`
goes in NULL and `note` verbatim, so the migration's repair has the same input
here that it will have in production. Around the insert:

```sql
select set_config('app.actor_email', 'corpus-loader@example.invalid', true),
       set_config('app.source', 'cli:517-corpus', true);
begin;
alter table core.finance_intake_item disable trigger user;
delete from core.finance_document_link;
delete from core.finance_purpose_proposal;
delete from core.finance_intake_item;
-- per row:
insert into core.finance_intake_item
  (id, source, kind, status, occurred_on, amount, currency, paid_amount, paid_currency,
   fee_amount, fee_currency, purpose_id, project_id, product_id, counterparty_id,
   member_id, note, already_paid, personal_funds, refusal_reason,
   decided_by, decided_at, created_by, created_at, updated_at)
values ($1,…,$23, timestamptz '2026-09-20 11:00:00+00', timestamptz '2026-09-20 11:00:00+00')
on conflict (id) do nothing;
alter table core.finance_intake_item enable trigger user;
select setval(pg_get_serial_sequence('core.finance_intake_item','id'),
              (select max(id) from core.finance_intake_item));
commit;
```

The triggers are off for the reason the migration gives: the capture trigger
refuses a write with no actor context (spec 201 EARS-26) and the stamping
trigger would overwrite `created_at`. This is a fixture load, not an
application write.

**Step 5 — the repair runner.** It is not a second implementation of anything:
it sliced the `DO $intake_provenance_repair$ … $intake_provenance_repair$;`
block out of the committed
`src/lib/platform/db/migrations/0017_finance_intake_provenance.sql` and executed
that text against the branch database — exactly what
`tests/int/platform/finance-intake-provenance.int.spec.ts` does. It was needed
only because `0017` had already been applied (step 2) when the corpus arrived
(step 4). The block is idempotent by construction — it selects on a
`source_system=` line inside `note`, which its own first pass removes — which is
why the second run reported **0 rows**.

Both scripts guarded themselves with
`if (!/\/platform_\d+(\?|$)/.test(PLATFORM_DATABASE_URL)) throw` — they
refuse any database that is not a `platform_<N>` branch.

## The acceptance queries

`acceptance-queries.txt`, run against `platform_517` after step 5:

| Question                                      | Answer                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `count(*) where source_ref is null`           | **0**                                                                                                                                                  |
| `count(*) where note like '%source_system=%'` | **0**                                                                                                                                                  |
| request 6 (Higgsfield)                        | `created_at` = `2026-04-20T14:21:39Z`, `source_ref` = `q41r3h4nxjnozgft493okar9tw`, `provenance.source_system` = `mattermost`, `note` a sentence again |
| refs carrying the `#<item>` split suffix      | **10** — the rows cut from one Mattermost post                                                                                                         |

## The frames

Five states × 1440×900 (`desktop`) and 390×844 (`phone`) × light and dark, plus
the link's three interaction states.

| Frame                           | What it shows                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register--*`                   | the register at the «Все» scope: «Подана» leads with date AND time, the money date under it, the source link as an icon on the rows that have one and NOTHING on the ones that do not |
| `sheet-higgsfield--*`           | request 6 — «ПОДАНА 20.04.2026 14:21» and «ИСТОЧНИК Mattermost ↗», the issue's own acceptance line                                                                                    |
| `sheet-no-source--*`            | request 52 — «Источник» renders «—» and no link                                                                                                                                       |
| `form-source-filled--*`         | «Ссылка на источник» with a Mattermost permalink pasted in                                                                                                                            |
| `form-source-invalid--*`        | `см. в чате` typed into the same field: the field goes red and says what shape is wanted, and nothing is filed                                                                        |
| `source-link--hover--*`         | the sheet's «Источник» link with `:hover` forced through CDP `CSS.forcePseudoState`                                                                                                   |
| `source-link--focus-visible--*` | the same link with `:focus-visible` forced — the ring the keyboard reader gets                                                                                                        |
| `source-link--active--*`        | the same link with `:active` forced                                                                                                                                                   |
