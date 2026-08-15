// VIOLATION under test: the hours module reaching for the member module's tables.
import { members } from '../platform/db/schema/member/tables'

export const owner = members
