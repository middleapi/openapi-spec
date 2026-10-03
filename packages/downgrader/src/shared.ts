/** Returned by a converter to leave the value out of its parent. */
export const DROP: unique symbol = Symbol('drop')

export interface Context {
  /** The document or schema being converted, which local `$ref`s resolve against. */
  readonly root: unknown
  /** The target of each `$ref` resolved so far. */
  readonly targets: Map<string, unknown>
  /** The output of each object converted so far, per field table, so a shared object is converted once and a cycle ends. */
  readonly seen: Map<Fields, Map<object, Record<string, unknown>>>
  /** The targets of the `$ref`s being inlined, so a reference back into one stops there. */
  readonly inlining: Set<unknown>
}

export type Convert = (value: unknown, ctx: Context) => unknown

export type Field = (value: unknown, ctx: Context, parent: Record<string, unknown>) => unknown

export type Fields = ReadonlyMap<string, Field | typeof DROP>

export type Finish = (out: Record<string, unknown>, source: Record<string, unknown>, ctx: Context) => void

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Assigning `__proto__` would set the prototype instead of adding a key.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
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

/**
 * Deep copies plain objects and arrays, keeping any cycle among them. Keys
 * holding `undefined` are left out, as JSON would, and other values, such as
 * a `Date`, are kept as they are.
 */
export function clone(value: unknown): unknown {
  return Array.isArray(value) || isRecord(value) ? copy(value, new Map()) : value
}

function copy(value: unknown, copies: Map<object, unknown>): unknown {
  if (!(Array.isArray(value) || isRecord(value))) {
    return value
  }
  const known = copies.get(value)
  if (known !== undefined) {
    return known
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    copies.set(value, out)
    for (const item of value) {
      out.push(copy(item, copies))
    }
    return out
  }
  const out: Record<string, unknown> = {}
  copies.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      setOwn(out, key, copy(item, copies))
    }
  }
  return out
}

/**
 * Converts the object `value` key by key: a key listed in `fields` goes
 * through its converter or is dropped, and any other key is copied. `finish`
 * then edits the output in place.
 */
export function convertObject(value: unknown, ctx: Context, fields: Fields, finish?: Finish): unknown {
  if (!isRecord(value)) {
    return clone(value)
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
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue
    }
    const field = fields.get(key)
    const converted = field === undefined ? clone(item) : field === DROP ? DROP : field(item, ctx, value)
    if (converted !== DROP) {
      setOwn(out, key, converted)
    }
  }
  finish?.(out, value, ctx)
  return out
}

/** Converts each entry of a map, or only those whose key passes `isEntry`, copying the rest. */
export function map(convert: Convert, isEntry: (key: string) => boolean = () => true): Convert {
  return (value, ctx) => {
    if (!isRecord(value)) {
      return clone(value)
    }
    const out: [string, unknown][] = []
    for (const [key, item] of Object.entries(value)) {
      const converted = item === undefined ? DROP : isEntry(key) ? convert(item, ctx) : clone(item)
      if (converted !== DROP) {
        out.push([key, converted])
      }
    }
    return Object.fromEntries(out)
  }
}

export function list(convert: Convert): Convert {
  return (value, ctx) => Array.isArray(value) ? value.map(item => convert(item, ctx)).filter(item => item !== DROP) : clone(value)
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

export function getRef(value: unknown): string | undefined {
  return isRecord(value) && typeof value.$ref === 'string' ? value.$ref : undefined
}

function find(root: unknown, ref: string): unknown {
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
  if (pointer !== '' && !pointer.startsWith('/')) {
    return undefined
  }
  let target = root
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!(isRecord(target) || Array.isArray(target)) || !Object.hasOwn(target, key)) {
      return undefined
    }
    target = (target as Record<string, unknown>)[key]
  }
  return target
}

/** The target of a local JSON Pointer `$ref`, such as `#/components/schemas/Pet`. */
export function resolvePointer(ref: string, ctx: Context): unknown {
  if (ctx.targets.has(ref)) {
    return ctx.targets.get(ref)
  }
  const target = find(ctx.root, ref)
  ctx.targets.set(ref, target)
  return target
}

/** Follows `ref`, and any `$ref` its target holds in turn, to the value they end at. */
export function resolve(ref: string, ctx: Context): unknown {
  const visited = new Set<string>()
  let target: unknown
  for (let next: string | undefined = ref; next !== undefined; next = getRef(target)) {
    if (visited.has(next)) {
      return undefined
    }
    visited.add(next)
    target = resolvePointer(next, ctx)
  }
  return target
}

/**
 * Converts the target of `ref` to stand in for the reference. Returns `DROP`
 * when the target is missing, or when it is already being inlined around
 * this point, where inlining it again would never end.
 */
export function inline(ref: string, ctx: Context, convert: Convert): unknown {
  const target = resolvePointer(ref, ctx)
  if (target === undefined || ctx.inlining.has(target)) {
    return DROP
  }
  ctx.inlining.add(target)
  const out = convert(target, ctx)
  ctx.inlining.delete(target)
  return out
}

export function downgrade(root: unknown, convert: Convert): unknown {
  return convert(root, { inlining: new Set(), root, seen: new Map(), targets: new Map() })
}
