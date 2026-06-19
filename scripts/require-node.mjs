#!/usr/bin/env node
// Preflight guard for the Node-22-sensitive scripts (migrate*, dev, build,
// test*, seed*). Payload's migrate CLI / drizzle-kit tsx loader crash on the
// wrong Node major (node:crypto?tsx-namespace ENOENT), so fail early with a
// clear message instead of a cryptic deep crash. The required major is read
// from .nvmrc — single source of truth, no second place to bump.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const nvmrc = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim()
const requiredMajor = nvmrc.replace(/^v/, '').split('.')[0]
const actual = process.versions.node
const actualMajor = actual.split('.')[0]

if (actualMajor !== requiredMajor) {
  console.error(
    `\n✖ This repo requires Node ${requiredMajor} (see .nvmrc: ${nvmrc}) — you are on ${actual}.\n` +
      `  Run \`nvm use\` / \`fnm use\` to switch, then retry.\n`,
  )
  process.exit(1)
}
