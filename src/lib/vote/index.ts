/**
 * The vote module (#575) — its public surface. The pages, the Server Actions
 * and the composition root import from here; nothing outside the module
 * reaches `./store` or the `schema/vote/` tables.
 */
export {
  CONSENT_ANSWER_LABELS,
  CONSENT_ANSWERS,
  CONSENT_ANSWERS_NEEDING_COMMENT,
  POLL_KIND_LABELS,
  POLL_KINDS,
  POLL_STATUS_LABELS,
  RATING_MAX_CHOICES,
  TIE_MESSAGE,
} from './rules'
export type {
  BallotView,
  ConsentAnswer,
  ConsentTally,
  LeadersResult,
  OptionTally,
  PollKind,
  PollRecord,
  PollStatus,
  RatingTally,
} from './rules'
export {
  adminOverview,
  closePoll,
  createConsentFromLeaders,
  createPoll,
  memberOverview,
  openPoll,
  pollResults,
  submitBallot,
} from './service'
export type { BallotInput, MemberPoll, PollResults, VoteResult } from './service'
export type { PollWithCount, VoterBallot } from './store'
export { voteAdminSection, votePollRecordSchema, voteWorkspaceEntry } from './workspace'
