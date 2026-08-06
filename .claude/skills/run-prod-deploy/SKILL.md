---
name: run-prod-deploy
description: The production deploy procedure for bbm-portal — pre-flight gates, `pnpm deploy:prod`, what the pipeline records, how to verify prod really carries the shipped commit, and the app-only rollback. Use when shipping `origin/main` to prod, when a deploy fails or stalls, when rolling back, or when deciding whether a merged range is ready to ship. Project-local; this repo only.
---

# run-prod-deploy — shipping `origin/main` to production

This skill is the single source of truth for the procedure. The executable form
is [`tools/deploy/prod.mjs`](../../../tools/deploy/prod.mjs); the host and stack
description stays in [`deploy/README.md`](../../../deploy/README.md).

The deploy is a **scripted SSH deploy from the workstation, with CI passive** —
spec `docs/superpowers/specs/2026-08-04-platform-consolidation-design.md` §3
decision 13 (revision -d). There is no CI deploy, no image registry, and no
deploy key in GitHub Actions. That decision has written-down revisit triggers: a
second deploy unit, Infisical, or a second deploy operator. Bus factor 1 (the
deploy is tied to the workstation holding the SSH key) is an accepted, recorded
cost — not a bug to route around.

One VPS, `portal-prod-tw`, running one compose stack: `postgres` · `app` ·
`preview` · `caddy` (+ the profiled one-off `migrate`). Two public vhosts —
`cms.bbm.academy` (CMS) and `portal.bbm.academy` (platform, `/p/*`) — served by
the **same** `app` container.

## Before deciding to ship

The deploy is not the decision; it is the execution. Check these over the WHOLE
range being shipped, not just the last PR:

1. **What is the range?** The deployed sha comes from the live app:
   `curl -s https://cms.bbm.academy/api/health | jq -r .sha`. Then
   `git log --oneline <deployedSha>..origin/main`.
2. **Owner acceptance.** Every owner-visible change in the range has passed
   task-cycle stage 5 (live-stand acceptance) — a merged PR is not an accepted
   one. `.claude/skills/task-cycle/SKILL.md`.
3. **CI is green at `origin/main`.** The pipeline re-asserts this and refuses
   otherwise; check it first so you find out before ten minutes of build.
4. **Migrations.** `git diff --name-only <deployedSha>..origin/main -- src/migrations`,
   then read every `.sql`. Expand-only keeps the app-only rollback safe; anything
   contracting makes this deploy an **escalate** — state the rollback plan and
   get the owner's go first. Canon:
   [`docs/runbooks/migrations-expand-contract.md`](../../../docs/runbooks/migrations-expand-contract.md).
5. **Clean tree, and know what you are shipping.** The pipeline ships
   `origin/main`'s sha regardless of local `HEAD`, so un-pushed work can never
   reach prod — but the release/record code that RUNS is your checkout's. Do
   `git pull --ff-only origin main` first.

## Deploy

```bash
pnpm deploy:prod              # ship origin/main
pnpm deploy:prod --dry-run    # run the real local gates, print the remote plan, touch nothing
```

Run it as its **own statement** — never `pnpm deploy:prod | tee log`. A pipe
returns the pipe's exit code and turns a red deploy green. Use
`> deploy.log 2>&1` and check `$?` if you want a transcript.

The pipeline, in order — it is fail-closed and stops at the first red step,
printing a rollback pointer:

