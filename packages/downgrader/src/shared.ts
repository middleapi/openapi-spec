export const DROP = Symbol('drop')

export type FieldConverter = (item: unknown, source: Record<string, unknown>) => unknown

export type FieldTable = Readonly<Record<string, FieldConverter | typeof DROP>>

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function setOwn(object: object, key: PropertyKey, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }
  else {
    (object as Record<PropertyKey, unknown>)[key] = value
  }
}

type Finish = (out: Record<string, unknown>, source: Record<string, unknown>) => unknown

interface Conversion {
  done: boolean
  fields: FieldTable
  finish: Finish | undefined
  result: unknown
}

const conversions = new Map<object, Conversion>()
const clones = new Map<object, unknown>()
let depth = 0

function cloneValue(value: unknown, seen: Map<object, unknown>): unknown {
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

export function deepClone<T>(value: T): T {
  if (!(Array.isArray(value) || isRecord(value))) {
    return value
  }
  return cloneValue(value, depth > 0 ? clones : new Map()) as T
}

export function convertRecord(value: unknown, fields: FieldTable, finish?: Finish): unknown {
  if (!isRecord(value)) {
    return deepClone(value)
  }
  const known = conversions.get(value)
  if (known !== undefined && (!known.done || (known.fields === fields && known.finish === finish))) {
    return known.result
  }
  const out: Record<string, unknown> = {}
  const conversion: Conversion = { done: false, fields, finish, result: out }
  conversions.set(value, conversion)
  depth += 1
  try {
    for (const [key, item] of Object.entries(value)) {
      const convert = Object.hasOwn(fields, key) ? fields[key] : undefined
      if (convert === DROP) {
        continue
      }
      const converted = convert === undefined ? deepClone(item) : convert(item, value)
      if (converted !== DROP) {
        setOwn(out, key, converted)
      }
    }
    conversion.result = finish === undefined ? out : finish(out, value)
    conversion.done = true
    return conversion.result
  }
  finally {
    depth -= 1
    if (depth === 0) {
      conversions.clear()
      clones.clear()
    }
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
