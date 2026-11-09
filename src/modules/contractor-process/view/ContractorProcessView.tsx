'use client'

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { ContractorProcess, ProcessLane, ProcessStep } from '@/lib/contractor-process'

import {
  layoutProcess,
  stageOfColumn,
  type LaneLayout,
  type MeasureText,
  type StepLayout,
} from '../layout'

import { ContractorProcessPlaceholder } from './ContractorProcessLayout'
import { ProcessDiagram, type DiagramHandle } from './ProcessDiagram'

/**
 * «Как работаем с исполнителями» (#545) — the interactive process map, ported
 * from the approved visual (`design-source/finance/contractor-process.visual.html`):
 * the legend bar with «Показать автоматизацию» and the two zoom modes, the main
 * diagram, the subprocess under it, and ONE details panel for both — a step's
 * «Сейчас» / «Автоматизация» / «Вопросы», a lane's «О роли» / «Вопросы».
 *
 * Text is measured with a canvas 2D context, as in the visual, so the diagram
 * is laid out on the client after mount; until then a placeholder holds the
 * frame. Where this differs from the visual (each one recorded in the PR):
 *   - on a narrow screen (≤900px) the default zoom is «100%» with horizontal
 *     scroll — the visual's fit-to-width shrinks a 12-column map to unreadable
 *     text on a phone (agent decision in the plan);
 *   - «Уместить по ширине» fits the diagram COLUMN, so an open panel narrows
 *     the diagram instead of pushing it under a horizontal scrollbar;
 *   - closing the panel puts focus back on the step or lane that opened it.
 */

type DiagramName = 'main' | 'sub'
type Selection = { diagram: DiagramName; kind: 'step' | 'lane'; id: string }
type Zoom = 'fit' | '100'

const NARROW = '(max-width: 900px)'

