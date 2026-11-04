import {
  type Document,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'
import { z } from 'zod'

import { plural } from './derive'
import { inboundLinks, repointTarget } from './links'
import { parsePathMap } from './parse'
import { BEACON_ID, CONFIDENCE, TRACK_STATUS, type PathMap, type PathTask } from './schema'
import { getTaskAt, isTaskDone, ownDone } from './tasks'

/**
 * Editing the map from the UI (#539) — pure: YAML text + one command → the new
 * YAML text, or the reasons it cannot be done.
 *
 * The file is shared with people and agents who edit it with git, so a command
 * is applied IN PLACE through the `yaml` Document API instead of re-dumping the
 * parsed map: the header comment block, inline comments, quoting, flow-style
 * task rows, blank lines and key order survive, and a one-field edit is a
 * one-line diff. New keys are inserted at their canonical position
 * (`NODE_KEYS` …), new list items follow their siblings' style.
 *
 * Every result is re-validated with `parsePathMap` — the same judgement the
 * page draws by — so an edit that would break the file is refused with the
 * parser's Russian error and nothing is written. Ids of new nodes and tracks
 * are generated from the title (transliterated, unique across the map): the
 * member never types one.
 */

// ── the command contract (validated at the Server Action boundary) ───────────

const ref = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'неверный id')
  .max(120)
const text = (max: number) => z.string().max(max, `не длиннее ${max} символов`)
const optional = (max: number) => text(max).optional()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД')
const indexPath = z.array(z.number().int().min(0).max(9999)).max(10)
/** The address of one task: never empty (`[]` is the obstacle itself, #541 review). */
const taskPath = indexPath.min(1, 'не указано, какая задача')
/**
 * The title of the task at `path` as the member's page showed it (#541
 * re-review): an index path alone can point at another task once a row above
 * was deleted or moved, so the server refuses when the titles differ.
 */
const expectTitle = z.string().max(300)
const nodeType = z.enum(['station', 'obstacle', 'fog'])
/**
 * Deleting what other blocks lead to (#541 review): `repoint` (the default)
 * sends their `opens` to what the deleted block opened; `break` leaves the
 * dangling id — a «разрыв» the map shows.
 */
const inbound = z.enum(['repoint', 'break']).optional()
const trackStatus = z.enum(TRACK_STATUS)

const nodeFields = z.strictObject({
  title: text(300),
  owner: optional(40),
  /** A node id or `beacon`; empty = leads nowhere. */
  opens: optional(120),
  because: optional(1000),
  confidence: z.enum(CONFIDENCE).optional(),
  /** Obstacles: the day it was removed («Снят»). */
  done: day.optional(),
})

const taskFields = z.strictObject({
  title: text(300),
  owner: optional(40),
  link: optional(2000),
})

export const editCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('node.add'),
    trackId: ref,
    /** Position in the track's `nodes` (0 = nearest to «Мы здесь»). */
    index: z.number().int().min(0).max(9999),
    type: nodeType,
    fields: nodeFields,
  }),
  z.strictObject({ op: z.literal('node.update'), nodeId: ref, fields: nodeFields }),
  z.strictObject({ op: z.literal('node.remove'), nodeId: ref, inbound }),
  z.strictObject({
    op: z.literal('node.move'),
    nodeId: ref,
    trackId: ref,
    /** Position in the target track's `nodes` after the node is taken out. */
    index: z.number().int().min(0).max(9999),
  }),
  z.strictObject({ op: z.literal('barrier.remove'), nodeId: ref, date: day }),
  z.strictObject({ op: z.literal('barrier.restore'), nodeId: ref }),
  z.strictObject({
    op: z.literal('track.add'),
    title: text(120),
    short: optional(40),
    status: trackStatus,
  }),
  z.strictObject({
    op: z.literal('track.update'),
    trackId: ref,
    title: text(120),
    short: optional(40),
  }),
  z.strictObject({
    op: z.literal('track.remove'),
    trackId: ref,
    force: z.boolean().optional(),
    inbound,
  }),
  z.strictObject({
    op: z.literal('track.status'),
    trackId: ref,
    status: trackStatus,
    /** Bringing a track into a FULL focus: the focus track that goes to the roadside. */
    swapWith: ref.optional(),
  }),
  z.strictObject({
    op: z.literal('task.add'),
    nodeId: ref,
    /** The parent task's index path; `[]` = a top-level task of the obstacle. */
    parent: indexPath,
    /** The parent task's title as the page showed it; required for a subtask. */
    parentTitle: expectTitle.optional(),
    fields: taskFields,
  }),
  z.strictObject({
    op: z.literal('task.update'),
    nodeId: ref,
    path: taskPath,
    expectTitle,
    fields: taskFields,
  }),
  z.strictObject({ op: z.literal('task.remove'), nodeId: ref, path: taskPath, expectTitle }),
  z.strictObject({
    op: z.literal('task.toggle'),
    nodeId: ref,
    path: taskPath,
    expectTitle,
    date: day,
  }),
  z.strictObject({
    op: z.literal('task.move'),
    nodeId: ref,
    path: taskPath,
    expectTitle,
    delta: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.strictObject({ op: z.literal('beacon.update'), title: text(300), why: optional(1000) }),
])

