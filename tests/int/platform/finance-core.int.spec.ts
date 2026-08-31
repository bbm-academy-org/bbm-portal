// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  accountBalances,
  createAccount,
  createCategory,
  createCurrency,
  createProduct,
  createProject,
  createPurpose,
  deleteReferenceRow,
  FinanceAccessRefusal,
  FinanceRefusal,
  listAccounts,
  listCategories,
  listProjects,
  listRegister,
  postingsMissingOptionalProduct,
  recordOperation,
  retireReferenceRow,
  reverseOperation,
  systemAccount,
  updateAccount,
  updateCurrency,
  updatePurpose,
  updateReferenceRow,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { auditEventsFor, auditWatermark } from './audit-helpers'
import {
  ADMIN,
  APPROVER,
  fundProjectId,
  MEMBER,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * The finance ledger against the REAL `core` tables (spec
 * `docs/specs/338-ledger-core.md`, issue #356).
 *
 * This tier exists because half of what F1a promises IS the database: the
 * immutability of a recorded fact is a trigger, the `core.member` link is an SQL
 * foreign key written by hand in the migration, the fund row is a migration
 * seed, and «one system account per kind and currency» is a partial unique
 * index. A mock would assert the module's OPINION of all four.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database"), loaded from `.env`
 * by `vitest.setup.ts`. Run: `pnpm exec vitest run tests/int/platform`.
 */
const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

/** RUB and one bank account — the minimum a fact needs to exist. */
async function seedRubBank(name = 'Тинькофф RUB') {
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  return createAccount(ADMIN, { name, kind: 'bank', currency: 'RUB' })
}

/** One expense of 1000.00 RUB, balanced through the system expense account. */
async function recordExpense(options: {
  accountId: number
  projectId: number
  purposeId?: number
  productId?: number | null
  memberId?: number | null
  occurredOn?: string
  amount?: bigint
}) {
  const expense = await systemAccount(ADMIN, 'expense', 'RUB')
  const amount = options.amount ?? 100_000n
  return recordOperation(APPROVER, {
    occurredOn: options.occurredOn ?? '2026-08-26',
    source: 'manual',
    purposeId: options.purposeId ?? null,
    postings: [
      {
        accountId: expense.id,
        amount,
        currency: 'RUB',
        projectId: options.projectId,
        productId: options.productId ?? null,
        memberId: options.memberId ?? null,
      },
      { accountId: options.accountId, amount: -amount, currency: 'RUB' },
    ],
  })
}

describe('the reference tables (EARS-301…309)', () => {
  it('EARS-301: stores currencies, accounts, projects, products, purposes and categories', async () => {
    await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
    const account = await createAccount(ADMIN, { name: 'Карта THB', kind: 'card', currency: 'THB' })
    const project = await createProject(ADMIN, { name: 'Doctor.School' })
    const product = await createProduct(ADMIN, { projectId: project.id, name: 'Урок' })
    const purpose = await createPurpose(ADMIN, {
      name: 'Продакшн урока',
      productBinding: 'required',
    })
    const category = await createCategory(ADMIN, { name: 'Продакшн', allocable: true })

    expect(account.currency).toBe('THB')
    expect(product.projectId).toBe(project.id)
    expect(purpose.productBinding).toBe('required')
    expect(category.allocable).toBe(true)
  })

  it('EARS-302: a currency added with its precision accepts postings immediately, with no release', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const recorded = await recordExpense({ accountId: bank.id, projectId: fund })
    expect(recorded.postings).toHaveLength(2)
  })

  it('EARS-303: refuses a precision change once a posting exists in the currency, and allows it before', async () => {
    const bank = await seedRubBank()
    // Before any posting: the amounts it could restate do not exist yet.
    const relaxed = await updateCurrency(ADMIN, 'RUB', { precision: 4 })
    expect(relaxed.precision).toBe(4)
    await updateCurrency(ADMIN, 'RUB', { precision: 2 })

    await recordExpense({ accountId: bank.id, projectId: await fundProjectId() })
    await expect(updateCurrency(ADMIN, 'RUB', { precision: 6 })).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    await expect(updateCurrency(ADMIN, 'RUB', { precision: 6 })).rejects.toThrow(/EARS-303/)
    // A rename is untouched by the freeze — it restates nothing.
    const renamed = await updateCurrency(ADMIN, 'RUB', { name: 'Российский рубль' })
    expect(renamed.name).toBe('Российский рубль')
    expect(renamed.precision).toBe(2)
  })

  it('EARS-304: the migration seeds exactly one fund row, and it is neither retirable nor deletable', async () => {
    const result = await db.execute(
      sql`select id, name, is_fund from core.finance_project where is_fund`,
    )
    expect(result.rows).toHaveLength(1)
    expect((result.rows[0] as { name: string }).name).toBe('Фонд BBM')

    const fund = await fundProjectId()
    await expect(retireReferenceRow(ADMIN, 'project', fund)).rejects.toThrow(/EARS-304/)
    await expect(deleteReferenceRow(ADMIN, 'project', fund)).rejects.toThrow(/EARS-304/)
  })

  it('EARS-304: a second fund row cannot be created — createProject refuses the flag and the index refuses the row', async () => {
    await expect(
      createProject(ADMIN, { name: 'Второй фонд', isFund: true } as { name: string }),
    ).rejects.toThrow(/EARS-304/)
    await expect(
      db.execute(sql`insert into core.finance_project (name, is_fund) values ('Дубль', true)`),
    ).rejects.toThrow()
  })

  it('EARS-305: creates a system account on first need, exactly one per kind and currency', async () => {
    await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
    const first = await systemAccount(ADMIN, 'expense', 'RUB')
    const again = await systemAccount(ADMIN, 'expense', 'RUB')
    expect(again.id).toBe(first.id)
    expect(first.isSystem).toBe(true)

    await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
    const thb = await systemAccount(ADMIN, 'expense', 'THB')
    expect(thb.id).not.toBe(first.id)

    const systemAccounts = (await listAccounts()).filter((account) => account.isSystem)
    expect(systemAccounts).toHaveLength(2)
  })

  it('EARS-305: the cabinet cannot create, edit or retire a system account', async () => {
    await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
    await expect(
      createAccount(ADMIN, {
        name: 'Мой expense',
        kind: 'expense' as 'bank',
        currency: 'RUB',
      }),
    ).rejects.toThrow(/EARS-305/)
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')
    await expect(updateAccount(ADMIN, expense.id, { name: 'Иначе' })).rejects.toThrow(/EARS-305/)
    await expect(retireReferenceRow(ADMIN, 'account', expense.id)).rejects.toThrow(/EARS-305/)
  })

  it('EARS-306: a purpose declares its binding, and links to a category once the list is non-empty', async () => {
    // The list is empty, so the link is not demanded (EARS-307).
    const free = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'optional' })
    expect(free.categoryId).toBeNull()

    const category = await createCategory(ADMIN, { name: 'Инфраструктура', allocable: false })
    await expect(
      createPurpose(ADMIN, { name: 'Домены', productBinding: 'optional' }),
    ).rejects.toThrow(/EARS-306/)
    const linked = await createPurpose(ADMIN, {
      name: 'Домены',
      productBinding: 'optional',
      categoryId: category.id,
    })
    expect(linked.categoryId).toBe(category.id)

    await expect(
      createPurpose(ADMIN, {
        name: 'Что-то',
        productBinding: 'sometimes' as 'optional',
        categoryId: category.id,
      }),
    ).rejects.toThrow(/EARS-306/)
  })

  it('EARS-307: the expense category table ships empty — no migration, seed or fixture inserts one', async () => {
    expect(await listCategories()).toEqual([])
    const result = await db.execute(sql`select count(*)::int as count from core.finance_category`)
    expect(Number((result.rows[0] as { count: number }).count)).toBe(0)
  })

  it('EARS-308: a referenced row refuses deletion and offers retirement instead, and a retired row stays valid on history', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const recorded = await recordExpense({ accountId: bank.id, projectId: fund })

    await expect(deleteReferenceRow(ADMIN, 'currency', 'RUB')).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
    await expect(deleteReferenceRow(ADMIN, 'currency', 'RUB')).rejects.toThrow(/EARS-308/)
    await expect(deleteReferenceRow(ADMIN, 'account', bank.id)).rejects.toThrow(/EARS-308/)

    await retireReferenceRow(ADMIN, 'account', bank.id)
    // Still valid on what was recorded…
    const register = await listRegister()
    expect(register[0].operationId).toBe(recorded.id)
    expect(register[0].postings.map((posting) => posting.accountId)).toContain(bank.id)
    // …and no longer offered for new ones.
    expect((await listAccounts()).map((account) => account.id)).not.toContain(bank.id)
    await expect(recordExpense({ accountId: bank.id, projectId: fund })).rejects.toThrow(/EARS-308/)
  })

  it('EARS-308: a row nothing refers to is deletable outright', async () => {
    const project = await createProject(ADMIN, { name: 'Черновик' })
    await deleteReferenceRow(ADMIN, 'project', project.id)
    const result = await db.execute(
      sql`select count(*)::int as count from core.finance_project where id = ${project.id}`,
    )
    expect(Number((result.rows[0] as { count: number }).count)).toBe(0)
  })

  it('EARS-309: a reference edit never rewrites a posting — a rename changes how rows read, not what was recorded', async () => {
    const bank = await seedRubBank('Тинькофф')
    const fund = await fundProjectId()
    const recorded = await recordExpense({ accountId: bank.id, projectId: fund })
    const before = await db.execute(
      sql`select id, account_id, amount::text as amount, currency
            from core.finance_posting where operation_id = ${recorded.id} order by id`,
    )

    await updateAccount(ADMIN, bank.id, { name: 'Т-Банк' })
    await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
    await retireReferenceRow(ADMIN, 'currency', 'THB')

    const after = await db.execute(
      sql`select id, account_id, amount::text as amount, currency
            from core.finance_posting where operation_id = ${recorded.id} order by id`,
    )
    expect(after.rows).toEqual(before.rows)
    // The rename IS visible going forward.
    const bankLeg = (await listRegister())[0].postings.find(
      (posting) => posting.accountId === bank.id,
    )
    expect(bankLeg?.accountName).toBe('Т-Банк')
  })

  /**
   * EARS-326 — one cabinet act is ONE transaction.
   *
   * A `PATCH {name, retire: true}` is a single thing the admin did, so it either
   * lands whole or leaves no trace at all. Two transactions could commit the
   * rename and then refuse the retirement, handing back a 409 over an already
   * durable rename and two audit events for one act.
   */
  it('EARS-326: a rename whose retirement is refused leaves the name unchanged and writes no audit event', async () => {
    const fund = await fundProjectId()
    const mark = await auditWatermark(db)

    await expect(
      updateReferenceRow(ADMIN, {
        table: 'project',
        id: fund,
        patch: { name: 'Фонд BBM (переименован)' },
        retire: true,
      }),
    ).rejects.toThrow(/EARS-304/)

    const row = await db.execute(
      sql`select name, retired_at from core.finance_project where id = ${fund}`,
    )
    expect(row.rows[0]).toMatchObject({ name: 'Фонд BBM', retired_at: null })
    expect(await auditEventsFor(db, mark, 'finance_project')).toEqual([])
  })

  it('EARS-326: a rename whose retirement is refused rolls back for every resource, not only projects', async () => {
    await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')
    const mark = await auditWatermark(db)

    await expect(
      updateReferenceRow(ADMIN, {
        table: 'account',
        id: expense.id,
        patch: { name: 'Переименованный системный' },
        retire: true,
      }),
    ).rejects.toThrow(/EARS-305/)

    const row = await db.execute(
      sql`select name, retired_at from core.finance_account where id = ${expense.id}`,
    )
    expect(row.rows[0]).toMatchObject({ name: expense.name, retired_at: null })
    expect(await auditEventsFor(db, mark, 'finance_account')).toEqual([])
  })

  it('EARS-326: an accepted rename + retirement commits both and reports the retired row', async () => {
    const project = await createProject(ADMIN, { name: 'Черновик' })

    const updated = await updateReferenceRow(ADMIN, {
      table: 'project',
      id: project.id,
      patch: { name: 'Черновик 2026' },
      retire: true,
    })

    expect(updated).toMatchObject({ name: 'Черновик 2026' })
    expect(updated.retiredAt).not.toBeNull()
    expect((await listProjects()).map((row) => row.id)).not.toContain(project.id)
  })
})

