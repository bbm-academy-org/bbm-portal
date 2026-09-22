import { z } from 'zod'

import type {
  CreateRequestBody,
  RequestBoardItem,
  RequestBoardReferences,
} from './request-board-contract'
import { currencyPrecision } from './request-board-model'

/**
 * The EARS-508 field contract of the request form, in ONE place.
 *
 * WHY A SCHEMA AND NOT AN `if` LADDER. The rules here are not «required» flags:
 * `personal_funds` is accepted only together with `already_paid` and only with
 * NO company account (EARS-513); a purpose comes from the reference OR as a
 * proposal, never both and never neither (EARS-526); a counterparty is picked
 * or created inline (EARS-532); the account-side amount is demanded exactly
 * when the paying account is in another currency. Written as one zod schema
 * they are also the messages `<FormMessage>` renders under the field that is
 * wrong — the shape #434 established for the member form and #433 filed against
 * the previous version of THIS form.
 *
 * WHAT A REQUEST DOES NOT KNOW (owner ruling, Антон, 2026-09-03, #388 —
 * EARS-533). A request is an INTENT: the paying account and the date money
 * moved do not exist yet, and the finance role enters them at the posting act.
 * So both are conditioned on `alreadyPaid` here rather than merely optional —
 * the schema demands them exactly where the money has already left, and
 * `toRequestBody` sends null for a pre-spend request whatever the (hidden)
 * fields still hold.
 *
 * The form is typed in MAJOR units — a member types «45 000,00», not 4500000 —
 * and the ledger stores minor units, so the conversion is part of the contract
 * rather than a detail of the submit handler.
 */

/** Reads a typed amount in major units into the minor units the ledger stores. */
export function toMinorUnits(text: string, precision: number): string | null {
  const normalized = text.replace(/\s| /g, '').replace(',', '.')
  if (normalized === '' || !/^\d+(\.\d+)?$/.test(normalized)) return null
  const [integer, fraction = ''] = normalized.split('.')
  if (fraction.length > precision) return null
  const minor = `${integer}${fraction.padEnd(precision, '0')}`.replace(/^0+(?=\d)/, '')
  return BigInt(minor) > 0n ? minor : null
}

/** Writes a stored amount back into the field it was typed in. */
export function fromMinorUnits(minor: string | null, precision: number): string {
  if (minor === null || minor === '') return ''
  const value = BigInt(minor)
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, -precision)
  return precision === 0 ? `${sign}${integer}` : `${sign}${integer},${digits.slice(-precision)}`
}

export type RequestFormValue = {
  occurredOn: string
  amount: string
  currency: string
  accountId: string
  paidAmount: string
  purposeId: string
  purposeProposal: string
  projectId: string
  productId: string
  counterpartyId: string
  counterpartyName: string
  note: string
  /** «Ссылка на источник» — where the spend was asked for (#517, EARS-535). */
  sourceRef: string
  alreadyPaid: boolean
  personalFunds: boolean
}

/** An http(s) address and nothing else — the one shape a «Источник» can open. */
function isHttpLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const baseSchema = z.object({
  // Unconditionally optional in the base shape: whether a money date is owed
  // at all depends on `alreadyPaid` (EARS-533), and that lives in the refinement.
  occurredOn: z.string(),
  amount: z.string(),
  currency: z.string().min(1, 'Выберите валюту документа.'),
  accountId: z.string(),
  paidAmount: z.string(),
  purposeId: z.string(),
  purposeProposal: z.string(),
  projectId: z.string().min(1, 'Выберите проект.'),
  productId: z.string(),
  counterpartyId: z.string(),
  counterpartyName: z.string(),
  note: z.string(),
  // OPTIONAL, and refused as a SHAPE rather than as a presence: empty is a
  // legitimate answer (a request typed straight into this form has no source
  // elsewhere), but a non-empty value that is not an http(s) address cannot
  // become a link, and a field that silently stored «см. в чате» would put a
  // dead «Источник» on the record (#517). The server refuses the same shape
  // (`request-utils.ts` → `isHttpLink`); this message is what the member reads
  // before the request leaves the browser.
  sourceRef: z
    .string()
    .refine(
      (value) => value.trim() === '' || isHttpLink(value.trim()),
      'Вставьте адрес целиком — например, ссылку на пост в Mattermost, где обсуждали трату.',
    ),
  alreadyPaid: z.boolean(),
  personalFunds: z.boolean(),
})

