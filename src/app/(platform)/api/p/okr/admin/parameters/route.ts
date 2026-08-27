import {
  describeOkrReadError,
  getOkrParameters,
  getOkrTree,
  okrParametersSchema,
  type OkrParametersRecord,
} from '@/lib/okr'
import { adminRoute } from '@/lib/platform/api'

/**
 * `/api/p/okr/admin/parameters` — the OKR cabinet section's one resource
 * (spec 311 §G: EARS-453, EARS-455, EARS-462, EARS-475, EARS-476).
 *
 * The FIRST handler on the modules' HTTP surface, so it is also the worked
 * example of the conventions #316 and #317 inherit:
 *
 * - it is built by `adminRoute`, so `platform-admin` is re-checked here and not
 *   assumed from the shell (EARS-462) — the layout gate of #313 does not run
 *   for a route handler at all;
 * - it lives one segment deeper than a member-facing route, under the reserved
 *   `admin` segment (D-12), which makes the required claim readable from the
 *   URL and greppable in review;
 * - it validates its answer with the MODULE's own schema, the same object the
 *   cabinet's data provider parses with (EARS-436);
 * - it reaches the OKR module only through its public API (ADR-004 §6):
 *   `getOkrParameters()` for the configuration, `getOkrTree()` for the read.
 *
 * GET only. EARS-455 makes create, update and delete unsupported — the records
 * are mastered in Plane and these parameters are deploy-time configuration with
 * no settings store in `core` to write to — and «unsupported» here means the
 * method does not exist, so there is nothing for a stray client to call.
 */
export const GET = adminRoute<undefined, OkrParametersRecord>({
  output: okrParametersSchema,
  handler: async () => {
    const parameters = getOkrParameters()

    // EARS-476: the module's CURRENT read state and when it was obtained. The
    // result is not stored anywhere, which is why §G needs no read-health
    // store — the page probes live and reports what it saw.
    let read: OkrParametersRecord['read']
    try {
      await getOkrTree()
      read = { state: 'ok', at: new Date().toISOString() }
    } catch (error) {
      // A failed READ is not a failed PAGE. Answering 503 here would hide the
      // configuration from the admin at exactly the moment they came to check
      // why the dashboard is empty.
      read = { state: 'error', at: new Date().toISOString(), message: describeOkrReadError(error) }
    }

    return {
      id: 'parameters',
      workspace: parameters.workspace,
      planeWebBaseUrl: parameters.planeWebBaseUrl,
      period: parameters.period,
      projects: parameters.projects,
      read,
    }
  },
})
