# Parallel sessions — worktrees and ports

Несколько сессий Claude работают в одном репо одновременно. Общий чекаут — это
один HEAD и один набор незакоммиченных изменений на всех, а порт 3000 — один на
машину. Четыре инцидента за неделю (force-push по ветке чужой сессии с
воскрешением удалённой; субагент переключил ветку под живым стендом приёмки;
чекаут уехал на `feat/81` посреди приёмки владельца — «ссылка не работает»)
пришли ровно отсюда. Правила ниже структурные, а не «быть внимательнее».

## Ветки и worktree

- **Рабочая ветка сессии живёт ТОЛЬКО в отдельном worktree.** Создавать одной
  командой: `pnpm task:worktree <N>` → `.claude/worktrees/<N>` на ветке
  `<type>/<N>-<slug>` от свежего `origin/main`. Никаких `git checkout -b` в
  общем чекауте.
- **Основной чекаут `C:\Users\sidor\repos\bbm-portal` держится на `main`** и
  принадлежит лиду и живым стендам. Он не переключает ветку ради задачи —
  переключение под запущенным стендом ломает чужую приёмку, а не только сборку.
- **Write-субагенты запускаются только в изолированном worktree**
  (`isolation: "worktree"` или заранее созданный `task:worktree`). Read-агентам
  общий чекаут можно.
- **Не трогать чужой worktree и чужую ветку.** `git push --force` допустим
  только по своей ветке этой сессии; ветка, которой нет в твоём worktree, —
  чужая по умолчанию.
- **Разбирать за собой:** `pnpm worktree:teardown <N>`. Несмерженную ветку он
  оставляет и предупреждает — это защита, а не сбой.
- Свежий worktree пуст: **`pnpm install` (~42 с) обязателен до первого
  коммита** — без `node_modules` нет ни pre-commit хука, ни тестов.

## Порты

- **Probe, don't reuse.** Порт берётся через `pnpm dev:ports` (bind-and-release
  по 3000–3009, шаг 1) — не биндить 3000 вслепую. Запуск: `PORT=<n> pnpm dev`
  (форма `pnpm dev -- -p <n>` в этом репо не работает: `--` доезжает до Next как
  путь).
- **Never kill a listener you did not start.** Чужой listener почти наверняка —
  стенд приёмки другой сессии, ждущий вердикта владельца; убить его значит
  сорвать чужую приёмку. Это правило **переопределяет** односессионную привычку
  «сначала прибей stale-процессы»: она применима только к своим процессам на
  своём порту.
- **e2e-сюита тоже берёт порт явно:** `E2E_PORT=<n> pnpm test:e2e` (или
  `E2E_BASE_URL=<origin>`); резолв — `tests/helpers/base-url.ts`. Политика
  двусторонняя. Без названного порта сюита поднимает СВОЙ стенд на 3000, а если
  3000 занят — падает с подсказкой, но к чужому стенду не цепляется. Названный
  порт — это утверждение «стенд мой», и он переиспользуется как есть: назвал
  чужой — сам и сломал чужую приёмку, потому что сюита сеет и удаляет
  пользователей в общей dev-БД (#169).
- **Выбранный порт фиксируется** в handoff и в комментарии issue — владелец
  откроет правильную ссылку, следующая сессия увидит занятый слот.
- **TaskStop не убивает node-детей.** Свой стенд гасится явно, по своему порту:
  `Get-NetTCPConnection -LocalPort <n> | Select-Object -Expand OwningProcess |
ForEach-Object { Stop-Process -Id $_ -Force }`. Свой — тот, который запустила
  эта сессия.

## Platform database

- **Branch, don't share.** A numeric task worktree gets its own platform DB:
  `pnpm dev:db:branch` inside `.claude/worktrees/<N>` creates `platform_<N>`,
  writes the local worktree `.env` marker
  `PLATFORM_DATABASE_URL=…/platform_<N>`, prints the connection string, and then
  **migrates and seeds it** — one command from an empty worktree to a stand with
  representative data (#436). Nothing has to remind anyone to seed. An
  already-branched DB is refreshed by `pnpm dev:seed` alone; `--no-migrate` /
  `--no-seed` decline a step deliberately. What the seed puts there, and what it
  refuses to write to: [`src/lib/platform/db/README.md`](../../src/lib/platform/db/README.md)
  → Commands.
- **Two roles since #278.** `dev:db:branch` writes `PLATFORM_MIGRATE_DATABASE_URL`
  alongside `PLATFORM_DATABASE_URL` when the base stand is split, and creates the
  branch DB through the MIGRATING one — the application role is `NOCREATEDB` by
  design. A stand that has never been split has no migrating variable, the tools
  fall back to the application string and say so on stderr, and splitting it is one
  supervised command (`pnpm platform:roles:ensure`, superuser). Roles are CLUSTER
  objects: splitting the stand affects every session's branch DB on that box, which
  is safe (it only adds roles) but is not a per-worktree act. Canon:
  [`src/lib/platform/db/README.md`](../../src/lib/platform/db/README.md) → Commands.
- **Teardown removes only proven branch DBs.** `pnpm worktree:teardown <N>`
  drops `platform_<N>` before removing the worktree only when that worktree's
  local `.env` names exactly `platform_<N>`. Without that marker it skips DB
  cleanup and says why; if the marker exists and the drop fails, teardown stops
  rather than claiming a clean teardown while leaking a database.
