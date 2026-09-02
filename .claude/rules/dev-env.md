# Dev env — this Windows box

- **Node 22 is mandatory** (`engines: ^22.22.1`, engine-strict). The system Node
  here is newer, so the first thing in every bash session is:
  `export PATH="$LOCALAPPDATA/node22:$PATH"` — the portable build lives in
  `%LOCALAPPDATA%\node22`. On Node 23/24 the Payload tsx loader breaks
  (`node:crypto?tsx-namespace` ENOENT), and `pnpm patch-commit` refuses to work
  at all.
- **Git — only as `git -C <absolute root>`.** Do not use `cd` in the Bash tool:
  the cwd drifts between calls, and the command ends up in someone else's
  worktree. Every git command names its own tree explicitly.
- **Dev-stand ports: 3000–3009.** The redirect URIs in the dev Zitadel are
  registered for exactly this range (× `localhost`/`127.0.0.1` × both callback
  paths); a stand on another port will come up, but the login fails with
  `400 invalid_request`. The port is taken via `pnpm dev:ports`, the stand is
  started as `PORT=<n> pnpm dev` (not `pnpm dev -- -p <n>`).
- **The range in the provisioning default:** `infra/dev-stand/idp/provision.sh`
  generates both sets from the same bounds — the redirect URIs (port × host ×
  callback path) and the post-logout URIs (port × host, bare origins) — so a
  re-provisioning narrows neither of them (#93, #170). Printing without talking
  to the IdP: `--print-redirect-uris` and `--print-post-logout-uris` (one flag at
  a time; both at once is an error). **Widening the range is not a one-liner**,
  and the full checklist of edits (plus a supervised run at the end)
  deliberately lives in one place:
  [`infra/dev-stand/idp/bootstrap.md`](../../infra/dev-stand/idp/bootstrap.md)
  §6, "Widening the range — the whole checklist". The set counts are not
  duplicated here: their canon is the table in that same §6.
- **The workspace roles** `platform-user` / `platform-admin` — and, since #380,
  the finance flow roles `finance-entry` / `finance-approve` — are seeded by the
  same script and granted to the dev test user by it (steps 2 and 8). Printing
  the set without talking to the IdP: `--print-seed-roles`. What has to be true
  for a member to actually get in — the role, the role assertion and the
  per-user grant are three different objects with one shared symptom — plus the
  **prod** path, which is a supervised step on the owner's explicit
  per-operation go (management API or console, never a `provision.sh` run):
  [`infra/dev-stand/idp/bootstrap.md`](../../infra/dev-stand/idp/bootstrap.md)
  §5a.
- **A full `provision.sh` run is an operation against the live IdP:** it is
  idempotent and no longer narrows the URIs, but it writes to the live dev
  Zitadel (roles, login policy, loginV2, the test user and its project grant). Run it deliberately,
  not "just in case".
- **A long-lived `next dev` process can stop being able to fork — restart it, do
  not debug the app.** Symptom: every `/api/auth/*` request answers `500` with
  `Jest worker encountered 2 child process exceptions, exceeding retry limit`
  while the rest of the stand is fine. In dev, Next runs `generateStaticParams`
  for every DYNAMIC app route in a forked worker (`base-server.js`, unconditional
  — `export const dynamic` does not opt out). The app has three dynamic
  segments — `(platform)/api/auth/[...nextauth]` plus Payload's
  `(payload)/admin/[[...segments]]` and `(payload)/api/[...slug]` — so a fork
  that cannot start takes out whichever of those surfaces gets compiled next:
  in the observed case the sign-in surface, but a 500 on `/admin` is the same
  failure. Observed 2026-08-25 (#313 acceptance): the child exited
  with `3221225794` = `0xC0000142` STATUS_DLL_INIT_FAILED before any JS ran, and
  the same process could no longer spawn even `node -e "process.exit(7)"` with a
  minimal env, while a fresh node on the same box forked fine. It is the PROCESS,
  not the code, not the box: kill that stand's PID and start a new one.
- **Учётные данные с бокса ДРУГОЙ системы — стоп-состояние, а не действие.**
  Зайти на `hermes-prod-tw`, truenas или чужой прод, чтобы достать оттуда ключ,
  токен или пароль, — это вопрос владельцу, а не шаг лида, даже когда точно
  известно, что ключ там лежит. Свой бокс этой задачи — можно; соседний — нет.
  _(2026-08-25: лид ушёл по ssh на прод Гермеса за учёткой без единого вопроса;
  владелец: «Не понял, как мы вообще отсюда затронули Гермеса?».)_
  **Наш собственный dev-стенд — В ЗОНЕ агента, а не «чужой бокс».** Тестовые
  пользователи `bbm-test` / `bbm-member` засеваются самим
  `infra/dev-stand/idp/provision.sh` (шаги 2 и 8), пароль лежит на truenas в
  `~/bbm-portal-dev-stand/.env` и `~/.bbm-portal/CREDENTIALS.dev.txt`. Взять их,
  чтобы войти на свой стенд приёмки, — обычный шаг задачи: разрешение уже дано
  этим правилом, спрашивать заново не нужно. Правило выше про ДРУГУЮ систему
  (прод Гермеса, чужой truenas-датасет, прод-IdP) и на этот стенд не
  распространяется. Решение владельца, Антон, 2026-09-02 — повод назвать: в тот
  день агент сослался на этот буллет, отказался читать учётку своего же стенда и
  остановил приёмку. Секреты по-прежнему не печатаются в вывод сессии.
- Parallel sessions, worktrees and the rules about other sessions' listeners:
  [`parallel-sessions.md`](./parallel-sessions.md).
