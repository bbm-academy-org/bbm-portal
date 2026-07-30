# Fix #55 — page-глобал с черновиком показывает `Draft` вместо `Changed`

**Дата:** 2026-07-01
**Issue:** [#55](https://github.com/bbm-academy-org/bbm-portal/issues/55) (эпик [#40](https://github.com/bbm-academy-org/bbm-portal/issues/40))
**Тип:** багфикс сторонней зависимости через `pnpm patch`

## Проблема

У page-глобала с `versions.drafts` + autosave (`pageAbout`, `pageContacts`), когда
поверх опубликованной версии лежит неопубликованный черновик, админка показывает
статус **`Draft`** вместо **`Changed`**. Из-за этого скрыты:

- ссылка **«Вернуть к опубликованной»** (нужен `hasPublishedDoc && status==='changed'`);
- пункт **Unpublish** в меню «⋮» (нужен `hasPublishedDoc`).

Данные корректны — сломана только индикация в админке. Модель публикации
(`/api/pending-changes`, кнопка Publish) читает `_status` напрямую и не затронута.

## Корневая причина

`@payloadcms/next/dist/views/Document/getVersions.js`, ветка глобалов (≈стр. 162–174):

```js
publishedDoc = await payload.findGlobal({
  slug: globalConfig.slug,
  depth: 0,
  locale,
  select: { updatedAt: true }, // ← срезает _status из ответа
  user,
})
if (publishedDoc?._status === 'published') {
  // ← _status не выбран → undefined → false
  hasPublishedDoc = true
}
```

(ветка `if (globalConfig)` начинается на стр. 156; `findGlobal({ select })` —
стр. 162–170, вставка `_status: true` идёт в `select`-объект ~стр. 168; проверка
`_status` — стр. 172.)

`hasPublishedDoc` остаётся `false`, хотя published-версия реально существует. Это
одно значение кладётся в `DocumentInfoContext` и читается тремя компонентами
(`Status`, `UnpublishButton`, `PublishButton`) — поэтому один сломанный источник
даёт все симптомы. Побочно `PublishButton` сейчас активна по неверной причине
(`!hasPublishedDoc`); после фикса она остаётся активной корректно через
`modified || hasNewerVersions` — регресса нет, меняется лишь обоснование.

**Проверка апстрима (2026-07-01):** npm `latest` = `3.85.1` (= наша версия). На
`main` HEAD баг воспроизводится — файл переехал в
`packages/ui/src/utilities/getVersions.ts`, но ветка глобалов та же
(`select: { updatedAt: true }` → проверка `_status`). Коллекционную ветку в том же
рефакторе починили, глобальную — нет. Публичного релиза с фиксом нет.

## Решение

**Единственный источник — `getVersions.js`.** Правим его через нативный
`pnpm patch` (идиома pnpm 10; npm-пакет `patch-package` не нужен). Патч применяется
на `pnpm install` (и в CI/деплое — **при условии правки `Dockerfile`, см. ниже**).

**Минимальная правка** (сохраняем `select`-оптимизацию, а не убираем её целиком):

```diff
   select: {
     updatedAt: true,
+    _status: true,
   },
```

Правим **только** ветку глобалов (~стр. 168). Коллекционную ветку не трогаем.
`updatedAt` из `select` **не удаляем** — он нужен ниже: `unpublishedVersionCount`
считается только внутри `if (publishedDoc?.updatedAt)` (стр. 189–208), а статус
`changed` в компоненте `Status` возникает лишь при
`hasPublishedDoc && unpublishedVersionCount > 0`. Т.е. фикс даёт `changed` только
в связке: `_status: true` чинит `hasPublishedDoc`, а сохранённый `updatedAt`
оставляет корректным подсчёт `unpublishedVersionCount`. Отдельные вызовы
`findGlobalVersions` (`mostRecentVersionIsAutosaved`, `versionCount`) от нашего
`select` не зависят.

### Почему не кастомный `Status`-компонент

Переопределение `Status` через `admin.components` починит только ярлык + ссылку
revert, но `UnpublishButton` читает то же сломанное `hasPublishedDoc` из контекста —
пункт **Unpublish** останется скрытым. Заведомо неполный фикс. Патч источника
чинит все три компонента разом. См. память `fix-root-cause-not-workarounds`.

## Объём изменений

1. `pnpm patch @payloadcms/next@3.85.1` → добавить `_status: true` в `select`
   ветки глобалов → `pnpm patch-commit`.
2. Новый файл `patches/@payloadcms__next@3.85.1.patch` + запись
   `pnpm.patchedDependencies` в `package.json` (секция `pnpm` там уже есть с
   `onlyBuiltDependencies` — `patch-commit` допишет `patchedDependencies` рядом;
   проверить, что существующую секцию не переформатировало неожиданно).
3. **`pnpm-lock.yaml`** обновляется `patch-commit` (секция `patchedDependencies`).
   Коммитить `package.json` + `pnpm-lock.yaml` + `patches/…patch` **одним
   изменением** — иначе Docker-деплой на `--frozen-lockfile` упадёт из-за
   рассинхрона lockfile ↔ package.json.
4. **`Dockerfile` (blocker).** `deps`-стадия (стр. 13–19) копирует только
   `package.json` + lockfiles и ставит `pnpm i --frozen-lockfile`. С
   `patchedDependencies`, но без каталога `patches/`, pnpm 10 **упадёт**
   (patch file not found). Добавить перед `RUN … pnpm i` копирование патчей:
   ```dockerfile
   COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
   COPY patches ./patches
   ```
   (`patches/` не исключён в `.dockerignore` — проверено, в контекст попадёт.)
   `builder`/`tooling` берут `node_modules` из `deps`, поэтому патч дальше
   протекает в standalone-трейс автоматически.
5. Апстрим-issue в `payloadcms/payload` со ссылкой на актуальную строку в
   `packages/ui/src/utilities/getVersions.ts` на `main` (чтобы снять патч после
   их фикса). Ссылку на upstream-issue добавить комментарием в `patches/…patch`
   или в `#55`. **NB:** при снятии патча перепроверить, в каком пакете теперь
   функция — на `main` она уехала из `@payloadcms/next` в `@payloadcms/ui`.

## Проверка

- **До/после в админке:** `pageAbout` с накопленным черновиком показывает
  `Changed`, появляется «Вернуть к опубликованной», в «⋮» виден **Unpublish**.
  Это единственная проверка, подтверждающая, что `findGlobal` с `select` реально
  отдаёт `_status` и `hasPublishedDoc=true` доходит до UI (одного grep строки в
  файле недостаточно).
- **Патч применяется:** после `rm -rf node_modules && pnpm install` строка
  `_status: true` присутствует в фактическом файле пакета
  (`node_modules/.pnpm/@payloadcms+next@3.85.1_*/…/dist/views/Document/getVersions.js`,
  на который указывает симлинк `node_modules/@payloadcms/next`).
- **Деплой:** проверять на **Docker/standalone-сборке**, не только `pnpm dev` —
  именно там всплывает Dockerfile-blocker. `docker build` должен пройти
  `deps`-стадию без ошибки patch-not-found, а патченый `getVersions.js` — попасть
  в `.next/standalone`.
- **Сборка/тесты:** `pnpm build` проходит; существующие int/e2e-сьюты зелёные
  (модель публикации не меняется).

## Риски

- Патч завязан на точную версию `3.85.1` и на скомпилированный `dist`-артефакт
  (payload не публикует `src` в npm-пакете). При бампе Payload `pnpm install`
  громко упадёт, если хунк не приложится — ожидаемый сигнал пересмотреть патч
  (снять, если апстрим починил). Приемлемо.
- Патч не трогает `getVersions.js.map` — sourcemap рассинхронизируется с кодом,
  но на рантайм не влияет. Приемлемо.
- Правка чисто в admin-индикации; путей данных/публикации не касается.
