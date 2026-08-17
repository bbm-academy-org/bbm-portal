// VIOLATION under test: hours reaching past the member module's public API.
import { findMemberByEmail } from '../member/repository'

export const resolve = findMemberByEmail
