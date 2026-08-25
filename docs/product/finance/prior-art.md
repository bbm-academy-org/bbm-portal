# Finance prior art digest — bbm-portal #115

> **Provenance:** produced by agent recon 2026-08-25 (discovery step 2 of
> `do-product-discovery`, epic #115). Committed **verbatim** from the discovery
> session's scratchpad — the body below is the recon output as written, in its
> original Russian, and is not edited or re-summarised here. Each source carries
> its own artifact passport (path + owner + type). Reference material only: it is
> a functional reference, never a template to reproduce.

## 1. money-calculator.html (Маршрут денег)

- **Паспорт:** `C:/Users/sidor/repos/bbm/outputs/2026-07-24-bbm-finmodel/2026-08-05-money-calculator.html`; владелец Антон (+Claude); тип: build/export (одностраничный HTML/JS, `computeModel` доступна из консоли).
- **Вкладки:** «Модель» (график + вехи), «Таблица P&L» (кликабельные ячейки → формула+подстановка, режим «показать формулы», экспорт CSV).
- **Входы (слайдеры, 6 шт., все — параметры `computeModel({I, cost0, gCost, rev0, gRev, k, T})`):**
  - `I` — вложения первоинвестора, млн ₽ (0–20)
  - `cost0` — расходы первого месяца, млн ₽ (0.1–5)
  - `gCost` — рост расходов, %/мес (0–10)
  - `rev0` — выручка первого месяца продаж, млн ₽ (0–5)
  - `gRev` — рост выручки, %/мес (0–40)
  - `k` (лаг запуска продаж), `T` (горизонт мес.) — параметры модели, не выведены как отдельные слайдеры в извлечённом фрагменте
- **Выходы:** помесячный P&L (выручка/расходы/касса), три вехи (операционная безубыточность, кассовый ноль, payback инвестора), роялти 5% + профит-шеринг 4x/2x/1x (зашитые пропорции, не варьируются).
- **Статьи расходов:** модель НЕ детализирует расходы по категориям — `cost0` это единое агрегированное число «расходы месяца», без разбивки на ФОТ/аренду/подрядчиков/налоги. Никакой себестоимости продукта/урока здесь нет.
- **Хардкод:** роялти 5%, доли 4/2/1 зашиты (не параметры).

## 2. money-mechanics-and-forks.md

- **Паспорт:** `.../2026-08-05-money-mechanics-and-forks.md`; владелец Антон; тип: original (протокол рабочей сессии).
- Ключевые механики: маршрут денег в 3 вехи (операционная безубыточность → кассовый ноль → payback инвестора), 2 фазы распределения (каскад-payback Эдуарда → профит-шеринг 4/2/1 наш), зарплата = расход ДО прибыли (решено, §5, действует с 01.08 в `payout-mechanics.md`), начисление = ставка роли по грейду × факт. часы, верификация 👍/👎 (не голосование деньгами).
- Открытые развилки (владелец): обеспечение токенов A/B/C (§4.3), канон формулы майнинга (§3.3), OPEX как тир каскада vs расход (§3.7) — эти вопросы адресованы Эдуарду/Антону, не решены.
- Никакой строки «статьи расходов/cost categories» отдельно не заведено — расходы = единый агрегат `Cost₀ + рост`, без ФОТ/аренда/подрядчики/налоги как отдельных линий (в этом документе).

## 3. Стенд Эдуарда (smart-contract-calculator)

- **Паспорт HTML:** `.../2026-08-01-smart-contract-calculator.html`; владелец Эдуард (с Claude Code); тип: build (прототип, самодостаточный HTML/JS, in-memory state + опц. localStorage).
- **Паспорт export.md:** `.../2026-08-04-smart-contract-calculator-export.md`; автор математики Эдуард, тех-экспорт — Claude Code по заказу Эдуарда; тип: export.
- Три модуля: А — токеномика BBM (индексы токенов/металл, cap-table, waterfall CAPEX→OPEX→Соавторы→Авторы→Соинвесторы→Инвесторы BBM, аукцион, роялти), Б — майнинг внимания DS (типы контента, уроки, 5 фондов), В — мост/сценарии.
- **Расходные категории здесь есть, но не как P&L-статьи, а как тиры каскада**: CAPEX (с подкатегориями: Архитектурные/Инфраструктурные/Смысловые/Продуктовые/Брендированные), OPEX — единый тир (не детализирован). Это распределение выручки по приоритету выплат, не себестоимость.
- Числа в cap-table — гипотетический пример, НЕ реальный учёт (подтверждено Антоном).

## 4. ds-lesson-cost-calculator (себестоимость урока)

- **Паспорт:** `C:/Users/sidor/repos/bbm/outputs/ds-lesson-cost-calculator/index.html`; владелец — производный от сметы `2026-06-04-ds-platform-reestimate-detailed.html` (DSP-218), т.е. Doctor School проект, не bbm-portal; тип: build/derived.
- **Это единственный источник, который реально считает себестоимость единицы продукта** (урока), а не только денежный поток компании.
- **Входы:** «Уроков в год» (слайдер), per-role ставки (₽/мес × месяцев занятости) с тремя режимами найма — Штат (налоговая нагрузка ~100%, т.е. полная стоимость ≈ ставка×2), ИП/УСН (+8%), Самозанятый/НПД (+6%) — редактируемый % нагрузки на роль; список внешних (подрядных) статей расходов (`ext`); чекбокс contingency-буфера (ФОТ +15%, внешние +25%); доля себестоимости от цены (`costShare`, дефолт 15%) ИЛИ ручная цена урока.
- **Выходы:** «Переменная» и «Средняя себестоимость» ₽/урок; итого ФОТ с налогами (₽/год и ₽/урок); итого внешние (₽/год и ₽/урок); маржа % и в деньгах; хедер — себестоимость vs цена.
- **Статьи расходов, явно смоделированные:** ФОТ по ролям (с разбивкой найм-режима и налоговой нагрузки) + «внешние» статьи (подрядчики/сервисы) — это ближе всего к настоящей структуре себестоимости среди всех источников.
- Курс ЦБ и цифры по умолчанию — из сметы 2026-06-04 (внешний хардкод).

## 5. platform/db/schema — существующие таблицы

- **Путь:** `C:/Users/sidor/repos/bbm-portal/src/lib/platform/db/schema/`; владелец: repo (bbm-portal); тип: original (живая схема БД).
- Модули: `core.ts`, `hours/`, `member/`.
- `hours/hours-assessment.ts` — начисления часов: колонки `monthlyRate` (int), `hourlyRate` (double precision, unrounded effective rate), `accrual` (int), `cashAmount` (int), `investAmount` (int), `weekdayCount` (int) — это и есть таблица с начислениями по ставкам (часы × ставка роли).
- `hours/hours-period.ts` — периоды начислений (id = text/UUID, cutover-совместимый); поле `weekday_count` определяет каждый rate/accrual периода.
- Другие `hours-*`: `hours-participant.ts`, `hours-publication.ts`, `hours-publication-message.ts` — участники/публикации периода, не детально просмотрены (не относятся к ставкам/начислениям).
- `member/member.ts`, `member/member-alias.ts` — участники/алиасы, не относится к деньгам напрямую.
- **Нет никакой таблицы себестоимости продукта, статей расходов проекта (аренда/сервисы/налоги/CAPEX-OPEX) или P&L** — только начисления по часам участников.

## 6. finmodel SSOT — variables.ts / types.ts

- **Путь:** `C:/Users/sidor/repos/bbm-portal/src/lib/finmodel/{variables.ts,types.ts}`; владелец: repo; тип: original (снапшот мастера `ssot/finmodel.yaml` из репо bbm-kb, снимается `pnpm ssot:pull`).
- SSOT-переменные, относящиеся к деньгам:
  - `policy.profit_shares` — `investors`/`author`/`coauthors` (доли 4/2/1)
  - `policy.royalty_percent` — `total` = `mission_fund` + `bbm_holders`
  - `policy.reserve_percent` — доля каждой входящей суммы в резерв
  - `policy.emission_price_rub` — цена первичной эмиссии токена
  - `policy.examples.team_monthly_rate_rub`, `policy.examples.team_hours_norm` — примерные ставка/норма часов команды (публичные примеры)
  - `projects.doctor_school.unit_price_rub` — цена юнита продукта проекта DS
  - `projects.doctor_school.mining_weights` (`pul`,`bre`,`con`) — веса майнинга внимания
  - `model_example: string[]` — пути значений, помеченных как модельные (не зафиксированный факт)
- Нет переменных себестоимости/статей расходов — SSOT моделирует только распределение прибыли/эмиссию, не структуру затрат.

## Sources I could not read

None — all six sources were read successfully (full or targeted grep/read).
