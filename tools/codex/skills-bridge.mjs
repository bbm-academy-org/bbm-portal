#!/usr/bin/env node

import { lstatSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export function samePath(left, right, platform = process.platform) {
  const normalize = (path) => String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (platform === 'win32') return normalize(left) === normalize(right)
  const exact = (path) => String(path).replace(/\/+$/, '')
  return exact(left) === exact(right)
}

function hasUsableIdentity(stat) {
  if (!stat || stat.dev == null || stat.ino == null) return false
  const isZero = (value) => value === 0 || value === 0n
  return !isZero(stat.dev) || !isZero(stat.ino)
}

export function sameFilesystemTarget(leftPath, rightPath, leftReal, rightReal, deps = {}) {
  const stat = deps.stat || statSync
  try {
    const left = stat(leftPath)
    const right = stat(rightPath)
    if (hasUsableIdentity(left) && hasUsableIdentity(right)) {
      return left.dev === right.dev && left.ino === right.ino
    }
  } catch {
    // Fall back to realpath spelling when a filesystem does not expose identity.
  }
  return samePath(leftReal, rightReal, deps.platform || process.platform)
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

export function verifySkillsBridge(root, deps = {}) {
  const canonical = resolve(root, '.claude', 'skills')
  const bridge = resolve(root, '.agents', 'skills')
  const realpath = deps.realpath || realpathSync
  let canonicalReal
  let bridgeReal
  try {
    canonicalReal = realpath(canonical)
    bridgeReal = realpath(bridge)
  } catch (error) {
    throw new Error(`Codex skills bridge is missing or unreadable: ${error.message}`)
  }
  if (!sameFilesystemTarget(canonical, bridge, canonicalReal, bridgeReal, deps)) {
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
