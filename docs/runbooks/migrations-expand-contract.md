# Migrations: the expand/contract canon

**Status:** canon, text-only (task 7.6, #137). Written BEFORE the first `core`
migrations (epic 1, #111) so that epic builds its mechanics on top of a rule
that already exists, rather than retrofitting one after the first painful
release. There is no linter enforcing it yet — the enforcement today is this
document plus the pre-deploy checklist in
[`.claude/skills/run-prod-deploy/SKILL.md`](../../.claude/skills/run-prod-deploy/SKILL.md).

## Why this rule exists

`pnpm deploy:prod --rollback <sha>` reverts the **app** in seconds: it brings up
a retained `bbm-portal-app:<sha>` image. It does **not** touch the database, and
that is deliberate — an automatic schema rollback is far more dangerous than the
bug you are rolling back from.

So an app rollback only works when the **previous app code still runs correctly
against the new schema**. Buying that property is the entire point of
expand/contract. Break it, and the rollback button is a lie: pressing it takes
prod from "new code, broken feature" to "old code, 500s on every request",
which is strictly worse.

The second reason is uptime during the deploy itself. The pipeline migrates
**before** the new app starts serving, so for a few seconds the OLD app runs
against the NEW schema. That window exists on every single deploy, whether or
not anyone ever rolls back.

## The rule

> **A single release may only EXPAND the schema. Anything that removes or
> narrows is split across two releases, with a deploy in between.**

### Expand (safe in one release)

- Add a **nullable** column (or one with a default).
- Add a table.
- Add an index.
- Add a value to an enum.
- Write to a new column while still writing the old one (dual-write).

Old code ignores what it does not know about, so it keeps working.

### Contract (never in the same release as the expand)

- `DROP COLUMN` / `DROP TABLE`.
- A **rename** — at the SQL level this is a drop plus an add, and old code
  selecting the old name breaks instantly.
- `SET NOT NULL` on an existing column without a default.
- Narrowing a type (`varchar(255)` → `varchar(64)`, `text` → `int`).
- A backfill that destroys the old representation.

### The two-release split

1. **Release A — expand.** Add the new column/table. Backfill it. Make the app
   write BOTH representations and read the new one with a fallback to the old.
   Deploy. An app rollback here is safe: the previous code still finds
   everything it reads.
2. **Release B — contract.** Only after A is deployed and has been observed
   fine, stop writing the old representation and drop it. Deploy.

Between A and B, an app rollback stays available. After B, rolling back past A
is no longer an app-only operation, and that must be stated out loud before B
ships.

## Payload specifics (this repo)

- Migrations are generated with `pnpm migrate:create` from the diff between the
  Payload collection/global config and the DB, and applied with `pnpm migrate`
  (in prod, by the profiled `migrate` compose service — the standalone runtime
  image has no CLI).
- **Read the generated SQL. Every time.** A field rename in a collection config
  looks like one edit and generates `DROP COLUMN` + `ADD COLUMN` — a contracting
  migration wearing a rename's clothes, with silent data loss. The config diff
  is not the review surface; the `.sql` file is.
- **Forward-only.** `pnpm migrate:down` exists but is not the production
  rollback plan: it is not exercised, and the deploy pipeline never calls it.
  Fixing a bad migration in prod means rolling **forward** with a new migration.
- **There IS a backup, and a deploy takes a fresh one before it migrates**
  (#156). Two independent layers, neither owned by this repo's code:
  - _Nightly, off-box._ A cron on `portal-prod-tw` at **23:30 UTC** runs
    `/home/deploy/portal-backup/backup-portal.sh`: `pg_dump` of the `cms`
    database (gzip) plus a tar of the host-only env files, pushed with `rclone`
    to the Timeweb S3 bucket `bbm-portal-backups`. **Retention:** 30 days in S3;
    locally the script prunes before it writes, so the box cannot fill up.
    Freshness is watched by an independent probe on `mon-prod-tw` with a Grafana
    alert, so a silently-dead cron surfaces as an alert rather than as an empty
    bucket on the day you need it.
  - _Per deploy._ `pnpm deploy:prod` runs that same script as its `checkpoint`
    stage, **after `ship` and before `stack`** — i.e. before any migration is
    applied. It is fail-closed: script missing on the box, or a non-zero exit,
    and the deploy stops with nothing migrated
    ([`tools/deploy/prod.mjs`](../../tools/deploy/prod.mjs)).

  **Owner of the mechanism: the `bbm` ops repo, `infra/portal/README.md`** (the
  install/reinstall runbook and the restore procedure; strategy in
  `infra/backups.md`, scripts in `infra/portal/scripts/`). Restore is a rehearsed
  procedure, not a hope: the drill ran on **2026-08-06** and the dump restored
  cleanly (93 tables, real row counts). Repair or reinstall the script THERE —
  this repo calls it, it does not own it.

  **The honest caveat:** a daily snapshot is not PITR. Between two nightly runs
  the worst-case loss window is **~24h**, and nothing here replays WAL. What the
  pre-migrate checkpoint buys is that this window is **zero for damage a
  migration causes** — the class a deploy can cause — because the dump is taken
  minutes before the migration runs. It does not make a destructive migration
  cheap: recovering from one still means a restore with everything written since
  the checkpoint gone. So the rule above stands, and a contracting migration
  remains an owner-decision, not an agent-decision.

## Before a deploy — the migration check

Run this over the whole deploy range, not just the last PR:

```bash
git diff --name-only <deployedSha>..origin/main -- src/migrations
```

Then read every listed `.sql`:

- **Nothing listed, or expand-only** → the app-only rollback path is intact.
  Ship on the normal path.
- **Anything contracting** → this deploy is an **escalate** class: state the
  rollback plan explicitly (what happens if the release is bad, given that the
  app rollback is now unsafe) and get the owner's go before shipping.

The `<deployedSha>` comes from the live app itself:

```bash
curl -s https://cms.bbm.academy/api/health | jq -r .sha
```

## Related

- [`.claude/skills/run-prod-deploy/SKILL.md`](../../.claude/skills/run-prod-deploy/SKILL.md)
  — the deploy procedure this check is part of.
- [`deploy/README.md`](../../deploy/README.md) — host provisioning and the
  compose stack.