| Stage                                                             | What it does                                                                                      | Refuses when                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| pre-flight                                                        | clean tree · target = `origin/main` sha · green CI for that sha                                   | dirty tree · red or still-running CI · no CI at all |
| ship                                                              | `git archive <sha>` → ssh → `rm -rf src && tar -xz`                                               | ssh/tar non-zero                                    |
| checkpoint                                                        | box backup script → fresh dump BEFORE anything migrates, pinned under a per-deploy S3 key         | missing script · non-zero exit · no fresh dump      |
| stack                                                             | build `app`+`migrate` → migrate → `up -d`                                                         | any compose step non-zero                           |
| caddy                                                             | compares the shipped `Caddyfile` with the running bind mount, restarts only if stale, re-compares | still stale after the restart                       |
| verify                                                            | polls until `bbm-portal-app-1` runs `bbm-portal-app:<sha>`                                        | the container carries any other image               |
| smoke                                                             | `deploy:smoke --expect-sha` over BOTH vhosts, settling up to 90 s                                 | any check still red at the end of the budget        |
| _below here prod is proven serving — nothing may fail the deploy_ |                                                                                                   |                                                     |
| release                                                           | cuts `release-YYYY.MM.DD-<n>` at the deployed sha                                                 | non-fatal — warns only                              |
| record                                                            | GitHub `Deployment(production, sha)` + `success`                                                  | non-fatal — warns only                              |
| retention                                                         | keeps the last 3 sha-tagged app images                                                            | non-fatal — warns only                              |

The split is **positional**: everything before the smoke can still leave prod in
a state nobody described; everything after it cannot, so it is non-fatal by
contract — a `gh`/host hiccup warns and the deploy exit code stays 0. Never read
such a warning as a failed deploy. Retention is the case that forced the rule:
image housekeeping (a host without `grep -P`, a `pipefail` exit from a filter
that matched nothing) once printed DEPLOY FAILED — with a rollback pointer — for
a deploy that was already serving correctly, and cost the smoke, the tag, the
record and the digest with it.