/**
 * A refusal raised by a TRIGGER, not by the module.
 *
 * drizzle wraps a `pg` error in its own «Failed query: …», so the trigger's own
 * message — the one that tells a reader WHY the write was refused and what to do
 * instead — is on `error.cause`. Asserting the wrapper would pass for any broken
 * query at all, which is precisely what these clauses must not do.
 */
async function expectTriggerRefusal(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(work).rejects.toThrow()
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  )
  const cause = (error as { cause?: { message?: string } })?.cause
  expect(String(cause?.message ?? (error as Error)?.message)).toMatch(pattern)
}

describe('the fact core is immutable (EARS-313)', () => {
  it('EARS-313: the module exposes no way to update or delete a recorded fact', async () => {
    const api = await import('@/lib/finance')
    const mutators = Object.keys(api).filter((name) =>
      /^(update|delete|patch|edit|amend|reclassify)(Operation|Posting)/i.test(name),
    )
    expect(mutators).toEqual([])
  })

  it('EARS-313: the database refuses an UPDATE of a recorded operation and of a posting', async () => {
    const bank = await seedRubBank()
    const recorded = await recordExpense({ accountId: bank.id, projectId: await fundProjectId() })

    await expectTriggerRefusal(
      db.execute(
        sql`update core.finance_operation set occurred_on = '2020-01-01' where id = ${recorded.id}`,
      ),
      /EARS-313/,
    )
    await expectTriggerRefusal(
      db.execute(
        sql`update core.finance_posting set amount = 1 where id = ${recorded.postings[0].id}`,
      ),
      /EARS-313/,
    )
  })

  it('EARS-313: the database refuses a DELETE of a recorded operation and of a posting', async () => {
    const bank = await seedRubBank()
    const recorded = await recordExpense({ accountId: bank.id, projectId: await fundProjectId() })

    await expectTriggerRefusal(
      db.execute(sql`delete from core.finance_posting where id = ${recorded.postings[0].id}`),
      /EARS-313/,
    )
    await expectTriggerRefusal(
      db.execute(sql`delete from core.finance_operation where id = ${recorded.id}`),
      /EARS-313/,
    )
  })

  it('EARS-313: a ROW trigger does not fire on TRUNCATE, so the statement-level guard refuses that too', async () => {
    await expectTriggerRefusal(db.execute(sql`truncate table core.finance_posting`), /EARS-313/)
    // `cascade`, because Postgres refuses a bare TRUNCATE of a table another
    // one references BEFORE any trigger runs — so the bare form would prove the
    // foreign key, not the guard.
    await expectTriggerRefusal(
      db.execute(sql`truncate table core.finance_operation cascade`),
      /EARS-313/,
    )
  })
})