function canvasMeasure(): MeasureText {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) {
    // No 2D context (a locked-down browser): an average glyph width keeps the layout usable.
    return (text, font) => text.length * Number(/(\d+)px/.exec(font)?.[1] ?? 14) * 0.55
  }
  return (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

const safeId = (raw: string) => raw.replace(/[^A-Za-z0-9_-]/g, '')

// The server cannot measure text, so it renders the placeholder (`null`); the
// client's first snapshot is the canvas measure — one per page, stable.
let clientMeasure: MeasureText | null = null
const noSubscription = () => () => {}
const getClientMeasure = () => (clientMeasure ??= canvasMeasure())
const getServerMeasure = () => null

const subscribeNarrow = (onChange: () => void) => {
  const query = window.matchMedia(NARROW)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const getNarrow = () => window.matchMedia(NARROW).matches
const getServerNarrow = () => false

export function ContractorProcessView({ process }: { process: ContractorProcess }) {
  const measure = useSyncExternalStore(noSubscription, getClientMeasure, getServerMeasure)
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, getServerNarrow)
  // Until the member picks a zoom, it follows the screen: «100%» on a narrow one.
  const [zoomChoice, setZoom] = useState<Zoom | null>(null)
  const zoom: Zoom = zoomChoice ?? (narrow ? '100' : 'fit')
  const [autoView, setAutoView] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [columnWidth, setColumnWidth] = useState(0)

  const columnRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const openerRef = useRef<SVGGElement | null>(null)
  const pendingReveal = useRef(false)
  const diagrams = useRef<Record<DiagramName, DiagramHandle | null>>({ main: null, sub: null })

  const baseId = safeId(useId())
  const panelId = `cp-panel-${baseId}`

  const layout = useMemo(
    () => (measure ? layoutProcess(process, measure) : null),
    [process, measure],
  )

  useEffect(() => {
    const el = columnRef.current
    if (!el) return
    const update = () => setColumnWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [layout])

  const close = useCallback(() => {
    setSelection(null)
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) opener.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!selection) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selection, close])

  // After the panel opened: bring the step into view, and on a narrow screen
  // the panel under the diagram (the visual's `reveal` + `scrollIntoView`).
  useEffect(() => {
    if (!selection || !pendingReveal.current) return
    pendingReveal.current = false
    if (selection.kind === 'step') diagrams.current[selection.diagram]?.reveal(selection.id)
    if (window.matchMedia(NARROW).matches) panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  const open = (diagram: DiagramName, kind: Selection['kind'], id: string, el: SVGGElement) => {
    openerRef.current = el
    pendingReveal.current = true
    setSelection({ diagram, kind, id })
  }

  if (!layout) return <ContractorProcessPlaceholder />

  const { main, sub } = layout
  const fit = zoom === 'fit'
  const k = columnWidth > 0 ? columnWidth / main.width : 1
  const mainWidth = fit ? columnWidth || main.width : main.width
  const subWidth = sub ? (fit ? Math.round(sub.width * k) : sub.width) : 0

  const selectedStep = (diagram: DiagramName) =>
    selection?.diagram === diagram && selection.kind === 'step' ? selection.id : null
  const selectedLane = (diagram: DiagramName) =>
    selection?.diagram === diagram && selection.kind === 'lane' ? selection.id : null

  return (
    <div className={autoView ? 'cp-view cp-autoview' : 'cp-view'}>
      <div className="cp-bar">
        <Legend />
        <span className="cp-spacer" />
        <button
          type="button"
          className={autoView ? 'cp-btn on' : 'cp-btn'}
          aria-pressed={autoView}
          onClick={() => setAutoView((v) => !v)}
        >
          Показать автоматизацию
        </button>
        <button
          type="button"
          className={fit ? 'cp-btn' : 'cp-btn on'}
          aria-pressed={!fit}
          onClick={() => setZoom('100')}
        >
          100%
        </button>
        <button
          type="button"
          className={fit ? 'cp-btn on' : 'cp-btn'}
          aria-pressed={fit}
          onClick={() => setZoom('fit')}
        >
          Уместить по ширине
        </button>
      </div>

      <div className={selection ? 'cp-stage with-panel' : 'cp-stage'}>
        <div className="cp-col" ref={columnRef}>
          <ProcessDiagram
            ref={(h) => {
              diagrams.current.main = h
            }}
            layout={main}
            markerId={`cp-arrow-main-${baseId}`}
            width={mainWidth}
            fixedHeight={!fit}
            selectedStepId={selectedStep('main')}
            selectedLaneId={selectedLane('main')}
            panelId={panelId}
            label="Схема процесса"
            onStep={(n: StepLayout, el) => open('main', 'step', n.step.id, el)}
            onLane={(l: LaneLayout, el) => open('main', 'lane', l.lane.id, el)}
          />
          {sub && process.subprocess ? (
            <section className="cp-subp" aria-labelledby={`cp-subt-${baseId}`}>
              <h2 id={`cp-subt-${baseId}`}>{process.subprocess.title}</h2>
              {process.subprocess.about ? <p>{process.subprocess.about}</p> : null}
              <ProcessDiagram
                ref={(h) => {
                  diagrams.current.sub = h
                }}
                layout={sub}
                markerId={`cp-arrow-sub-${baseId}`}
                width={subWidth}
                fixedHeight={!fit}
                selectedStepId={selectedStep('sub')}
                selectedLaneId={selectedLane('sub')}
                panelId={panelId}
                label={`Схема «${process.subprocess.title}»`}
                onStep={(n: StepLayout, el) => open('sub', 'step', n.step.id, el)}
                onLane={(l: LaneLayout, el) => open('sub', 'lane', l.lane.id, el)}
              />
            </section>
          ) : null}
        </div>

        <aside
          id={panelId}
          ref={panelRef}
          className="cp-panel"
          aria-live="polite"
          aria-label="Подробности"
          data-cp-panel=""
        >
          {selection ? (
            <>
              <button
                type="button"
                className="cp-pclose"
                aria-label="Закрыть панель"
                title="Закрыть (Esc)"
                onClick={close}
              >
                ✕
              </button>
              <PanelBody process={process} selection={selection} />
            </>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function PanelBody({ process, selection }: { process: ContractorProcess; selection: Selection }) {
  const isSub = selection.diagram === 'sub'
  const lanes: ProcessLane[] = isSub ? (process.subprocess?.lanes ?? []) : process.lanes
  const steps: ProcessStep[] = isSub ? (process.subprocess?.steps ?? []) : process.steps

  if (selection.kind === 'lane') {
    const lane = lanes.find((l) => l.id === selection.id)
    if (!lane) return null
    return (
      <div data-cp-panel-kind="lane">
        <h2>{lane.title}</h2>
        {lane.about ? (
          <Section title="О роли">
            <pre>{lane.about}</pre>
          </Section>
        ) : null}
        {lane.q.length ? (
          <Section title="Вопросы">
            <Questions items={lane.q} open={Boolean(lane.open)} />
          </Section>
        ) : (
          <div className="cp-hint">Вопросов к этой дорожке нет.</div>
        )}
      </div>
    )
  }

  const step = steps.find((s) => s.id === selection.id)
  if (!step) return null
  const lane = lanes.find((l) => l.id === step.lane)
  const stage = isSub ? null : stageOfColumn(process.stages, step.col)
  const where = stage
    ? ` · ${stage.title}`
    : isSub && process.subprocess
      ? ` · ${process.subprocess.title}`
      : ''
  return (
    <div data-cp-panel-kind="step">
      <h2>{step.title}</h2>
      <div className="cp-meta">
        {lane?.title ?? ''}
        {where}
      </div>
      {step.now ? (
        <Section title="Сейчас">
          <pre>{step.now}</pre>
        </Section>
      ) : null}
      {step.auto ? (
        <Section title="Автоматизация">
          <pre>{step.auto}</pre>
        </Section>
      ) : null}
      {step.q.length ? (
        <Section title="Вопросы">
          <Questions items={step.q} open={Boolean(step.open)} />
        </Section>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  )
}

function Questions({ items, open }: { items: string[]; open: boolean }) {
  return (
    <ul>
      {items.map((q, i) => (
        <li key={i} className={open ? 'open' : undefined}>
          {q}
        </li>
      ))}
    </ul>
  )
}

/** The visual's legend: the three edge/box kinds and the «авто» tag. */
function Legend() {
  return (
    <>
      <span className="cp-it">
        <svg width="34" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="33" y2="5" stroke="var(--cp-arrow)" strokeWidth="1.4" />
        </svg>
        порядок шагов
      </span>
      <span className="cp-it">
        <svg width="34" height="10" aria-hidden="true">
          <line
            x1="1"
            y1="5"
            x2="33"
            y2="5"
            stroke="var(--cp-arrow)"
            strokeWidth="1.4"
            strokeDasharray="6 4"
          />
        </svg>
        обход, если условие выполнено
      </span>
      <span className="cp-it">
        <svg width="34" height="16" aria-hidden="true">
          <rect
            x="1"
            y="2"
            width="32"
            height="12"
            rx="3"
            fill="none"
            stroke="var(--cp-accent)"
            strokeWidth="1"
            strokeDasharray="5 3"
          />
        </svg>
        пунктир — вопрос открыт, нарисован предлагаемый вариант
      </span>
      <span className="cp-it">
        <svg width="34" height="16" aria-hidden="true">
          <rect
            x="1"
            y="1"
            width="32"
            height="14"
            rx="7"
            fill="var(--cp-chip)"
            stroke="var(--cp-node-line)"
            strokeWidth="1"
          />
          <text
            x="17"
            y="12"
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill="var(--cp-muted)"
          >
            авто
          </text>
        </svg>
        авто — можно автоматизировать
      </span>
    </>
  )
}
