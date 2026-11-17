/**
 * The processes catalog (#553, spec 553 EARS-602): every process model the
 * «Процессы» workspace lists, and where its master lives. The model itself is
 * NOT here — it is read at request time from its repo (`./source.ts`); this
 * file only names it. One entry today; a second process is one more element.
 */

export interface ProcessModelLocation {
  /** `owner/name` of the repo that masters the model. */
  repo: string
  /** Branch the page follows. */
  ref: string
  /** The model package folder inside the repo (holds `model/index.yaml`). */
  dir: string
}

export interface ProcessCatalogEntry {
  slug: string
  name: string
  description: string
  /** The portal page of this process. */
  href: string
  /** The notation the page renders. */
  notation: 'idef0'
  source: ProcessModelLocation
  /** The package's text in the knowledge base (ADR-005: text is read there). */
  kbUrl: string
}

export const PROCESS_CATALOG: readonly ProcessCatalogEntry[] = [
  {
    slug: 'ds-content-production',
    name: 'Производство контента DS',
    description:
      'IDEF0-модель Doctor.School: от A-0 до операций, ICOM-стрелки, определения реестра и шаги процесса TO-BE',
    href: '/p/processes/ds-content-production',
    notation: 'idef0',
    source: {
      repo: 'bbm-academy-org/bbm-kb',
      ref: 'main',
      dir: 'content/processes/ds-content-production',
    },
    kbUrl: 'https://kb.bbm.academy/processes/ds-content-production',
  },
]

export function processBySlug(slug: string): ProcessCatalogEntry | undefined {
  return PROCESS_CATALOG.find((entry) => entry.slug === slug)
}