describe('reversal — сторно (EARS-314, EARS-315)', () => {
  it('EARS-314: mirrors the original with negated amounts and identical dimensions; both stay visible and sum to zero', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const member = await seedMember('anton@bbm.academy', 'Антон')
    const original = await recordExpense({
      accountId: bank.id,
      projectId: fund,
      memberId: member,
    })

    const reversal = await reverseOperation(APPROVER, original.id)
    expect(reversal.source).toBe('reversal')
    expect(reversal.reverses).toBe(original.id)

    const legs = await db.execute(sql`
      select operation_id, account_id, amount::text as amount, currency,
             project_id, category_id, product_id, member_id
        from core.finance_posting
       where operation_id in (${original.id}, ${reversal.id})
       order by operation_id, id
    `)
    const rows = legs.rows as Record<string, unknown>[]
    const originals = rows.filter((row) => Number(row.operation_id) === original.id)
    const mirrors = rows.filter((row) => Number(row.operation_id) === reversal.id)
    expect(mirrors).toHaveLength(originals.length)
    for (const [index, row] of originals.entries()) {
      const mirror = mirrors[index]
      expect(mirror.account_id).toEqual(row.account_id)
      expect(mirror.currency).toEqual(row.currency)
      expect(mirror.project_id).toEqual(row.project_id)
      expect(mirror.category_id).toEqual(row.category_id)
      expect(mirror.product_id).toEqual(row.product_id)
      expect(mirror.member_id).toEqual(row.member_id)
      expect(BigInt(String(mirror.amount))).toBe(-BigInt(String(row.amount)))
    }

    // Both remain visible, each pointing at the other.
    const register = await listRegister()
    expect(register.map((entry) => entry.operationId).sort()).toEqual(
      [original.id, reversal.id].sort(),
    )
    expect(register.find((e) => e.operationId === original.id)?.reversedBy).toBe(reversal.id)

    // And their sum is zero in every cut: every account is back at its start.
    for (const balance of await accountBalances()) {
      expect(balance.balance).toBe(0n)
    }
  })

  it('EARS-315: refuses a SECOND reversal of the same operation, naming the one that exists', async () => {
    const bank = await seedRubBank()
    const original = await recordExpense({ accountId: bank.id, projectId: await fundProjectId() })
    const reversal = await reverseOperation(APPROVER, original.id)

    await expect(reverseOperation(APPROVER, original.id)).rejects.toBeInstanceOf(FinanceRefusal)
    await expect(reverseOperation(APPROVER, original.id)).rejects.toThrow(
      new RegExp(`#${reversal.id}`),
    )
  })

  it('EARS-315: a reversal is itself reversible — that is how a mistaken сторно is undone', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const original = await recordExpense({ accountId: bank.id, projectId: fund })
    const reversal = await reverseOperation(APPROVER, original.id)
    const undo = await reverseOperation(APPROVER, reversal.id)

    expect(undo.reverses).toBe(reversal.id)
    const balances = await accountBalances()
    const bankBalance = balances.find((row) => row.accountId === bank.id)
    expect(bankBalance?.balance).toBe(-100_000n)
  })
})