function accountOf(references: RequestBoardReferences, accountId: string) {
  return references.accounts.find((account) => String(account.id) === accountId) ?? null
}

function purposeOf(references: RequestBoardReferences, purposeId: string) {
  return references.purposes.find((purpose) => String(purpose.id) === purposeId) ?? null
}

function projectOf(references: RequestBoardReferences, projectId: string) {
  return references.projects.find((project) => String(project.id) === projectId) ?? null
}

/** The products the chosen purpose's binding and the chosen project allow. */
export function productOptions(
  references: RequestBoardReferences,
  purposeId: string,
  projectId: string,
): RequestBoardReferences['products'] {
  const purpose = purposeOf(references, purposeId)
  if (purpose === null || purpose.productBinding === 'forbidden') return []
  return references.products.filter((product) => String(product.projectId) === projectId)
}

/**
 * WHAT THE «Продукт» FIELD IS on the pair of choices already made — the view's
 * question, answered by the model rather than by `products.length > 0`.
 *
 * `empty` is the case that made the form refuse in silence (#388 journey,
 * state 09): a purpose whose binding is `required` chosen for a project that
 * carries no products at all. There is nothing to offer, but the field is not
 * absent — it is the field the member cannot satisfy, and hiding it hid the
 * refusal with it. The schema still raises on `productId`; this tells the view
 * to keep the place where that message is read.
 */
export function productFieldMode(
  references: RequestBoardReferences,
  purposeId: string,
  projectId: string,
): 'hidden' | 'options' | 'empty' {
  const purpose = purposeOf(references, purposeId)
  if (purpose === null || purpose.productBinding === 'forbidden') return 'hidden'
  // No project yet — and `empty` is a statement ABOUT a project («that one has
  // no products»). Said before the member picked one it is advice to change a
  // choice that does not exist; the field order is «Назначение» → «Проект» →
  // «Продукт», so this is the normal state, not a corner (#388 review round 2).
  if (projectId === '') return 'hidden'
  if (productOptions(references, purposeId, projectId).length > 0) return 'options'
  return purpose.productBinding === 'required' ? 'empty' : 'hidden'
}

/**
 * The FACT the description carries — «у проекта «X» нет продуктов» — as against
 * the instruction the refusal carries. Two slots under one field said the same
 * 20-word sentence twice, which at 390 px is four lines said twice (#388 review
 * round 2, #473 item 7); each slot now carries its own half.
 */
export function productEmptyFact(references: RequestBoardReferences, projectId: string): string {
  const project = projectOf(references, projectId)
  return project === null
    ? 'У выбранного проекта нет продуктов.'
    : `У проекта «${project.name}» нет продуктов.`
}

/** The message the empty-and-required product field carries, in one place. */
export function productEmptyMessage(references: RequestBoardReferences, projectId: string): string {
  const project = projectOf(references, projectId)
  const named = project === null ? 'выбранного проекта' : `проекта «${project.name}»`
  return `Это назначение требует продукт, а у ${named} нет продуктов — выберите другой проект или другое назначение.`
}

/**
 * WHO MAY SAY «THE COMPANY PAID» — owner decision 36 (Антон, 2026-09-14, #115),
 * spec 339 EARS-508 revision 2026-09-14: «конечно, не любой сотрудник имеет
 * доступ к корп. счетам».
 *
 * The company-account branch of the already-paid path belongs to
 * `finance-entry` / `finance-approve`. A submitter with neither role files an
 * already-paid request as their OWN money — so the form neither offers the
 * choice nor the account picker, and the schema says so rather than leaving the
 * refusal to a server round-trip the member cannot read. The gate that MATTERS
 * is the module's own (`request-utils.ts`); this one is the affordance.
 */
export type RequestFormOptions = { canNameCompanyAccount?: boolean }

/**
 * WHY THE SUBMIT BUTTON IS STILL DISABLED — named, not implied (#388 wave 3,
 * owner acceptance 2026-09-15: «submit is disabled-with-reason»).
 *
 * IT ONLY COUNTS EMPTY ANSWERS, NEVER MALFORMED ONES. A disabled button whose
 * reason were «укажите сумму числом больше нуля» would be a button that hides
 * the message the reader has to act on: format refusals are the SCHEMA's, they
 * land in that field's own `FormMessage` on submit, and they must stay
 * reachable. What this answers is the other question — «is the form finished» —
 * and it answers it by naming the fields that still hold nothing.
 *
 * The order is the form's own reading order, so the reason reads as a route
 * through the sheet rather than as a list of complaints.
 */
