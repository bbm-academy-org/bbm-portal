'use client'

import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react'

import type { DiagramLayout, LaneLayout, StepLayout } from '../layout'
import { AUTO_LABEL, OPEN_LABEL } from '../layout'

/**
 * One SVG diagram of «Как работаем с исполнителями» (#545) — the markup the
 * approved visual's `drawDiagram` builds with `createElementNS`, as React:
 * lane bands, stage header, dashed stage separators, edges with an arrow
 * marker, edge labels, steps, and the lane labels that stay put on horizontal
 * scroll. The geometry comes from `../layout.ts`; this file only draws it.
 */

export interface DiagramHandle {
  /** Scroll so the step is in view, left of the sticky lane labels (the visual's `reveal`). */
  reveal(stepId: string): void
  /** Re-place the sticky lane labels after a size change. */
  sync(): void
}

export interface ProcessDiagramProps {
  layout: DiagramLayout
  /** Unique per diagram on the page: the arrow marker's id. */
  markerId: string
  /** Rendered width in px; height follows the viewBox. */
  width: number
  /** In «100%» mode the height is set too, as in the visual. */
  fixedHeight: boolean
  selectedStepId: string | null
  selectedLaneId: string | null
  /** The details panel these buttons open (`aria-controls`). */
  panelId: string
  label: string
  onStep(step: StepLayout, element: SVGGElement): void
  onLane(lane: LaneLayout, element: SVGGElement): void
}

const activate =
  <T,>(item: T, act: (item: T, el: SVGGElement) => void) =>
  (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      act(item, event.currentTarget)
    }
  }