describe('provenance and the absence of an opening balance (EARS-316, EARS-317)', () => {
  it('EARS-316: every operation carries one of the six sources, and a backfill can be flagged backdated', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')
    const backfilled = await recordOperation(APPROVER, {
      occurredOn: '2025-01-15',
      source: 'backfill',
      backdated: true,
      sourceRef: 'выписка 2025-01',
      postings: [
        { accountId: expense.id, amount: 5_000n, currency: 'RUB', projectId: fund },
        { accountId: bank.id, amount: -5_000n, currency: 'RUB' },
      ],
    })
    expect(backfilled.source).toBe('backfill')
    expect(backfilled.backdated).toBe(true)
    expect(backfilled.sourceRef).toBe('выписка 2025-01')

    await expect(
      db.execute(
        sql`insert into core.finance_operation (occurred_on, source) values ('2026-01-01', 'invented')`,
      ),
    ).rejects.toThrow()
    // `reversal` is not a source a caller may claim — only a сторно wears it.
    await expect(
      recordOperation(APPROVER, {
        occurredOn: '2026-01-01',
        source: 'reversal',
        postings: [
          { accountId: expense.id, amount: 1n, currency: 'RUB', projectId: fund },
          { accountId: bank.id, amount: -1n, currency: 'RUB' },
        ],
      }),
    ).rejects.toThrow(/EARS-314/)
  })

  it('EARS-317: every account starts at zero and its balance is exclusively the sum of its postings', async () => {
    const bank = await seedRubBank()
    expect((await accountBalances()).find((row) => row.accountId === bank.id)?.balance).toBe(0n)

    const api = await import('@/lib/finance')
    const openings = Object.keys(api).filter((name) =>
      /opening|initialBalance|setBalance/i.test(name),
    )
    expect(openings).toEqual([])

    await recordExpense({ accountId: bank.id, projectId: await fundProjectId(), amount: 42_000n })
    expect((await accountBalances()).find((row) => row.accountId === bank.id)?.balance).toBe(
      -42_000n,
    )
  })
})

