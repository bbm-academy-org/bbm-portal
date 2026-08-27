/**
 * The pluggable source layer (spec `docs/specs/339-ledger-intake.md` §B,
 * EARS-503 and EARS-525).
 *
 * **What «pluggable» has to mean to be worth anything.** EARS-525: «adding a
 * future source shall add a producer of intake items and change no other source
 * and no posting path». That is a statement about SHAPE, and it is only true if
 * the spine looks a source up instead of branching on it. So there is exactly
 * one registry here, `resolveIntakeSourceRef` is the single entry point every
 * create path uses, and nothing in `./items.ts` says the word `bank_import`.
 * A future bank API registers a producer and is done; a `switch` on `source`
 * anywhere in the spine would be the regression this file exists to prevent.
 *
 * (The DATABASE enum is a separate, deliberate story: `finance_intake_item.source`
 * carries a CHECK over the four sources spec 339 fixes, so a genuinely new source
 * also needs a migration widening it. That is a schema decision with its own
 * review, not a spine change — the producer is what the MODULE needs, and the
 * clause is about the module.)
 *
 * **EARS-503's semantics, per source.** `bank_import` — the statement line's
 * stable identity, always. `backfill` — always, and composed in a fixed order:
 * the document's number, else the Mattermost post id, else a deterministic
 * natural key. `manual` and `request` — none: a human act has no external
 * identity to deduplicate on, and inventing one would make two genuinely
 * separate typings of the same expense collide.
 */
import { FinanceRefusal } from '../core/errors'

/** Whether this source's items carry an external identity at all (EARS-503). */
export type FinanceIntakeSourceRefPolicy = 'none' | 'required'

/**
 * The natural key a backfill row falls back to (EARS-503, scenario 6).
 *
 * Date + account + amount + counterparty, which is what the entry surface can
 * always compose from a Mattermost receipt that has neither a document number
 * nor a usable post id.
 */
export type FinanceIntakeNaturalKey = {
  occurredOn: string
  accountId?: number | null
  amount: bigint
  counterpartyId?: number | null
}

/** Everything a producer may be given to derive its ref from. */
export type FinanceIntakeRefInput = {
  /** Supplied verbatim — the statement line identity, or an explicit ref. */
  sourceRef?: string | null
  documentNumber?: string | null
  mattermostPostId?: string | null
  natural?: FinanceIntakeNaturalKey
}

/**
 * One source's plug into the spine. A producer is DATA plus at most one
 * function; it never writes a row itself — the spine does — which is what keeps
 * «adding a source changes no posting path» true.
 */
export type FinanceIntakeProducer = {
  source: string
  sourceRefPolicy: FinanceIntakeSourceRefPolicy
  /** How this source composes its ref when none was handed in. */
  deriveSourceRef?: (input: FinanceIntakeRefInput) => string | null
}

const producers = new Map<string, FinanceIntakeProducer>()

export function registerIntakeProducer(producer: FinanceIntakeProducer): void {
  producers.set(producer.source, { ...producer })
}

export function listIntakeProducers(): FinanceIntakeProducer[] {
  return [...producers.values()].map((producer) => ({ ...producer }))
}

/**
 * The producer for a source, or a refusal NAMING the unknown source.
 *
 * A source is registered, never guessed: a typo that fell through as «probably
 * manual» would file items nothing deduplicates.
 */
export function resolveIntakeProducer(source: string): FinanceIntakeProducer {
  const producer = producers.get(source)
  if (producer === undefined) {
    throw new FinanceRefusal(
      `Источник «${source}» не зарегистрирован в приёмке (EARS-503/525). ` +
        `Известные источники: ${[...producers.keys()].join(', ')}. ` +
        'Новый источник — это новый producer, а не ветка в общем коде.',
    )
  }
  return producer
}

/** The deterministic natural key — the same history composes the same string. */
function naturalKey(key: FinanceIntakeNaturalKey): string {
  return [
    'nat',
    key.occurredOn,
    key.accountId ?? 'personal',
    key.amount.toString(),
    key.counterpartyId ?? 'none',
  ].join('|')
}

/**
 * The backfill ref, in the spec's fixed order of preference (EARS-503).
 *
 * The ORDER is the clause, not a heuristic: a document number identifies the
 * fact for a human too, a post id identifies the corpus entry, and the natural
 * key is what remains when neither exists. Re-running the same history composes
 * the same string at every level, which is what makes EARS-504 able to refuse
 * the second pass.
 */
export function backfillSourceRef(input: FinanceIntakeRefInput & FinanceIntakeNaturalKey): string {
  const documentNumber = (input.documentNumber ?? '').trim()
  if (documentNumber !== '') return documentNumber
  const postId = (input.mattermostPostId ?? '').trim()
  if (postId !== '') return postId
  return naturalKey(input)
}

/**
 * The spine's single ref step — every create path calls THIS, whatever the
 * source (EARS-503/525).
 *
 * Returns `null` for a source whose policy is `none`, the derived ref for one
 * whose policy is `required`, and refuses in the two cases that would corrupt
 * deduplication: a human source that was handed a ref (it would occupy an
 * identity space that is supposed to be empty), and a machine source that could
 * not produce one (it would land ref-less and double-post on the next run).
 */
export function resolveIntakeSourceRef(
  source: string,
  input: FinanceIntakeRefInput,
): string | null {
  const producer = resolveIntakeProducer(source)
  const handed = (input.sourceRef ?? '').trim()

  if (producer.sourceRefPolicy === 'none') {
    if (handed !== '') {
      throw new FinanceRefusal(
        `Источник «${source}» не имеет внешнего идентификатора: source_ref для него не ` +
          'задаётся (EARS-503). Человеческое действие нечем дедуплицировать — две отдельные ' +
          'заявки на один и тот же расход это две заявки, а не дубль.',
      )
    }
    return null
  }

  const derived = handed !== '' ? handed : (producer.deriveSourceRef?.(input) ?? null)
  if (derived === null || derived.trim() === '') {
    throw new FinanceRefusal(
      `Источник «${source}» обязан приносить source_ref (EARS-503): без него повторный ` +
        'разбор той же истории провёл бы её второй раз (EARS-504). Для backfill это номер ' +
        'документа, иначе id поста Mattermost, иначе естественный ключ ' +
        '(дата + счёт + сумма + контрагент).',
    )
  }
  return derived.trim()
}

// ── the four producers spec 339 fixes (EARS-503) ─────────────────────────────
//
// Registered here, at module load, and each is a table row rather than a branch.
// A fifth one is added the same way — by `registerIntakeProducer`, from wherever
// that source lives — and nothing above changes.

registerIntakeProducer({ source: 'request', sourceRefPolicy: 'none' })
registerIntakeProducer({ source: 'manual', sourceRefPolicy: 'none' })
registerIntakeProducer({
  source: 'backfill',
  sourceRefPolicy: 'required',
  deriveSourceRef: (input) =>
    input.natural === undefined ? null : backfillSourceRef({ ...input, ...input.natural }),
})
// The statement line's stable identity is the PARSER's output — there is nothing
// to derive here, which is why this producer has no `deriveSourceRef` and the
// spine refuses a `bank_import` line that arrived without one. The format parser
// itself is spec 339 §G and is deliberately unbuilt until real statements exist.
registerIntakeProducer({ source: 'bank_import', sourceRefPolicy: 'required' })