export const ProcessDiagram = forwardRef<DiagramHandle, ProcessDiagramProps>(
  function ProcessDiagram(
    {
      layout,
      markerId,
      width,
      fixedHeight,
      selectedStepId,
      selectedLaneId,
      panelId,
      label,
      onStep,
      onLane,
    },
    ref,
  ) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const labelsRef = useRef<SVGGElement>(null)
    const { width: W, height: H, top: TOP, laneWidth: LW, laneHeight: LH } = layout

    const scale = useCallback(() => {
      const rendered = svgRef.current?.getBoundingClientRect().width ?? 0
      return rendered / W
    }, [W])

    const sync = useCallback(() => {
      const s = scale()
      if (!s || !labelsRef.current || !wrapRef.current) return
      labelsRef.current.setAttribute('transform', `translate(${wrapRef.current.scrollLeft / s},0)`)
    }, [scale])

    useLayoutEffect(() => {
      sync()
    }, [sync, width, fixedHeight])

    useImperativeHandle(
      ref,
      () => ({
        sync,
        reveal(stepId) {
          const wrap = wrapRef.current
          const n = layout.steps.find((s) => s.step.id === stepId)
          const g = svgRef.current?.querySelector<SVGGElement>(`[data-step-id="${stepId}"]`)
          if (!wrap || !n || !g) return
          const s = scale()
          const mg = 16
          const left = n.x * s
          const right = (n.x + n.width) * s
          const lab = LW * s
          const vw = wrap.clientWidth
          const sl = wrap.scrollLeft
          if (left < sl + lab + mg) wrap.scrollLeft = Math.max(0, left - lab - mg)
          else if (right > sl + vw - mg) wrap.scrollLeft = right - vw + mg
          sync()
          const r = g.getBoundingClientRect()
          if (r.top < mg) window.scrollBy(0, r.top - mg)
          else if (r.bottom > window.innerHeight - mg)
            window.scrollBy(0, r.bottom - window.innerHeight + mg)
        },
      }),
      [layout, scale, sync, LW],
    )

    const band = (i: number) => (i % 2 ? 'var(--cp-band-b)' : 'var(--cp-band-a)')
    const arrow = `url(#${markerId})`

    return (
      <div className="cp-wrap" ref={wrapRef} onScroll={sync}>
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label={label}
          style={{ width: `${width}px`, height: fixedHeight ? `${H}px` : 'auto' }}
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--cp-arrow)" />
            </marker>
          </defs>

          {layout.lanes.map((lane) => (
            <rect
              key={`band-${lane.lane.id}`}
              x={0}
              y={lane.y}
              width={W}
              height={LH}
              fill={band(lane.index)}
            />
          ))}

          {layout.stages.map((stage, i) => (
            <React.Fragment key={`stage-${i}`}>
              <g className="cp-stageh">
                <rect
                  x={stage.x + 1}
                  y={4}
                  width={stage.width - 2}
                  height={TOP - 10}
                  rx={6}
                  fill="var(--cp-stage)"
                />
                <text
                  className="cp-stage-t"
                  x={stage.x + stage.width / 2}
                  y={stage.textY}
                  textAnchor="middle"
                >
                  {stage.lines.map((line, k) => (
                    <tspan key={k} x={stage.x + stage.width / 2} dy={k ? 15 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
              {stage.separator ? (
                <line
                  x1={stage.x}
                  y1={TOP}
                  x2={stage.x}
                  y2={H}
                  stroke="var(--cp-line)"
                  strokeDasharray="2 4"
                />
              ) : null}
            </React.Fragment>
          ))}

          <g>
            {layout.edges.map((e, i) => (
              <path
                key={`edge-${i}`}
                d={`M${e.points.map((p) => `${p[0]},${p[1]}`).join(' L')}`}
                className={e.edge.alt ? 'cp-edge alt' : 'cp-edge'}
                markerEnd={arrow}
                data-edge={`${e.edge.from}-${e.edge.to}`}
              />
            ))}
          </g>
          <g>
            {layout.edges.map((e, i) =>
              e.label && e.edge.label ? (
                <g key={`label-${i}`} className="cp-elabel">
                  <rect
                    className="cp-elabel-r"
                    x={e.label.x}
                    y={e.label.y}
                    width={e.label.width}
                    height={e.label.height}
                    rx={3}
                  />
                  <text className="cp-elabel-t" x={e.label.x + 5} y={e.label.y + 13}>
                    {e.edge.label}
                  </text>
                </g>
              ) : null,
            )}
          </g>

          <g>
            {layout.steps.map((n) => {
              const classes = [
                'cp-node',
                n.step.open ? 'open' : '',
                n.step.auto ? 'has-auto' : '',
                n.decision ? 'dec' : '',
                selectedStepId === n.step.id ? 'sel' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g
                  key={n.step.id}
                  className={classes}
                  transform={`translate(${n.x},${n.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={withState(n.step.title, n.chip, n.autoTag)}
                  aria-expanded={selectedStepId === n.step.id}
                  aria-controls={panelId}
                  data-step-id={n.step.id}
                  onClick={(event) => onStep(n, event.currentTarget)}
                  onKeyDown={activate(n, onStep)}
                >
                  {n.decision ? (
                    <polygon
                      className="cp-box"
                      points={`0,${n.height / 2} ${n.width / 2},0 ${n.width},${n.height / 2} ${n.width / 2},${n.height}`}
                    />
                  ) : (
                    <rect className="cp-box" width={n.width} height={n.height} rx={8} />
                  )}
                  <text className="cp-node-t" x={n.width / 2} y={n.textY} textAnchor="middle">
                    {n.lines.map((line, k) => (
                      <tspan key={k} x={n.width / 2} dy={k ? 17 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {n.chip ? <Chip box={n.chip} /> : null}
                  {n.autoTag ? (
                    <g className="cp-atag">
                      <rect
                        className="cp-atag-r"
                        x={n.autoTag.x}
                        y={n.autoTag.y}
                        width={n.autoTag.width}
                        height={n.autoTag.height}
                        rx={7}
                      />
                      <text
                        className="cp-atag-t"
                        x={n.autoTag.x + n.autoTag.width / 2}
                        y={n.autoTag.y + 10.5}
                        textAnchor="middle"
                      >
                        {AUTO_LABEL}
                      </text>
                    </g>
                  ) : null}
                </g>
              )
            })}
          </g>

          {/* The lane labels: drawn last, over the steps, and shifted by the scroll. */}
          <g ref={labelsRef} data-lane-labels="">
            {layout.lanes.map((lane) => (
              <rect
                key={`lbg-${lane.lane.id}`}
                x={0}
                y={lane.y}
                width={LW}
                height={LH}
                fill={band(lane.index)}
              />
            ))}
            {TOP > 0 ? <rect x={0} y={0} width={LW} height={TOP} fill="var(--cp-bg)" /> : null}
            {layout.lanes.map((lane) => (
              <g
                key={lane.lane.id}
                className={lane.lane.open ? 'cp-laneh open' : 'cp-laneh'}
                tabIndex={0}
                role="button"
                aria-label={withState(`Дорожка «${lane.lane.title}»`, lane.chip)}
                aria-expanded={selectedLaneId === lane.lane.id}
                aria-controls={panelId}
                data-lane-id={lane.lane.id}
                onClick={(event) => onLane(lane, event.currentTarget)}
                onKeyDown={activate(lane, onLane)}
              >
                <rect
                  className="cp-hd"
                  x={3}
                  y={lane.y + 3}
                  width={LW - 8}
                  height={LH - 6}
                  rx={8}
                />
                <text className="cp-lane-t" x={14} y={lane.textY}>
                  {lane.lines.map((line, k) => (
                    <tspan key={k} x={14} dy={k ? 16 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {lane.chip ? <Chip box={lane.chip} /> : null}
              </g>
            ))}
          </g>
        </svg>
      </div>
    )
  },
)

/**
 * The accessible name of a step or a lane: its title plus what its box shows
 * as SVG text — the «вопрос открыт» chip, the «авто» tag. The `aria-label`
 * overrides the `<text>` children, so without this neither is announced.
 */
function withState(title: string, chip?: unknown, autoTag?: unknown): string {
  const state = [chip ? OPEN_LABEL : '', autoTag ? AUTO_LABEL : ''].filter(Boolean)
  return state.length ? `${title} — ${state.join(', ')}` : title
}

function Chip({ box }: { box: { x: number; y: number; width: number; height: number } }) {
  return (
    <g className="cp-chip">
      <rect
        className="cp-chip-r"
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={8}
      />
      <text className="cp-chip-t" x={box.x + box.width / 2} y={box.y + 12} textAnchor="middle">
        {OPEN_LABEL}
      </text>
    </g>
  )
}
