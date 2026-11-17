import type { Knowledge } from './registry.mjs'

/**
 * What the IDEF0 viewer draws (#553) — the same shape the bbm-kb viewer's
 * `index.tsx` built at build time, assembled here per request (`./parse.ts`).
 * Diagrams stay loosely typed on purpose: the ported viewer reads them as the
 * YAML says (format: the bbm-kb package's `model/FORMAT-ru.md`) and reports a
 * diagram it cannot lay out itself.
 */
export interface Idef0IndexEntry {
  id: string
  file: string
  parent?: string | null
}

export type Idef0Diagram = Record<string, unknown> & {
  id: string
  parent: string | null
  title?: string
}

export interface Idef0Model {
  index: { root: string; diagrams: Idef0IndexEntry[] }
  diagrams: Idef0Diagram[]
  /** Registry definitions + TO-BE steps; `null` when they could not be read or parsed. */
  knowledge: Knowledge | null
  /** Why `knowledge` is null — shown in the panel; the diagrams still open (EARS-615). */
  knowledgeError: string | null
}

export type { Knowledge }
