// VIOLATION under test: CMS-side code opening the platform database.
import { platformDb } from '../lib/platform/db/client'

export const Members = platformDb
