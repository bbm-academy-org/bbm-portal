# Dev env — этот Windows-бокс

- **Node 22 обязателен** (`engines: ^22.17.0`, engine-strict). Системный Node
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
  генерирует те же 40 URI (`--print-redirect-uris` печатает набор без обращения
  к IdP), поэтому переprovisioning их не сужает. Расширение — по одной строке в
  каждом из двух источников диапазона: `DEV_PORT_MAX` в `provision.sh` и
  `PORT_MAX` в [`tools/dev/dev-ports.mjs`](../../tools/dev/dev-ports.mjs); что
  они совпадают, держит `tests/unit/idp-provision-redirect-uris.spec.ts`.
- **Но полный прогон `provision.sh` СЕЙЧАС разрушителен:** `postLogoutRedirectUris`
  он сузит с живых 20 до 1 и сломает sign-out на девяти портах из десяти. До
  закрытия #170 скрипт целиком не запускать — только `--print-redirect-uris`.
- Параллельные сессии, worktree и правила по чужим listener'ам:
  [`parallel-sessions.md`](./parallel-sessions.md).
