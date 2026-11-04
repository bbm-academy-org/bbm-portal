'use client'

import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from 'lucide-react'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

import { plural } from '@/lib/path-map/derive'
import { inboundLinks, type InboundLinks } from '@/lib/path-map/links'
import { shortDate } from '@/lib/path-map/nav'
import {
  BEACON_ID,
  type Confidence,
  type PathMap,
  type PathNode,
  type PathObstacle,
  type PathTask,
  type PathTrack,
} from '@/lib/path-map/schema'
import { isTaskDone, MAX_TASK_DEPTH } from '@/lib/path-map/tasks'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { SheetTitle } from '@/ui/sheet'
import { Textarea } from '@/ui/textarea'

import {
  NEW_NODE_KIND,
  NODE_ACCUSATIVE,
  NODE_KIND,
  type NodeDraft,
  nodeExists,
  opensChoices,
  outcomeErrors,
  swapImpact,
  todayIso,
  type RunEdit,
} from './editing'
import { EditMenu, type EditMenuItem } from './EditMenu'
import { PM_KIT } from './kit'
import { ownerColor } from './labels'

/**
 * The editor's forms (#539): a node (station / barrier / fog), a track, the
 * beacon, and the barrier's task tree. They render inside the editor's side
 * Sheet (`PathMapEditor.tsx`).
 *
 * Content: the AddStation artboard of the owner's «Карта пути» canvas, vendored
 * as `design-source/path-map/AddStation.dc.html` — «Что должно стать правдой?»,
 * «что это открывает выше» with the «потому что» under it, «Насколько уверены?»
 * as three road swatches, and the Отмена / «Поставить на дорогу» footer. Its
 * «Режим встречи» button is out of scope. The swap dialog follows
 * `Roadside.dc.html`.
 *
 * #541 v2 (the owner rejected v1 as «все моветоны UI в одном месте»): every
 * control is the `@/ui` kit — Input / Textarea / Label / Checkbox / Select, a
 * Popover + Command combobox for the target, DropdownMenu row actions,
 * AlertDialog confirmations, Dialog for the swap. Groups are separated by
 * whitespace and a quiet heading, never a frame; regular weights except the
 * form title; one primary action. The rules and their sources are recorded
 * in the PR #541 body (UX-record).
 *
 * Every form validates in the browser first (a station needs «потому что»),
 * then shows whatever the server refused. A stale map is the editor's banner,
 * not the form's: the form keeps its input so nothing typed is lost.
 */

// ── small parts ──────────────────────────────────────────────────────────────

export function FormErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <div role="alert" className="pm-f-errors">
      <p>Не сохранено</p>
      <ul>
        {errors.map((e, i) => (
          <li key={`${i}:${e}`}>{e}</li>
        ))}
      </ul>
    </div>
  )
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')
  return (
    <div className="pm-f-field">
      <div className="pm-f-labelrow">
        <Label htmlFor={id} className="pm-f-label">
          {label}
        </Label>
        {required ? <span className="pm-f-req">обязательно</span> : null}
      </div>
      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="pm-f-error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="pm-f-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Related fields: `<fieldset>` + a quiet `<legend>` — grouped by space, not by a frame. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="pm-f-group">
      <legend className="pm-f-legend">{title}</legend>
      {children}
    </fieldset>
  )
}

/** A destructive or discarding confirmation: the kit AlertDialog, buttons in one row. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirm,
  cancel = 'Отмена',
  onConfirm,
  onCancel,
  busy,
  children,
}: {
  open: boolean
  title: string
  description?: string
  confirm: string
  cancel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  children?: React.ReactNode
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <AlertDialogContent className={`${PM_KIT} pm-f-alert`}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="pm-f-alert-footer">
          <AlertDialogCancel variant="ghost">{cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function titleOf(map: PathMap, id: string): string {
  if (id === BEACON_ID) return 'маяк'
  return map.tracks.flatMap((t) => t.nodes).find((n) => n.id === id)?.title ?? id
}

/** Named in the delete confirm; the rest are counted. */
const SHOWN_REFERRERS = 5

/**
 * The delete confirm's warning (#541 review): the blocks that lead into what
 * is being deleted, and — by default — repointing them to what it opened.
 */
function InboundWarning({
  map,
  links,
  scope,
  repoint,
  onRepoint,
}: {
  map: PathMap
  links: InboundLinks
  scope: 'node' | 'track'
  repoint: boolean
  onRepoint: (next: boolean) => void
}) {
  const id = useId()
  const n = links.referrers.length
  if (n === 0) return null
  const blocks = `${n} ${plural(n, 'блок', 'блока', 'блоков')}`
  const lead =
    scope === 'node'
      ? `На этот блок ${n === 1 ? 'ссылается' : 'ссылаются'} ${blocks} — их связь станет разрывом.`
      : `На блоки этого трека ${n === 1 ? 'ссылается' : 'ссылаются'} ${blocks} из других треков — их связь станет разрывом.`
  return (
    <div className="pm-f-inbound">
      <p>{lead}</p>
      <ul>
        {links.referrers.slice(0, SHOWN_REFERRERS).map(({ node, track }) => (
          <li key={node.id}>
            {NODE_KIND[node.type]} «{node.title}» · трек «{track.title}»
          </li>
        ))}
        {n > SHOWN_REFERRERS ? <li>и ещё {n - SHOWN_REFERRERS}</li> : null}
      </ul>
      {links.target ? (
        <div className="pm-f-check">
          <Checkbox id={id} checked={repoint} onCheckedChange={(v) => onRepoint(v === true)} />
          <Label htmlFor={id} className="pm-f-check-label">
            Перенаправить их на «{titleOf(map, links.target)}»
          </Label>
        </div>
      ) : null}
    </div>
  )
}

