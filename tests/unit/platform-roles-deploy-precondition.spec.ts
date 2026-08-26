import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * The deploy-ordering precondition of the claim gate (spec 311 §B).
 *
 * The release that carries the gate flips the live workspace from "any
 * authenticated account" to "a grant is required". Until the prod project
 * carries the two roles, `projectRoleAssertion`, and a per-user grant for every
 * existing member, that release answers a bare 403 on every `/p` path — and a
 * missing grant is indistinguishable from a correct refusal, so the failure is
 * silent.
 *
 * That hazard has to live where the person running the deploy reads it, which
 * is `deploy/README.md` — not only in a dev-stand how-to. This test pins the
 * precondition to the runbook so a later edit cannot quietly drop it, the same
 * way `hours-core-cutover-runbook.spec.ts` pins its cutover steps.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const deployReadme = readFileSync(resolve(REPO, 'deploy/README.md'), 'utf8')
const bootstrap = readFileSync(resolve(REPO, 'infra/dev-stand/idp/bootstrap.md'), 'utf8')

describe('deploy/README.md — the workspace-roles precondition', () => {
  it('names both workspace roles', () => {
    expect(deployReadme).toContain(PLATFORM_USER_ROLE)
    expect(deployReadme).toContain(PLATFORM_ADMIN_ROLE)
  })

  it('names all three objects that have to exist before the release', () => {
    expect(deployReadme).toContain('projectRoleAssertion')
    expect(deployReadme).toMatch(/grant/i)
  })

  it('states the ordering — the provisioning steps run BEFORE the release', () => {
    expect(deployReadme).toMatch(/before[^.\n]*deploy|deploy[^.\n]*after|precondition/i)
  })

  it('points at the canonical procedure instead of retelling it', () => {
    expect(deployReadme).toContain('infra/dev-stand/idp/bootstrap.md')
    expect(deployReadme).toContain('5a')
  })

  it('says the blast radius out loud — a missing grant looks like a correct refusal', () => {
    expect(deployReadme).toMatch(/403/)
  })
})

describe('bootstrap.md §5a — a precondition, not only a how-to', () => {
  const section = bootstrap.slice(bootstrap.indexOf('## 5a.'), bootstrap.indexOf('## 6.'))

  it('states that the prod steps are a precondition of deploying the gate', () => {
    expect(section).toMatch(/precondition/i)
    expect(section).toContain('#313')
  })

  it('is the section deploy/README.md points at', () => {
    expect(section.length).toBeGreaterThan(0)
  })
})
