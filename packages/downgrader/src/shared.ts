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
  readonly inlined: Map<Convert, Map<unknown, unknown>>
  readonly inlining: Set<unknown>
  readonly removals: Map<string, boolean | undefined>
  readonly seen: Map<Fields, Map<object, unknown>>
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
    return DROP
  }
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

export function inline(ref: string, ctx: Context, convert: Convert): unknown {
  const target = ctx.resolve(ref)
  if (target === undefined || ctx.inlining.has(target) || ctx.converting.includes(target)) {
    return DROP
  }
  let cache = ctx.inlined.get(convert)
  if (cache === undefined) {
    cache = new Map()
    ctx.inlined.set(convert, cache)
  }
  if (cache.has(target)) {
    return cache.get(target)
  }
  const identified = ctx.identified.size
  ctx.inlining.add(target)
  const out = convert(target, { ...ctx, seen: new Map() })
  ctx.inlining.delete(target)
  if (ctx.identified.size === identified) {
    cache.set(target, out)
  }
  return out
}

function convertsToDrop(ref: string, ctx: Context, convert: Convert): boolean {
  if (ctx.removals.has(ref)) {
    return ctx.removals.get(ref) === true
  }
  ctx.removals.set(ref, undefined)
  const removed = inline(ref, { ...ctx, converting: [], identified: new Set(), inlined: new Map(), inlining: new Set(), seen: new Map() }, convert) === DROP
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

export function hasDanglingMapping(discriminator: unknown, ctx: Context): boolean {
  return isRecord(discriminator)
    && isRecord(discriminator.mapping)
    && Object.values(discriminator.mapping).some(value => typeof value === 'string' && isGone(value, ctx))
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

export function mergeRef(convert: Convert): Finish {
  return (out, source, ctx) => {
    let ref = getRef(source)
    if (!followsPathItem(ref, ctx)) {
      return out
    }
    delete out.$ref
    const hops: unknown[] = []
    for (;;) {
      const target = ctx.resolve(ref)
      const next = getRef(target)
      if (!followsPathItem(next, ctx)) {
        mergeMissing(out, inline(ref, ctx, convert))
        break
      }
      if (!ctx.inlining.has(target) && !ctx.converting.includes(target)) {
        const { $ref: _, ...own } = target as Record<string, unknown>
        ctx.inlining.add(target)
        hops.push(target)
        mergeMissing(out, convert(own, { ...ctx, seen: new Map() }))
      }
      ref = next
    }
    for (const hop of hops) {
      ctx.inlining.delete(hop)
    }
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
      aliasEnd,
      converting: [],
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
      identified: new Set(),
      inlined: new Map(),
      inlining: new Set(),
      isRemovedPart,
      removals: new Map(),
      markDangling: ref => dangling.add(ref),
      resolve: resolveRef,
      seen: new Map(),
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
