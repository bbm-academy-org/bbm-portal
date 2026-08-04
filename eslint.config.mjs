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
  {
    ignores: [
      '.next/',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
      'src/migrations/',
    ],
  },
]

export default eslintConfig