describe('the person dimension (EARS-322)', () => {
  it('EARS-322: `finance_posting.member_id` is an SQL FK to core.member with ON DELETE RESTRICT', async () => {
    // `pg_catalog`, not `information_schema`: the SQL-standard views are
    // privilege-filtered by table ownership, and since #278 `core` is owned by
    // the migrating role while the application connects as another.
    const constraints = (
      await db.execute(sql`
        select con.conname as constraint_name,
               rel.relname as table_name,
               att.attname as column_name,
               case con.confdeltype
                 when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                 when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
               end as delete_rule,
               ref.relname as foreign_table
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          join pg_class ref on ref.oid = con.confrelid
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
         where con.contype = 'f'
           and rel.relnamespace = 'core'::regnamespace
           and rel.relname like 'finance_%'
           and ref.relname = 'member'
         order by rel.relname
      `)
    ).rows as Array<{ table_name: string; column_name: string; delete_rule: string }>

    // Every finance → `core.member` link, sorted, with its delete rule. The F2
    // intake spine (#381) added five: an intake item records who filed it, who
    // decided and who posted, and a counterparty records who created it — all of
    // them RESTRICT for the same reason the posting's is, so the registry cannot
    // delete a person out from under an act recorded to their name. Documents
    // (#382) added two more on the same rule: an upload and an attachment are
    // each an act with a name on it. A purpose proposal (#383) adds its proposer
    // for the same reason.
    expect(
      constraints.map((row) => `${row.table_name}.${row.column_name} → ${row.delete_rule}`).sort(),
    ).toEqual([
      'finance_counterparty.created_by → RESTRICT',
      'finance_document.uploaded_by → RESTRICT',
      'finance_document_link.linked_by → RESTRICT',
      'finance_intake_item.created_by → RESTRICT',
      'finance_intake_item.decided_by → RESTRICT',
      'finance_intake_item.member_id → RESTRICT',
      'finance_intake_item.posted_by → RESTRICT',
      'finance_posting.member_id → RESTRICT',
      'finance_purpose_proposal.proposed_by → RESTRICT',
    ])
  })

  it('EARS-322: "what did we pay X" is a query, and the registry cannot delete a person out from under it', async () => {
    const bank = await seedRubBank()
    const member = await seedMember('anton@bbm.academy', 'Антон')
    await recordExpense({
      accountId: bank.id,
      projectId: await fundProjectId(),
      memberId: member,
      amount: 250_000n,
    })

    const paid = await db.execute(sql`
      select coalesce(sum(amount), 0)::text as total
        from core.finance_posting where member_id = ${member}
    `)
    expect((paid.rows[0] as { total: string }).total).toBe('250000')
    await expect(db.execute(sql`delete from core.member where id = ${member}`)).rejects.toThrow()
  })
})

