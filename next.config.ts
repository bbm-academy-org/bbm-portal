import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  // Emit `.next/standalone` (+ `.next/static`) so the Dockerfile `runner` stage
  // can ship a minimal self-contained server. Without this, output tracing is
  // skipped and the runner stage's `COPY .next/standalone` finds nothing.
  output: 'standalone',
  // Next rewrites its own guidance block into `AGENTS.md` on EVERY `next dev`
  // start (`next/dist/server/lib/generate-agent-files.js`). Off here, and the
  // reason is ownership rather than tidiness: `AGENTS.md` is part of this repo's
  // always-on instruction corpus — the set `pnpm lint:instruction-budget`
  // measures — so leaving it on hands a framework write access to agent canon,
  // with content that can change on any upgrade without passing a review. The
  // block's own text argues that committing it "keeps the tree clean", which is
  // backwards here: canon lives in `.claude/`, and a tool-managed block inside
  // it is the second source of truth CLAUDE.md bans. The one useful thing it
  // said — read the version-matched docs bundled in the `next` package — is now
  // stated by us, in `AGENTS.md`, under our own review. (#229)
  agentRules: false,
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