export function requestSubmitBlockers(
  value: RequestFormValue,
  options: RequestFormOptions = {},
): string[] {
  const canNameCompanyAccount = options.canNameCompanyAccount ?? true
  const missing: string[] = []

  if (value.amount.trim() === '') missing.push('сумма документа')
  if (value.purposeId === '' && value.purposeProposal.trim() === '') missing.push('назначение')
  if (value.projectId === '') missing.push('проект')
  if (value.counterpartyId === '' && value.counterpartyName.trim() === '')
    missing.push('контрагент')

  // EARS-533: a pre-spend intent is asked for neither, and decision 36 keeps
  // the company account off a submitter who may not name one.
  if (value.alreadyPaid) {
    if (canNameCompanyAccount && !value.personalFunds && value.accountId === '')
      missing.push('счёт списания')
    if (value.occurredOn.trim() === '') missing.push('дата движения денег')
  }

  return missing
}

/** The same answer as one sentence — what the reader sees beside the button. */
export function requestSubmitBlockReason(
  value: RequestFormValue,
  options: RequestFormOptions = {},
): string | null {
  const missing = requestSubmitBlockers(value, options)
  return missing.length === 0 ? null : `Заполните: ${missing.join(', ')}`
}

export function createRequestFormSchema(
  references: RequestBoardReferences,
  options: RequestFormOptions = {},
) {
  const canNameCompanyAccount = options.canNameCompanyAccount ?? true
  return baseSchema.superRefine((value, context) => {
    if (!canNameCompanyAccount && value.alreadyPaid) {
      if (!value.personalFunds) {
        context.addIssue({
          code: 'custom',
          path: ['personalFunds'],
          message:
            'Оплату с корпоративного счёта оформляет финансовая роль: свою трату подайте как ' +
            'оплаченную своими средствами.',
        })
      }
      if (value.accountId !== '') {
        context.addIssue({
          code: 'custom',
          path: ['accountId'],
          message: 'Списание с корпоративного счёта оформляет финансовая роль.',
        })
      }
    }
    const precision = currencyPrecision(references.currencies, value.currency)
    if (toMinorUnits(value.amount, precision) === null) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Укажите сумму документа числом больше нуля.',
      })
    }

    if (value.personalFunds && !value.alreadyPaid) {
      context.addIssue({
        code: 'custom',
        path: ['personalFunds'],
        message: 'Свои деньги — это уже потраченные деньги: отметьте «уже потрачено».',
      })
    }
    if (value.personalFunds && value.accountId !== '') {
      context.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: 'Трата своими средствами не списывается со счёта BBM.',
      })
    }
    // EARS-533: only the request that says the money ALREADY left is asked
    // who paid and when. A pre-spend request names neither, and the posting
    // act supplies both.
    if (value.alreadyPaid) {
      if (!value.personalFunds && value.accountId === '') {
        context.addIssue({
          code: 'custom',
          path: ['accountId'],
          message: 'Выберите счёт списания.',
        })
      }
      if (value.occurredOn.trim() === '') {
        context.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: 'Укажите дату, когда деньги действительно ушли.',
        })
      }
      const account = accountOf(references, value.accountId)
      if (account !== null && account.currency !== value.currency) {
        const paidPrecision = currencyPrecision(references.currencies, account.currency)
        if (toMinorUnits(value.paidAmount, paidPrecision) === null) {
          context.addIssue({
            code: 'custom',
            path: ['paidAmount'],
            message: `Укажите сумму, списанную со счёта в ${account.currency}.`,
          })
        }
      }
    }

    const proposal = value.purposeProposal.trim()
    if (value.purposeId === '' && proposal === '') {
      context.addIssue({
        code: 'custom',
        path: ['purposeId'],
        message: 'Выберите назначение или предложите новое.',
      })
    }
    if (value.purposeId !== '' && proposal !== '') {
      context.addIssue({
        code: 'custom',
        path: ['purposeProposal'],
        message: 'Выберите назначение или предложите новое, но не оба варианта сразу.',
      })
    }

    const purpose = purposeOf(references, value.purposeId)
    // Nothing is asked about the product while the project it depends on is
    // unanswered: the form's one refusal there is «Выберите проект.».
    if (
      purpose?.productBinding === 'required' &&
      value.productId === '' &&
      value.projectId !== ''
    ) {
      const empty = productFieldMode(references, value.purposeId, value.projectId) === 'empty'
      context.addIssue({
        code: 'custom',
        path: ['productId'],
        message: empty
          ? productEmptyMessage(references, value.projectId)
          : 'Это назначение требует продукт.',
      })
    }
    if (purpose?.productBinding === 'forbidden' && value.productId !== '') {
      context.addIssue({
        code: 'custom',
        path: ['productId'],
        message: 'Это назначение не относится к продукту.',
      })
    }

    if (value.counterpartyId === '' && value.counterpartyName.trim() === '') {
      context.addIssue({
        code: 'custom',
        path: ['counterpartyId'],
        message: 'Выберите контрагента или впишите нового.',
      })
    }
  })
}

