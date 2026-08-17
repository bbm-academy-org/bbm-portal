// LEGAL: hours reaches member data through the member module's public API only.
import { findMemberByEmail } from '../member/index'

export const resolve = findMemberByEmail
