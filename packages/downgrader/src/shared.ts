/**
 * Internal helpers shared by the version converters. Everything is defensive:
 * converters never throw on malformed input, they pass unconvertible parts
 * through unchanged.
 */

/**
 * Returned by a converter to remove its entry from the surrounding object or
 * array: the single signal for constructs the target version cannot express.
 */
export const DROP = Symbol('drop')

/**
 * Converts one field of a record. The whole source record is passed along
 * for decisions that depend on sibling fields.
 */
export type FieldConverter = (item: unknown, source: Record<string, unknown>) => unknown

/**
 * What happens to each known field of a record: a converter, or `DROP` to
 * remove the field. Fields not listed (unknown keys, `x-` extensions) are
 * deep-cloned as they are.
 */
export type FieldTable = Readonly<Record<string, FieldConverter | typeof DROP>>

/** The Path Item operation fields of OpenAPI 3.0 and 3.1; 3.2 adds `query`. */
export const HTTP_METHODS_UP_TO_V31 = [
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
] as const

export function operationFields(convert: FieldConverter): FieldTable {
  return Object.fromEntries(HTTP_METHODS_UP_TO_V31.map(method => [method, convert]))
}

/**
 * Whether the value is a plain object (the only shape the converters walk
 * into). Arrays, class instances, and primitives are handled by reference or
 * by dedicated array helpers.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Sets a key as an own data property. Keys the prototype chain already knows
 * (an accessor such as `__proto__`, or a read-only member once the
 * intrinsics are frozen) are defined instead of assigned.
 */
export function setOwn(object: object, key: PropertyKey, value: unknown): void {
  if (Object.hasOwn(object, key) || !(key in object)) {
    // SAFETY: only widens the index signature.
    (object as Record<PropertyKey, unknown>)[key] = value
    return
  }
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function cloneValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (!(Array.isArray(value) || isRecord(value))) {
    return value
  }
  const existing = seen.get(value)
  if (existing !== undefined) {
    return existing
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) {
      out.push(cloneValue(item, seen))
    }
    return out
  }
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    setOwn(out, key, cloneValue(item, seen))
  }
  return out
}

/**
 * A JSON-oriented deep clone that never throws: non-plain values (class
 * instances, functions, ...) are kept by reference, hostile keys like
 * `__proto__` are copied as own data properties instead of being assigned,
 * and cyclic or shared references are preserved in the clone instead of
 * recursing forever.
 */
export function deepClone<T>(value: T): T {
  if (!(Array.isArray(value) || isRecord(value))) {
    return value
  }
  // SAFETY: cloneValue preserves the runtime shape of its input.
  return cloneValue(value, new WeakMap()) as T
}

/** Objects being converted up the call stack, mapped to their output records. */
const converting = new WeakMap<object, Record<string, unknown>>()

/**
 * Rebuilds a plain object field by field: each key goes through its entry in
 * `fields` (or is deep-cloned when it has none), entries mapped to or
 * returning `DROP` are left out, and `finish` receives the result together
 * with the source for fix-ups that depend on several fields. Non-object input
 * is deep-cloned unchanged, and a cyclic reference back to an object still
 * being converted yields that object's output record, so `finish` should
 * mutate and return `out` rather than replace it.
 */
export function convertRecord(value: unknown, fields: FieldTable, finish?: (out: Record<string, unknown>, source: Record<string, unknown>) => unknown): unknown {
  if (!isRecord(value)) {
    return deepClone(value)
  }
  const inProgress = converting.get(value)
  if (inProgress !== undefined) {
    return inProgress
  }
  const out: Record<string, unknown> = {}
  converting.set(value, out)
  try {
    for (const [key, item] of Object.entries(value)) {
      const convert = Object.hasOwn(fields, key) ? fields[key] : undefined
      if (convert === DROP) {
        continue
      }
      const converted
        = convert === undefined ? deepClone(item) : convert(item, value)
      if (converted !== DROP) {
        setOwn(out, key, converted)
      }
    }
    return finish === undefined ? out : finish(out, value)
  }
  finally {
    converting.delete(value)
  }
}

export function mapRecord(value: unknown, convert: (item: unknown, key: string) => unknown): unknown {
  if (!isRecord(value)) {
    return deepClone(value)
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const converted = convert(item, key)
    if (converted !== DROP) {
      setOwn(out, key, converted)
    }
  }
  return out
}

export function mapArray(value: unknown, convert: (item: unknown) => unknown): unknown {
  if (!Array.isArray(value)) {
    return deepClone(value)
  }
  return value.map(item => convert(item)).filter(item => item !== DROP)
}

export function getRef(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.$ref === 'string') {
    return value.$ref
  }
  return undefined
}
