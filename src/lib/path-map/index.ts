/**
 * Path map module (#530) — «Карта пути»: a read-only strategy map rendered from
 * one YAML file — since #533 read from the private repo `bbm-academy-org/path-maps`
 * (GitHub contents API), with the public example in `content/path-map/` as the
 * no-token fallback. Public surface of the
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
export { getPathMap, loadPathMap, PATH_MAP_FILE } from './load'
export type { GetPathMapOptions, LoadResult, PathMapLoad } from './load'
export { PATH_MAP_CACHE_TTL_MS, resetPathMapCache } from './cache'
export {
  describeOrigin,
  githubPathMapSource,
  localPathMapSource,
  PATH_MAPS_DEFAULT_FILE,
  PATH_MAPS_DEFAULT_REPO,
  PathMapSourceError,
  pathMapSourceFromEnv,
} from './source'
export type {
  GithubSourceConfig,
  PathMapDocument,
  PathMapEnv,
  PathMapOrigin,
  PathMapSource,
  PathMapSourceFailure,
} from './source'
export { parsePathMap } from './parse'
export type { ParseResult } from './parse'
export { BEACON_ID, CONFIDENCE, pathMapSchema } from './schema'
export type { Confidence, PathMap, PathNode, PathObstacle, PathStation, PathTrack } from './schema'

// The module's workspace declaration (spec 311 EARS-401), registered in
// `src/lib/workspace/registry.ts`.
export { pathMapWorkspaceEntry } from './workspace'
