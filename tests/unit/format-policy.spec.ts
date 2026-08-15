import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { check } from 'prettier'
import { describe, expect, it } from 'vitest'

const prettierConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', '..', '.prettierrc.json'), 'utf8'),
)

describe('canonical Prettier policy on cross-platform checkouts', () => {
  it('accepts a CRLF-only difference', async () => {
    expect(
      await check("const value = 'already formatted'\r\n", {
        ...prettierConfig,
        filepath: 'fixture.ts',
      }),
    ).toBe(true)
  })

  it('still rejects a substantive formatting violation', async () => {
    expect(
      await check('const value={nested:true}\r\n', {
        ...prettierConfig,
        filepath: 'fixture.ts',
      }),
    ).toBe(false)
  })
})
