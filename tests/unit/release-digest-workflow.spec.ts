import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

type WorkflowStep = {
  name?: string
  run?: string
}

type ReleaseDigestWorkflow = {
  jobs: {
    digest: {
      steps: WorkflowStep[]
    }
  }
}

const repoRoot = resolve(import.meta.dirname, '..', '..')
const workflow = parse(
  readFileSync(resolve(repoRoot, '.github', 'workflows', 'release-digest.yml'), 'utf8'),
) as ReleaseDigestWorkflow
const resolver = workflow.jobs.digest.steps.find(
  (step) => step.name === 'Resolve target sha (workflow_dispatch)',
)?.run

if (!resolver) throw new Error('release-digest workflow is missing its dispatch sha resolver')

const resolverLines = resolver.split('\n').map((line) => line.trim())

describe('release-digest workflow dispatch sha resolver', () => {
  it('forces the filtered deployments request to use GET', () => {
    expect(resolver).toContain(
      'gh api --method GET repos/{owner}/{repo}/deployments -f environment=production',
    )
  })

  it('clears a failed lookup before evaluating the HEAD fallback', () => {
    const lookupStart = resolverLines.findIndex((line) =>
      line.startsWith('if ! sha="$(gh api --method GET '),
    )

    expect(lookupStart).toBeGreaterThan(-1)
    expect(resolverLines.slice(lookupStart + 1, lookupStart + 3)).toEqual(['sha=""', 'fi'])
    expect(resolver).not.toContain('gh api repos/{owner}/{repo}/deployments')
    expect(resolver).not.toContain('|| true')
    expect(resolverLines).toContain('sha="$(git rev-parse HEAD)"')
  })
})
