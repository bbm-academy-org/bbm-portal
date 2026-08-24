import { readFileSync } from 'node:fs'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Третья декларация одного факта: `.mdx` — текст, а не модуль. Канон и причина
 * — `tools/build/mdx-raw-loader.cjs`; здесь она нужна потому, что снимок
 * нормативного документа читает не только страница, но и тест согласованности
 * (`tests/unit/finmodel-rules-consistency.spec.ts`), а у vitest свой сборщик.
 */
const mdxAsRawText = {
  name: 'bbm:mdx-as-raw-text',
  enforce: 'pre' as const,
  load(id: string) {
    if (!id.split('?')[0].endsWith('.mdx')) return null
    return `export default ${JSON.stringify(readFileSync(id.split('?')[0], 'utf8'))}`
  },
}

export default defineConfig({
  plugins: [tsconfigPaths(), react(), mdxAsRawText],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'tests/int/**/*.int.spec.ts',
      'tests/unit/**/*.spec.ts',
      // CI guard specs live next to the guards they cover (docs/ci-guardrails.md
      // §8) — the pairing is what `guard-test-coverage` asserts. Run tier:
      // `pnpm test:guards`; CI runs them as their own job.
      'tools/lint/guard-tests/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', 'tools/lint/guard-tests/fixtures/**'],
    // int suites share one dev DB (:5444) and a singleton `siteBuildState`
    // global, so cross-file parallelism makes them order-dependent (#48): a
    // suite staging/publishing drafts or stamping the global between another
    // suite's two reads perturbs cross-read assertions. Pin serial (equivalent
    // to --no-file-parallelism). The pinning is int-suite-motivated; the pure
    // unit suite (tests/unit, DB-free — the only tier CI runs, via
    // `pnpm test:unit`) just inherits it at negligible wall-clock cost.
    fileParallelism: false,
  },
})
