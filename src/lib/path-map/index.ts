/**
 * Path map module (#530) — «Карта пути»: a read-only strategy map rendered from
 * one YAML file in the repo (`content/path-map/`). Public surface of the
 * module, consumed by `src/modules/path-map/view` and `/p/path`; nothing here
 * may import CMS internals (enforced by dependency-cruiser).
 */
export { buildMapView, checkPath, plural, TRACK_COLORS } from './derive'
export type {
  ChainLink,
  MapView,
  NodeLook,
  PassedItem,
  PathBreak,
  PathCheck,
  RoadsideStationView,
  RoadsideTrackView,
  TrackView,
  UpcomingItem,
} from './derive'
export { loadPathMap, PATH_MAP_FILE } from './load'
export type { LoadResult } from './load'
export { parsePathMap } from './parse'
export type { ParseResult } from './parse'
export { BEACON_ID, CONFIDENCE, pathMapSchema } from './schema'
export type { Confidence, PathMap, PathNode, PathObstacle, PathStation, PathTrack } from './schema'

// The module's workspace declaration (spec 311 EARS-401), registered in
// `src/lib/workspace/registry.ts`.
export { pathMapWorkspaceEntry } from './workspace'
