export const DROP: unique symbol = Symbol('drop')

const PLACEHOLDERS = new WeakSet<object>()

export interface Context {
  readonly resolve: (ref: string) => unknown
  readonly aliasEnd: (ref: string) => string | undefined
  readonly dangles: (ref: string) => boolean
  readonly isRemovedPart: (ref: string) => boolean
  readonly markDangling: (ref: string) => void
  readonly converting: unknown[]
  readonly copies: Map<object, unknown>
  readonly exact: Exact
  readonly identified: Set<unknown>
  readonly inlined: Map<Convert, Map<unknown, Cached[]>>
  readonly inlining: Set<unknown>
  readonly merged: Map<Convert, Map<unknown, Cached[]>>
  readonly removals: Map<string, boolean | undefined>
  readonly seen: Map<Fields, Map<object, unknown>>
  readonly trace: Trace
}

export type Convert = (value: unknown, ctx: Context) => unknown

export type Field = (value: unknown, ctx: Context, parent: Record<string, unknown>) => unknown

export type Fields = ReadonlyMap<string, Field | typeof DROP>

export type Finish = (out: Record<string, unknown>, source: Record<string, unknown>, ctx: Context) => unknown

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { configurable: true, enumerable: true, value, writable: true })
  }
  else {
    target[key] = value
  }
}

export function defineFields(table: Readonly<Record<string, Field | typeof DROP>>): Fields {
  return new Map(Object.entries(table))
}

export function clone(value: unknown, ctx?: Context): unknown {
  return Array.isArray(value) || isRecord(value) ? copy(value, ctx?.copies ?? new Map()) : value
}

function copy(value: unknown, seen: Map<object, unknown>): unknown {
  if (!(Array.isArray(value) || isRecord(value))) {
    return value
  }
  const known = seen.get(value)
  if (known !== undefined) {
    return known
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) {
      out.push(copy(item, seen))
    }
    return out
  }
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    setOwn(out, key, copy(item, seen))
  }
  return out
}

export function convertObject(value: unknown, ctx: Context, fields: Fields, finish?: Finish): unknown {
  if (!isRecord(value)) {
    return clone(value, ctx)
  }
  let seen = ctx.seen.get(fields)
  if (seen === undefined) {
    seen = new Map()
    ctx.seen.set(fields, seen)
  }
  const known = seen.get(value)
  if (known !== undefined) {
    return known
  }
  if (ctx.converting.includes(value)) {
    return cut(value, ctx)
  }
  work(ctx)
  const again = hold(value, ctx)
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  ctx.converting.push(value)
  for (const [key, item] of Object.entries(value)) {
    const field = fields.get(key)
    const converted = field === undefined ? clone(item, ctx) : field === DROP ? DROP : field(item, ctx, value)
    if (converted !== DROP) {
      setOwn(out, key, converted)
    }
  }
  const result = finish === undefined ? out : finish(out, value, ctx)
  ctx.converting.pop()
  if (again) {
    ctx.exact.again.pop()
  }
  if (result !== out) {
    seen.set(value, result)
  }
  return result
}

export function map(convert: (value: unknown, ctx: Context, key: string) => unknown, isEntry: (key: string) => boolean = () => true): Convert {
  return (value, ctx) => {
    if (!isRecord(value)) {
      return clone(value, ctx)
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const converted = isEntry(key) ? convert(item, ctx, key) : clone(item, ctx)
      if (converted !== DROP) {
        setOwn(out, key, converted)
      }
    }
    return out
  }
}

export function list(convert: Convert): Convert {
  return (value, ctx) => Array.isArray(value) ? value.map(item => convert(item, ctx)).filter(item => item !== DROP) : clone(value, ctx)
}

export function isPath(key: string): boolean {
  return key.startsWith('/')
}

export function isNotExtension(key: string): boolean {
  return !key.startsWith('x-')
}

export function hasType(type: unknown, name: string): boolean {
  return type === name || (Array.isArray(type) && type.includes(name))
}

