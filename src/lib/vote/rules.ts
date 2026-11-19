/**
 * The vote module's pure rules (#575): what a valid poll and a valid ballot
 * are, which status changes exist, how ballots are counted, and who the two
 * finalists of a rating round are. No IO — the service decides WHO may act,
 * this file decides WHAT is valid, and the server enforces both before any
 * write.
 */

export const POLL_KINDS = ['rating', 'consent'] as const
export type PollKind = (typeof POLL_KINDS)[number]

export const POLL_STATUSES = ['draft', 'open', 'closed'] as const
export type PollStatus = (typeof POLL_STATUSES)[number]

export const CONSENT_ANSWERS = ['accept', 'accept_with_wish', 'object'] as const
export type ConsentAnswer = (typeof CONSENT_ANSWERS)[number]

/** A rating ballot picks one or two options — the session procedure, fixed. */
export const RATING_MAX_CHOICES = 2

export const POLL_KIND_LABELS: Record<PollKind, string> = {
  rating: 'Рейтинг',
  consent: 'Согласие',
}

export const POLL_STATUS_LABELS: Record<PollStatus, string> = {
  draft: 'Черновик',
  open: 'Открыто',
  closed: 'Закрыто',
}

export const CONSENT_ANSWER_LABELS: Record<ConsentAnswer, string> = {
  accept: 'Принимаю',
  accept_with_wish: 'Принимаю, есть пожелание',
  object: 'Возражаю по существу',
}

/** The answers that must carry a comment: a wish and an objection both say WHAT. */
export const CONSENT_ANSWERS_NEEDING_COMMENT: readonly ConsentAnswer[] = [
  'accept_with_wish',
  'object',
]

export const TIE_MESSAGE = 'Ничья за второе место — создайте согласие вручную'

export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): RuleResult<T> => ({ ok: true, value })
const fail = <T>(error: string): RuleResult<T> => ({ ok: false, error })

export interface PollRecord {
  id: number
  title: string
  kind: PollKind
  options: string[]
  status: PollStatus
  sourcePollId: number | null
}

/** A ballot as the tally reads it: the voter already resolved to a display name. */
export interface BallotView {
  voterEmail: string
  voterName: string
  choices: number[]
  consentAnswer: ConsentAnswer | null
  comment: string | null
}

export function isPollKind(value: unknown): value is PollKind {
  return typeof value === 'string' && (POLL_KINDS as readonly string[]).includes(value)
}

export function isPollStatus(value: unknown): value is PollStatus {
  return typeof value === 'string' && (POLL_STATUSES as readonly string[]).includes(value)
}

export function isConsentAnswer(value: unknown): value is ConsentAnswer {
  return typeof value === 'string' && (CONSENT_ANSWERS as readonly string[]).includes(value)
}

/** The options textarea: one option per line, blank lines dropped. */
export function parseOptions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export interface PollDraft {
  title: string
  kind: PollKind
  options: string[]
}

export function validatePollDraft(input: {
  title: unknown
  kind: unknown
  options: unknown
}): RuleResult<PollDraft> {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title === '') return fail('Укажите название голосования.')
  if (!isPollKind(input.kind)) return fail('Выберите тип: рейтинг или согласие.')
  if (input.kind === 'consent') return ok({ title, kind: 'consent', options: [] })

  const options = Array.isArray(input.options)
    ? input.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim())
    : parseOptions(typeof input.options === 'string' ? input.options : '')
  if (options.length < 2) return fail('Для рейтинга нужно не меньше двух вариантов.')
  if (new Set(options).size !== options.length) return fail('Варианты не должны повторяться.')
  return ok({ title, kind: 'rating', options })
}

/** 1..2 distinct indices into the poll's options, returned sorted. */
export function validateRatingBallot(choices: unknown, optionCount: number): RuleResult<number[]> {
  if (!Array.isArray(choices) || choices.length === 0) {
    return fail('Выберите хотя бы один вариант.')
  }
  if (choices.length > RATING_MAX_CHOICES) {
    return fail(`Можно выбрать не больше ${RATING_MAX_CHOICES} вариантов.`)
  }
  for (const choice of choices) {
    if (typeof choice !== 'number' || !Number.isInteger(choice)) {
      return fail('Неизвестный вариант.')
    }
    if (choice < 0 || choice >= optionCount) return fail('Неизвестный вариант.')
  }
  if (new Set(choices).size !== choices.length) return fail('Вариант выбран дважды.')
  return ok([...(choices as number[])].sort((a, b) => a - b))
}

