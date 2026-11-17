/**
 * Types of the ported bbm-kb IDEF0 viewer (`./viewer.mjs`, #553). The module is
 * untyped JS kept diff-able against its source; these declarations name only
 * what the portal and the tests use.
 */
import type { ReactElement } from 'react'

import type { Idef0Model } from '@/lib/processes'

export default function Idef0Viewer(props: { model: Idef0Model }): ReactElement

/* eslint-disable @typescript-eslint/no-explicit-any -- the layout objects are the viewer's own */
export function readHash(fallback: string): string
export function layoutDiagram(diagram: Record<string, unknown>): any
export function icomOfBox(diagram: Record<string, unknown>, boxId: string): any
export function Details(props: Record<string, unknown>): ReactElement | null
export function initialAnimate(): boolean
export function initialHoverCard(): boolean
export function litEdgesOf(layout: any, focus: any): Set<string> | null
export function tracedEdgesOf(
  layout: any,
  trace: string | null,
  panelBox: string | null,
): Set<string> | null
export function keptBoxesOf(
  layout: any,
  focus: any,
  litEdges: Set<string> | null,
): Set<string> | null
export function chainOf(byId: Map<string, any>, diagram: any): any[]
