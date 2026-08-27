/**
 * The cabinet's frame-side pieces — everything `/p/admin` needs that is not a
 * screen. Today that is the hand-written Refine data provider (spec 311
 * EARS-431, consolidation §6).
 *
 * It lives under `src/lib/platform` rather than inside the route group because
 * it is unit-testable logic with no JSX, and because the route group is where
 * the composition root may be read (EARS-457) — the provider reads no registry
 * and must not start.
 */
export {
  type CabinetDataProviderOptions,
  createCabinetDataProvider,
  MODULE_API_ROOT,
} from './dataProvider'
