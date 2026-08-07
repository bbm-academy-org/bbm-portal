# Dev env — этот Windows-бокс

- **Node 22 обязателен** (`engines: ^22.22.1`, engine-strict). Системный Node
  тут новее, поэтому в каждой bash-сессии первым делом:
  `export PATH="$LOCALAPPDATA/node22:$PATH"` — портативная сборка лежит в
  `%LOCALAPPDATA%\node22`. На Node 23/24 ломается tsx-лоадер Payload
  (`node:crypto?tsx-namespace` ENOENT), а `pnpm patch-commit` отказывается
  работать вовсе.
- **Git — только `git -C <абсолютный корень>`.** `cd` в Bash-инструменте не
  использовать: cwd между вызовами дрейфует, и команда уезжает в чужой
  worktree. Каждая git-команда явно называет своё дерево.
- **Порты dev-стенда: 3000–3009.** Redirect URI в dev-Zitadel зарегистрированы
  ровно на этот диапазон (× `localhost`/`127.0.0.1` × оба callback-пути); стенд
  на другом порту поднимется, но логин упадёт с `400 invalid_request`. Порт
  берётся через `pnpm dev:ports`, стенд поднимается как `PORT=<n> pnpm dev` (не
  `pnpm dev -- -p <n>`).
- **Диапазон в дефолте provisioning:** `infra/dev-stand/idp/provision.sh`
  генерирует из одних и тех же границ оба набора — 40 redirect URI и 20
  post-logout URI (голые origin'ы, порт × хост) — поэтому переprovisioning ни
  один из них не сужает (#93, #170). Наборы печатаются без обращения к IdP:
  `--print-redirect-uris` и `--print-post-logout-uris`. Расширение — по одной
  строке в каждом из двух источников диапазона: `DEV_PORT_MAX` в `provision.sh`
  и `PORT_MAX` в [`tools/dev/dev-ports.mjs`](../../tools/dev/dev-ports.mjs); что
  они совпадают и что оба набора висят на этих границах, держит
  `tests/unit/idp-provision-redirect-uris.spec.ts`.
- **Полный прогон `provision.sh` — операция по живому IdP:** он идемпотентен и
  больше не сужает URI, но пишет в живой dev-Zitadel (роли, login-политика,
  loginV2, тестовый юзер). Запускать осознанно, а не «на всякий случай».
- Параллельные сессии, worktree и правила по чужим listener'ам:
  [`parallel-sessions.md`](./parallel-sessions.md).
