#!/usr/bin/env node

import { lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

function samePath(left, right) {
  const normalize = (path) => String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

function skillNames(canonical) {
  return readdirSync(canonical, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        return lstatSync(resolve(canonical, entry.name, 'SKILL.md')).isFile()
      } catch {
        return false
      }
    })
    .map((entry) => entry.name)
    .sort()
}

export function verifySkillsBridge(root) {
  const canonical = resolve(root, '.claude', 'skills')
  const bridge = resolve(root, '.agents', 'skills')
  let canonicalReal
  let bridgeReal
  try {
    canonicalReal = realpathSync(canonical)
    bridgeReal = realpathSync(bridge)
  } catch (error) {
    throw new Error(`Codex skills bridge is missing or unreadable: ${error.message}`)
  }
  if (!samePath(canonicalReal, bridgeReal)) {
    throw new Error(`Codex skills bridge points to '${bridgeReal}', expected '${canonicalReal}'.`)
  }
  const skills = skillNames(canonical)
  if (skills.length === 0) throw new Error(`No canonical skills found under '${canonical}'.`)
  return { bridge, canonical, skills }
}

export function ensureSkillsBridge(root) {
  const canonical = resolve(root, '.claude', 'skills')
  const bridge = resolve(root, '.agents', 'skills')
  try {
    lstatSync(canonical)
  } catch {
    throw new Error(`Canonical skills directory does not exist: '${canonical}'.`)
  }

  try {
    lstatSync(bridge)
    try {
      return verifySkillsBridge(root)
    } catch (error) {
      throw new Error(
        `Refusing to replace existing '.agents/skills': ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }

  mkdirSync(dirname(bridge), { recursive: true })
  symlinkSync(canonical, bridge, process.platform === 'win32' ? 'junction' : 'dir')
  return verifySkillsBridge(root)
}

export function gitRoot(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Cannot resolve the repository root with git rev-parse --show-toplevel.')
  }
  return result.stdout.trim()
}

function main() {
  try {
    const rootIndex = process.argv.indexOf('--root')
    const root = rootIndex >= 0 ? resolve(process.argv[rootIndex + 1]) : gitRoot()
    const result = process.argv.includes('--check')
      ? verifySkillsBridge(root)
      : ensureSkillsBridge(root)
    process.stdout.write(
      `Codex skills bridge OK: ${result.skills.length} canonical skill(s) from ${result.canonical}\n`,
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
