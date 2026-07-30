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
  вручную только на этот диапазон; стенд на другом порту поднимется, но логин
  упадёт с `400 invalid_request`. Порт берётся через `pnpm dev:ports`, стенд
  поднимается как `PORT=<n> pnpm dev` (не `pnpm dev -- -p <n>`).
- **Диапазон не в дефолте provisioning:** `infra/dev-stand/idp/provision.sh`
  при следующем прогоне откатит регистрацию к одному порту — issue #93.
- Параллельные сессии, worktree и правила по чужим listener'ам:
  [`parallel-sessions.md`](./parallel-sessions.md).
