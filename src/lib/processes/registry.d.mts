/** Types of the ported bbm-kb registry parser (`./registry.mjs`, #553). */
export interface RegistryObject {
  id: string
  status: string
  decision: string
  name: string
  type: string
  group: string
  definition: string
}
export interface RegistryFunction {
  id: string
  status: string
  decision: string
  name: string
  cluster: string
  executor: string
}
export interface ToBeStep {
  block: number
  text: string
}
export interface Knowledge {
  objects: Map<string, RegistryObject>
  functions: Map<string, RegistryFunction>
  clusters: Map<string, string>
  steps: Map<string, ToBeStep[]>
  blocks: Map<number, string>
  outOfScope: Map<string, { what: string; reason: string }>
}
export function plain(text: unknown): string
export function parseKnowledge(registryMd: string, processMd: string): Knowledge
