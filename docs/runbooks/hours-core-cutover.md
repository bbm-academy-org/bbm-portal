# `/p/hours` on `core` — the cutover tooling contract

**Status:** stub, tooling only. This file documents the three commands the cutover
runs and the rules that come with them — nothing else. The **cutover procedure
itself** (maintenance window, pre-migrate checkpoint, ordering, archive, rollback,
the owner's acceptance) is written by **#256**, which is the task that executes it;
spec [`docs/specs/124-hours-on-core.md`](../specs/124-hours-on-core.md) EARS-13..16,
25..27 is the canon both halves answer to.

Why the split: the tooling landed with the implementation (#255) so the rehearsal
of EARS-26 has something to rehearse, and a procedure written by whoever is not
going to run it is the kind of document that drifts.

## The three commands

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
environment winning.

## The seed dataset — and the rule that it is never committed

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

## The import, and the verdict it ends with

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

## Re-run inside the window: truncate and retry

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

`core.member` cannot be truncated on its own: `hours_participant` and
`hours_assessment` reference it `ON DELETE RESTRICT`, on purpose — the registry
must not be able to delete a person out from under their saved assessments
(history is the product, 081 §16).

There is **no automatic truncate command**, and adding one is not a convenience
this task deferred — it is a deliberate absence. The operator types the statement,
inside the window, having read this section.