export function placeholder(): Record<string, unknown> {
  const out = {}
  PLACEHOLDERS.add(out)
  return out
}

export function allOfItems(allOf: unknown): unknown[] {
  if (Array.isArray(allOf)) {
    return allOf
  }
  return allOf === undefined ? [] : [{ allOf }]
}

export function convertXml(value: unknown, _ctx: Context, schema: Record<string, unknown>): unknown {
  if (!isRecord(value)) {
    return clone(value)
  }
  const { nodeType, ...rest } = value
  const out = clone(rest) as Record<string, unknown>
  if (nodeType === 'attribute') {
    out.attribute = true
  }
  else if (nodeType === 'element' && hasType(schema.type, 'array')) {
    out.wrapped = true
  }
  return out
}

export function getRef(value: unknown): string | undefined {
  return isRecord(value) && typeof value.$ref === 'string' ? value.$ref : undefined
}

export function child(value: unknown, token: string): unknown {
  if (Array.isArray(value)) {
    return /^(?:0|[1-9]\d*)$/.test(token) ? value[Number(token)] : undefined
  }
  return isRecord(value) && Object.hasOwn(value, token) ? value[token] : undefined
}

function parsePointer(ref: string): string[] | undefined {
  if (!ref.startsWith('#')) {
    return undefined
  }
  let pointer: string
  try {
    pointer = decodeURIComponent(ref.slice(1))
  }
  catch {
    return undefined
  }
  if (pointer === '') {
    return []
  }
  if (!pointer.startsWith('/')) {
    return undefined
  }
  return pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'))
}

export function resolve(root: unknown, ref: string): unknown {
  return parsePointer(ref)?.reduce<unknown>(child, root)
}

function cacheOf<K, J, T>(caches: Map<K, Map<J, T>>, key: K): Map<J, T> {
  let cache = caches.get(key)
  if (cache === undefined) {
    cache = new Map()
    caches.set(key, cache)
  }
  return cache
}

function isInProgress(target: unknown, ctx: Context): boolean {
  return ctx.inlining.has(target) || ctx.converting.includes(target)
}

// Copying a target that is in progress, an enclosing object or inlined
// target, would never end, so a copy is cut there instead, and what a copy
// holds depends on what was in progress where it was made. Each copy traces
// the targets it cut at, the objects and targets it converted, and the cached
// copies it holds, and a cached copy is reused only where it comes out the
// same (see `isExact`). So a copy is cut only where it refers back to
// something that encloses it.
//
// Copies of a dense cycle that fit that way are exponentially many, as for k
// Path Items whose callbacks all reference one another. So the work of
// converting targets again because no copy fits is limited to `BUDGET` times
// the rest of the work. Past that, the conversion that started it is unwound,
// and copies are shared as before for the rest of the run: an inlined target
// as soon as it is cached, and a merge while the hops it skipped are still in
// progress. A copy can then be cut at a target that enclosed the place where
// it was made but not the place where it is reused.
interface Trace {
  readonly cuts: Set<unknown>
  readonly held: Set<unknown>
  readonly parts: Set<Cached>
}

interface Skipped {
  readonly hop: unknown
  readonly rest: Skipped | undefined
}

interface Cached {
  // The targets it cut at outside itself, still in progress when it was done.
  readonly cuts: ReadonlySet<unknown>
  // The objects and targets it converted, apart from those in `parts`.
  readonly held: ReadonlySet<unknown>
  // The cached copies it holds, made or reused while it was converted.
  readonly parts: Iterable<Cached>
  // For a merge, the hops skipped as in progress by the walks it took.
  readonly skipped: Skipped | undefined
  readonly value: unknown
}

interface Exact {
  on: boolean
  // Each unit of work adds `BUDGET`, except that each unit of converting a
  // target again because no copy fit, or of checking whether a copy fits,
  // takes one instead.
  budget: number
  // How many conversions of a target again are in progress.
  depth: number
  // The objects and targets in progress that were converted before,
  // innermost last.
  readonly again: unknown[]
  readonly converted: Set<unknown>
  readonly holds: Map<unknown, Map<Cached, boolean>>
}

