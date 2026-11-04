/**
 * Path map module (#530) — «Карта пути»: a strategy map rendered from one
 * YAML file — since #533 read from the private repo `bbm-academy-org/path-maps`
 * (GitHub contents API), with the public example in `content/path-map/` as the
 * no-token fallback; since #539 editable from the UI, every edit a commit to
 * that same file (`./edit.ts`, `./save.ts`). Public surface of the
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
export type { GetPathMapOptions, LoadResult, PathMapLoad, PathMapLoadFailure } from './load'
export {
  PATH_MAP_CACHE_TTL_MS,
  peekPathMapCache,
  primePathMapCache,
  resetPathMapCache,
} from './cache'
export {
  describeOrigin,
  githubPathMapSource,
  localPathMapSource,
  PATH_MAPS_DEFAULT_FILE,
  PATH_MAPS_DEFAULT_REPO,
  PathMapConflictError,
  PathMapSourceError,
  pathMapSourceFromEnv,
  readFailureKind,
} from './source'
export type {
  AnyPathMapSource,
  GithubPathMapOrigin,
  GithubPathMapSource,
  GithubSourceConfig,
  LocalPathMapOrigin,
  LocalPathMapSource,
  MisconfiguredPathMapOrigin,
  MisconfiguredPathMapSource,
  PathMapDocument,
  PathMapEnv,
  PathMapOrigin,
  PathMapReadFailureKind,
  PathMapSource,
  PathMapSourceFailure,
} from './source'
export { applyEdit, editCommandSchema, slugifyTitle } from './edit'
export type { EditCommand, EditResult, NodeFields, TaskFields } from './edit'
export { commitMessage, EDIT_DISABLED_REASON, runPathMapEdit, savePathMapEdit } from './save'
export type { PathMapEditOutcome } from './save'
export { parsePathMap } from './parse'
export type { ParseResult } from './parse'
export { BEACON_ID, CONFIDENCE, pathMapSchema } from './schema'
export type { Confidence, PathMap, PathNode, PathObstacle, PathStation, PathTrack } from './schema'

// The module's workspace declaration (spec 311 EARS-401), registered in
// `src/lib/workspace/registry.ts`.
export { pathMapWorkspaceEntry } from './workspace'
