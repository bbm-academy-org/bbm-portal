// VIOLATION under test (spec 311 EARS-458): three doors out of the kit that the
// word "module" alone would not have closed — the route layer, the CMS side and
// the platform database.
import { session } from '../app/(platform)/session'
import { Team } from '../collections/Team'
import { db } from '../lib/platform/db/index'

export const bar = [session, Team, db]