interface Saved {
  readonly again: number
  readonly converting: number
  readonly identified: number
  readonly inlining: number
}

// Records nothing. It is the trace of the whole document, and of every copy
// once exact reuse is off, since nothing reads those.
class Untraced<T> extends Set<T> {
  override add(): this {
    return this
  }
}

const UNTRACED: Trace = { cuts: new Untraced(), held: new Untraced(), parts: new Untraced() }

// Thrown to unwind a conversion that ran over budget. Its stack is never read.
const OVER_BUDGET = new Error('over budget')

const BUDGET = 4

function newTrace(ctx: Context): Trace {
  return ctx.exact.on ? { cuts: new Set(), held: new Set(), parts: new Set() } : UNTRACED
}

function spend(units: number, ctx: Context): void {
  const { exact } = ctx
  exact.budget -= units
  if (exact.budget < 0 && exact.on) {
    exact.on = false
    exact.converted.clear()
    exact.holds.clear()
    if (exact.depth > 0) {
      throw OVER_BUDGET
    }
  }
}

function work(ctx: Context): void {
  if (ctx.exact.on) {
    if (ctx.exact.depth === 0) {
      ctx.exact.budget += BUDGET
    }
    else {
      spend(1, ctx)
    }
  }
}

// Traces `value` as converted by the current copy. If it was converted
// before, it goes on `again` until its conversion ends, unless `enter` just
// put it there as an inlined target. Returns whether it was put there.
function hold(value: unknown, ctx: Context): boolean {
  const { exact } = ctx
  if (!exact.on) {
    return false
  }
  ctx.trace.held.add(value)
  const { size } = exact.converted
  if (exact.converted.add(value).size > size || exact.again.at(-1) === value) {
    return false
  }
  exact.again.push(value)
  return true
}

// Starts converting `target` for a copy traced in `trace`. With `redo`, a
// copy of it exists but none fits, so it is converted again; the outermost
// such conversion returns the state to restore if it runs over budget.
function enter(target: unknown, trace: Trace, redo: boolean, ctx: Context): Saved | undefined {
  const { exact } = ctx
  const saved = redo && exact.depth === 0 ? save(ctx) : undefined
  if (redo) {
    exact.depth++
  }
  ctx.inlining.add(target)
  if (exact.on) {
    trace.held.add(target)
    if (exact.converted.has(target)) {
      exact.again.push(target)
    }
  }
  return saved
}

function leave(target: unknown, redo: boolean, ctx: Context): void {
  const { exact } = ctx
  ctx.inlining.delete(target)
  if (redo) {
    exact.depth--
  }
  if (exact.on) {
    exact.converted.add(target)
  }
  if (exact.again.at(-1) === target) {
    exact.again.pop()
  }
}

function save(ctx: Context): Saved {
  return { again: ctx.exact.again.length, converting: ctx.converting.length, identified: ctx.identified.size, inlining: ctx.inlining.size }
}

// Unwinds a conversion that ran over budget. What it added to the caches
// stays, since each of those copies was finished and fits where it was made.
function restore(saved: Saved, ctx: Context): void {
  ctx.converting.length = saved.converting
  for (const target of [...ctx.inlining].slice(saved.inlining)) {
    ctx.inlining.delete(target)
  }
  for (const schema of [...ctx.identified].slice(saved.identified)) {
    ctx.identified.delete(schema)
  }
  ctx.exact.again.length = saved.again
  ctx.exact.depth = 0
}

function cut(target: unknown, ctx: Context): typeof DROP {
  ctx.trace.cuts.add(target)
  return DROP
}

function record(cuts: Iterable<unknown>, parts: Iterable<Cached>, ctx: Context): void {
  for (const target of cuts) {
    ctx.trace.cuts.add(target)
  }
  for (const part of parts) {
    ctx.trace.parts.add(part)
  }
}

