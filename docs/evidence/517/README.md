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
| 4    | `node docs/evidence/517/load-prod-corpus.mjs <rows.json>`            | loaded them into `platform_517` with their production ids, `source_ref` null and `note` verbatim, references by name  |
| 5    | `node docs/evidence/517/run-0017-repair.mjs` (twice)                 | ran `0017`'s repair block, lifted verbatim from the committed migration: **47 rows** the first time, **0** the second |
| 6    | one `insert` (in the PR body)                                        | added request **52**, a ref-less request, so the register carries the «no source» state too                           |
| 7    | `pnpm exec tsx docs/evidence/517/capture.ts http://localhost:3000 …` | drove the matrix below                                                                                                |

Nothing was written to production: step 3 is a `select`, and both scripts refuse
to run against anything but a `platform_<N>` branch database.

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
