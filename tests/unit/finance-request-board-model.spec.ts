import { describe, expect, it } from 'vitest'

import {
  FINANCE_REQUEST_BOARD_STATUSES,
  planRequestDrop,
} from '@/app/(platform)/p/finance/requests/request-board-model'

describe('request-board status machine (spec 339 EARS-510/511/512/524)', () => {
  it('EARS-510/511/512: maps every legal drag to the act that must still be confirmed', () => {
    expect(planRequestDrop('submitted', 'approved')).toEqual({ type: 'act', act: 'approve' })
    expect(planRequestDrop('submitted', 'refused')).toEqual({ type: 'act', act: 'refuse' })
    expect(planRequestDrop('approved', 'posted')).toEqual({ type: 'act', act: 'confirm' })
    expect(planRequestDrop('approved', 'refused')).toEqual({ type: 'act', act: 'refuse' })
  })

  it('EARS-524: refuses illegal and terminal drags on the client without pretending the status changed', () => {
    for (const status of FINANCE_REQUEST_BOARD_STATUSES) {
      expect(planRequestDrop('posted', status)).toMatchObject({ type: 'refused' })
      expect(planRequestDrop('refused', status)).toMatchObject({ type: 'refused' })
    }
    expect(planRequestDrop('submitted', 'posted')).toMatchObject({ type: 'refused' })
    expect(planRequestDrop('approved', 'submitted')).toMatchObject({ type: 'refused' })
  })
})