// Returns `cuts` with those of `more` that are still in progress and without
// `done`, a hop whose merge just ended. A cached copy may hold `cuts`, so it
// is copied only if that changes it.
function joinCuts(cuts: ReadonlySet<unknown>, more: readonly unknown[], done: unknown, ctx: Context): ReadonlySet<unknown> {
  if (!ctx.exact.on) {
    return cuts
  }
  const added = more.filter(target => !cuts.has(target) && isInProgress(target, ctx))
  if (added.length === 0 && !cuts.has(done)) {
    return cuts
  }
  const out = new Set([...cuts, ...added])
  out.delete(done)
  return out
}

// Whether `cached`, or a copy it holds, converted `target`.
function holds(cached: Cached, target: unknown, ctx: Context): boolean {
  const known = cacheOf(ctx.exact.holds, target)
  const answer = known.get(cached)
  if (answer !== undefined) {
    spend(1, ctx)
    return answer
  }
  const visited = new Set([cached])
  const stack = [cached]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    spend(1, ctx)
    const nodeAnswer = known.get(node)
    if (nodeAnswer === true || node.held.has(target)) {
      known.set(cached, true)
      return true
    }
    if (nodeAnswer === undefined) {
      for (const part of node.parts) {
        if (!visited.has(part)) {
          visited.add(part)
          stack.push(part)
        }
      }
    }
  }
  for (const node of visited) {
    known.set(node, false)
  }
  return false
}

// A copy comes out the same where every target it cut at is still in
// progress, and nothing it converted is in progress again, which a
// conversion there would cut instead. Nothing in progress for the first time
// can have been converted by a copy.
function isExact(cached: Cached, ctx: Context): boolean {
  spend(cached.cuts.size + ctx.exact.again.length, ctx)
  for (const target of cached.cuts) {
    if (!isInProgress(target, ctx)) {
      return false
    }
  }
  return ctx.exact.again.every(target => cached.cuts.has(target) || !holds(cached, target, ctx))
}

function isStillSkipped(skipped: Skipped | undefined, ctx: Context): boolean {
  for (let node = skipped; node !== undefined; node = node.rest) {
    if (!isInProgress(node.hop, ctx)) {
      return false
    }
  }
  return true
}

function reusable(copies: readonly Cached[] | undefined, ctx: Context): Cached | undefined {
  if (copies === undefined) {
    return undefined
  }
  if (!ctx.exact.on) {
    const last = copies.at(-1) as Cached
    return isStillSkipped(last.skipped, ctx) ? last : undefined
  }
  for (let index = copies.length - 1; index >= 0; index--) {
    if (isExact(copies[index] as Cached, ctx)) {
      return copies[index]
    }
  }
  return undefined
}

// Once exact reuse is off, only the last copy of a target is read.
function keep(cache: Map<unknown, Cached[]>, target: unknown, cached: Cached, ctx: Context): void {
  const copies = cache.get(target)
  if (copies === undefined || !ctx.exact.on) {
    cache.set(target, [cached])
  }
  else {
    copies.push(cached)
  }
}

export function inline(ref: string, ctx: Context, convert: Convert): unknown {
  const target = ctx.resolve(ref)
  if (target === undefined) {
    return DROP
  }
  if (isInProgress(target, ctx)) {
    return cut(target, ctx)
  }
  const cache = cacheOf(ctx.inlined, convert)
  const copies = cache.get(target)
  const known = reusable(copies, ctx)
  if (known !== undefined) {
    record(known.cuts, [known], ctx)
    return known.value
  }
  const redo = ctx.exact.on && copies !== undefined
  const identified = ctx.identified.size
  const trace = newTrace(ctx)
  const saved = enter(target, trace, redo, ctx)
  let value: unknown
  try {
    value = convert(target, { ...ctx, seen: new Map(), trace })
  }
  catch (error) {
    if (saved === undefined || error !== OVER_BUDGET) {
      throw error
    }
    restore(saved, ctx)
    return inline(ref, ctx, convert)
  }
  leave(target, redo, ctx)
  for (const cutAt of trace.cuts) {
    if (!isInProgress(cutAt, ctx)) {
      trace.cuts.delete(cutAt)
    }
  }
  const out: Cached = { cuts: trace.cuts, held: trace.held, parts: trace.parts, skipped: undefined, value }
  if (ctx.identified.size === identified) {
    keep(cache, target, out, ctx)
  }
  record(out.cuts, [out], ctx)
  return value
}