const CONFIDENCE_LOOK: Record<Confidence, { label: string; road: string; swatch: string }> = {
  known: { label: 'Знаем', road: 'асфальт', swatch: 'asphalt' },
  hypothesis: { label: 'Гипотеза', road: 'грунтовка', swatch: 'dirt' },
  unknown: { label: 'Не знаем', road: 'станет туманом', swatch: 'fog' },
}

/** One pick among two or three always-visible options (no menu to open). */
function Choice({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="pm-f-choice"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function ConfidencePicker({
  value,
  onChange,
}: {
  value: Confidence
  onChange: (next: Confidence) => void
}) {
  return (
    <Group title="Насколько уверены?">
      <div className="pm-f-choices pm-f-choices--3">
        {(['known', 'hypothesis', 'unknown'] as const).map((c) => (
          <Choice key={c} pressed={value === c} onClick={() => onChange(c)}>
            <span className="pm-f-road" data-kind={CONFIDENCE_LOOK[c].swatch} aria-hidden="true" />
            <span className="pm-f-choice-text">
              <span>{CONFIDENCE_LOOK[c].label}</span>
              <span className="pm-f-choice-note">{CONFIDENCE_LOOK[c].road}</span>
            </span>
          </Choice>
        ))}
      </div>
    </Group>
  )
}

const NOWHERE = '__none'

/** Plain substring search (cmdk's default is fuzzy: «НМО» matched «Промомед»). */
function containsFilter(value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLowerCase()
  if (!needle) return 1
  return [value, ...(keywords ?? [])].join(' ').toLowerCase().includes(needle) ? 1 : 0
}

/**
 * «Что это открывает выше?» / «Куда ведёт?»: ONE combobox (#541 v2 — a kit
 * Popover + Command, the shadcn combobox pattern). The trigger shows the
 * current target; the list searches every block of the map, grouped — the
 * beacon and «никуда» first, then this road above the block, then each other
 * track.
 */
function OpensPicker({
  map,
  trackId,
  index,
  existing,
  selfId,
  value,
  onChange,
  label,
  hint,
}: {
  map: PathMap
  trackId: string
  index: number
  existing: boolean
  selfId?: string
  value: string
  onChange: (next: string) => void
  label: string
  hint?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const hintId = `${id}-hint`
  const { above, others } = opensChoices(map, trackId, index, existing, selfId)

  const node =
    value && value !== BEACON_ID
      ? map.tracks.flatMap((t) => t.nodes).find((n) => n.id === value)
      : undefined
  const current =
    value === BEACON_ID ? (
      <span>Маяк</span>
    ) : !value ? (
      <span className="pm-f-muted">Никуда — дорога обрывается</span>
    ) : node ? (
      <span className="pm-f-target">
        <span className="pm-f-kind" data-type={node.type}>
          {NODE_KIND[node.type]}
        </span>
        <span className="pm-f-target-title">{node.title}</span>
      </span>
    ) : !nodeExists(map, value) ? (
      <span className="pm-f-error">«{value}» — такого блока нет</span>
    ) : (
      <span>{titleOf(map, value)}</span>
    )

  const pick = (next: string) => {
    onChange(next === NOWHERE ? '' : next)
    setOpen(false)
  }
  const item = (n: PathNode) => (
    <CommandItem
      key={n.id}
      value={`${n.id} ${n.title}`}
      keywords={[NODE_KIND[n.type]]}
      data-checked={value === n.id}
      onSelect={() => pick(n.id)}
    >
      <span className="pm-f-target">
        <span className="pm-f-kind" data-type={n.type}>
          {NODE_KIND[n.type]}
        </span>
        <span className="pm-f-target-title">{n.title}</span>
      </span>
    </CommandItem>
  )

  return (
    <div className="pm-f-field">
      <Label htmlFor={id} className="pm-f-label">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={hint ? hintId : undefined}
            className="pm-f-combo"
          >
            {current}
            <ChevronsUpDownIcon className="pm-f-combo-icon" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={`${PM_KIT} pm-f-combo-pop`} align="start" aria-label={label}>
          <Command filter={containsFilter}>
            <CommandInput placeholder="Найти блок…" aria-label="Найти блок" />
            <CommandList>
              <CommandEmpty>Ничего не нашлось</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={`${BEACON_ID} Маяк`}
                  data-checked={value === BEACON_ID}
                  onSelect={() => pick(BEACON_ID)}
                >
                  Маяк
                </CommandItem>
                <CommandItem
                  value={`${NOWHERE} Никуда дорога обрывается`}
                  data-checked={!value}
                  onSelect={() => pick(NOWHERE)}
                >
                  <span className="pm-f-muted">Никуда — дорога обрывается</span>
                </CommandItem>
              </CommandGroup>
              {above.length > 0 ? (
                <CommandGroup heading="Выше на этой дороге">{above.map(item)}</CommandGroup>
              ) : null}
              {others.map(({ track, nodes }) => (
                <CommandGroup key={track.id} heading={`Трек «${track.title}»`}>
                  {nodes.map(item)}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hint ? (
        <p id={hintId} className="pm-f-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** What is being edited (the Sheet's title) and where it sits (a muted line under it). */
function PanelHead({
  title,
  context,
  onClose,
}: {
  title: string
  context?: string
  onClose: () => void
}) {
  return (
    <div className="pm-f-head">
      <div className="pm-f-head-text">
        <SheetTitle className="pm-f-title">{title}</SheetTitle>
        {context ? <p className="pm-f-context">{context}</p> : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Закрыть"
        className="pm-f-close"
        onClick={onClose}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  )
}

function FormFooter({
  submit,
  busy,
  onCancel,
}: {
  submit: string
  busy: boolean
  onCancel: () => void
}) {
  return (
    <div className="pm-f-footer">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Отмена
      </Button>
      <Button type="submit" disabled={busy}>
        {submit}
      </Button>
    </div>
  )
}

/** A secondary section after the footer (tasks, focus): a quiet heading, then rows. */
function Section({
  label,
  title,
  hint,
  children,
}: {
  label: string
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="pm-f-sec" aria-label={label}>
      <div className="pm-f-sec-head">
        <h3 className="pm-f-sec-title">{title}</h3>
        {hint ? <p className="pm-f-hint">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Rarely used fields, collapsed: a quiet disclosure row. */
function More({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible className="pm-f-more" defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="pm-f-more-trigger">
          {title}
          <ChevronDownIcon aria-hidden="true" className="pm-f-more-icon" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pm-f-more-body">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** The delete action, apart from everything else, at the bottom of a form. */
function DangerZone({ children }: { children: React.ReactNode }) {
  return <div className="pm-ed-danger">{children}</div>
}

function DeleteButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="pm-f-delete" onClick={onClick}>
      {children}
    </Button>
  )
}

/**
 * Reports dirtiness up whenever the serialised form state differs from its
 * start, or `also` says a nested draft (a task row) holds unsaved text.
 */
function useDirty(state: unknown, onDirty: (dirty: boolean) => void, also = false) {
  const [initial] = useState(() => JSON.stringify(state))
  const dirty = also || JSON.stringify(state) !== initial
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  return dirty
}

/** Focus the first field marked invalid after a refused submit. */
function focusFirstInvalid(form: HTMLFormElement | null) {
  const el = form?.querySelector<HTMLElement>('[aria-invalid="true"]')
  el?.focus()
}

// ── node form ────────────────────────────────────────────────────────────────

export type NodeTarget =
  | { mode: 'edit'; nodeId: string }
  | { mode: 'new'; trackId: string; index: number; type?: PathNode['type'] }

function locate(map: PathMap, nodeId: string) {
  for (const track of map.tracks) {
    const index = track.nodes.findIndex((n) => n.id === nodeId)
    if (index >= 0) return { track, index, node: track.nodes[index] }
  }
  return null
}

const TITLE_LABEL: Record<PathNode['type'], string> = {
  station: 'Что должно стать правдой?',
  obstacle: 'Что мешает проехать?',
  fog: 'Какой вопрос пока без ответа?',
}

export function NodeForm({
  map,
  target,
  run,
  busy,
  onDirty,
  onDraft,
  onDone,
  onClose,
}: {
  map: PathMap
  target: NodeTarget
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  /** A new block mirrors its type, title and confidence on the road's placeholder card. */
  onDraft?: (draft: NodeDraft) => void
  onDone: () => void
  onClose: () => void
}) {
  const found = target.mode === 'edit' ? locate(map, target.nodeId) : null
  const node = found?.node
  const trackId = found?.track.id ?? (target.mode === 'new' ? target.trackId : '')
  const index = found?.index ?? (target.mode === 'new' ? target.index : 0)
  const track = map.tracks.find((t) => t.id === trackId)

  const defaultOpens = () => {
    const above = track?.nodes[index]
    return above ? above.id : BEACON_ID
  }

  const type: PathNode['type'] =
    node?.type ?? (target.mode === 'new' ? (target.type ?? 'station') : 'station')
  const [title, setTitle] = useState(node?.title ?? '')
  const [because, setBecause] = useState(node?.type === 'station' ? (node.because ?? '') : '')
  const [confidence, setConfidence] = useState<Confidence>(
    node?.type === 'station' ? node.confidence : 'hypothesis',
  )
  const [owner, setOwner] = useState(node?.owner ?? '')
  const [opens, setOpens] = useState(node ? (node.opens ?? '') : defaultOpens())
  const [removed, setRemoved] = useState(node?.type === 'obstacle' ? Boolean(node.done) : false)
  const [removedOn, setRemovedOn] = useState(
    node?.type === 'obstacle' && node.done ? node.done : todayIso(),
  )
  const [errors, setErrors] = useState<{ title?: string; because?: string }>({})
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [repoint, setRepoint] = useState(true)
  const formRef = useRef<HTMLFormElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const removedId = useId()
  // Text typed into a task row of the barrier counts as unsaved too (#541 re-review).
  const [tasksDirty, setTasksDirty] = useState(false)

  useDirty({ title, because, confidence, owner, opens, removed, removedOn }, onDirty, tasksDirty)

  const isNew = target.mode === 'new'
  // A «+» slot's trigger unmounts when its placeholder takes the spot: focus
  // goes to the form's first field, not to <body> (#541 re-review).
  useEffect(() => {
    if (isNew) titleRef.current?.focus()
  }, [isNew])
  useEffect(() => {
    if (isNew) onDraft?.({ type, title, confidence })
  }, [isNew, onDraft, type, title, confidence])

  if (target.mode === 'edit' && !found) {
    return (
      <div className="pm-f-form">
        <PanelHead title="Блока больше нет на карте" onClose={onClose} />
        <p className="pm-f-hint">Его удалили или переименовали — выберите другой блок.</p>
      </div>
    )
  }

  const kind = NODE_KIND[type]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!title.trim()) next.title = type === 'fog' ? 'Сформулируйте вопрос' : 'Введите название'
    if (type === 'station' && !because.trim()) {
      next.because =
        'Без «потому что» станция не встанет на дорогу — напишите, чем она приближает маяк'
    }
    setErrors(next)
    setServerErrors([])
    if (next.title || next.because) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    const fields = {
      title,
      owner: type === 'obstacle' ? owner : node?.owner,
      opens: opens || undefined,
      ...(type === 'station' ? { because, confidence } : {}),
      ...(type === 'obstacle' && removed ? { done: removedOn } : {}),
    }
    const outcome = await run(
      isNew
        ? { op: 'node.add', trackId, index, type, fields }
        : { op: 'node.update', nodeId: node!.id, fields },
    )
    if (outcome.status === 'ok') onDone()
    else setServerErrors(outcomeErrors(outcome))
  }

  const move = async (command: Parameters<RunEdit>[0]) => {
    setServerErrors([])
    const outcome = await run(command)
    if (outcome.status !== 'ok') setServerErrors(outcomeErrors(outcome))
  }

  const otherTracks = map.tracks.filter((t) => t.id !== trackId)
  const links = node ? inboundLinks(map, [node.id]) : null
  const opensPicker = (label: string, hint?: string) => (
    <OpensPicker
      map={map}
      trackId={trackId}
      index={index}
      existing={!isNew}
      selfId={node?.id}
      value={opens}
      onChange={setOpens}
      label={label}
      hint={hint}
    />
  )

  return (
    <form
      ref={formRef}
      className="pm-f-form"
      onSubmit={submit}
      noValidate
      aria-label={isNew ? NEW_NODE_KIND[type] : `${kind}: ${node!.title}`}
    >
      <PanelHead
        title={isNew ? NEW_NODE_KIND[type] : kind}
        context={`Трек «${track?.title ?? trackId}»`}
        onClose={onClose}
      />

      <div className="pm-f-fields">
        <Field label={TITLE_LABEL[type]} error={errors.title}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              ref={titleRef}
              id={id}
              rows={2}
              value={title}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              maxLength={300}
              onChange={(e) => {
                setTitle(e.target.value)
                if (errors.title) setErrors({ ...errors, title: undefined })
              }}
            />
          )}
        </Field>

        {type === 'station' ? (
          <>
            <Group title="Зачем она нужна">
              {opensPicker('Что это открывает выше?')}
              <Field
                label="Потому что"
                required
                hint="Чем станция приближает маяк. Без этого она встанет на обочину серой."
                error={errors.because}
              >
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    value={because}
                    rows={2}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    maxLength={1000}
                    onChange={(e) => {
                      setBecause(e.target.value)
                      if (errors.because) setErrors({ ...errors, because: undefined })
                    }}
                  />
                )}
              </Field>
            </Group>
            <ConfidencePicker value={confidence} onChange={setConfidence} />
          </>
        ) : null}

        {type === 'obstacle' ? (
          <>
            {opensPicker('Куда ведёт?')}
            <Group title="Кто и когда снимает">
              <Field label="Кто снимает" hint="Метка или имя, например «ДС»">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    className="pm-f-short"
                    value={owner}
                    aria-describedby={describedBy}
                    maxLength={40}
                    onChange={(e) => setOwner(e.target.value)}
                  />
                )}
              </Field>
              <div className="pm-f-check">
                <Checkbox
                  id={removedId}
                  checked={removed}
                  onCheckedChange={(v) => setRemoved(v === true)}
                />
                <Label htmlFor={removedId} className="pm-f-check-label">
                  Снят — уходит в «Пройденный путь»
                </Label>
              </div>
              {removed ? (
                <Field label="Дата">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      className="pm-f-short"
                      value={removedOn}
                      onChange={(e) => setRemovedOn(e.target.value || todayIso())}
                    />
                  )}
                </Field>
              ) : null}
            </Group>
            {isNew ? (
              <p className="pm-f-hint">Задачи можно добавить, когда шлагбаум встанет на дорогу.</p>
            ) : null}
          </>
        ) : null}

        {type === 'fog'
          ? opensPicker(
              'Куда ведёт?',
              'Туман — открытый вопрос. Без цели дорога на нём обрывается, с целью — «доходит через туман».',
            )
          : null}
      </div>

      <FormErrors errors={serverErrors} />
      <FormFooter
        submit={isNew ? 'Поставить на дорогу' : 'Сохранить'}
        busy={busy}
        onCancel={onClose}
      />

      {!isNew && node?.type === 'obstacle' ? (
        <TaskTreeEditor obstacle={node} run={run} busy={busy} onDirty={setTasksDirty} />
      ) : null}

      {!isNew && node && track ? (
        <More title="Переместить">
          <p className="pm-f-hint">Перемещение сохраняется сразу.</p>
          <div className="pm-f-row" role="group" aria-label="Положение на дороге">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || index >= track.nodes.length - 1}
              onClick={() => move({ op: 'node.move', nodeId: node.id, trackId, index: index + 1 })}
            >
              ↑ Выше
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || index === 0}
              onClick={() => move({ op: 'node.move', nodeId: node.id, trackId, index: index - 1 })}
            >
              ↓ Ниже
            </Button>
          </div>
          {otherTracks.length > 0 ? (
            <Select
              value=""
              disabled={busy}
              onValueChange={(to) => {
                const dest = map.tracks.find((t) => t.id === to)
                if (dest)
                  void move({
                    op: 'node.move',
                    nodeId: node.id,
                    trackId: dest.id,
                    index: dest.nodes.length,
                  })
              }}
            >
              <SelectTrigger size="sm" aria-label="Перенести в трек" className="pm-f-short">
                <SelectValue placeholder="Перенести в трек…" />
              </SelectTrigger>
              <SelectContent className={PM_KIT} position="popper">
                {otherTracks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </More>
      ) : null}

      {!isNew && node && links ? (
        <DangerZone>
          <DeleteButton onClick={() => setConfirmDelete(true)}>
            Удалить {NODE_ACCUSATIVE[type]}
          </DeleteButton>
          <ConfirmDialog
            open={confirmDelete}
            title={`Удалить «${node.title}» с карты?`}
            confirm="Удалить"
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              setConfirmDelete(false)
              const outcome = await run({
                op: 'node.remove',
                nodeId: node.id,
                ...(links.referrers.length > 0
                  ? { inbound: repoint && links.target ? 'repoint' : 'break' }
                  : {}),
              })
              if (outcome.status === 'ok') onDone()
              else setServerErrors(outcomeErrors(outcome))
            }}
          >
            <InboundWarning
              map={map}
              links={links}
              scope="node"
              repoint={repoint}
              onRepoint={setRepoint}
            />
          </ConfirmDialog>
        </DangerZone>
      ) : null}
    </form>
  )
}

// ── barrier task tree ────────────────────────────────────────────────────────

interface TaskDraft {
  title: string
  owner: string
  link: string
}

function TaskFieldsForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  onDirty,
}: {
  initial: TaskDraft
  submitLabel: string
  busy: boolean
  onSubmit: (draft: TaskDraft) => Promise<string[]>
  onCancel: () => void
  /** Whether the draft differs from `initial` — the editor's unsaved-input confirm. */
  onDirty?: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<{ field: 'title' | 'link'; text: string } | null>(null)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const titleRef = useRef<HTMLInputElement | null>(null)
  const linkRef = useRef<HTMLInputElement | null>(null)
  const ids = useId()
  const errorId = `${ids}-error`
  useEffect(() => titleRef.current?.focus(), [])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

  const save = async () => {
    if (!draft.title.trim()) {
      setError({ field: 'title', text: 'Введите задачу' })
      titleRef.current?.focus()
      return
    }
    if (draft.link.trim() && !/^https?:\/\/\S+$/.test(draft.link.trim())) {
      setError({ field: 'link', text: 'Ссылка должна начинаться с http:// или https://' })
      linkRef.current?.focus()
      return
    }
    setError(null)
    setServerErrors(await onSubmit(draft))
  }
  const invalid = (field: 'title' | 'link') =>
    error?.field === field ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {}
  const errorFor = (field: 'title' | 'link') =>
    error?.field === field ? (
      <p id={errorId} className="pm-f-error">
        {error.text}
      </p>
    ) : null

  return (
    <div
      className="pm-f-taskform"
      role="group"
      aria-label={submitLabel}
      // Esc cancels this row only — the Sheet's Esc (close the panel) skips
      // a `data-esc-local` subtree (#541 re-review).
      data-esc-local=""
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          void save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="pm-f-field">
        <Label htmlFor={`${ids}-title`} className="pm-f-label">
          Задача
        </Label>
        <Input
          ref={titleRef}
          id={`${ids}-title`}
          placeholder="Что сделать"
          value={draft.title}
          {...invalid('title')}
          maxLength={300}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        {errorFor('title')}
      </div>
      <div className="pm-f-pair">
        <div className="pm-f-field pm-f-field--owner">
          <Label htmlFor={`${ids}-owner`} className="pm-f-label">
            Исполнитель
          </Label>
          <Input
            id={`${ids}-owner`}
            placeholder="Кто"
            value={draft.owner}
            maxLength={40}
            onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
          />
        </div>
        <div className="pm-f-field pm-f-field--grow">
          <Label htmlFor={`${ids}-link`} className="pm-f-label">
            Ссылка
          </Label>
          <Input
            ref={linkRef}
            id={`${ids}-link`}
            placeholder="https://…"
            value={draft.link}
            {...invalid('link')}
            maxLength={2000}
            onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          />
          {errorFor('link')}
        </div>
      </div>
      <FormErrors errors={serverErrors} />
      <div className="pm-f-row pm-f-row--end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

type RowMode = 'view' | 'edit' | 'add' | 'delete'

/**
 * One task row: a done checkbox and the title (with the owner label when set)
 * — every other action is in the row's «⋯» menu, and editing expands inline
 * under the row.
 */
function TaskEditItem({
  obstacle,
  task,
  path,
  siblings,
  run,
  busy,
  onShift,
  onDirty,
}: {
  obstacle: PathObstacle
  task: PathTask
  path: number[]
  siblings: number
  run: RunEdit
  busy: boolean
  /** A row was deleted or moved: every open row draft is closed (indices shifted). */
  onShift: () => void
  onDirty: (key: string, dirty: boolean) => void
}) {
  const [mode, setMode] = useState<RowMode>('view')
  const [errors, setErrors] = useState<string[]>([])
  const done = isTaskDone(task)
  const children = task.tasks ?? []
  const at = path[path.length - 1]
  const expectTitle = task.title
  // `path` is a fresh array each render; its joined form is the row's identity.
  const pathKey = path.join('.')
  const reportDirty = useCallback((dirty: boolean) => onDirty(pathKey, dirty), [onDirty, pathKey])
  const reportAddDirty = useCallback(
    (dirty: boolean) => onDirty(`${pathKey}+`, dirty),
    [onDirty, pathKey],
  )

  const exec = async (command: Parameters<RunEdit>[0]): Promise<string[]> => {
    const outcome = await run(command)
    if (outcome.status === 'ok') {
      setMode('view')
      setErrors([])
      if (command.op === 'task.remove' || command.op === 'task.move') onShift()
      return []
    }
    const errs = outcomeErrors(outcome)
    setErrors(errs)
    return errs
  }

  const items: EditMenuItem[] = [
    { label: 'Изменить…', onSelect: () => setMode('edit') },
    {
      label: 'Добавить подзадачу',
      disabled: path.length >= MAX_TASK_DEPTH,
      onSelect: () => setMode('add'),
    },
    {
      label: 'Выше',
      disabled: at === 0,
      onSelect: () =>
        void exec({ op: 'task.move', nodeId: obstacle.id, path, expectTitle, delta: -1 }),
    },
    {
      label: 'Ниже',
      disabled: at >= siblings - 1,
      onSelect: () =>
        void exec({ op: 'task.move', nodeId: obstacle.id, path, expectTitle, delta: 1 }),
    },
    { label: 'Удалить…', danger: true, onSelect: () => setMode('delete') },
  ]

  return (
    <li className="pm-f-task" data-done={done ? 'true' : undefined} data-path={pathKey}>
      <div className="pm-f-task-row">
        <Checkbox
          checked={done}
          aria-label={`Выполнено: ${task.title}`}
          className="pm-f-task-check"
          disabled={busy}
          onCheckedChange={() =>
            void exec({
              op: 'task.toggle',
              nodeId: obstacle.id,
              path,
              expectTitle,
              date: todayIso(),
            })
          }
        />
        <span className="pm-f-task-title">
          {task.title}
          {typeof task.done === 'string' ? (
            <span className="pm-f-task-date"> · {shortDate(task.done)}</span>
          ) : null}
        </span>
        {task.owner ? (
          <span className="pm-f-task-owner" style={{ color: ownerColor(task.owner) }}>
            {task.owner}
          </span>
        ) : null}
        <EditMenu
          look="quiet"
          className="pm-ed-taskmenu"
          label={`Действия с задачей «${task.title}»`}
          disabled={busy}
          items={items}
        />
      </div>
      {mode === 'edit' ? (
        <TaskFieldsForm
          initial={{ title: task.title, owner: task.owner ?? '', link: task.link ?? '' }}
          submitLabel="Сохранить задачу"
          busy={busy}
          onCancel={() => setMode('view')}
          onDirty={reportDirty}
          onSubmit={(d) =>
            exec({ op: 'task.update', nodeId: obstacle.id, path, expectTitle, fields: d })
          }
        />
      ) : null}
      <ConfirmDialog
        open={mode === 'delete'}
        title={
          children.length > 0
            ? `Удалить «${task.title}» вместе с подзадачами?`
            : `Удалить «${task.title}»?`
        }
        confirm="Удалить"
        busy={busy}
        onCancel={() => setMode('view')}
        onConfirm={() => void exec({ op: 'task.remove', nodeId: obstacle.id, path, expectTitle })}
      />
      {errors.length > 0 && mode === 'view' ? <FormErrors errors={errors} /> : null}
      {children.length > 0 || mode === 'add' ? (
        <ul className="pm-f-tasks pm-f-tasks--nested">
          {children.map((child, i) => (
            <TaskEditItem
              key={i}
              obstacle={obstacle}
              task={child}
              path={[...path, i]}
              siblings={children.length}
              run={run}
              busy={busy}
              onShift={onShift}
              onDirty={onDirty}
            />
          ))}
          {mode === 'add' ? (
            <li className="pm-f-task-new">
              <TaskFieldsForm
                initial={{ title: '', owner: '', link: '' }}
                submitLabel="Добавить подзадачу"
                busy={busy}
                onCancel={() => setMode('view')}
                onDirty={reportAddDirty}
                onSubmit={(d) =>
                  exec({
                    op: 'task.add',
                    nodeId: obstacle.id,
                    parent: path,
                    parentTitle: expectTitle,
                    fields: d,
                  })
                }
              />
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

export function TaskTreeEditor({
  obstacle,
  run,
  busy,
  onDirty,
}: {
  obstacle: PathObstacle
  run: RunEdit
  busy: boolean
  /** Whether any task draft holds unsaved text. */
  onDirty?: (dirty: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  // Bumped when a row is deleted or moved: the rows are keyed by index, so
  // every row remounts and no open draft is left over another task (#541
  // re-review). The server refuses a mismatched title regardless.
  const [epoch, setEpoch] = useState(0)
  const onShift = useCallback(() => setEpoch((n) => n + 1), [])
  const drafts = useRef(new Set<string>())
  const onDirtyRef = useRef(onDirty)
  useEffect(() => {
    onDirtyRef.current = onDirty
  })
  const report = useCallback((key: string, dirty: boolean) => {
    const before = drafts.current.size
    if (dirty) drafts.current.add(key)
    else drafts.current.delete(key)
    if (before > 0 !== drafts.current.size > 0) onDirtyRef.current?.(drafts.current.size > 0)
  }, [])
  const reportNew = useCallback((dirty: boolean) => report('+', dirty), [report])
  const tasks = obstacle.tasks ?? []
  return (
    <Section label="Задачи шлагбаума" title="Задачи" hint="Каждое изменение сохраняется сразу.">
      {tasks.length > 0 ? (
        <ul className="pm-f-tasks">
          {tasks.map((task, i) => (
            <TaskEditItem
              key={`${epoch}:${i}`}
              obstacle={obstacle}
              task={task}
              path={[i]}
              siblings={tasks.length}
              run={run}
              busy={busy}
              onShift={onShift}
              onDirty={report}
            />
          ))}
        </ul>
      ) : (
        <p className="pm-f-hint">Задач пока нет.</p>
      )}
      {adding ? (
        <TaskFieldsForm
          initial={{ title: '', owner: '', link: '' }}
          submitLabel="Добавить задачу"
          busy={busy}
          onCancel={() => setAdding(false)}
          onDirty={reportNew}
          onSubmit={async (d) => {
            const outcome = await run({
              op: 'task.add',
              nodeId: obstacle.id,
              parent: [],
              fields: d,
            })
            if (outcome.status === 'ok') {
              setAdding(false)
              return []
            }
            return outcomeErrors(outcome)
          }}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="pm-f-add"
          aria-label="+ Задача"
          onClick={() => setAdding(true)}
        >
          <PlusIcon aria-hidden="true" />
          Задача
        </Button>
      )}
    </Section>
  )
}

// ── the swap dialog (Roadside.dc.html) ───────────────────────────────────────

/**
 * «Фокус полон»: which focus track goes to the roadside. The kit Dialog (#541
 * v2): focus moves in and is trapped, Esc cancels; on close the editor puts
 * focus back on whatever opened it (`onReturnFocus`).
 */
export function SwapDialog({
  map,
  incoming,
  busy,
  onCancel,
  onSwap,
  onReturnFocus,
}: {
  map: PathMap
  incoming: PathTrack
  busy: boolean
  onCancel: () => void
  onSwap: (outgoingId: string) => void
  /** Called instead of Radix's own return of focus when the dialog closes. */
  onReturnFocus?: () => void
}) {
  const focus = map.tracks.filter((t) => t.status === 'focus')
  const [choice, setChoice] = useState<string | null>(null)
  const groupRef = useRef<HTMLDivElement | null>(null)

  // One tab stop for the radio group: the checked radio, else the first.
  const checkedAt = focus.findIndex((t) => t.id === choice)
  const stop = checkedAt >= 0 ? checkedAt : 0
  /** ↑/←/↓/→ (and Home/End) move to the next radio and check it, wrapping (#541 re-review). */
  const onRadioKey = (e: React.KeyboardEvent) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [],
    )
    const from = radios.indexOf(document.activeElement as HTMLElement)
    let to: number
    if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = focus.length - 1
    else if (step !== 0 && from >= 0) to = (from + step + focus.length) % focus.length
    else return
    e.preventDefault()
    setChoice(focus[to].id)
    radios[to]?.focus()
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent
        className={`${PM_KIT} pm-f-dialog`}
        showCloseButton={false}
        aria-label="Вывести трек в фокус"
        aria-labelledby={undefined}
        onCloseAutoFocus={(e) => {
          if (!onReturnFocus) return
          e.preventDefault()
          onReturnFocus()
        }}
      >
        <div className="pm-f-dialog-head">
          <DialogTitle className="pm-f-title">Какой трек уходит на обочину?</DialogTitle>
          <DialogDescription className="pm-f-hint">
            {`Фокус полон (${focus.length} из ${map.limits.focus_tracks}). Чтобы вывести «${incoming.title}» на дорогу, один трек из фокуса уйдёт на обочину.`}
          </DialogDescription>
        </div>
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label="Трек для обочины"
          className="pm-f-radios"
          onKeyDown={onRadioKey}
        >
          {focus.map((t, i) => (
            <Button
              key={t.id}
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={choice === t.id}
              tabIndex={i === stop ? 0 : -1}
              className="pm-f-radio"
              onClick={() => setChoice(t.id)}
            >
              <span className="pm-f-radio-mark" aria-hidden="true">
                {choice === t.id ? <CheckIcon /> : null}
              </span>
              <span className="pm-f-choice-text">
                <span>{t.title}</span>
                <span className="pm-f-choice-note">{swapImpact(t)}</span>
              </span>
            </Button>
          ))}
        </div>
        <p className="pm-f-hint">
          Трек на обочине остаётся на карте со всеми станциями. Вернуть его можно так же — обменом.
        </p>
        <div className="pm-f-row pm-f-row--end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="button" disabled={!choice || busy} onClick={() => choice && onSwap(choice)}>
            Поменять местами
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── track form ───────────────────────────────────────────────────────────────

export function TrackForm({
  map,
  trackId,
  initialDelete,
  run,
  busy,
  onDirty,
  onDone,
  onClose,
  onSwap,
}: {
  map: PathMap
  /** `null` — a new track. */
  trackId: string | null
  /** Opened from the track menu's «Удалить трек…»: the confirm is shown at once. */
  initialDelete?: boolean
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  onDone: () => void
  onClose: () => void
  /** Bringing a roadside track into a FULL focus: open the swap dialog. */
  onSwap: (trackId: string) => void
}) {
  const track = trackId ? map.tracks.find((t) => t.id === trackId) : undefined
  const focusCount = map.tracks.filter((t) => t.status === 'focus').length
  const focusFull = focusCount >= map.limits.focus_tracks
  const [title, setTitle] = useState(track?.title ?? '')
  const [short, setShort] = useState(track?.short ?? '')
  const [status, setStatus] = useState<'focus' | 'roadside'>(focusFull ? 'roadside' : 'focus')
  const [error, setError] = useState<string | undefined>()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(Boolean(initialDelete))
  const [repoint, setRepoint] = useState(true)
  const formRef = useRef<HTMLFormElement | null>(null)
  useDirty({ title, short, status }, onDirty)

  if (trackId && !track) {
    return (
      <div className="pm-f-form">
        <PanelHead title="Трека больше нет на карте" onClose={onClose} />
      </div>
    )
  }

  const exec = async (command: Parameters<RunEdit>[0], close: boolean) => {
    setServerErrors([])
    const outcome = await run(command)
    if (outcome.status === 'ok') {
      if (close) onDone()
      return true
    }
    setServerErrors(outcomeErrors(outcome))
    return false
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Введите название трека')
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    setError(undefined)
    await exec(
      track
        ? { op: 'track.update', trackId: track.id, title, short: short || undefined }
        : { op: 'track.add', title, short: short || undefined, status },
      true,
    )
  }

  const links = track
    ? inboundLinks(
        map,
        track.nodes.map((n) => n.id),
      )
    : null

  return (
    <form
      ref={formRef}
      className="pm-f-form"
      onSubmit={submit}
      noValidate
      aria-label={track ? `Трек «${track.title}»` : 'Новый трек'}
    >
      <PanelHead
        title={track ? 'Трек' : 'Новый трек'}
        context={track ? undefined : 'Новая дорога к маяку'}
        onClose={onClose}
      />
      <div className="pm-f-fields">
        <Field label="Название" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={title}
              maxLength={120}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        {!track ? (
          <Group title="Куда ставим">
            <div className="pm-f-choices pm-f-choices--2">
              <Choice
                pressed={status === 'focus'}
                disabled={focusFull}
                onClick={() => setStatus('focus')}
              >
                <span className="pm-f-choice-text">
                  <span>В фокус</span>
                  {focusFull ? (
                    <span className="pm-f-choice-note">
                      фокус полон ({focusCount} из {map.limits.focus_tracks})
                    </span>
                  ) : (
                    <span className="pm-f-choice-note">на дорогу</span>
                  )}
                </span>
              </Choice>
              <Choice pressed={status === 'roadside'} onClick={() => setStatus('roadside')}>
                <span className="pm-f-choice-text">
                  <span>На обочину</span>
                  <span className="pm-f-choice-note">видно, но вне фокуса</span>
                </span>
              </Choice>
            </div>
          </Group>
        ) : null}
        <More title="Дополнительно" defaultOpen={Boolean(track?.short)}>
          <Field
            label="Короткое имя"
            hint="Для вкладок на телефоне. Пусто — покажем полное название."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                className="pm-f-short"
                value={short}
                maxLength={40}
                aria-describedby={describedBy}
                onChange={(e) => setShort(e.target.value)}
              />
            )}
          </Field>
        </More>
      </div>

      <FormErrors errors={serverErrors} />
      <FormFooter submit={track ? 'Сохранить' : 'Добавить трек'} busy={busy} onCancel={onClose} />

      {track ? (
        <Section
          label="Фокус"
          title={track.status === 'focus' ? 'В фокусе — на дороге' : 'На обочине'}
          hint="Сохраняется сразу."
        >
          <div className="pm-f-row">
            {track.status === 'focus' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void exec({ op: 'track.status', trackId: track.id, status: 'roadside' }, false)
                }
              >
                Убрать на обочину
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  focusFull
                    ? onSwap(track.id)
                    : void exec({ op: 'track.status', trackId: track.id, status: 'focus' }, false)
                }
              >
                Вывести в фокус
              </Button>
            )}
          </div>
        </Section>
      ) : null}

      {track && links ? (
        <DangerZone>
          <DeleteButton onClick={() => setConfirmDelete(true)}>Удалить трек</DeleteButton>
          <ConfirmDialog
            open={confirmDelete}
            title={
              track.nodes.length > 0
                ? `Удалить трек «${track.title}» вместе с ${track.nodes.length} ${track.nodes.length === 1 ? 'блоком' : 'блоками'}?`
                : `Удалить трек «${track.title}»?`
            }
            confirm="Удалить трек"
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => {
              setConfirmDelete(false)
              void exec(
                {
                  op: 'track.remove',
                  trackId: track.id,
                  force: track.nodes.length > 0,
                  ...(links.referrers.length > 0
                    ? { inbound: repoint && links.target ? 'repoint' : 'break' }
                    : {}),
                },
                true,
              )
            }}
          >
            <InboundWarning
              map={map}
              links={links}
              scope="track"
              repoint={repoint}
              onRepoint={setRepoint}
            />
          </ConfirmDialog>
        </DangerZone>
      ) : null}
    </form>
  )
}

// ── beacon ───────────────────────────────────────────────────────────────────

export function BeaconForm({
  map,
  run,
  busy,
  onDirty,
  onDone,
  onClose,
}: {
  map: PathMap
  run: RunEdit
  busy: boolean
  onDirty: (dirty: boolean) => void
  onDone: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(map.beacon.title)
  const [why, setWhy] = useState(map.beacon.why ?? '')
  const [error, setError] = useState<string | undefined>()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  useDirty({ title, why }, onDirty)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Маяку нужно название — куда идём')
      return
    }
    setError(undefined)
    const outcome = await run({ op: 'beacon.update', title, why: why || undefined })
    if (outcome.status === 'ok') onDone()
    else setServerErrors(outcomeErrors(outcome))
  }

  return (
    <form className="pm-f-form" onSubmit={submit} noValidate aria-label="Маяк">
      <PanelHead title="Маяк" context="Куда идём и зачем" onClose={onClose} />
      <div className="pm-f-fields">
        <Field label="Куда идём" error={error}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={3}
              value={title}
              maxLength={300}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Зачем" hint="Одна-две фразы: почему это важно.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              rows={3}
              value={why}
              maxLength={1000}
              aria-describedby={describedBy}
              onChange={(e) => setWhy(e.target.value)}
            />
          )}
        </Field>
      </div>
      <FormErrors errors={serverErrors} />
      <FormFooter submit="Сохранить" busy={busy} onCancel={onClose} />
    </form>
  )
}