export function validateConsentBallot(
  answer: unknown,
  comment: unknown,
): RuleResult<{ answer: ConsentAnswer; comment: string | null }> {
  if (!isConsentAnswer(answer)) return fail('Выберите ответ.')
  const text = typeof comment === 'string' ? comment.trim() : ''
  if (CONSENT_ANSWERS_NEEDING_COMMENT.includes(answer) && text === '') {
    return fail(
      answer === 'object'
        ? 'Напишите, в чём возражение.'
        : 'Напишите пожелание — без него ответ не принимается.',
    )
  }
  return ok({ answer, comment: text === '' ? null : text })
}

export function ensureVotable(status: PollStatus): RuleResult<null> {
  if (status === 'open') return ok(null)
  return fail(status === 'closed' ? 'Голосование уже закрыто.' : 'Голосование ещё не открыто.')
}

const NEXT_STATUS: Record<PollStatus, PollStatus | null> = {
  draft: 'open',
  open: 'closed',
  closed: null,
}

/** draft → open → closed, one step at a time, never back. */
export function transitionPoll(from: PollStatus, to: PollStatus): RuleResult<PollStatus> {
  if (NEXT_STATUS[from] !== to) {
    return fail(
      `Нельзя перевести голосование из «${POLL_STATUS_LABELS[from]}» в «${POLL_STATUS_LABELS[to]}».`,
    )
  }
  return ok(to)
}

export interface OptionTally {
  index: number
  text: string
  count: number
  voters: string[]
}

export interface RatingTally {
  kind: 'rating'
  total: number
  options: OptionTally[]
}

export function tallyRating(options: string[], ballots: BallotView[]): RatingTally {
  const rows: OptionTally[] = options.map((text, index) => ({ index, text, count: 0, voters: [] }))
  for (const ballot of ballots) {
    for (const choice of ballot.choices) {
      const row = rows[choice]
      if (!row) continue
      row.count += 1
      row.voters.push(ballot.voterName)
    }
  }
  return { kind: 'rating', total: ballots.length, options: rows }
}

export interface ConsentTally {
  kind: 'consent'
  total: number
  answers: { answer: ConsentAnswer; label: string; count: number; voters: string[] }[]
  comments: { answer: ConsentAnswer; voter: string; comment: string }[]
}

export function tallyConsent(ballots: BallotView[]): ConsentTally {
  const answers = CONSENT_ANSWERS.map((answer) => ({
    answer,
    label: CONSENT_ANSWER_LABELS[answer],
    count: 0,
    voters: [] as string[],
  }))
  const comments: ConsentTally['comments'] = []
  for (const ballot of ballots) {
    if (!ballot.consentAnswer) continue
    const row = answers.find((a) => a.answer === ballot.consentAnswer)
    if (!row) continue
    row.count += 1
    row.voters.push(ballot.voterName)
    if (ballot.comment) {
      comments.push({
        answer: ballot.consentAnswer,
        voter: ballot.voterName,
        comment: ballot.comment,
      })
    }
  }
  return { kind: 'consent', total: ballots.length, answers, comments }
}

export type LeadersResult =
  | { status: 'ok'; leaders: [OptionTally, OptionTally] }
  | { status: 'tie'; message: string }
  | { status: 'empty'; message: string }

/**
 * The two finalists of a rating round. The top-two SET is what matters, not
 * their order, so a tie between first and second is decided (both go through);
 * a second place shared with the third is not, and is reported rather than
 * broken by option order.
 */
export function topTwoLeaders(tally: RatingTally): LeadersResult {
  if (tally.total === 0) return { status: 'empty', message: 'Голосов нет — лидеров нет.' }
  const ranked = [...tally.options].sort((a, b) => b.count - a.count || a.index - b.index)
  const [first, second, third] = ranked
  if (!first || !second) return { status: 'tie', message: TIE_MESSAGE }
  if (third && third.count === second.count) return { status: 'tie', message: TIE_MESSAGE }
  return { status: 'ok', leaders: [first, second] }
}