function freshState(exact: boolean): Pick<Context, 'converting' | 'exact' | 'identified' | 'inlined' | 'inlining' | 'merged' | 'seen' | 'trace'> {
  return {
    converting: [],
    exact: { again: [], budget: 0, converted: new Set(), depth: 0, holds: new Map(), on: exact },
    identified: new Set(),
    inlined: new Map(),
    inlining: new Set(),
    merged: new Map(),
    seen: new Map(),
    trace: UNTRACED,
  }
}

function convertsToDrop(ref: string, ctx: Context, convert: Convert): boolean {
  if (ctx.removals.has(ref)) {
    return ctx.removals.get(ref) === true
  }
  ctx.removals.set(ref, undefined)
  const removed = inline(ref, { ...ctx, ...freshState(false) }, convert) === DROP
  ctx.removals.set(ref, removed)
  return removed
}

function isRemovedAlias(ref: string, ctx: Context, convert: Convert): boolean {
  if (getRef(ctx.resolve(ref)) === undefined) {
    return false
  }
  const end = ctx.aliasEnd(ref)
  return end !== undefined && ctx.dangles(end) && convertsToDrop(end, ctx, convert)
}

export function skipAliases(ref: string, ctx: Context, follow: (next: string, target: Record<string, unknown>) => boolean): string {
  const hops = new Set([ref])
  let hop = ref
  for (;;) {
    const target = ctx.resolve(hop)
    const next = getRef(target)
    if (next === undefined || hops.has(next) || !follow(next, target as Record<string, unknown>)) {
      return hop
    }
    hops.add(next)
    hop = next
  }
}

export function inlineSchema(ref: string, ctx: Context, convert: Convert): unknown {
  return inline(skipAliases(ref, ctx, (next, target) => Object.keys(target).length === 1 && ctx.dangles(next)), ctx, convert)
}

export function refOr(convert: Convert, keep: (value: Record<string, unknown>) => unknown = clone): Convert {
  const self: Convert = (value, ctx) => {
    const ref = getRef(value)
    if (ref === undefined) {
      return convert(value, ctx)
    }
    if (isRemovedAlias(ref, ctx, self)) {
      ctx.markDangling(ref)
      return DROP
    }
    if (ctx.dangles(ref)) {
      return inline(skipAliases(ref, ctx, next => ctx.dangles(next)), ctx, self)
    }
    return keep(value as Record<string, unknown>)
  }
  return self
}

function isGone(ref: string, ctx: Context): boolean {
  return ctx.isRemovedPart(ref) || ctx.dangles(ref)
}

export function convertMappingRef(value: unknown, ctx: Context): unknown {
  return typeof value === 'string' && isGone(value, ctx) ? DROP : clone(value)
}

export function hasDanglingOperationRef(link: unknown, ctx: Context): boolean {
  return isRecord(link) && typeof link.operationRef === 'string' && isGone(link.operationRef, ctx)
}

function isOperationPointer(tokens: readonly string[]): boolean {
  const key = tokens.at(-1) as string
  if ((HTTP_METHODS as readonly string[]).includes(key) || key === 'query') {
    return isPathItemPointer(tokens.slice(0, -1))
  }
  return tokens.at(-2) === 'additionalOperations' && isPathItemPointer(tokens.slice(0, -2))
}

