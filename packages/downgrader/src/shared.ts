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
  readonly identified: Set<unknown>
  readonly inlined: Map<Convert, Map<unknown, Inlined>>
  readonly inlining: Set<unknown>
  readonly merged: Map<Convert, Map<unknown, Merged>>
  readonly removals: Map<string, boolean | undefined>
  readonly seen: Map<Fields, Map<object, unknown>>
  readonly trace: Trace | undefined
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
    ctx.trace?.cuts.add(value)
    return DROP
  }
  ctx.trace?.entered.add(value)
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

function cacheOf<T>(caches: Map<Convert, Map<unknown, T>>, convert: Convert): Map<unknown, T> {
  let cache = caches.get(convert)
  if (cache === undefined) {
    cache = new Map()
    caches.set(convert, cache)
  }
  return cache
}

function isInProgress(target: unknown, ctx: Context): boolean {
  return ctx.inlining.has(target) || ctx.converting.includes(target)
}

// A conversion is cut where it reaches an item already in progress, and it
// enters every other item it reaches. The innermost inlined conversion records
// both in its trace. A copy of an inlined target equals a fresh conversion
// wherever every item it was cut at outside itself is still in progress and no
// item it entered is, so that is where it is reused. Anywhere else it would be
// cut where the recursion does not repeat, or unroll the recursion further,
// which compounds as copies nest.
interface Trace {
  readonly cuts: Set<unknown>
  readonly entered: Set<unknown>
  readonly target: unknown
}

interface Cuts {
  readonly rest: Cuts | undefined
  readonly target: unknown
}

interface Copy {
  readonly cuts: Cuts | undefined
  readonly entered: ReadonlySet<unknown>
  readonly value: unknown
}

interface Inlined {
  readonly copies: Copy[]
  readonly referrers: Set<unknown>
}

// A dense cycle can call for exponentially many copies of a target. Past one
// copy per target referring to it, and at least this many, a reference reuses
// a copy that enters nothing in progress, cut where that copy was, or is cut
// itself. The copies then grow with the number of references, not with the
// number of paths through them.
const COPY_BUDGET = 16

function isStillCut(cuts: Cuts | undefined, ctx: Context): boolean {
  for (let node = cuts; node !== undefined; node = node.rest) {
    if (!isInProgress(node.target, ctx)) {
      return false
    }
  }
  return true
}

function entersInProgress(copy: Copy, ctx: Context): boolean {
  for (const item of ctx.inlining) {
    if (copy.entered.has(item)) {
      return true
    }
  }
  return ctx.converting.some(item => copy.entered.has(item))
}

function findCopy({ copies, referrers }: Inlined, ctx: Context): Copy | typeof DROP | undefined {
  const fitting = copies.filter(copy => !entersInProgress(copy, ctx))
  const exact = fitting.find(copy => isStillCut(copy.cuts, ctx))
  if (exact !== undefined || copies.length < Math.max(COPY_BUDGET, referrers.size)) {
    return exact
  }
  return fitting[0] ?? DROP
}

function reportCuts(cuts: Cuts | undefined, ctx: Context): void {
  for (let node = cuts; node !== undefined && ctx.trace !== undefined; node = node.rest) {
    ctx.trace.cuts.add(node.target)
  }
}

function report(copy: Copy, ctx: Context): void {
  if (ctx.trace !== undefined) {
    reportCuts(copy.cuts, ctx)
    for (const item of copy.entered) {
      ctx.trace.entered.add(item)
    }
  }
}

function outerCuts(cuts: ReadonlySet<unknown>, ctx: Context): Cuts | undefined {
  let outer: Cuts | undefined
  for (const target of cuts) {
    if (isInProgress(target, ctx)) {
      outer = { rest: outer, target }
    }
  }
  return outer
}

