# Hours period #102 production cleanup

This runbook removes only period `4b741c5e-0b54-45c4-a54a-60cc4fd84936`
and its one assessment/publication from the production hours JSON. It must run
on `portal-prod-tw` after the change is merged and deployed. Do not use the
preview API key or any HTTP mutation endpoint.

The executable artifact is
`tools/ops/cleanup-hours-period.mjs`. Its pure core is fixture-tested in
`tests/unit/hours-period-cleanup.spec.ts`. It refuses a pre-state other than the
approved audit cut: exact period metadata, one assessment, and one published
publication with one confirmed `sent` delivery. A second run reports
`already-clean` and does not rewrite the file.

The old RF-host backup
`/home/deploy/hours.json.bak-20260801T071116Z` remains a recovery artifact. It
is not used as the frozen snapshot for this operation.

## Transaction

Run from `/home/deploy/bbm-portal/deploy` on `portal-prod-tw`. The app image
provides Node 22; the one-off container mounts the same named volume as the app
and `/home/deploy` for the timestamped JIT backup.

```bash
set -euo pipefail
cd /home/deploy/bbm-portal/deploy

COMPOSE='docker compose -f docker-compose.prod.yml'
APP_IMAGE=$($COMPOSE images -q app)
test -n "$APP_IMAGE"

# Freeze first. A diagnostic copy made before this point never authorizes write.
$COMPOSE stop app
APP_ID=$($COMPOSE ps -aq app)
test -n "$APP_ID"
test "$(docker inspect -f '{{.State.Running}}' "$APP_ID")" = 'false'

# Exact frozen pre-state dry-run. It must say status=ready and removed=1/1/1.
docker run --rm --user 0 \
  --mount type=volume,src=bbm-portal_hoursdata,dst=/data/hours \
  --mount type=bind,src=/home/deploy,dst=/backup \
  --mount type=bind,src=/home/deploy/bbm-portal/tools/ops,dst=/ops,readonly \
  "$APP_IMAGE" node /ops/cleanup-hours-period.mjs \
  --file /data/hours/hours.json

# Apply. The confirmation phrase is accepted only after the independent Docker
# stopped-state proof above. Keep the full non-PII console result in the ops log;
# serialized preservation snapshots live only in the mode-600 report file.
set +e
CLEANUP_OUTPUT=$(docker run --rm --user 0 \
  --mount type=volume,src=bbm-portal_hoursdata,dst=/data/hours \
  --mount type=bind,src=/home/deploy,dst=/backup \
  --mount type=bind,src=/home/deploy/bbm-portal/tools/ops,dst=/ops,readonly \
  "$APP_IMAGE" node /ops/cleanup-hours-period.mjs \
  --file /data/hours/hours.json \
  --backup-dir /backup \
  --apply \
  --confirm-app-stopped app-stopped-and-frozen 2>&1)
CLEANUP_STATUS=$?
set -e
printf '%s\n' "$CLEANUP_OUTPUT"

# Exit 0 means the new document was fully verified. The two explicit failure
# markers mean the original document or rollback was fully verified. Any other
# error is an incident: leave app stopped and preserve every artifact.
CLEANUP_APPLIED=0
if test "$CLEANUP_STATUS" -eq 0; then
  SAFE_TO_START=1
  CLEANUP_APPLIED=1
elif printf '%s' "$CLEANUP_OUTPUT" | grep -Eq \
  'rollback confirmed from JIT backup|live file unchanged and confirmed'; then
  SAFE_TO_START=1
else
  echo 'UNCONFIRMED FILE STATE: keep app stopped and escalate as an incident.' >&2
  exit 1
fi

test "$SAFE_TO_START" = 1
$COMPOSE up -d app

# A confirmed unchanged file/rollback is safe to serve, but the requested
# deletion did not land. Restart the verified original, then fail this run so
# nobody mistakes recovery for a successful cleanup or runs success postchecks.
if test "$CLEANUP_APPLIED" -ne 1; then
  echo 'cleanup not applied; verified original/rollback restarted' >&2
  exit 2
fi
```

The artifact's order is fixed: frozen read/stat → mode-600 JIT backup on the
RF host + mode-600 same-volume rollback copy → byte SHA-256 verification →
pre-state snapshot → same-volume staged write → full target/preservation
validation → original numeric owner/group/mode → file fsync → atomic rename →
directory fsync → live reread/validation/metadata check. Its mode-600 report
stores counts, serialized values, and canonical SHA-256 before/after for
participants, every non-target managed record, and all other root data.

If any post-rename check fails, the JIT bytes are copied to a new same-volume
temp file, hash/JSON/metadata-checked, and atomically renamed over live. A
failed or unconfirmed rollback leaves the app stopped.

## Post-check

Run immediately after the app starts:

```bash
set -euo pipefail
cd /home/deploy/bbm-portal/deploy
COMPOSE='docker compose -f docker-compose.prod.yml'

$COMPOSE ps app
curl -fsS -o /dev/null https://portal.bbm.academy/p/hours

# Runtime UID 1001 must read JSON and perform create/fsync/rename/delete in the
# same directory. The probe never renames over or changes hours.json.
$COMPOSE exec -T --user 1001 app node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const live = process.env.HOURS_DATA_FILE || '/data/hours/hours.json'
const directory = path.dirname(live)
const before = fs.readFileSync(live)
JSON.parse(before.toString('utf8'))
const beforeHash = crypto.createHash('sha256').update(before).digest('hex')
const first = path.join(directory, `.hours-write-probe-${process.pid}`)
const second = `${first}.renamed`
const file = fs.openSync(first, 'wx', 0o600)
try {
  fs.writeFileSync(file, 'probe\n')
  fs.fsyncSync(file)
} finally {
  fs.closeSync(file)
}
fs.renameSync(first, second)
fs.unlinkSync(second)
const after = fs.readFileSync(live)
const afterHash = crypto.createHash('sha256').update(after).digest('hex')
if (afterHash !== beforeHash) throw new Error('probe changed hours.json')
console.log(`runtime uid=${process.getuid()} read/write/rename/delete ok; live sha256=${afterHash}`)
NODE

# Repeatability + post-state: must report already-clean and 0/0/0 targets.
APP_IMAGE=$($COMPOSE images -q app)
docker run --rm --user 0 \
  --mount type=volume,src=bbm-portal_hoursdata,dst=/data/hours \
  --mount type=bind,src=/home/deploy/bbm-portal/tools/ops,dst=/ops,readonly \
  "$APP_IMAGE" node /ops/cleanup-hours-period.mjs \
  --file /data/hours/hours.json

# Inspect the newest protected report and backups without printing serialized
# participant data into a workstation/session transcript.
ls -lt /home/deploy/hours-cleanup-report-*.json /home/deploy/hours.json.bak-* | head
stat -c '%u:%g %a %n' /home/deploy/hours-cleanup-report-*.json /home/deploy/hours.json.bak-* | tail
```

Finally verify in `/p/hours/admin` that `2 спринт`, its assessment, and its
publication panel are absent, while all participant roles/forks/grades match
the frozen report. The already-sent Mattermost post is intentionally untouched.
