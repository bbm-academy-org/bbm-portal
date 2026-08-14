---
status: Shipped
issue: 60
updated: 2026-08-14
---

# Portal prod domain + OKR deploy (P3) — spec (issue #60)

**Owner sign-off: APPROVED rev.2.1 — «го» владельца 2026-07-27 (issue #60,
комментарий).** Ladder status — во frontmatter выше.
Rev.2: учтено независимое ревью (REQUEST_CHANGES: 1 блокер — redirect URI,
1 major — default-deny на portal-хосте, 7 minor — все приняты) + два
подтверждённых факта (DNS заведён; механика прод-клиента Zitadel через
`tools-prod-tw`).

## Why

P2b принят: OKR-дашборд живёт за Zitadel-гейтом на dev-стенде. P3 доводит его
до команды: платформенный домен `portal.bbm.academy` в проде (Timeweb,
`portal-prod-tw`), прод-клиент Zitadel на `id.bbm.academy`, деплой — и только
после «принято» владельца на реальном URL гасится статический Vercel-дашборд
(`bbm-okr-dashboard.vercel.app`), который до того момента остаётся
единственным дашбордом команды.

## Requirements

1. **DNS — СДЕЛАНО (владелец, 2026-07-27).** A-запись `portal.bbm.academy`
   заведена и резолвится на прод-хост `portal-prod-tw` (проверено nslookup).
   Осталось только убедиться, что Caddy выпустил сертификат при деплое. Сам
   адрес хоста в репозитории не хранится (#218) — координаты алиаса
   `portal-prod-tw` лежат вне дерева, см. `deploy/README.md` § Prerequisites.

2. **Caddy site block для `portal.bbm.academy`** в `deploy/Caddyfile`:
   `reverse_proxy app:3000`, LE-сертификат автоматически. **Layer-2-решение
   (ADR-003 §2, отложено до P3): Caddy остаётся грубым (host-level), Layer 1
   (middleware) — единственный авторитетный enforcement.** Рационале:
   path-matcher в Caddy = второе место синхронизации с allowlist'ом — ровно
   тот класс «надо не забыть», который ADR-003 устраняет; middleware покрыт
   тестами, Caddy — нет.

3. **Полный host→surface allowlist (ADR-003 §2 Layer 1, обе стороны).**
   Middleware расширяется с `/p/*` на все пути и реализует таблицу ADR-003 §1
   целиком — default-deny на КАЖДОМ хосте, не только на CMS:
   - На `cms.bbm.academy` разрешены только CMS-префиксы (`/admin`, `/api`,
     `/graphql`, media/uploads, фронтенд-роуты статик-бэкенда); всё прочее — 404. В частности **`/api/auth/*` (Auth.js) на CMS-хосте закрыт** — это
     платформенная обвязка, более специфичное правило, чем Payload REST
     `/api/*` (hardening-заметка 1 из ревью PR #72).
   - На `portal.bbm.academy` разрешены только `/p/*` и `/api/auth/*`; всё
     прочее — 404. **Payload-админка и Payload REST/GraphQL на portal-хосте
     недоступны** (`portal.bbm.academy/admin` → 404) — иначе кросс-surface
     утечка, прямо запрещённая ADR-003 §1 («Everything else → 404»).
   - Оба allowlist'а включают инфраструктурные пути фреймворка (`/_next/*`,
     favicon/статик-ассеты) — известный pitfall: забыть их = сломанная
     админка и сломанный дашборд.

4. **Прод-клиент Zitadel на `id.bbm.academy`.** Новый OIDC-клиент (web,
   authorization code + secret по BFF-паттерну P2b), redirect URI —
   **`https://portal.bbm.academy/api/auth/callback/zitadel`** (фактический
   дефолтный callback Auth.js v5 — `src/auth.ts`; НЕ исторический
   `/auth/callback`). Механика — подтверждённый доступ: инстанс живёт на
   `tools-prod-tw` (репо `bbm`, `infra/zitadel/README.md`, BBMP-96); клиент
   регистрируется идемпотентным скриптом на хосте по паттерну BBMP-100
   (`infra/kb/scripts/provision-oidc-app.sh`: management-API на
   127.0.0.1:8081 + PAT, секреты в stdout не выводятся). Секрет рождается на
   `tools-prod-tw` и переносится на `portal-prod-tw` host-to-host, без печати
   в транскрипт (память `no-secret-echo`). Клиент документируется; прод-env
   идёт в `deploy/.env.prod` (шаблон — `deploy/.env.prod.example`, туда
   добавляются `IDP_ISSUER=https://id.bbm.academy`, `IDP_CLIENT_ID`,
   `IDP_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_URL` — см. req. 5 — и
   `PLANE_API_TOKEN`, req. 7).

5. **Прод-hardening host-конфига** (hardening-заметка 2 из ревью PR #72):
   `localhost`/`127.0.0.1` не должны считаться платформенными хостами в
   проде (список становится env-зависимым или NODE_ENV-гейтится), и
   `trustHost: true` в `src/auth.ts` пересматривается: origin фиксируется
   явно конфигом — `AUTH_URL=https://portal.bbm.academy/api/auth` на
   прод-хосте (без него Auth.js за Caddy не выведет callback-origin), а не
   доверием к входящему Host-заголовку.

6. **Тесты обвязки** (hardening-заметка 3 из ревью PR #72 + ADR-003
   Consequences): host-матричный integration-тест (каждый хост ×
   {разрешённый путь, чужой surface} → 200-ish / 404) по полной таблице
   req. 3 — включая `portal/admin → 404`, `cms/api/auth/* → 404`, живучесть
   CMS-фронтенд-роутов и `/_next/*`; кеш-поведение гейта (`force-dynamic`:
   authed-страница не отдаётся из static/route-кеша анониму); browser-E2E
   (Playwright) приёмочных сценариев — обязательный зелёный прогон ДО
   приглашения владельца (task-cycle stage 5). TDD: тесты из сценариев ниже
   пишутся до продакшен-кода.

7. **`PLANE_API_TOKEN` на прод-хосте** (нужен OKR-модулю для чтения Plane;
   добавляется в `deploy/.env.prod`). Ротация токена (утёк в локальный
   транскрипт сессии) — **отложена решением владельца 2026-07-27**: логи
   хранятся локально, риск принят владельцем; деплой идёт с текущим токеном.
   Триггер пересмотра: любой признак компрометации локальной машины или
   шаринга транскриптов наружу → немедленная ротация.

8. **Деплой** на `portal-prod-tw` существующим пайплайном (runbook
   `deploy/README.md`, инфра-база BBMP-30 живая). `main` деплоится только
   после merge всех PR этого спека. **Откат:** P3 впервые ставит middleware
   на путь всех CMS-запросов — при регрессии CMS откат = redeploy
   предыдущего `main` по тому же runbook («Rollback: rebuild from previous
   commit»); Vercel-статика при этом всё ещё жива (req. 9).

9. **Гашение Vercel** (`bbm-okr-dashboard.vercel.app`) — **только после
   «принято»** владельца на `portal.bbm.academy/p/okr`. «Погашен» означает:
   **PII недоступна ни по одному деплой-URL**, включая
   preview/deployment-URL вида `bbm-okr-dashboard-*.vercel.app` — т.е.
   удаление проекта Vercel (или deployment protection на весь проект), а не
   снятие одного алиаса. Кто гасит (владелец в Vercel-панели или у агента
   есть доступ) — вопрос владельцу на чекпойнте «го».

Constraints: ADR-002 (границы модулей; правило
`cms-must-not-import-okr-internals` уже включает `app/(frontend)` —
`.dependency-cruiser.cjs:29`, держится, новых правок не требует), ADR-003
(host→surface, default-deny), 152-FZ (PII команды не отдаётся анонимно;
хостинг — Zone RF).

Канонический URL — `portal.bbm.academy/p/okr` (ADR-003 §3(a)); формулировка
`portal.bbm.academy/okr` в AC issue #60 предшествует ADR-003. Редирект
`/okr` → `/p/okr` НЕ делается (лишняя поверхность; вопрос владельцу — если
хочется короткой ссылки, это отдельное решение).

## Acceptance scenarios

Приёмка — владелец сам открывает реальные URL (не скриншоты, не dev-сервер).

1. **Аноним → логин.** Владелец в свежем браузере открывает
   `https://portal.bbm.academy/p/okr` → редирект на логин Zitadel
   (`id.bbm.academy`); дашборд и данные не показаны.
2. **Логин → дашборд.** Владелец входит своим аккаунтом Zitadel → возвращён
   на `/p/okr`, видит OKR-дерево с живыми данными Plane.
3. **CMS-хост чист.** `https://cms.bbm.academy/p/okr` → 404;
   `https://cms.bbm.academy/api/auth/signin` → 404. При этом
   `https://cms.bbm.academy/admin` (Payload) и CMS-фронтенд-роуты
   статик-бэкенда работают как раньше.
4. **Portal-хост чист.** `https://portal.bbm.academy/admin` → 404 (Payload
   недоступен на платформенном домене; ADR-003 «Everything else → 404»).
5. **Свежая сессия → нет данных.** Инкогнито-окно на `/p/okr` → снова логин,
   PII недоступна.
6. **Гашение Vercel (после «принято» по сценариям 1–5).** Ни канонический
   `bbm-okr-dashboard.vercel.app`, ни deployment-URL вида
   `bbm-okr-dashboard-*.vercel.app` больше не отдают дашборд; команда ходит
   на `portal.bbm.academy/p/okr`.

## Out of scope

- Новые платформенные модули и role-based authorization (любой
  аутентифицированный пользователь орга видит дашборд — как в P2b).
- Изменения OKR-view/UI — деплоится как есть.
- Caddy path-matcher (Layer 2) — осознанно НЕ делается (req. 2); revisit —
  если middleware-enforcement когда-либо ослабнет.
- Редирект `/okr` → `/p/okr` на portal-хосте (см. Constraints).
- `preview.bbm.academy`, apex, публичный сайт — не трогаются.
- Гашение dev-стенда TrueNAS — dev-контур остаётся рабочим (#62/#63).
