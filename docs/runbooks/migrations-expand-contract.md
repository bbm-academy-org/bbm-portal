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
  (#156). This bullet is the single place in THIS repo that states the numbers;
  `deploy/README.md` and the deploy skill point here. Two layers:

  - _Nightly, off-box._ A cron on `portal-prod-tw` at **23:30 UTC** runs
    `/home/deploy/portal-backup/backup-portal.sh`: `pg_dump` of the `cms`
    database (gzip) plus a tar of the host-only env files, pushed with `rclone`
    to the Timeweb S3 bucket `bbm-portal-backups`. **Retention:** 30 days in S3;
    locally the script prunes before it writes, so the box cannot fill up.
    Freshness is watched by an independent probe on `mon-prod-tw` with a Grafana
    alert, so a silently-dead cron surfaces as an alert rather than as an empty
    bucket on the day you need it. These artifacts are keyed by calendar **day**
    (`postgres-YYYYMMDD.sql.gz`), so each run overwrites the day's previous one.
  - _Per deploy._ `pnpm deploy:prod` runs that same script as its `checkpoint`
    stage, **after `ship` and before `stack`** — i.e. before any migration is
    applied — and then **pins** the dump it produced under a key of its own,
    `checkpoints/pre-migrate-<UTC timestamp>-<sha12>.sql.gz`. The pin is the
    point: without it tonight's cron (or a second deploy the same day) would
    overwrite the day-keyed dump that protected this migration, and the recovery
    point would be gone by morning. Pinned objects live in the same bucket, so
    the nightly's recursive `rclone delete … --min-age 30d` gives them the **same
    30-day retention** with no extra machinery. The stage is fail-closed: script
    missing, non-zero exit, no freshly-written dump, or a failed pin, and the
    deploy stops with nothing migrated
    ([`tools/deploy/prod.mjs`](../../tools/deploy/prod.mjs)). Only the dump is
    pinned — the env tar holds secrets, barely changes between deploys, and the
    nightly copy restores alongside it.

  **Owner of the mechanism: the `bbm` ops repo, `infra/portal/README.md`** (the
  install/reinstall runbook and the restore procedure; strategy in
  `infra/backups.md`, scripts in `infra/portal/scripts/`). Restore is a rehearsed
  procedure, not a hope: the drill ran on **2026-08-06** and the dump restored
  cleanly (93 tables, real row counts). A pinned checkpoint is restored the same
  way as any other object in the bucket, by its key. Repair or reinstall the
  script THERE — this repo calls it, it does not own it, and everything the
  script writes goes to `/home/deploy/portal-backup/data/backup.log` rather than
  to the deploy's terminal.

  **The honest caveat:** a daily snapshot is not PITR. For ordinary damage —
  a bad write, an accidental delete — the worst case is still **~24h** back to
  the last nightly, and nothing here replays WAL. What the checkpoint closes is
  the **migration** case, the one a deploy itself can cause: that dump is taken
  minutes before the migration and survives 30 days. It does not make a
  destructive migration cheap — recovering still means a restore with everything
  written since the checkpoint gone, and the app down while it runs. So the rule
  above stands, and a contracting migration remains an owner-decision, not an
  agent-decision.

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