describe('the purpose governs the dimensions (EARS-320, EARS-327, EARS-331, EARS-332)', () => {
  it('EARS-320: a `required` purpose refuses an operation with no product, a `forbidden` one refuses a product', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const project = await createProject(ADMIN, { name: 'Doctor.School' })
    const product = await createProduct(ADMIN, { projectId: project.id, name: 'Урок' })
    const required = await createPurpose(ADMIN, {
      name: 'Продакшн урока',
      productBinding: 'required',
    })
    const forbidden = await createPurpose(ADMIN, {
      name: 'Аренда офиса',
      productBinding: 'forbidden',
    })

    await expect(
      recordExpense({ accountId: bank.id, projectId: fund, purposeId: required.id }),
    ).rejects.toThrow(/EARS-320/)
    const ok = await recordExpense({
      accountId: bank.id,
      projectId: project.id,
      purposeId: required.id,
      productId: product.id,
    })
    expect(ok.postings).toHaveLength(2)

    await expect(
      recordExpense({
        accountId: bank.id,
        projectId: project.id,
        purposeId: forbidden.id,
        productId: product.id,
      }),
    ).rejects.toThrow(/EARS-320/)
  })

  it("EARS-327: sets the purpose's category on the expense-side posting itself, and refuses a differing one", async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const category = await createCategory(ADMIN, { name: 'Инфраструктура', allocable: false })
    const other = await createCategory(ADMIN, { name: 'Маркетинг', allocable: false })
    const purpose = await createPurpose(ADMIN, {
      name: 'Хостинг',
      productBinding: 'forbidden',
      categoryId: category.id,
    })
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')

    const recorded = await recordOperation(APPROVER, {
      occurredOn: '2026-08-26',
      source: 'manual',
      purposeId: purpose.id,
      postings: [
        { accountId: expense.id, amount: 3_000n, currency: 'RUB', projectId: fund },
        { accountId: bank.id, amount: -3_000n, currency: 'RUB' },
      ],
    })
    const rows = await db.execute(
      sql`select account_id, category_id from core.finance_posting where operation_id = ${recorded.id} order by id`,
    )
    const byAccount = new Map(
      (rows.rows as Record<string, unknown>[]).map((row) => [
        Number(row.account_id),
        row.category_id === null ? null : Number(row.category_id),
      ]),
    )
    expect(byAccount.get(expense.id)).toBe(category.id)
    // The money leg carries no category — the dimension rides the result leg.
    expect(byAccount.get(bank.id)).toBeNull()

    await expect(
      recordOperation(APPROVER, {
        occurredOn: '2026-08-26',
        source: 'manual',
        purposeId: purpose.id,
        postings: [
          {
            accountId: expense.id,
            amount: 3_000n,
            currency: 'RUB',
            projectId: fund,
            categoryId: other.id,
          },
          { accountId: bank.id, amount: -3_000n, currency: 'RUB' },
        ],
      }),
    ).rejects.toThrow(/EARS-327/)
  })

  it('EARS-331: the operator supplies the product VALUE and never the binding — an operation carrying one is refused', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')

    await expect(
      recordOperation(APPROVER, {
        occurredOn: '2026-08-26',
        source: 'manual',
        purposeId: purpose.id,
        productBinding: 'optional',
        postings: [
          { accountId: expense.id, amount: 1_000n, currency: 'RUB', projectId: fund },
          { accountId: bank.id, amount: -1_000n, currency: 'RUB' },
        ],
      } as never),
    ).rejects.toThrow(/EARS-331/)

    // Changing it IS an edit of the purpose, and the audit ledger records it.
    const changed = await updatePurpose(ADMIN, purpose.id, { productBinding: 'required' })
    expect(changed.productBinding).toBe('required')
    const audited = await db.execute(sql`
      select diff, actor_email from core.audit_event
       where table_name = 'finance_purpose' and diff ? 'product_binding'
       order by id desc limit 1
    `)
    expect(audited.rows).toHaveLength(1)
    expect((audited.rows[0] as { actor_email: string }).actor_email).toBe(ADMIN.email)
    expect((audited.rows[0] as { diff: Record<string, unknown> }).diff.product_binding).toEqual({
      old: 'forbidden',
      new: 'required',
    })
  })

  it('EARS-332: a binding change leaves every already-recorded posting exactly as posted', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'optional' })
    const recorded = await recordExpense({
      accountId: bank.id,
      projectId: fund,
      purposeId: purpose.id,
    })
    const before = await db.execute(
      sql`select * from core.finance_posting where operation_id = ${recorded.id} order by id`,
    )

    // The new rule would have refused this very operation…
    await updatePurpose(ADMIN, purpose.id, { productBinding: 'required' })
    // …and history stands exactly as posted: nothing rewritten, nothing revalidated.
    const after = await db.execute(
      sql`select * from core.finance_posting where operation_id = ${recorded.id} order by id`,
    )
    expect(after.rows).toEqual(before.rows)
    expect((await listRegister())[0].operationId).toBe(recorded.id)
  })
})

