// VIOLATION under test (spec 311 EARS-458): the kit reaching into a module.
// A kit that knows what an open period is is no longer a kit — it is the hours
// module wearing a component's name.
import { openPeriod } from '../lib/hours/index'

export const tile = `Часы: ${openPeriod}`