export type EditCommand = z.infer<typeof editCommandSchema>
export type NodeFields = z.infer<typeof nodeFields>
export type TaskFields = z.infer<typeof taskFields>

export type EditResult =
  | { ok: true; text: string; map: PathMap; warnings: string[]; summary: string }
  | { ok: false; errors: string[] }

// ── ids ──────────────────────────────────────────────────────────────────────

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
} // prettier-ignore

/** «Готов первый урок» → `gotov-pervyy-urok`; nothing usable → `node`. */
export function slugifyTitle(title: string, fallback = 'node'): string {
  const latin = [...title.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('')
  let slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > 48) slug = slug.slice(0, 48).replace(/-[^-]*$/, '') || slug.slice(0, 48)
  return slug || fallback
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

// ── the YAML document, edited in place ───────────────────────────────────────

const NODE_KEYS = [
  'id',
  'type',
  'title',
  'owner',
  'confidence',
  'because',
  'opens',
  'done',
  'tasks',
]
const TRACK_KEYS = ['id', 'title', 'short', 'status', 'nodes']
const TASK_KEYS = ['title', 'done', 'owner', 'link', 'tasks']
const BEACON_KEYS = ['title', 'why']

/** Why a command cannot be applied — becomes the member-facing error. */
class EditRefusal extends Error {}

const refuse = (message: string): never => {
  throw new EditRefusal(message)
}

type Value = string | boolean | undefined

function keyName(item: { key: unknown }): string {
  return isScalar(item.key) ? String(item.key.value) : String(item.key)
}

/**
 * Set (or with `undefined`, delete) `key`: an existing scalar keeps its node —
 * and so its quoting and comment; a new key goes in at its canonical position.
 */
function setKey(doc: Document, map: YAMLMap, key: string, value: Value, order: string[]): void {
  if (value === undefined) {
    map.delete(key)
    return
  }
  const existing = map.get(key, true)
  if (isScalar(existing)) {
    existing.value = value
    return
  }
  if (map.has(key)) {
    map.set(key, doc.createNode(value))
    return
  }
  insertPair(doc, map, key, doc.createNode(value), order)
}

function insertPair(doc: Document, map: YAMLMap, key: string, value: unknown, order: string[]) {
  const pair = doc.createPair(key, value)
  const rank = order.indexOf(key)
  const at = map.items.findIndex((item) => order.indexOf(keyName(item)) > rank)
  if (at < 0) map.items.push(pair)
  else map.items.splice(at, 0, pair)
}

/** The list under `key`, created (at its canonical position) when absent or a bare `key:`. */
function ensureSeq(doc: Document, map: YAMLMap, key: string, order: string[]): YAMLSeq {
  const existing = map.get(key, true)
  if (isSeq(existing)) return existing
  if (isAlias(existing)) refuse(ALIAS_REFUSAL.list)
  const seq = doc.createNode([]) as YAMLSeq
  if (map.has(key)) map.set(key, seq)
  else insertPair(doc, map, key, seq, order)
  return seq
}

/** A plain object in canonical key order, without the empty fields. */
function ordered(fields: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of order) if (fields[key] !== undefined) out[key] = fields[key]
  return out
}

