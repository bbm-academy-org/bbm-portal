// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { parseFxSyncArgv } from '../../tools/platform/finance-fx-sync'

/** `pnpm platform:finance:fx:sync` argument handling (spec 339 §I, EARS-552, #548). */
describe('platform:finance:fx:sync arguments (EARS-552)', () => {
  it('EARS-552: no arguments means the default range — last stored date … today', () => {
    expect(parseFxSyncArgv([])).toEqual({})
  })

  it('EARS-552: --from / --to select a backfill range', () => {
    expect(parseFxSyncArgv(['--from', '2026-09-01', '--to', '2026-11-17'])).toEqual({
      from: '2026-09-01',
      to: '2026-11-17',
    })
  })

  it('EARS-552: a malformed date or an unknown flag is refused before anything runs', () => {
    expect(() => parseFxSyncArgv(['--from', '01/09/2026'])).toThrow(/YYYY-MM-DD/)
    expect(() => parseFxSyncArgv(['--from'])).toThrow(/YYYY-MM-DD/)
    expect(() => parseFxSyncArgv(['--days', '3'])).toThrow(/unknown argument/)
  })
})