describe('the exception list and the absence of allocation (EARS-333, EARS-334)', () => {
  it('EARS-333: lists postings on an `optional`-binding purpose that carry no product, and only those', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const project = await createProject(ADMIN, { name: 'Doctor.School' })
    const product = await createProduct(ADMIN, { projectId: project.id, name: 'Урок' })
    const optional = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'optional' })
    const forbidden = await createPurpose(ADMIN, { name: 'Аренда', productBinding: 'forbidden' })

    const missing = await recordExpense({
      accountId: bank.id,
      projectId: fund,
      purposeId: optional.id,
      amount: 7_000n,
    })
    // Named — not an exception.
    await recordExpense({
      accountId: bank.id,
      projectId: project.id,
      purposeId: optional.id,
      productId: product.id,
      amount: 9_000n,
    })
    // A `forbidden` purpose has no product BY RULE — never an exception.
    await recordExpense({
      accountId: bank.id,
      projectId: fund,
      purposeId: forbidden.id,
      amount: 3_000n,
    })

    const exceptions = await postingsMissingOptionalProduct()
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0].operationId).toBe(missing.id)
    expect(exceptions[0].purposeName).toBe('Хостинг')
    expect(exceptions[0].amount).toBe(7_000n)
  })

  it('EARS-334: the module posts no allocation — no such function exists, and no posting appears without one being recorded', async () => {
    const api = await import('@/lib/finance')
    const allocators = Object.keys(api).filter((name) =>
      /alloc|absorb|apportion|overheadRate|driverRun/i.test(name),
    )
    expect(allocators).toEqual([])

    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const project = await createProject(ADMIN, { name: 'Doctor.School' })
    const product = await createProduct(ADMIN, { projectId: project.id, name: 'Урок' })
    // A period cost of the fund, recorded with no product.
    await recordExpense({ accountId: bank.id, projectId: fund, amount: 100_000n })

    // No process spreads it onto the product: the product's cost stays exactly
    // what was recorded against it, which here is nothing.
    const onProduct = await db.execute(
      sql`select coalesce(sum(amount), 0)::text as total
            from core.finance_posting where product_id = ${product.id}`,
    )
    expect((onProduct.rows[0] as { total: string }).total).toBe('0')
    const postingCount = await db.execute(
      sql`select count(*)::int as count from core.finance_posting`,
    )
    expect(Number((postingCount.rows[0] as { count: number }).count)).toBe(2)
  })
})