The **checkpoint** stage (#156) runs the box's own backup script
(`/home/deploy/portal-backup/backup-portal.sh` — the same one the nightly cron
runs) and then pins the dump it produced under a per-deploy S3 key, so tonight's
cron cannot overwrite the recovery point for this migration. Mechanism,
retention and the caveat are stated once, in
[`docs/runbooks/migrations-expand-contract.md`](../../../docs/runbooks/migrations-expand-contract.md);
the script is owned by the **`bbm` ops repo, `infra/portal/README.md`**.

Two things to know while operating it. It is **fatal by contract** — it protects
the migrate in the very next stage, so a missing script, a non-zero exit, a run
that left no fresh dump, or a failed pin all mean DEPLOY FAILED with nothing
migrated. And it is **silent**: the script redirects all of its output into
`/home/deploy/portal-backup/data/backup.log` on the box, so the deploy prints
only a heartbeat line every 30 s and, at the end, the key it pinned. When it goes
red, the reason is in that log — `ssh portal-prod-tw tail -40
/home/deploy/portal-backup/data/backup.log` — not on your terminal.

The smoke **settles**: `app` has no compose healthcheck, so `verify` can only
prove the container is RUNNING, not that Next.js has finished booting behind
Caddy. The smoke re-probes the still-red checks for up to 90 s before calling a
deploy red. That budget is **wall clock**: no new sweep starts once it is spent,
so the worst case is 90 s plus the sweep already in flight. A genuinely broken
deploy still goes red — a minute later.

**A deploy cannot hang silently.** Every ssh channel carries keepalives (a dead
half-open connection exits loudly in ~60s) and each streamed step runs under a
no-output watchdog (10 min for build-class steps, 2 min elsewhere). A tripped
watchdog is a **channel** verdict, not a box verdict — the remote work may well
have completed. Check reality before deciding anything:

```bash
pnpm deploy:smoke            # liveness + what sha is actually live
```

New sha live → the work completed, and a plain re-run is an idempotent no-op.
Old sha → re-run. Unreachable → fix connectivity first; never fire blind
state-changing commands at a box you cannot observe.

## After the deploy

- `curl -s https://cms.bbm.academy/api/health | jq -r .sha` == the deployed sha.
  The smoke already asserted this on both vhosts; this is the over-HTTP re-check
  you can paste to the owner.
- The Deployment record carries the previously-deployed sha in its payload
  (`previousSha`) — that is the value to hand `--rollback` if this release turns
  out bad, without reading image tags off the box.
- The Deployment record's `success` status fires
  `.github/workflows/release-digest.yml`, which posts the aggregated Russian
  product digest to Mattermost. **Read the posted message, not the HTTP 200.**
  A digest that says "технический релиз" when the range contained product work
  means the notes machinery is broken, not that the release was technical.
- Record the deployed sha and the release tag in the issue / handoff.

## Rollback (app-only)

```bash
pnpm deploy:prod --rollback <sha>   # up -d a retained image; NO rebuild, NO migrate, NO DB change
```

The target image must still be on the box (retention keeps the last 3). If it
has been pruned, roll **forward** instead: get the good commit onto
`origin/main` and run `pnpm deploy:prod`.

A rollback **records its own GitHub Deployment**, untagged — it ships no new
code, and `release-*` means "what shipped". Without that record GitHub would keep
asserting the sha you just took off the box, and the next session would read the
broken build as "deployed".

That record carries `task: deploy:rollback`, which is what keeps it **out of the
Mattermost release digest**. It is otherwise a perfectly ordinary
success/production Deployment, so without the task the digest would fire
«Релиз на PROD» re-announcing the release you are rolling back TO — mid-incident,
to the whole team. A rollback therefore posts **nothing**: silence is honest,
where that message would not be. If the team later wants an «откат» notice it
must be its own message shape, never the release one.

A rollback runs **no** checkpoint stage: it applies no migration, so there is
nothing for one to protect (`ROLLBACK_STAGES` in `tools/deploy/prod.mjs`).

An app rollback is only safe while the previous code still runs against the
current schema — which is exactly what the expand/contract canon buys. After a
contracting migration it is NOT safe: the DB backup that exists (nightly dump +
the pre-migrate checkpoint, see the checkpoint stage above) makes a **restore**
possible, but a restore is not a rollback — everything written since the
checkpoint is gone, and the app is down while it runs. That is why a contracting
migration is an owner-decision.

## Failure modes

- **Piping the deploy command** — masks the exit code; a red deploy reads green.
- **Treating a record-cycle WARN as a deploy failure** — those steps run only
  after success and are non-fatal by contract.
- **Rolling back to a pruned sha** — roll forward instead.
- **Believing "the commands exited 0"** — the verify + smoke stages exist
  because that was never sufficient. If you bypass them, you have no deploy.
- **A retired file lingering on the box** — `tar -xz` is additive. The pipeline
  wipes `src/` before extracting (the trap from 2026-07-30), but NOT `tools/`,
  `docs/` or the repo root, and never `deploy/` (the host-only `.env.*` files
  live there). A build failing on a file that no longer exists in the branch is
  this class; remove it on the box by hand.
- **A `--dry-run` refusing on a dirty tree** — that is the gate working, not a
  bug. Commit or stash.
- **A red checkpoint** — the backup script is missing, failed, produced no fresh
  dump, or the pin to S3 failed. Nothing migrated, prod still serves the previous
  image. **Read `/home/deploy/portal-backup/data/backup.log` on the box** — the
  terminal shows only the exit code — then repair per the `bbm` ops repo's
  `infra/portal/README.md` and re-run; there is deliberately **no** flag to skip
  it.

## Related

- [`docs/runbooks/migrations-expand-contract.md`](../../../docs/runbooks/migrations-expand-contract.md)
  — the rule that makes the rollback button real.
- [`deploy/README.md`](../../../deploy/README.md) — host provisioning, env files,
  the preview service, first-time setup.
- [`.claude/skills/task-cycle/SKILL.md`](../task-cycle/SKILL.md) — stage 5 (live
  acceptance) and stage 7 (close) around this procedure.
- [`.claude/skills/do-hotfix-pr/SKILL.md`](../do-hotfix-pr/SKILL.md) — the fast
  lane when what you are deploying is a fix for something already broken in prod.