/** A new list item takes the style of its siblings: flow only when they all are. */
function newItem(doc: Document, seq: YAMLSeq, value: Record<string, unknown>): YAMLMap {
  const node = doc.createNode(value) as YAMLMap
  node.flow = seq.items.length > 0 && seq.items.every((item) => isMap(item) && item.flow === true)
  return node
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requireTitle(value: string): string {
  return clean(value) ?? refuse('название не может быть пустым')
}

// ── locating things in the document and in the parsed map ────────────────────

interface Ctx {
  doc: Document
  map: PathMap
}

/**
 * A hand-written file may reuse a block with a YAML anchor (`&a` … `*a`).
 * Editing through the alias would change every place that uses it, so such a
 * spot is refused with a pointer to git instead of a TypeError (#541 review).
 */
const ALIAS_REFUSAL = {
  track: 'этот трек в файле — YAML-ссылка (&якорь / *алиас) на другое место: правьте его в git',
  node: 'этот блок в файле — YAML-ссылка (&якорь / *алиас) на другое место: правьте его в git',
  task: 'эта задача в файле — YAML-ссылка (&якорь / *алиас) на другое место: правьте её в git',
  list: 'этот список в файле — YAML-ссылка (&якорь / *алиас) на другое место: правьте его в git',
} as const

function mapItem(item: unknown, what: keyof typeof ALIAS_REFUSAL): YAMLMap {
  if (isMap(item)) return item
  return refuse(isAlias(item) ? ALIAS_REFUSAL[what] : `в файле карты не найден ${what}`)
}

function tracksSeq(ctx: Ctx): YAMLSeq {
  const tracks = ctx.doc.get('tracks', true)
  if (isSeq(tracks)) return tracks
  if (isAlias(tracks)) refuse(ALIAS_REFUSAL.list)
  const seq = ctx.doc.createNode([]) as YAMLSeq
  ctx.doc.set('tracks', seq)
  return seq
}

function trackAt(ctx: Ctx, trackId: string) {
  const t = ctx.map.tracks.findIndex((track) => track.id === trackId)
  if (t < 0)
    refuse(`трека «${trackId}» на карте нет — возможно, его уже удалили; перечитайте карту`)
  const yaml = mapItem(tracksSeq(ctx).items[t], 'track')
  return { t, track: ctx.map.tracks[t], yaml }
}

function nodesOf(ctx: Ctx, trackYaml: YAMLMap): YAMLSeq {
  return ensureSeq(ctx.doc, trackYaml, 'nodes', TRACK_KEYS)
}

function nodeAt(ctx: Ctx, nodeId: string) {
  for (const [t, track] of ctx.map.tracks.entries()) {
    const n = track.nodes.findIndex((node) => node.id === nodeId)
    if (n < 0) continue
    const trackYaml = mapItem(tracksSeq(ctx).items[t], 'track')
    const seq = nodesOf(ctx, trackYaml)
    return { t, n, track, node: track.nodes[n], seq, yaml: mapItem(seq.items[n], 'node') }
  }
  return refuse(`блока «${nodeId}» на карте нет — возможно, его уже удалили; перечитайте карту`)
}

function obstacleAt(ctx: Ctx, nodeId: string) {
  const found = nodeAt(ctx, nodeId)
  if (found.node.type !== 'obstacle') refuse(`«${found.node.title}» — не шлагбаум`)
  return found as typeof found & { node: Extract<typeof found.node, { type: 'obstacle' }> }
}

const TASK_MISSING = 'задачи по этому адресу нет — возможно, её уже удалили; перечитайте карту'
export const TASK_LIST_CHANGED = 'список задач изменился — откройте задачу заново'

/**
 * The task at an index path, its YAML row, and the list (and that list's owner)
 * it sits in. `expected` is the title the member's page showed at that path: a
 * different task there (a row above was deleted or moved) is refused, so a row
 * draft never saves into another task (#541 re-review).
 */
function taskAt(ctx: Ctx, nodeId: string, path: number[], expected: string | undefined) {
  // An empty path is the obstacle itself, not a task (#541 review).
  if (path.length === 0) return refuse(TASK_MISSING)
  const { node, yaml } = obstacleAt(ctx, nodeId)
  const task = getTaskAt(node.tasks, path) ?? refuse(TASK_MISSING)
  if (task.title !== expected) refuse(TASK_LIST_CHANGED)
  let owner: YAMLMap = yaml
  let parentOwner: YAMLMap = yaml
  let parentSeq: YAMLSeq | null = null
  let item: YAMLMap | null = null
  for (const index of path) {
    const seq = owner.get('tasks', true)
    if (isAlias(seq)) return refuse(ALIAS_REFUSAL.list)
    if (!isSeq(seq)) return refuse(TASK_MISSING)
    const row = seq.items[index]
    if (isAlias(row)) return refuse(ALIAS_REFUSAL.task)
    if (!isMap(row)) return refuse(TASK_MISSING)
    parentOwner = owner
    parentSeq = seq
    item = row
    owner = row
  }
  return { node, task, item: item!, parentSeq: parentSeq!, parentOwner }
}

/** The task list at a parent path (`[]` = the obstacle's own `tasks`), created if absent. */
function listFor(
  ctx: Ctx,
  nodeId: string,
  parent: number[],
  parentTitle: string | undefined,
): YAMLSeq {
  const { yaml } = obstacleAt(ctx, nodeId)
  if (parent.length === 0) return ensureSeq(ctx.doc, yaml, 'tasks', NODE_KEYS)
  const { item } = taskAt(ctx, nodeId, parent, parentTitle)
  // A `{ title: … }` row that gains subtasks becomes a block map: a nested
  // flow list inside a flow row would be unreadable.
  if (item.flow) item.flow = false
  return ensureSeq(ctx.doc, item, 'tasks', TASK_KEYS)
}

const NODE_NOUN = { station: 'станцию', obstacle: 'шлагбаум', fog: 'туман' } as const

function allNodeIds(map: PathMap): Set<string> {
  return new Set([BEACON_ID, ...map.tracks.flatMap((t) => t.nodes.map((n) => n.id))])
}

/** The fields a node of `type` carries, normalised; the station's «потому что» is required. */
function nodeValues(type: keyof typeof NODE_NOUN, fields: NodeFields, selfId?: string) {
  const title = requireTitle(fields.title)
  const opens = clean(fields.opens)
  if (opens && opens === selfId) refuse('блок не может открывать сам себя')
  const values: Record<string, Value> = { title, owner: clean(fields.owner), opens }
  if (type === 'station') {
    values.because =
      clean(fields.because) ?? refuse('станции нужно «потому что»: чем она приближает маяк')
    values.confidence = fields.confidence ?? 'known'
  }
  if (type === 'obstacle') values.done = clean(fields.done)
  return values
}

/**
 * Before deleting `removed` ids: repoint (or knowingly leave) the `opens` of
 * every block outside the set that leads into it (#541 review). Runs before
 * the splice, so the referrers' positions in the document are still the
 * parsed map's. Returns the summary's tail — «, 2 блока теперь ведут к «…»».
 */
function relinkInbound(ctx: Ctx, removed: string[], mode: 'repoint' | 'break' = 'repoint'): string {
  const { referrers, target } = inboundLinks(ctx.map, removed)
  if (referrers.length === 0) return ''
  const n = referrers.length
  const blocks = `${n} ${plural(n, 'блок', 'блока', 'блоков')}`
  const broken = `, ${blocks} ${n === 1 ? 'остался' : 'остались'} с разрывом`
  if (mode === 'break') return broken
  for (const { node } of referrers) {
    const next = repointTarget(ctx.map, removed, node.opens!)
    // A block never opens itself: such a link becomes a break instead.
    const value = next && next !== node.id ? next : undefined
    setKey(ctx.doc, nodeAt(ctx, node.id).yaml, 'opens', value, NODE_KEYS)
  }
  if (!target) return broken
  const title =
    target === BEACON_ID
      ? 'маяк'
      : (ctx.map.tracks.flatMap((t) => t.nodes).find((x) => x.id === target)?.title ?? target)
  return `, ${blocks} теперь ${n === 1 ? 'ведёт' : 'ведут'} к «${title}»`
}

// ── the commands ─────────────────────────────────────────────────────────────

function run(ctx: Ctx, command: EditCommand): string {
  const { doc, map } = ctx
  switch (command.op) {
    case 'node.add': {
      const { yaml } = trackAt(ctx, command.trackId)
      const values = nodeValues(command.type, command.fields)
      const id = uniqueId(slugifyTitle(values.title as string), allNodeIds(map))
      const seq = nodesOf(ctx, yaml)
      const node = doc.createNode(ordered({ id, type: command.type, ...values }, NODE_KEYS))
      seq.items.splice(Math.min(command.index, seq.items.length), 0, node)
      return `добавить ${NODE_NOUN[command.type]} «${values.title}»`
    }
    case 'node.update': {
      const { node, yaml } = nodeAt(ctx, command.nodeId)
      const values = nodeValues(node.type, command.fields, node.id)
      for (const [key, value] of Object.entries(values)) {
        // `confidence: known` is the default: do not write it where the file left it out.
        if (key === 'confidence' && value === 'known' && !yaml.has('confidence')) continue
        setKey(doc, yaml, key, value, NODE_KEYS)
      }
      return `изменить ${NODE_NOUN[node.type]} «${values.title}»`
    }
    case 'node.remove': {
      const { node, seq, n } = nodeAt(ctx, command.nodeId)
      const tail = relinkInbound(ctx, [node.id], command.inbound)
      seq.items.splice(n, 1)
      return `удалить ${NODE_NOUN[node.type]} «${node.title}»${tail}`
    }
    case 'node.move': {
      const from = nodeAt(ctx, command.nodeId)
      const to = trackAt(ctx, command.trackId)
      const [item] = from.seq.items.splice(from.n, 1)
      const target = nodesOf(ctx, to.yaml)
      target.items.splice(Math.min(command.index, target.items.length), 0, item)
      const where = to.t === from.t ? '' : ` в трек «${to.track.title}»`
      return `переместить ${NODE_NOUN[from.node.type]} «${from.node.title}»${where}`
    }
    case 'barrier.remove': {
      const { node, yaml } = obstacleAt(ctx, command.nodeId)
      setKey(doc, yaml, 'done', command.date, NODE_KEYS)
      return `снять шлагбаум «${node.title}»`
    }
    case 'barrier.restore': {
      const { node, yaml } = obstacleAt(ctx, command.nodeId)
      setKey(doc, yaml, 'done', undefined, NODE_KEYS)
      return `вернуть шлагбаум «${node.title}»`
    }
    case 'track.add': {
      const title = requireTitle(command.title)
      if (command.status === 'focus') {
        const focus = map.tracks.filter((t) => t.status === 'focus').length
        if (focus >= map.limits.focus_tracks) {
          refuse(
            `Фокус полон · ${focus} из ${map.limits.focus_tracks}: новый трек можно поставить только на обочину`,
          )
        }
      }
      const taken = new Set(map.tracks.map((t) => t.id))
      const id = uniqueId(slugifyTitle(title, 'track'), taken)
      const value = ordered(
        { id, title, short: clean(command.short), status: command.status, nodes: [] },
        TRACK_KEYS,
      )
      tracksSeq(ctx).items.push(doc.createNode(value))
      return `добавить трек «${title}»`
    }
    case 'track.update': {
      const { yaml } = trackAt(ctx, command.trackId)
      const title = requireTitle(command.title)
      setKey(doc, yaml, 'title', title, TRACK_KEYS)
      setKey(doc, yaml, 'short', clean(command.short), TRACK_KEYS)
      return `изменить трек «${title}»`
    }
    case 'track.remove': {
      const { t, track } = trackAt(ctx, command.trackId)
      if (track.nodes.length > 0 && !command.force) {
        refuse(
          `в треке «${track.title}» есть блоки (${track.nodes.length}) — его можно удалить только вместе с ними, подтвердите удаление`,
        )
      }
      const tail = relinkInbound(
        ctx,
        track.nodes.map((node) => node.id),
        command.inbound,
      )
      tracksSeq(ctx).items.splice(t, 1)
      return `удалить трек «${track.title}»${tail}`
    }
    case 'track.status': {
      const { track, yaml } = trackAt(ctx, command.trackId)
      if (track.status === command.status) {
        refuse(command.status === 'focus' ? 'трек уже в фокусе' : 'трек уже на обочине')
      }
      if (command.status === 'roadside') {
        setKey(doc, yaml, 'status', 'roadside', TRACK_KEYS)
        return `убрать трек «${track.title}» на обочину`
      }
      const focus = map.tracks.filter((t) => t.status === 'focus')
      let swapped = ''
      if (focus.length >= map.limits.focus_tracks) {
        if (!command.swapWith) {
          refuse(
            `Фокус полон · ${focus.length} из ${map.limits.focus_tracks}: выберите трек, который уйдёт на обочину`,
          )
        }
        const out = trackAt(ctx, command.swapWith!)
        if (out.track.status !== 'focus') refuse(`трек «${out.track.title}» не в фокусе`)
        setKey(doc, out.yaml, 'status', 'roadside', TRACK_KEYS)
        swapped = ` вместо «${out.track.title}»`
      }
      setKey(doc, yaml, 'status', 'focus', TRACK_KEYS)
      return `вывести трек «${track.title}» в фокус${swapped}`
    }
    case 'task.add': {
      const { node } = obstacleAt(ctx, command.nodeId)
      const seq = listFor(ctx, command.nodeId, command.parent, command.parentTitle)
      const title = requireTitle(command.fields.title)
      const value = ordered(
        { title, owner: clean(command.fields.owner), link: clean(command.fields.link) },
        TASK_KEYS,
      )
      seq.items.push(newItem(doc, seq, value))
      return `добавить задачу «${title}» в «${node.title}»`
    }
    case 'task.update': {
      const { item } = taskAt(ctx, command.nodeId, command.path, command.expectTitle)
      const title = requireTitle(command.fields.title)
      setKey(doc, item, 'title', title, TASK_KEYS)
      setKey(doc, item, 'owner', clean(command.fields.owner), TASK_KEYS)
      setKey(doc, item, 'link', clean(command.fields.link), TASK_KEYS)
      return `изменить задачу «${title}»`
    }
    case 'task.remove': {
      const { task, parentSeq, parentOwner } = taskAt(
        ctx,
        command.nodeId,
        command.path,
        command.expectTitle,
      )
      parentSeq.items.splice(command.path[command.path.length - 1], 1)
      // An emptied list would turn its parent into a heading over nothing.
      if (parentSeq.items.length === 0) parentOwner.delete('tasks')
      return `удалить задачу «${task.title}»`
    }
    case 'task.toggle': {
      const { task, item } = taskAt(ctx, command.nodeId, command.path, command.expectTitle)
      if (!isTaskDone(task)) {
        setKey(doc, item, 'done', command.date, TASK_KEYS)
        return `отметить задачу «${task.title}» выполненной`
      }
      const children = task.tasks ?? []
      if (children.length > 0 && children.every((child: PathTask) => isTaskDone(child))) {
        refuse('все подзадачи выполнены — снимите отметку с одной из них')
      }
      if (ownDone(task)) setKey(doc, item, 'done', undefined, TASK_KEYS)
      return `снять отметку с задачи «${task.title}»`
    }
    case 'task.move': {
      const { task, parentSeq } = taskAt(ctx, command.nodeId, command.path, command.expectTitle)
      const from = command.path[command.path.length - 1]
      const to = from + command.delta
      if (to < 0 || to >= parentSeq.items.length) refuse('задачу некуда сдвинуть')
      const [item] = parentSeq.items.splice(from, 1)
      parentSeq.items.splice(to, 0, item)
      return `переставить задачу «${task.title}»`
    }
    case 'beacon.update': {
      const beacon = doc.get('beacon', true)
      if (!isMap(beacon)) return refuse('в файле нет блока beacon')
      const title = requireTitle(command.title)
      setKey(doc, beacon, 'title', title, BEACON_KEYS)
      setKey(doc, beacon, 'why', clean(command.why), BEACON_KEYS)
      return `изменить маяк «${title}»`
    }
  }
}

/**
 * Apply one command to the map's YAML text. Line endings of the input are
 * kept. A file that is invalid already is not edited (fix it in git first).
 */
export function applyEdit(text: string, command: EditCommand): EditResult {
  const crlf = text.includes('\r\n')
  const source = crlf ? text.split('\r\n').join('\n') : text
  const before = parsePathMap(source)
  if (!before.ok) {
    return {
      ok: false,
      errors: [`Файл карты сейчас с ошибками — правьте его в git: ${before.errors[0]}`],
    }
  }
  const doc = parseDocument(source)
  let summary: string
  try {
    summary = run({ doc, map: before.map }, command)
  } catch (error) {
    if (error instanceof EditRefusal) return { ok: false, errors: [error.message] }
    throw error
  }
  const out = doc.toString({ lineWidth: 0 })
  const after = parsePathMap(out)
  if (!after.ok) return { ok: false, errors: after.errors }
  return {
    ok: true,
    text: crlf ? out.split('\n').join('\r\n') : out,
    map: after.map,
    warnings: after.warnings,
    summary,
  }
}
