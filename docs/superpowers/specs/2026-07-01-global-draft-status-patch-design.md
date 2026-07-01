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
  select: { updatedAt: true },   // ← срезает _status из ответа
  user,
})
if (publishedDoc?._status === 'published') {   // ← _status не выбран → undefined → false
  hasPublishedDoc = true
}
```

`hasPublishedDoc` остаётся `false`, хотя published-версия реально существует. Это
одно значение кладётся в `DocumentInfoContext` и читается тремя компонентами
(`Status`, `UnpublishButton`, `PublishButton`) — поэтому один сломанный источник
даёт все симптомы.

**Проверка апстрима (2026-07-01):** npm `latest` = `3.85.1` (= наша версия). На
`main` HEAD баг воспроизводится — файл переехал в
`packages/ui/src/utilities/getVersions.ts`, но ветка глобалов та же
(`select: { updatedAt: true }` → проверка `_status`). Коллекционную ветку в том же
рефакторе починили, глобальную — нет. Публичного релиза с фиксом нет.

## Решение

**Единственный источник — `getVersions.js`.** Правим его через нативный
`pnpm patch` (идиома pnpm 10; npm-пакет `patch-package` не нужен). Патч применяется
на `pnpm install`, т.е. отрабатывает и в CI/деплое.

**Минимальная правка** (сохраняем `select`-оптимизацию, а не убираем её целиком):

```diff
   select: {
     updatedAt: true,
+    _status: true,
   },
```

Правим **только** ветку глобалов (≈стр. 166). Коллекционную ветку не трогаем.

### Почему не кастомный `Status`-компонент

Переопределение `Status` через `admin.components` починит только ярлык + ссылку
revert, но `UnpublishButton` читает то же сломанное `hasPublishedDoc` из контекста —
пункт **Unpublish** останется скрытым. Заведомо неполный фикс. Патч источника
чинит все три компонента разом. См. память `fix-root-cause-not-workarounds`.

## Объём изменений

1. `pnpm patch @payloadcms/next@3.85.1` → добавить `_status: true` в `select`
   ветки глобалов → `pnpm patch-commit`.
2. `patches/@payloadcms__next@3.85.1.patch` (новый файл) + запись
   `pnpm.patchedDependencies` в `package.json`.
3. Апстрим-issue в `payloadcms/payload` со ссылкой на актуальную строку в
   `packages/ui/src/utilities/getVersions.ts` на `main` (чтобы снять патч после
   их фикса). Ссылку на upstream-issue добавить комментарием в `patches/…patch`
   или в `#55`.

## Проверка

- **До/после в админке:** `pageAbout` с накопленным черновиком показывает
  `Changed`, появляется «Вернуть к опубликованной», в «⋮» виден **Unpublish**.
- **Патч применяется:** после `rm -rf node_modules && pnpm install` строка
  `_status: true` присутствует в
  `node_modules/@payloadcms/next/dist/views/Document/getVersions.js`.
- **Сборка/тесты:** `pnpm build` проходит; существующие int/e2e-сьюты зелёные
  (модель публикации не меняется).

## Риски

- Патч завязан на точную версию `3.85.1`. При бампе Payload `pnpm install` громко
  упадёт, если хунк не приложится — это ожидаемый сигнал пересмотреть патч (снять,
  если апстрим починил). Приемлемо.
- Правка чисто в admin-индикации; путей данных/публикации не касается.