function isPathItemPointer(tokens: readonly string[]): boolean {
  const [first, second] = tokens
  if (tokens.length === 2) {
    return first === 'paths' || first === 'webhooks'
  }
  if (tokens.length === 3 && first === 'components' && second === 'pathItems') {
    return true
  }
  return tokens.length > 3
    && tokens.at(-3) === 'callbacks'
    && !(tokens.at(-1) as string).startsWith('x-')
    && (tokens.length === 4 ? first === 'components' : isOperationPointer(tokens.slice(0, -3)))
}

function mergeMissing(out: Record<string, unknown>, target: unknown): void {
  if (isRecord(target)) {
    for (const [key, item] of Object.entries(target)) {
      if (!Object.hasOwn(out, key)) {
        setOwn(out, key, item)
      }
    }
  }
}

function followsPathItem(ref: string | undefined, ctx: Context): ref is string {
  const tokens = ref === undefined ? undefined : parsePointer(ref)
  return tokens !== undefined && isPathItemPointer(tokens) && ctx.dangles(ref as string)
}

type Hop = { readonly target: unknown } | { readonly identified: number, readonly own: unknown, readonly redo: boolean, readonly target: unknown, readonly trace: Trace }

// The rest of a chain: a hop's cached merge, or the chain end.
type Tail = Pick<Cached, 'cuts' | 'parts' | 'skipped' | 'value'>

interface Walk {
  readonly hops: Hop[]
  saved?: { readonly hops: number, readonly ref: string, readonly state: Saved }
}

// Walks the chain from `ref`, converting the own fields of each hop that is
// not in progress, up to the chain end or a hop with a copy to reuse.
function walkChain(ref: string, ctx: Context, convert: Convert, walk: Walk): Tail {
  const cache = cacheOf(ctx.merged, convert)
  for (;;) {
    work(ctx)
    const target = ctx.resolve(ref)
    const next = getRef(target)
    if (!followsPathItem(next, ctx)) {
      const trace = newTrace(ctx)
      const value = inline(ref, { ...ctx, trace }, convert)
      return { cuts: trace.cuts, parts: trace.parts, skipped: value === DROP ? { hop: target, rest: undefined } : undefined, value }
    }
    if (isInProgress(target, ctx)) {
      walk.hops.push({ target })
    }
    else {
      const copies = cache.get(target)
      const known = reusable(copies, ctx)
      if (known !== undefined) {
        return { cuts: known.cuts, parts: [known], skipped: known.skipped, value: known.value }
      }
      const redo = ctx.exact.on && copies !== undefined
      const { $ref: _, ...own } = target as Record<string, unknown>
      const identified = ctx.identified.size
      const trace = newTrace(ctx)
      const saved = enter(target, trace, redo, ctx)
      if (saved !== undefined) {
        walk.saved = { hops: walk.hops.length, ref, state: saved }
      }
      walk.hops.push({ identified, own: convert(own, { ...ctx, seen: new Map(), trace }), redo, target, trace })
    }
    ref = next
  }
}

// Each hop's merged fields are cached like an inlined target, so a chain is
// walked and its hops converted once however many references enter it, as
// long as the copies fit. A merge cuts where the own fields of its hops or
// the chain end cut, and at each hop it skipped as in progress. A skipped hop
// adds nothing, so a later hop's fields fill in for it.
function mergeChain(ref: string, ctx: Context, convert: Convert): unknown {
  const cache = cacheOf(ctx.merged, convert)
  const walk: Walk = { hops: [] }
  let tail: Tail
  try {
    tail = walkChain(ref, ctx, convert, walk)
  }
  catch (error) {
    if (walk.saved === undefined || error !== OVER_BUDGET) {
      throw error
    }
    restore(walk.saved.state, ctx)
    walk.hops.length = walk.saved.hops
    tail = walkChain(walk.saved.ref, ctx, convert, walk)
  }
  let { cuts, parts, skipped, value } = tail
  let passed: unknown[] = []
  for (const hop of walk.hops.reverse()) {
    if (!('own' in hop)) {
      passed.push(hop.target)
      skipped = { hop: hop.target, rest: skipped }
      continue
    }
    leave(hop.target, hop.redo, ctx)
    cuts = joinCuts(cuts, [...passed, ...hop.trace.cuts], hop.target, ctx)
    passed = []
    for (const part of parts) {
      hop.trace.parts.add(part)
    }
    const fields: Record<string, unknown> = {}
    mergeMissing(fields, hop.own)
    mergeMissing(fields, value)
    const merged: Cached = { cuts, held: hop.trace.held, parts: hop.trace.parts, skipped, value: fields }
    if (ctx.identified.size === hop.identified) {
      keep(cache, hop.target, merged, ctx)
    }
    parts = [merged]
    value = fields
  }
  for (const target of passed) {
    cut(target, ctx)
  }
  record(cuts, parts, ctx)
  return value
}

