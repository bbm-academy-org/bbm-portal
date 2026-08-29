/** Counterparty reference behavior (spec 339 EARS-532, issue #383). */
import { asc, eq, sql } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import { getPlatformDb } from '@/lib/platform/db/client'
import { financeCounterparty } from '@/lib/platform/db/schema/finance/finance-counterparty'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import {
  assertFinanceIntakeAccess,
  assertFinanceReferenceAccess,
  financeAuditContext,
  type FinanceActor,
} from './core/actor'
import { FinanceAccessRefusal, FinanceRefusal } from './core/errors'

export type FinanceCounterpartyView = {
  id: number
  name: string
  createdBy: number
  createdAt: Date
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FinanceRefusal('Контрагента без названия не создать: название обязательно.')
  }
  return value.trim()
}

function normalizedEquals(value: string) {
  return sql`lower(btrim(${financeCounterparty.name})) = ${value.trim().toLowerCase()}`
}

async function requireMemberId(actor: FinanceActor): Promise<number> {
  const member = await findMemberByEmail(actor.email)
  if (member === null) {
    throw new FinanceAccessRefusal(
      `У ${actor.email} нет записи в общем реестре людей (core.member), а создание ` +
        'контрагента обязано называть автора. Заведите участника — src/lib/member.',
    )
  }
  return member.id
}

async function requireCounterparty(
  tx: PlatformTx,
  id: number,
): Promise<typeof financeCounterparty.$inferSelect> {
  const [row] = await tx
    .select()
    .from(financeCounterparty)
    .where(eq(financeCounterparty.id, id))
    .for('update')
  if (row === undefined) throw new FinanceRefusal(`Контрагента #${id} нет в справочнике.`)
  return row
}

/** Every finance reader sees the shared reference; the surface authenticates the read. */
export async function listCounterparties(): Promise<FinanceCounterpartyView[]> {
  return getPlatformDb().select().from(financeCounterparty).orderBy(asc(financeCounterparty.id))
}

/** Any platform submitter may add the name inline; the write remains attributable. */
export async function createCounterparty(
  actor: FinanceActor,
  input: { name: string },
): Promise<FinanceCounterpartyView> {
  assertFinanceIntakeAccess(actor, { ownRequest: true })
  const name = requireName(input.name)
  const createdBy = await requireMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const [row] = await tx
      .insert(financeCounterparty)
      .values({ name, createdBy })
      .onConflictDoNothing()
      .returning()
    if (row !== undefined) return row

    const [existing] = await tx.select().from(financeCounterparty).where(normalizedEquals(name))
    if (existing !== undefined) {
      throw new FinanceRefusal(
        `Контрагент «${existing.name}» уже есть в справочнике: названия не различаются ` +
          'регистром и пробелами по краям (EARS-532).',
      )
    }
    throw new FinanceRefusal(`Контрагента «${name}» не удалось создать.`)
  })
}

/** Rename is reference administration and therefore remains platform-admin only. */
export async function renameCounterparty(
  actor: FinanceActor,
  id: number,
  patch: { name: string },
): Promise<FinanceCounterpartyView> {
  assertFinanceReferenceAccess(actor)
  const name = requireName(patch.name)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireCounterparty(tx, id)
    const [collision] = await tx.select().from(financeCounterparty).where(normalizedEquals(name))
    if (collision !== undefined && collision.id !== id) {
      throw new FinanceRefusal(
        `Контрагент «${collision.name}» уже есть в справочнике: дубликат создать нельзя ` +
          '(EARS-532). Слияние дублей не входит в v1.',
      )
    }
    if (current.name === name) return current
    const [updated] = await tx
      .update(financeCounterparty)
      .set({ name })
      .where(eq(financeCounterparty.id, id))
      .returning()
    return updated
  })
}
