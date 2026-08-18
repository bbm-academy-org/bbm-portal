# `/p/hours` on `core` — the production cutover

The procedure that moves the production hours document out of `hours.json` and
into the `platform` database's `core` schema, in one maintenance window, with the
rollback warm until the owner says «принято».

Canon: spec [`docs/specs/124-hours-on-core.md`](../specs/124-hours-on-core.md),
clauses EARS-13..16 and 25..27 plus acceptance scenarios 1–5. Where this file and
the spec disagree, the spec wins and this file is the bug. The deploy pipeline it
drives is [`.claude/skills/run-prod-deploy/SKILL.md`](../../.claude/skills/run-prod-deploy/SKILL.md)
and `tools/deploy/prod.mjs`; the expand/contract rules the migrations obey are
[`migrations-expand-contract.md`](./migrations-expand-contract.md).

**Owning task: #256.** The tooling was built by #255 and is documented in
[§ The tooling](#the-tooling) below, unchanged.

## Preconditions

Every one of these is checked BEFORE the window opens. A missing one is a reason
to postpone, not to improvise.

| #   | Precondition                                                                                                                                           | Where the evidence is                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | **The EARS-26 dev rehearsal ran** — seed → import → verify against a COPY of the production `hours.json`, ending in `VERDICT: identical`               | the rehearsal record linked from the plan comment on **#256**; the runs themselves are commented on **#255** |
| 2   | **#125 is in production** — the `platform` database, `PLATFORM_DATABASE_URL` in the box's `deploy/.env.prod`, and the platform migrate in the pipeline | `deploy/.env.prod` on the box already carries `PLATFORM_DATABASE_URL` and `HOURS_DATA_FILE`                  |
| 3   | **#255 is merged and on `origin/main`, CI green** — the deploy refuses anything else                                                                   | `preflightVerdict` in `tools/deploy/prod.mjs`                                                                |
| 4   | **The member dataset is prepared with the owner** and sits on the box OUTSIDE `~/bbm-portal`                                                           | see [the dataset rule](#the-seed-dataset--and-the-rule-that-it-is-never-committed)                           |
| 5   | **The owner is present** for the window and for the acceptance right after it                                                                          | the «go» comment on #256                                                                                     |

**Why the dataset must live outside `~/bbm-portal`.** The `migrate` service builds
with `context: ..` (`deploy/docker-compose.prod.yml`), i.e. the whole
`/home/deploy/bbm-portal` tree. A dataset file placed anywhere inside it is baked
into the tooling image — real names, emails and handles, in a layer that outlives
the window. It lives in `/home/deploy/cutover/` (mode 700, created in the window)
and is mounted into the container instead.

```bash
mkdir -m 700 -p /home/deploy/cutover     # does not exist until the window
```

**The `platform` dump is manual, and deliberately so.** The box's checkpoint
script (`/home/deploy/portal-backup/backup-portal.sh`, owned by the `bbm` ops repo)
still dumps only `cms` — `checkpoints/` in the bucket holds `postgres-YYYYMMDD.sql.gz`
and nothing else. Extending it is `sidorovanthon/bbm#112`, which is OPEN; the owner
decided (2026-08-18) not to hold the window for it. So the window takes a
`pg_dump platform` by hand and pins it next to the `cms` checkpoint. The deploy
prints a WARNING about exactly this on every run — that warning is expected here,
not a failure.

## The window

Roughly 20–30 minutes. `docker compose stop app` takes **both**
`portal.bbm.academy` and `cms.bbm.academy` down — they are the same container
(`bbm-portal-app-1`) — and `preview.bbm.academy` with them (`preview` depends on
`app`). The owner accepted that outage.

Shell prompts below: `box$` runs on `portal-prod-tw` in `/home/deploy/bbm-portal/deploy`;
`ws$` runs on the workstation in the repo checkout.

### 1 — Freeze the document

```bash
box$ cd /home/deploy/bbm-portal/deploy
box$ COMPOSE='docker compose -f docker-compose.prod.yml'
box$ $COMPOSE stop app
box$ docker inspect -f '{{.State.Running}}' bbm-portal-app-1     # must print: false
```

Nothing may write `hours.json` from here on. That is what makes the import's
source a fixed byte sequence and the rollback a complete answer.

### 2 — Take the document off the box

```bash
box$ docker cp bbm-portal-app-1:/data/hours/hours.json \
       /home/deploy/cutover/hours.json.pre-cutover
box$ sha256sum /home/deploy/cutover/hours.json.pre-cutover
```

`docker cp` works on a stopped container and is daemon-side, so it needs nothing
inside the image. Keep the sha256 — it goes into the evidence comment and proves
EARS-16 (the import never mutates the source) at the end of the window.

> The same directory on the volume also holds a stale root-owned
> `.hours.json.rollback-20260801T092809620Z` from the #102 cleanup
> ([`hours-period-102-cleanup.md`](./hours-period-102-cleanup.md)). It is not the
> source of anything here. Leave it alone.

### 3 — Build, checkpoint and migrate — but do NOT serve

```bash
ws$ pnpm deploy:prod --hold-before-up > deploy-256.log 2>&1
```

`--hold-before-up` runs the pipeline's first six stages — `preflight`,
`readPrevSha`, `verifyRemoteEnv`, `ship`, `checkpoint`, `deployStack` — and stops.
The stack stage under the flag builds `app` + `migrate`, applies Payload's
migrations to `cms` and the platform's to `core`, prints both ledgers, and does
**not** run `up -d`. The container that exists on the box is still the previous
image (`07ceab2`), stopped since step 1: the new image is BUILT and never
started, so nothing serves `/p/hours` against an empty `core`.

The run ends with the block of next commands (steps 5–8 below) and exit code 0.
It is not a failure and it is not a half-deploy: no marker is written anywhere,
and the plain re-run in step 8 simply runs the whole pipeline again.

Expected in `deploy-256.log`: the pinned checkpoint key
(`checkpoints/pre-migrate-<UTC>-<sha12>-postgres-YYYYMMDD.sql.gz`), the
`[checkpoint] WARNING: no pinned dump looks like: platform` line (precondition
above), Payload's `payload_migrations` tail and `core.__drizzle_migrations`
showing the hours migrations applied.

### 4 — Pin a manual `platform` dump

```bash
box$ TS=$(date -u +%Y%m%dT%H%M%SZ)
box$ docker exec bbm-portal-postgres-1 pg_dump -U payload -Fc platform \
       > /home/deploy/cutover/platform-pre-import-$TS.dump
box$ ls -l /home/deploy/cutover/platform-pre-import-$TS.dump   # must be non-zero

box$ export PATH="$HOME/.local/bin:$PATH"        # rclone is user-local
box$ set -a; . /home/deploy/portal-backup/.s3-backup.env; set +a
box$ rclone copyto /home/deploy/cutover/platform-pre-import-$TS.dump \
       "twcs:$S3_BUCKET/checkpoints/platform-$TS.dump"
```

There is no `pg_dump` on the host; the one inside `bbm-portal-postgres-1`
(postgres 17) is the one that matches the server. The remote name `twcs:` and the
bucket variable `$S3_BUCKET` come from the backup env file — `<verify on box>` that
the file resolves both, since this repo never reads it.

This dump is the state «schema migrated, `core` empty». It is what a restore
returns to if step 7 goes wrong in a way truncate-and-retry cannot fix.

### 5 — Seed the member registry (dry run first)

```bash
box$ $COMPOSE --profile tools run --rm \
       -v /home/deploy/cutover/members.json:/tmp/members.json:ro \
       migrate pnpm platform:member:seed /tmp/members.json --dry-run
```

The owner reads the dry-run summary. `--dry-run` is the real transaction rolled
back, so the counts it prints are counts the database accepted. Then, unchanged
except for the flag:

```bash
box$ $COMPOSE --profile tools run --rm \
       -v /home/deploy/cutover/members.json:/tmp/members.json:ro \
       migrate pnpm platform:member:seed /tmp/members.json
```

### 6 — Import the document

```bash
box$ $COMPOSE --profile tools run --rm \
       -v bbm-portal_hoursdata:/data/hours:ro \
       migrate pnpm platform:hours:import /data/hours/hours.json
```

Read-only mount: EARS-16 says the import never writes the source, and the mount
makes that structural rather than trusted. One transaction; it refuses non-empty
`hours_*` tables and aborts with the full list of unmatched emails if the seed and
the document disagree.

### 7 — Verify, and read the verdict

```bash
box$ $COMPOSE --profile tools run --rm \
       -v bbm-portal_hoursdata:/data/hours:ro \
       migrate pnpm platform:hours:verify /data/hours/hours.json
```

The last line must be exactly:

```
VERDICT: identical
```

(exit 0). Anything else — `VERDICT: differs — N path(s)` — is a **stop**. Read the
paths, then [truncate and retry](#re-run-inside-the-window-truncate-and-retry)
below; do not continue to step 8 with a differing verdict.

### 8 — Bring traffic up

```bash
ws$ pnpm deploy:prod
```

No flag. This runs the FULL pipeline again, and every stage of it is safe to
repeat:

| Stage                  | On the re-run                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight`            | same clean tree, same `origin/main` sha, same green CI                                                                                |
| `ship`                 | `rm -rf ~/bbm-portal/src` + re-extract of the same archive; `deploy/` untouched                                                       |
| `checkpoint`           | a **second** dump, pinned under its own timestamped S3 key — it overwrites nothing, and it now captures `core` WITH the imported rows |
| `deployStack`          | docker layer cache makes the build short; both migration ledgers are idempotent and report "no migrations to apply"                   |
| `applyCaddy` → `smoke` | first run of these in this window: they are what proves prod serves the new image                                                     |

The re-run costs one extra checkpoint (a few minutes) and buys the property that
there is exactly one way to finish a deploy. Nothing needs to be undone first.

### 9 — Owner acceptance

The owner runs acceptance scenarios **1–5** of
[`docs/specs/124-hours-on-core.md`](../specs/124-hours-on-core.md#acceptance-scenarios)
on the live stand — parity on `/p/hours`, parity on `/p/hours/admin`, history
integrity against the EARS-27 verdict, seed integrity, and the cutover evidence
itself. The scenario texts live there; they are not restated here.

Until the owner says «принято» the [rollback](#rollback--until-the-owners-acceptance)
is the answer to any problem.

### 10 — Evidence, then destroy the dataset

Paste on **#256**: the sha256 of `hours.json.pre-cutover` (before and after the
import — identical, EARS-16), the checkpoint key and the manual `platform` dump
key, the seed dry-run and real summaries, the import's per-table row counts, the
`VERDICT: identical` line, and the tail of `deploy-256.log` from the traffic
re-run (verify + smoke green).

```bash
box$ shred -u /home/deploy/cutover/members.json
box$ ls -la /home/deploy/cutover/          # the dataset must be gone
```

`hours.json.pre-cutover` and the `platform` dump stay until PR-2 lands; the
dataset does not (EARS-14).

## Rollback — until the owner's acceptance

```bash
ws$ pnpm deploy:prod --rollback 07ceab2
```

`07ceab2` is the sha production runs today; confirm it against the deploy's own
`↩ previously deployed:` line rather than trusting this page. The rollback is an
app-image swap: no rebuild, no migration, no database write. The old image reads
`hours.json`, which this procedure never modified (EARS-16), so it comes back to
exactly the document it was serving before the window. Rows written into `core`
during the window are consciously abandoned — the window is a maintenance window
and every write in it is the operator's own (EARS-25).

**If the archive rename already happened** (it is PR-2's step, but if it was done
early) restore the name FIRST, or the old image starts against a missing file:

```bash
box$ APP_IMAGE=$($COMPOSE images -q app)
box$ docker run --rm --user 0 \
       --mount type=volume,src=bbm-portal_hoursdata,dst=/data/hours \
       "$APP_IMAGE" mv /data/hours/hours.json.<date> /data/hours/hours.json
```

**After the owner's acceptance there is no rollback.** From that moment `core` is
the master and the JSON is stale, so going back would silently drop everything
written since. Forward-fix only (EARS-25).

## After the GO — what PR-2 does

Listed here so nobody does it inside the window. All of it belongs to **PR-2 of
#256**, opened after the acceptance:

- archive the document in place on the volume as `hours.json.<date>` (EARS-15);
- delete `src/lib/hours/store.ts` and `HOURS_DATA_FILE` from `deploy/.env.prod`
  and the compose contract;
- keep a frozen READ-ONLY reader under `tools/platform/` so
  `pnpm platform:hours:verify <archive>` still works against the archive;
- revise spec 081's «Хранение (без БД)» section to point at spec 124;
- write the EARS-15 test and drop the last `#256` deferral from
  `tools/lint/ears-test-lint.mjs`.

---

## The tooling

Everything below documents the three commands #255 built and the rules that come
with them. It is reference material for the steps above.

### The three commands

```bash
pnpm platform:member:seed  <dataset.json> [--dry-run]   # EARS-14
pnpm platform:hours:import <hours.json>                 # EARS-13, EARS-16, EARS-27
pnpm platform:hours:verify <hours.json>                 # EARS-26, EARS-27
```

Order is not a preference: `member` must hold every person the document names
before the import runs, because the import **matches** participants to the
registry and refuses to invent anybody (EARS-13). Sources:
`tools/platform/member-seed.ts`, `tools/platform/hours-import.ts`,
`tools/platform/hours-verify.ts` — each file's header carries the reasoning; this
page carries the operating rules.

Both write commands need `PLATFORM_DATABASE_URL` (the platform database, separate
from Payload's `cms` — ADR-004 §3), read from the environment or `.env`, the
environment winning. On the box that comes from `deploy/.env.prod`, which the
`migrate` service loads via `env_file`.

### The seed dataset — and the rule that it is never committed

```json
{
  "members": [
    {
      "email": "anton@bbm.academy",
      "name": "Антон Сидоров",
      "role": "CTO",
      "status": "active",
      "timezone": "Europe/Moscow",
      "slug": "anton",
      "aliases": [{ "kind": "mattermost_id", "value": "dobroyar", "note": "MM login" }]
    }
  ]
}
```

`email` and `name` are required; everything else is optional (`status` defaults to
`active`, `timezone` to `Europe/Moscow`, `slug` to the email local part with a
numeric suffix on collision). The alias vocabulary is documented in
`src/lib/member/types.ts` (`AliasKind`) and is deliberately open.

> **The dataset file is NEVER committed to this repository.** It carries real
> names, real emails and the external handles of the whole team, one join away from
> salary data (EARS-14). It is prepared by hand with the owner, lives on the box for
> the length of the window, and is deleted afterwards. What is committed instead is
> the fixtures under `tests/int/platform/fixtures/` — obviously fake people whose
> only job is to pin the mechanics.

Behaviour worth knowing before running it on a live registry:

- **Idempotent.** A person is matched by NORMALIZED email (`lower(btrim(...))`);
  only the fields the dataset actually changes are pushed; an alias already present
  under the same (kind, normalized value) is left alone. Re-running is safe.
- **Nobody is ever deleted.** A dataset listing fewer people than the registry
  holds is not a removal instruction — removal stays the owner's SQL escape hatch
  (EARS-19).
- **One transaction.** A refusal on the eleventh person leaves no trace of the
  first ten: fix the file, re-run.
- **`--dry-run` is the real transaction, rolled back.** The summary it prints is a
  summary the database accepted — constraints, duplicate aliases and bad statuses
  included. Run it first, every time.
- **A refusal names the other person.** One alias value claimed by two members is
  refused, because a handle resolving to two people has no useful answer
  (EARS-17/18).

### The import, and the verdict it ends with

`platform:hours:import` reads the document **through the frozen JSON store**
(`src/lib/hours/store.ts` — the same parser and the same email normalization the
running app has always applied to that file), then writes it into `core` in ONE
transaction that first takes the module advisory lock. It:

- **refuses non-empty `hours_*` tables** and writes nothing (the member seed
  legitimately ran first, so `core.member` being populated is expected);
- **aborts with the full list of emails that have no `member` row**, writing
  nothing — that list is the seed and the document disagreeing (EARS-13);
- carries ids, timestamps and snapshot numbers **digit-for-digit** and the JSON
  array order into `sort_key` / the assessment identity PK (EARS-21);
- **never writes to the source file** (EARS-16) — which is what keeps the rollback
  of EARS-25 warm;
- prints a per-table row summary, then the verdict.

The verdict (EARS-27) is the last line, and `platform:hours:verify` is that same
verdict on its own — for the dev rehearsal (EARS-26), for the post-import check and
for a later spot-check:

```
VERDICT: identical
VERDICT: differs — 2 path(s)
  assessments[0].accrual: 172710 -> 172711
  participants[3].role: "Продюсер" -> "Продюсер, редактор"
```

Exit code follows the verdict (0 identical, 1 differs), so a deploy step can gate
on it. Read the **paths**, not just the colour: an `assessments[*]` number is a
data problem to investigate, while a `participants[*].name`/`role` difference is
the hand-prepared seed disagreeing with the document — a seed fix, not an import
bug.

**A differing verdict does not undo the import.** The rows are committed by then,
deliberately: an automatic truncate is the one operation in this pipeline that
could delete real history on a mistyped command. The documented answer is below.

### Re-run inside the window: truncate and retry

Valid **only inside the maintenance window**, while no traffic is served and the
untouched `hours.json` is still the source of truth. After the owner's acceptance
this is not a recovery procedure — it is data loss; from that point on it is
forward-fix only (EARS-25).

Children first, then the registry only if the seed itself is being redone:

```sql
-- the hours document (enough to re-run `platform:hours:import`)
truncate table core.hours_publication, core.hours_assessment,
               core.hours_participant, core.hours_period;

-- ALSO the registry, only when the seed dataset itself was wrong
truncate table core.hours_publication, core.hours_assessment,
               core.hours_participant, core.hours_period,
               core.member_alias, core.member restart identity cascade;
```

On the box, through the running postgres container — the database publishes no
host port in production, so `psql` from the host is not an option:

```bash
box$ $COMPOSE exec -T postgres psql -U payload -d platform -c \
  'truncate table core.hours_publication, core.hours_assessment,
                  core.hours_participant, core.hours_period;'
```

`core.member` cannot be truncated on its own: `hours_participant` and
`hours_assessment` reference it `ON DELETE RESTRICT`, on purpose — the registry
must not be able to delete a person out from under their saved assessments
(history is the product, 081 §16).

There is **no automatic truncate command**, and adding one is not a convenience
this task deferred — it is a deliberate absence. The operator types the statement,
inside the window, having read this section.
