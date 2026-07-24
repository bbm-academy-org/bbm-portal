import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts', 'tests/unit/**/*.spec.ts'],
    // int suites share one dev DB (:5444) and a singleton `siteBuildState`
    // global, so cross-file parallelism makes them order-dependent (#48): a
    // suite staging/publishing drafts or stamping the global between another
    // suite's two reads perturbs cross-read assertions. Pin serial (equivalent
    // to --no-file-parallelism). CI runs only lint+typecheck, so this has no CI
    // cost; locally it trades a little wall-clock for determinism.
    fileParallelism: false,
  },
})