export function inline(ref: string, ctx: Context, convert: Convert): unknown {
  const target = ctx.resolve(ref)
  if (target === undefined) {
    return DROP
  }
  if (isInProgress(target, ctx)) {
    ctx.trace?.cuts.add(target)
    return DROP
  }
  const cache = cacheOf(ctx.inlined, convert)
  let inlined = cache.get(target)
  if (inlined === undefined) {
    inlined = { copies: [], referrers: new Set() }
    cache.set(target, inlined)
  }
  inlined.referrers.add(ctx.trace?.target)
  const known = findCopy(inlined, ctx)
  if (known === DROP) {
    return DROP
  }
  if (known !== undefined) {
    report(known, ctx)
    return known.value
  }
  const identified = ctx.identified.size
  const trace: Trace = { cuts: new Set(), entered: new Set([target]), target }
  ctx.inlining.add(target)
  const value = convert(target, { ...ctx, seen: new Map(), trace })
  ctx.inlining.delete(target)
  const copy: Copy = { cuts: outerCuts(trace.cuts, ctx), entered: trace.entered, value }
  report(copy, ctx)
  if (ctx.identified.size === identified) {
    inlined.copies.push(copy)
  }
  return value
}

function freshState(): Pick<Context, 'converting' | 'identified' | 'inlined' | 'inlining' | 'merged' | 'seen' | 'trace'> {
  return { converting: [], identified: new Set(), inlined: new Map(), inlining: new Set(), merged: new Map(), seen: new Map(), trace: undefined }
}

function convertsToDrop(ref: string, ctx: Context, convert: Convert): boolean {
  if (ctx.removals.has(ref)) {
    return ctx.removals.get(ref) === true
  }
  ctx.removals.set(ref, undefined)
  const removed = inline(ref, { ...ctx, ...freshState() }, convert) === DROP
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

interface Merged {
  readonly cuts: Cuts | undefined
  readonly fields: unknown
}

type Hop = { readonly target: unknown } | { readonly identified: number, readonly own: unknown, readonly target: unknown }

// Each hop's merged fields are cached, so a chain is walked and its hops
// converted once however many references enter it. A merge that skipped a hop
// in progress is cut there, so it is reused only while every hop it skipped is
// still in progress. Unlike an inlined copy, it keeps no trace of its own
// fields: converted while some hop was in progress, they can lack its fields
// too, and an inlined copy that reuses the merge does not learn of that.
function mergeChain(ref: string, ctx: Context, convert: Convert): unknown {
  const cache = cacheOf(ctx.merged, convert)
  const hops: Hop[] = []
  let tail: Merged
  for (;;) {
    const target = ctx.resolve(ref)
    const next = getRef(target)
    if (!followsPathItem(next, ctx)) {
      const fields = inline(ref, ctx, convert)
      tail = { cuts: fields === DROP ? { rest: undefined, target } : undefined, fields }
      break
    }
    if (isInProgress(target, ctx)) {
      ctx.trace?.cuts.add(target)
      hops.push({ target })
    }
    else {
      ctx.trace?.entered.add(target)
      const known = cache.get(target)
      if (known !== undefined && isStillCut(known.cuts, ctx)) {
        reportCuts(known.cuts, ctx)
        tail = known
        break
      }
      const { $ref: _, ...own } = target as Record<string, unknown>
      const identified = ctx.identified.size
      ctx.inlining.add(target)
      hops.push({ identified, own: convert(own, { ...ctx, seen: new Map() }), target })
    }
    ref = next
  }
  for (const hop of hops.reverse()) {
    if (!('own' in hop)) {
      tail = { ...tail, cuts: { rest: tail.cuts, target: hop.target } }
      continue
    }
    ctx.inlining.delete(hop.target)
    const fields: Record<string, unknown> = {}
    mergeMissing(fields, hop.own)
    mergeMissing(fields, tail.fields)
    tail = { ...tail, fields }
    if (ctx.identified.size === hop.identified) {
      cache.set(hop.target, tail)
    }
  }
  return tail.fields
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
      ...freshState(),
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
