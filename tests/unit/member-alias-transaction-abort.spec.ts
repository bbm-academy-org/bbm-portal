import { describe, expect, it, vi } from 'vitest'

import { createMemberAlias, updateMemberAlias, type MemberDb } from '@/lib/member'

function uniqueViolation() {
  return new Error('query failed', {
    cause: Object.assign(new Error('duplicate'), { code: '23505' }),
  })
}

function conflictDb(write: 'insert' | 'update') {
  const select = vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
  }))
  const insert = vi.fn(() => ({
    values: () => ({ returning: async () => Promise.reject(uniqueViolation()) }),
  }))
  const update = vi.fn(() => ({
    set: () => ({
      where: () => ({ returning: async () => Promise.reject(uniqueViolation()) }),
    }),
  }))
  const db = {
    select,
    insert,
    update,
    delete: vi.fn(),
  } as unknown as MemberDb

  if (write === 'insert')
    update.mockImplementation(() => {
      throw new Error('unexpected update')
    })
  else
    insert.mockImplementation(() => {
      throw new Error('unexpected insert')
    })

  return { db, select }
}

describe('member alias unique-race transaction boundary', () => {
  it('does not query an aborted transaction after a rejected insert', async () => {
    const { db, select } = conflictDb('insert')

    await expect(
      createMemberAlias(7, { kind: 'mattermost', value: ' ANNA ' }, { db }),
    ).rejects.toMatchObject({
      name: 'MemberAliasUniqueConflictError',
      kind: 'mattermost',
      value: 'anna',
    })
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('does not query an aborted transaction after a rejected update', async () => {
    const { db, select } = conflictDb('update')

    await expect(
      updateMemberAlias(7, 11, { kind: 'telegram', value: ' ANNA_BBM ' }, { db }),
    ).rejects.toMatchObject({
      name: 'MemberAliasUniqueConflictError',
      kind: 'telegram',
      value: 'anna_bbm',
      exceptAliasId: 11,
    })
    expect(select).toHaveBeenCalledTimes(1)
  })
})