/** A blank form, or the saved request re-opened for an edit (EARS-524). */
export function requestFormDefaults(
  references: RequestBoardReferences,
  request?: RequestBoardItem,
): RequestFormValue {
  if (request === undefined) {
    return {
      // Blank, not «today»: a pre-spend request has no money date at all, and
      // a pre-filled one would be a guess the form invented (EARS-533).
      occurredOn: '',
      amount: '',
      currency: references.currencies[0]?.code ?? 'RUB',
      accountId: '',
      paidAmount: '',
      purposeId: '',
      purposeProposal: '',
      projectId: '',
      productId: '',
      counterpartyId: '',
      counterpartyName: '',
      note: '',
      sourceRef: '',
      alreadyPaid: false,
      personalFunds: false,
    }
  }
  const paidPrecision = currencyPrecision(
    references.currencies,
    request.paidCurrency ?? request.currency,
  )
  return {
    occurredOn: request.occurredOn ?? '',
    amount: fromMinorUnits(
      request.amount,
      currencyPrecision(references.currencies, request.currency),
    ),
    currency: request.currency,
    accountId: request.account === null ? '' : String(request.account.id),
    paidAmount: fromMinorUnits(request.paidAmount, paidPrecision),
    purposeId: request.purpose === null ? '' : String(request.purpose.id),
    purposeProposal: '',
    projectId: String(request.project.id),
    productId: request.product === null ? '' : String(request.product.id),
    counterpartyId: request.counterparty === null ? '' : String(request.counterparty.id),
    counterpartyName: '',
    note: request.note ?? '',
    // Reopened for EDITING, and provenance is immutable after submit
    // (EARS-536): the field comes back empty and the body below never sends it,
    // so a re-save cannot rewrite where the request came from.
    sourceRef: '',
    alreadyPaid: request.alreadyPaid,
    personalFunds: request.personalFunds,
  }
}

/** The validated form as the API's own body (`CreateRequestBody`). */
export function toRequestBody(
  value: RequestFormValue,
  references: RequestBoardReferences,
  options: RequestFormOptions = {},
): CreateRequestBody {
  const canNameCompanyAccount = options.canNameCompanyAccount ?? true
  const precision = currencyPrecision(references.currencies, value.currency)
  // EARS-533 again, on the way OUT: whatever the hidden fields still hold from
  // a checkbox the member ticked and unticked, a pre-spend request files no
  // paying account and no money date. Decision 36 adds the second exclusion on
  // the same line: a submitter who was never offered the company-account branch
  // files no account, and the `personal_funds` fact is DERIVED rather than read
  // out of a control that is not on the form.
  const ownMoneyOnly = !canNameCompanyAccount
  const account = value.alreadyPaid && !ownMoneyOnly ? accountOf(references, value.accountId) : null
  const crossCurrency = account !== null && account.currency !== value.currency
  const paidPrecision = crossCurrency
    ? currencyPrecision(references.currencies, account.currency)
    : precision
  // BOTH EXCLUSIVE PAIRS, on the way OUT. A field the form no longer renders
  // still holds what was typed into it — react-hook-form keeps it,
  // `shouldUnregister` being false — so a member who typed a new counterparty
  // and then found the right one in the reference would have sent both. The
  // pick wins and the free text it replaced is dropped; the API refuses a body
  // carrying both (EARS-508/526/532).
  const proposal = value.purposeId === '' ? value.purposeProposal.trim() : ''
  const counterpartyName = value.counterpartyId === '' ? value.counterpartyName.trim() : ''

  return {
    occurredOn: value.alreadyPaid && value.occurredOn !== '' ? value.occurredOn : null,
    accountId: account?.id ?? null,
    amount: toMinorUnits(value.amount, precision) ?? '0',
    currency: value.currency,
    paidAmount: crossCurrency ? toMinorUnits(value.paidAmount, paidPrecision) : null,
    paidCurrency: crossCurrency ? account.currency : null,
    purposeId: value.purposeId === '' ? null : Number(value.purposeId),
    purposeProposal: proposal === '' ? null : proposal,
    projectId: Number(value.projectId),
    productId: value.productId === '' ? null : Number(value.productId),
    counterpartyId: value.counterpartyId === '' ? null : Number(value.counterpartyId),
    counterpartyName: counterpartyName === '' ? null : counterpartyName,
    note: value.note.trim() === '' ? null : value.note.trim(),
    sourceRef: value.sourceRef.trim() === '' ? null : value.sourceRef.trim(),
    alreadyPaid: value.alreadyPaid,
    personalFunds: ownMoneyOnly ? value.alreadyPaid : value.personalFunds,
  }
}

