import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const RUNBOOK_PATH = resolve(
  import.meta.dirname,
  '../../docs/runbooks/finance-history-reconstruction.md',
)

const runbook = () => readFileSync(RUNBOOK_PATH, 'utf8').replaceAll('\r\n', '\n')

describe('docs/runbooks/finance-history-reconstruction.md', () => {
  it('documents both workstation SSH tunnels to the private databases', () => {
    const text = runbook()

    expect(text).toContain('tools-prod-tw')
    expect(text).toContain('portal-prod-tw')
    expect(text).toMatch(/'-L', "127\.0\.0\.1:15432:[^\n]+"[\s\S]+?'tools-prod-tw'/)
    expect(text).toMatch(/'-L', "127\.0\.0\.1:15433:[^\n]+"[\s\S]+?'portal-prod-tw'/)
    expect(text).toMatch(/MATTERMOST_DATABASE_URL/)
    expect(text).toMatch(/PLATFORM_DATABASE_URL/)
    expect(text).toContain('FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY')
    expect(text).toContain("$env:NODE_ENV = 'production'")
  })

  it('transfers only selected-channel attachments into a private local workspace', () => {
    const text = runbook()

    expect(text).toContain('tsixee7hhj87inw5frgjna694c')
    expect(text).toMatch(/fileinfo[\s\S]+posts[\s\S]+channelid/i)
    expect(text).toMatch(/tar[\s\S]+--files-from/i)
    expect(text).toMatch(/icacls[\s\S]+inheritance:r/i)
    expect(text).toMatch(/mapping[\s\S]+plan[\s\S]+bundle/i)
  })

  it('keeps dry-run and digest-authorized apply as separate operator stages', () => {
    const text = runbook()
    const dryRunAt = text.indexOf('platform:finance:history dry-run')
    const authorizationAt = text.indexOf('OWNER AUTHORIZATION GATE')
    const applyAt = text.indexOf('platform:finance:history apply')

    expect(dryRunAt).toBeGreaterThan(-1)
    expect(authorizationAt).toBeGreaterThan(dryRunAt)
    expect(applyAt).toBeGreaterThan(authorizationAt)
    expect(text).toMatch(/--digest\s+\$PlanDigest/)
  })

  it('requires verified cleanup without commands that print credentials', () => {
    const text = runbook()

    expect(text).toContain('Remove-Item -LiteralPath $HistoryRoot -Recurse -Force')
    expect(text).toMatch(/Test-Path -LiteralPath \$HistoryRoot/)
    expect(text).not.toMatch(/(?:echo|Write-Output)[^\n]*(?:PASSWORD|DATABASE_URL)/i)
    expect(text).not.toMatch(/grep[^\n]+(?:PASSWORD|DATABASE_URL)/i)
  })
})
