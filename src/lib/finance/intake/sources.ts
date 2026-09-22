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
 * natural key. `manual` and `request` — OPTIONAL since 2026-09-22 (#517, owner
 * go, Антон).
 *
 * That last arm used to read «none», and the reason it gave was sound about the
 * ACT and wrong about the RECORD: a human act has no external identity to
 * deduplicate on, so nothing may be INVENTED for it — but a request is typed
 * somewhere before it reaches the intake (a Mattermost post, a ticket, a
 * message), and the link to that place is exactly what the submitter and every
 * later reader want to follow. Forbidding the column is why 47 reconstructed
 * requests carried their post id as free text inside `note`, which the owner
 * read as «просто заметка в комментарии».
 *
 * Nothing about deduplication weakens: an optional ref is never DERIVED, only
 * accepted verbatim from the producer, so two separate typings of the same
 * expense still land as two items. And when a ref IS present the partial unique
 * index still holds — two requests cannot name one post.
 */
import { FinanceRefusal } from '../core/errors'

/**
 * Whether this source's items carry an external identity (EARS-503).
 *
 * `none` — the source has no identity space at all and a handed ref is refused.
 * `optional` — a ref is accepted verbatim when the producer has one and never
 * derived when it has not. `required` — a ref is mandatory and the create is
 * refused without one.
 *
 * No source ships with `none` today; the value stays because it is the honest
 * answer for a producer that genuinely has no external identity, and removing
 * it would force such a producer to pretend otherwise.
 */
export type FinanceIntakeSourceRefPolicy = 'none' | 'optional' | 'required'

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

  // OPTIONAL never DERIVES (#517). The producer's `deriveSourceRef` composes an
  // identity out of the row's own facts, and doing that for a human source is
  // the very thing EARS-503 rules out: two separate typings of one expense
  // would collide on a key neither person asked for. So an optional source
  // stores the link it was handed and nothing else.
  if (producer.sourceRefPolicy === 'optional') {
    if (handed === '') return null
    return assertRefLength(source, handed)
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
  return assertRefLength(source, derived.trim())
}

/**
 * The one shape rule a ref of ANY source obeys: it is an identity, not a
 * document.
 *
 * `source_ref` is `text`, so Postgres would take a pasted essay and put it in
 * the unique index. The limit is the same 2048 the request form's schema
 * states — the longest URL every browser and proxy in the chain handles — and
 * it lives here as well because the form is one producer of many.
 */
export const FINANCE_INTAKE_SOURCE_REF_MAX = 2048

function assertRefLength(source: string, ref: string): string {
  if (ref.length > FINANCE_INTAKE_SOURCE_REF_MAX) {
    throw new FinanceRefusal(
      `Ссылка на источник для «${source}» длиннее ${FINANCE_INTAKE_SOURCE_REF_MAX} символов ` +
        '(EARS-503): source_ref — это идентификатор записи, а не её содержимое.',
    )
  }
  return ref
}

// ── the four producers spec 339 fixes (EARS-503) ─────────────────────────────
//
// Registered here, at module load, and each is a table row rather than a branch.
// A fifth one is added the same way — by `registerIntakeProducer`, from wherever
// that source lives — and nothing above changes.

// `request` and `manual` take the link they are given and never invent one
// (#517). See «EARS-503's semantics, per source» above for why the arm moved
// from `none` to `optional` on 2026-09-22.
registerIntakeProducer({ source: 'request', sourceRefPolicy: 'optional' })
registerIntakeProducer({ source: 'manual', sourceRefPolicy: 'optional' })
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
