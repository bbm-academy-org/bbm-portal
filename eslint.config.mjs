import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  // Node CLI tooling (`tools/**`) — plain .mjs, не код приложения: Next/browser
  // правила ему не нужны и раньше вся папка была просто исключена из линта.
  // Ровно это и пропустило в main #132: `item is not defined` в успешной ветке
  // `board:status` синтаксически валиден, живёт в редко исполняемой строке лога
  // и вылезает только в рантайме — ПОСЛЕ прошедшей мутации. Поэтому папка
  // линтуется одним правилом, ловящим весь класс: `no-undef`.
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // `globals` не является прямой зависимостью репо, поэтому список
      // node-глобалей задан явно — ровно то, чем пользуются наши скрипты.
      globals: Object.fromEntries(
        [
          'process',
          'console',
          'Buffer',
          'URL',
          'URLSearchParams',
          'TextEncoder',
          'TextDecoder',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'structuredClone',
          'fetch',
          'AbortController',
          'globalThis',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: { 'no-undef': 'error' },
  },
  // ЕДИНСТВЕННАЯ дверь в транзакцию платформенной БД (спека 201, EARS-24).
  //
  // `core.audit_row_change()` ОТКАЗЫВАЕТ записи на помеченном соединении
  // приложения, если в транзакции не выставлен аудит-контекст (EARS-26). Ставит
  // его `platformTransaction(ctx, fn)` из `src/lib/platform/db/transaction.ts`
  // — и это правило вместе с типом `PlatformDb` (без `.transaction`) держит его
  // единственной дверью: тип ловит компиляцией, правило — глазами ревью,
  // триггер — фактом отказа записи.
  //
  // Названная асимметрия (EARS-24): первый селектор — чистый AST, второй ищет
  // SQL ТЕКСТОМ внутри `Literal`/`TemplateElement`, то есть ровно та хрупкость
  // строкового матчинга, из-за которой наши собственные гарды живут в WARN, —
  // здесь она внутри BLOCK-линта. Принято осознанно: это вспомогательная
  // половина вспомогательного механизма (несущая — EARS-26, на стороне БД), а
  // её класс ложных срабатываний односторонний — поймать она может только
  // рукописную запись `app.*` GUC, которая вне `src/lib/platform/db/` и есть
  // то, что клауза запрещает.
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'tools/**/*.ts'],
    ignores: ['src/lib/platform/db/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='transaction']",
          message:
            'Транзакцию к платформенной БД открывает только platformTransaction(ctx, fn) из @/lib/platform/db/transaction (спека 201, EARS-24): без аудит-контекста запись отклонит триггер core.audit_row_change().',
        },
        {
          selector: "Literal[value=/set_config\\(\\s*'app\\.|SET LOCAL app\\.|set local app\\./]",
          message:
            'Аудит-контекст (app.actor_email / app.source) выставляет только platformTransaction() в src/lib/platform/db/ (спека 201, EARS-24). Рукописный set_config( app.… ) на месте вызова воссоздаёт ровно ту конвенцию, которую клауза отменяет.',
        },
        {
          selector:
            "TemplateElement[value.raw=/set_config\\(\\s*'app\\.|SET LOCAL app\\.|set local app\\./]",
          message:
            'Аудит-контекст (app.actor_email / app.source) выставляет только platformTransaction() в src/lib/platform/db/ (спека 201, EARS-24). Рукописный set_config( app.… ) на месте вызова воссоздаёт ровно ту конвенцию, которую клауза отменяет.',
        },
      ],
    },
  },
  {
    ignores: [
      '.next/',
      // Fake repo trees fed to the CI guards as input under test
      // (docs/ci-guardrails.md §8) — a fixture carries a banned stub marker or a
      // broken workflow ON PURPOSE, so linting it would fight the assertion.
      'tools/lint/guard-tests/fixtures/',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
      'src/migrations/',
    ],
  },
]

export default eslintConfig
