import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // `@refinedev/react-table`'s ESM build imports the extensionless CJS
      // subpath `lodash/isEqual`, which Node's ESM resolver refuses. Without
      // this alias the REAL `useTable` cannot be loaded in a unit test at all,
      // and the only thing a spec can assert is a mock of it — which is where
      // #388 defect A hid (the stale `filters.permanent` seed lives inside the
      // real hook). Resolving the subpath to its file makes the real block
      // testable; nothing else changes.
      'lodash/isEqual': 'lodash/isEqual.js',
    },
  },
  test: {
    environment: 'jsdom',
    // …and the alias only reaches that import once the package is transformed
    // by vite rather than handed to Node's own ESM resolver.
    server: { deps: { inline: ['@refinedev/react-table'] } },
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