describe('the write gates against the real tables (EARS-330, EARS-501, EARS-529, EARS-530)', () => {
  it('EARS-330: refuses every reference edit for a session that does not carry `platform-admin`', async () => {
    const bank = await seedRubBank()

    const refusals = [
      createCurrency(MEMBER, { code: 'THB', name: 'Бат', precision: 2 }),
      createAccount(MEMBER, { name: 'Карта', kind: 'card', currency: 'RUB' }),
      createProject(MEMBER, { name: 'Проект' }),
      createPurpose(MEMBER, { name: 'Назначение', productBinding: 'optional' }),
      createCategory(MEMBER, { name: 'Статья', allocable: true }),
      retireReferenceRow(MEMBER, 'account', bank.id),
      deleteReferenceRow(MEMBER, 'account', bank.id),
      updatePurpose(MEMBER, 1, { name: 'Иначе' }),
      // The flow roles are not reference administration either (EARS-529).
      createProject(APPROVER, { name: 'Проект' }),
      systemAccount(APPROVER, 'expense', 'RUB'),
    ]
    for (const refusal of refusals) {
      await expect(refusal).rejects.toBeInstanceOf(FinanceAccessRefusal)
    }
  })

  it('EARS-501: refuses recording and reversing for a session carrying neither flow role', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const recorded = await recordExpense({ accountId: bank.id, projectId: fund })
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')
    const draft = {
      occurredOn: '2026-08-26',
      source: 'manual' as const,
      postings: [
        { accountId: expense.id, amount: 1n, currency: 'RUB', projectId: fund },
        { accountId: bank.id, amount: -1n, currency: 'RUB' },
      ],
    }

    await expect(recordOperation(MEMBER, draft)).rejects.toBeInstanceOf(FinanceAccessRefusal)
    await expect(reverseOperation(MEMBER, recorded.id)).rejects.toBeInstanceOf(FinanceAccessRefusal)
  })

  it('EARS-529: an admin without `finance-approve` is refused posting and reversal, and nothing lands', async () => {
    const bank = await seedRubBank()
    const fund = await fundProjectId()
    const recorded = await recordExpense({ accountId: bank.id, projectId: fund })
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')
    const before = await listRegister()

    await expect(
      recordOperation(ADMIN, {
        occurredOn: '2026-08-26',
        source: 'manual',
        postings: [
          { accountId: expense.id, amount: 1n, currency: 'RUB', projectId: fund },
          { accountId: bank.id, amount: -1n, currency: 'RUB' },
        ],
      }),
    ).rejects.toBeInstanceOf(FinanceAccessRefusal)
    await expect(reverseOperation(ADMIN, recorded.id)).rejects.toBeInstanceOf(FinanceAccessRefusal)
    // The refusal is a refusal, not a half-write: the register is untouched.
    expect(await listRegister()).toHaveLength(before.length)
  })

  it('EARS-530: reading is deliberately wider — balances and the register need no actor at all', async () => {
    const bank = await seedRubBank()
    await recordExpense({ accountId: bank.id, projectId: await fundProjectId() })
    expect(await accountBalances()).not.toHaveLength(0)
    expect(await listRegister()).toHaveLength(1)
    expect(await postingsMissingOptionalProduct()).toEqual([])
  })
})