export function mergeRef(convert: Convert): Finish {
  return (out, source, ctx) => {
    const ref = getRef(source)
    if (!followsPathItem(ref, ctx)) {
      return out
    }
    delete out.$ref
    mergeMissing(out, mergeChain(ref, ctx, convert))
    return out
  }
}

export function removedPrefixes(tables: Readonly<Record<string, Fields>>): string[] {
  return Object.entries(tables).flatMap(([base, fields]) =>
    [...fields].filter(([, field]) => field === DROP).map(([key]) => `#${base}/${key}/`),
  )
}

function danglesIn(output: unknown, source: unknown, tokens: readonly string[] | undefined): boolean {
  if (tokens === undefined) {
    return false
  }
  let from = source
  let to = output
  for (const token of tokens) {
    if (Array.isArray(from) && !(Array.isArray(to) && to.length === from.length)) {
      to = undefined
    }
    from = child(from, token)
    to = child(to, token)
    if (from === undefined) {
      return false
    }
  }
  return to === undefined || (isRecord(to) && PLACEHOLDERS.has(to))
}

export function downgrade(root: unknown, convert: Convert, removed: readonly string[] = []): unknown {
  const targets = new Map<string, unknown>()
  const resolveRef = (ref: string): unknown => {
    if (!targets.has(ref)) {
      targets.set(ref, resolve(root, ref))
    }
    return targets.get(ref)
  }
  const ends = new Map<string, string | undefined>()
  const aliasEnd = (ref: string): string | undefined => {
    const path = new Set<string>()
    let hop = ref
    let end: string | undefined
    for (;;) {
      if (ends.has(hop)) {
        end = ends.get(hop)
        break
      }
      if (path.has(hop)) {
        break
      }
      path.add(hop)
      const next = getRef(resolveRef(hop))
      if (next === undefined) {
        end = hop
        break
      }
      hop = next
    }
    for (const visited of path) {
      ends.set(visited, end)
    }
    return end
  }
  const isInlinable = (ref: string): boolean => {
    const target = resolveRef(ref)
    return (isRecord(target) || typeof target === 'boolean') && aliasEnd(ref) !== undefined
  }
  const dangling = new Set<string>()
  const isRemovedPart = (ref: string): boolean => removed.some(prefix => ref.startsWith(prefix))
  let previous = root
  for (;;) {
    const kept = new Set<string>()
    const out = convert(root, {
      ...freshState(true),
      aliasEnd,
      copies: new Map(),
      dangles: (ref) => {
        if (!dangling.has(ref) && !kept.has(ref)) {
          if ((isRemovedPart(ref) || (previous !== root && danglesIn(previous, root, parsePointer(ref)))) && isInlinable(ref)) {
            dangling.add(ref)
          }
          else {
            kept.add(ref)
          }
        }
        return dangling.has(ref)
      },
      isRemovedPart,
      removals: new Map(),
      markDangling: ref => dangling.add(ref),
      resolve: resolveRef,
    })
    let stale = false
    for (const ref of kept) {
      if ((dangling.has(ref) || danglesIn(out, root, parsePointer(ref))) && isInlinable(ref)) {
        dangling.add(ref)
        stale = true
      }
    }
    if (!stale) {
      return out
    }
    previous = out
  }
}