/**
 * THE POSTING ACT'S OWN FORM (EARS-533) — the finance role's half of the same
 * separation the request form's `alreadyPaid` branch is the member's half of.
 *
 * It is a SEPARATE model, not three more optional fields on the request form,
 * because it is a different question asked of a different person at a different
 * moment: the request form asks what the requester intends, this one asks the
 * poster what actually happened. Sharing a schema would mean one of the two
 * always carrying rules that do not apply to it.
 */
export type PostingFormValue = {
  accountId: string
  occurredOn: string
  paidAmount: string
}

/** Everything the act already knows, pre-filled; the rest is asked. */
export function postingFormDefaults(
  references: RequestBoardReferences,
  request: RequestBoardItem,
): PostingFormValue {
  const account = request.account
  const paidPrecision = currencyPrecision(
    references.currencies,
    request.paidCurrency ?? account?.currency ?? request.currency,
  )
  return {
    accountId: account === null ? '' : String(account.id),
    occurredOn: request.occurredOn ?? '',
    paidAmount: fromMinorUnits(request.paidAmount, paidPrecision),
  }
}

export function createPostingFormSchema(
  references: RequestBoardReferences,
  request: RequestBoardItem,
) {
  return z
    .object({
      accountId: z.string(),
      occurredOn: z.string(),
      paidAmount: z.string(),
    })
    .superRefine((value, context) => {
      // Own funds name no company account (EARS-513) — and that is not a
      // missing account, so the field is neither shown nor demanded.
      if (!request.personalFunds && value.accountId === '') {
        context.addIssue({
          code: 'custom',
          path: ['accountId'],
          message: 'Выберите счёт, с которого ушли деньги.',
        })
      }
      if (value.occurredOn.trim() === '') {
        context.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: 'Укажите дату, когда деньги действительно ушли.',
        })
      }
      const account = accountOf(references, value.accountId)
      if (account !== null && account.currency !== request.currency) {
        const paidPrecision = currencyPrecision(references.currencies, account.currency)
        if (toMinorUnits(value.paidAmount, paidPrecision) === null) {
          context.addIssue({
            code: 'custom',
            path: ['paidAmount'],
            message: `Укажите сумму, списанную со счёта в ${account.currency}.`,
          })
        }
      }
    })
}

/** The validated posting form as the act endpoint's own body (EARS-533). */
export function toPostingBody(
  value: PostingFormValue,
  references: RequestBoardReferences,
  request: RequestBoardItem,
): {
  accountId: number | null
  occurredOn: string
  paidAmount: string | null
  paidCurrency: string | null
} {
  const account = accountOf(references, value.accountId)
  const crossCurrency = account !== null && account.currency !== request.currency
  return {
    accountId: account?.id ?? null,
    occurredOn: value.occurredOn,
    paidAmount: crossCurrency
      ? toMinorUnits(value.paidAmount, currencyPrecision(references.currencies, account.currency))
      : null,
    paidCurrency: crossCurrency ? account.currency : null,
  }
}
