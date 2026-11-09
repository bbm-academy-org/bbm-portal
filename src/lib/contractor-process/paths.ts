/**
 * Where the process data lives (#545). Both are constants on purpose: the repo,
 * branch and token are the path map's `PATH_MAPS_*` env (one private repo for
 * both), and the file inside it is fixed — there is no env var for it.
 */

/** The public example, relative to the app root. Traced into the image by `next.config.ts`. */
export const CONTRACTOR_PROCESS_EXAMPLE_FILE = 'content/finance/contractor-process.example.json'

/** The real process, inside the private repo named by `PATH_MAPS_REPO`. */
export const CONTRACTOR_PROCESS_REMOTE_FILE = 'processes/contractors.json'
