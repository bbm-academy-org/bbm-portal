/**
 * Processes module (#553, spec 553) — the «Процессы» workspace: a catalog of
 * process models and, per model, the data its page draws, read at request time
 * from the repo that masters it (the DS IDEF0 model: `bbm-academy-org/bbm-kb`
 * main). Public surface consumed by `src/modules/processes` and
 * `/p/processes/*`; nothing here may import CMS internals.
 */
export { PROCESS_CATALOG, processBySlug } from './catalog'
export type { ProcessCatalogEntry, ProcessModelLocation } from './catalog'
export { getProcessModel } from './load'
export type { GetProcessModelOptions, ProcessModelLoad } from './load'
export { PROCESS_MODEL_CACHE_TTL_MS, resetProcessModelCache } from './cache'
export type { Idef0Diagram, Idef0IndexEntry, Idef0Model, Knowledge } from './model'
export { assembleModel, parseIndex } from './parse'
export type { AssembleResult, RawModelFiles } from './parse'
export { parseKnowledge } from './registry.mjs'
export {
  describeProcessOrigin,
  EXAMPLE_DIR,
  exampleProcessSource,
  failureKind,
  githubProcessSource,
  ProcessSourceError,
  processSourceFromEnv,
} from './source'
export type {
  AnyProcessSource,
  ExampleProcessOrigin,
  GithubProcessOrigin,
  ProcessEnv,
  ProcessFailureKind,
  ProcessOrigin,
  ProcessSourceFailure,
} from './source'

// The module's workspace declaration (spec 311 EARS-401), registered in
// `src/lib/workspace/registry.ts`.
export { processesWorkspaceEntry } from './workspace'
