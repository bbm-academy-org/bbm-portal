import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT_RE = /(tools\/[\w./-]+\.mjs)(?:\\?["')]+)?\s*([\w-]+)?/g

function commandTargets(command) {
  return [
    ...String(command ?? '')
      .replaceAll('\\', '/')
      .matchAll(SCRIPT_RE),
  ].map((match) => ({
    path: match[1],
    args: match[2] ?? '',
  }))
}

function registrations(config) {
  const out = []
  for (const [event, groups] of Object.entries(config?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue
      for (const hook of group.hooks) {
        for (const target of commandTargets(hook?.command)) out.push({ event, ...target })
      }
    }
  }
  return out
}

function validateDefinitions(config, label) {
  const findings = []
  for (const [event, groups] of Object.entries(config?.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.length === 0) {
      findings.push({ kind: 'invalid-hook-event', detail: `${label}:${event}` })
      continue
    }
    for (const [groupIndex, group] of groups.entries()) {
      if (!Array.isArray(group?.hooks) || group.hooks.length === 0) {
        findings.push({ kind: 'invalid-hook-group', detail: `${label}:${event}[${groupIndex}]` })
        continue
      }
      for (const [hookIndex, hook] of group.hooks.entries()) {
        if (
          hook?.type !== 'command' ||
          !String(hook.command ?? '').trim() ||
          commandTargets(hook.command).length !== 1
        ) {
          findings.push({
            kind: 'invalid-hook-definition',
            detail: `${label}:${event}[${groupIndex}].hooks[${hookIndex}]`,
          })
        }
      }
    }
  }
  return findings
}

const key = (event, path, args = '') => `${event}|${path}|${args}`

export function auditHookCoverage(claude, codex, inventory) {
  const findings = []
  const claudeKeys = new Set(
    registrations(claude).map((item) => key(item.event, item.path, item.args)),
  )
  const codexKeys = new Set(
    registrations(codex).map((item) => key(item.event, item.path, item.args)),
  )
  const inventoryKeys = new Set()

  for (const entry of inventory) {
    const sourceKey = key(entry.claudeEvent, entry.claudePath, entry.claudeArgs)
    if (inventoryKeys.has(sourceKey)) findings.push({ kind: 'duplicate-inventory-entry', entry })
    inventoryKeys.add(sourceKey)
    if (!claudeKeys.has(sourceKey)) findings.push({ kind: 'stale-inventory-entry', entry })
    if (entry.status === 'mapped') {
      if (
        !entry.codexEvent ||
        !entry.codexPath ||
        !codexKeys.has(key(entry.codexEvent, entry.codexPath, entry.codexArgs))
      ) {
        findings.push({ kind: 'missing-codex-registration', entry })
      }
    } else if (entry.status === 'intentional-difference') {
      if (!String(entry.rationale ?? '').trim()) findings.push({ kind: 'missing-rationale', entry })
    } else {
      findings.push({ kind: 'unknown-inventory-status', entry })
    }
  }
  for (const sourceKey of claudeKeys) {
    if (!inventoryKeys.has(sourceKey))
      findings.push({ kind: 'unclassified-claude-hook', key: sourceKey })
  }
  return findings
}

function loadJson(path, findings, label) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.hooks ||
      typeof parsed.hooks !== 'object'
    ) {
      findings.push({ kind: 'invalid-hook-config', path, detail: `${label} has no hooks object` })
    }
    return parsed
  } catch (error) {
    findings.push({ kind: 'invalid-hook-config', path, detail: `${label}: ${error.message}` })
    return { hooks: {} }
  }
}

function defaultGitPath(root) {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 ? resolve(root, result.stdout.trim()) : null
}

export function inspectCodexReadiness(root, options = {}) {
  const findings = []
  const claude = loadJson(resolve(root, '.claude', 'settings.json'), findings, 'Claude hook config')
  const codex = loadJson(resolve(root, '.codex', 'hooks.json'), findings, 'Codex hook config')
  const inventory =
    options.inventory ??
    JSON.parse(readFileSync(resolve(root, 'tools', 'codex', 'hook-coverage.json'), 'utf8'))

  findings.push(...validateDefinitions(claude, 'Claude'), ...validateDefinitions(codex, 'Codex'))

  for (const [event, groups] of Object.entries(codex?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue
      for (const hook of group.hooks) {
        const command = commandTargets(hook?.command)
        const commandWindows = commandTargets(hook?.commandWindows)
        if (JSON.stringify(command) !== JSON.stringify(commandWindows)) {
          findings.push({
            kind: 'command-platform-mismatch',
            event,
            detail: `command=${JSON.stringify(command)} commandWindows=${JSON.stringify(commandWindows)}`,
          })
        }
        for (const field of ['command', 'commandWindows']) {
          const targets = commandTargets(hook?.[field])
          if (targets.length === 0) {
            findings.push({ kind: 'unrecognized-command-registration', event, field })
            continue
          }
          for (const target of targets) {
            if (!existsSync(resolve(root, target.path))) {
              findings.push({ kind: 'missing-command-path', event, field, ...target })
            }
          }
        }
      }
    }
  }
  findings.push(...auditHookCoverage(claude, codex, inventory))

  const hookPath = (options.gitPath ?? defaultGitPath)(root)
  if (!hookPath || !existsSync(hookPath)) {
    findings.push({ kind: 'missing-pre-commit', path: hookPath })
  } else {
    const hook = readFileSync(hookPath, 'utf8')
    for (const expected of ['lint-staged', 'tdd-order-lint.mjs --staged']) {
      if (!hook.includes(expected))
        findings.push({ kind: 'incomplete-pre-commit', expected, path: hookPath })
    }
  }

  return {
    findings,
    registrations: registrations(codex).length,
    coverageEntries: inventory.length,
    unverified: [
      'Runtime trust is not observable from repository files.',
      'Runtime hook capabilities and delivery are not exercised by this command.',
    ],
  }
}

export function formatReadiness(result) {
  const lines = []
  if (result.findings.length === 0) {
    lines.push(
      `Codex hook definitions OK: ${result.registrations} registration(s), all command paths exist.`,
    )
    lines.push(
      `Codex hook coverage OK: ${result.coverageEntries} Claude registration classification(s).`,
    )
    lines.push('Git pre-commit OK: lint-staged and staged TDD-order are installed.')
  } else {
    for (const finding of result.findings) {
      const entryDetail = finding.entry
        ? `${finding.entry.claudeEvent} ${finding.entry.claudePath}`
        : ''
      const detail =
        finding.detail ?? finding.key ?? finding.path ?? finding.expected ?? entryDetail
      const event = finding.event ? ` ${finding.event}` : ''
      lines.push(`Codex readiness finding: ${finding.kind}${event}${detail ? ` — ${detail}` : ''}`)
    }
  }
  for (const item of result.unverified) lines.push(`UNVERIFIED: ${item}`)
  return lines.join('\n')
}
