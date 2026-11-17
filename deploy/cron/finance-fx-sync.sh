#!/usr/bin/env bash
# Daily Bank of Russia rate sync on portal-prod-tw (spec 339 §I, EARS-552, #548).
#
# Runs `pnpm platform:finance:fx:sync` in the compose `migrate` (tooling) service
# — the same image and `.env.prod` every platform command on this box uses, and
# the image `pnpm deploy:prod` rebuilds on every deploy, so the job always runs
# the deployed code. No `--build` here: a cron run must never build from the tree.
#
# Installed into deploy@'s crontab (see deploy/README.md → «Scheduled jobs»):
#   15 6 * * * $HOME/bbm-portal/deploy/cron/finance-fx-sync.sh >> $HOME/portal-fx-sync/sync.log 2>&1
#
# Extra arguments pass through, so the one-off backfill is the same script:
#   ~/bbm-portal/deploy/cron/finance-fx-sync.sh --from 2026-09-01 --to 2026-11-17
set -euo pipefail

cd "$HOME/bbm-portal/deploy"
echo "-- $(date -u +%Y-%m-%dT%H:%M:%SZ) finance-fx-sync $* --"
exec docker compose -f docker-compose.prod.yml --profile tools run --rm -T migrate \
  pnpm platform:finance:fx:sync "$@" </dev/null
