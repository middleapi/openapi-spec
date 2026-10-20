import { Validator } from '@seriousme/openapi-schema-validator'
import { expect } from 'vitest'

type Version = '3.0' | '3.1' | '3.2'

// Compiling an official schema takes tens of milliseconds, and a Validator
// caches the compiled schema per version, so one instance serves every call.
const validator = new Validator()

/**
 * Resolves a local `$ref` such as `#/components/schemas/Pet` against `root`.
 * The fragment is percent-decoded first (RFC 3986) and then split into
 * JSON Pointer tokens with `~1` and `~0` unescaped (RFC 6901).
 */
function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) {
    return undefined
  }
  let pointer: string
  try {
    pointer = decodeURIComponent(ref.slice(1))
  } catch {
    return undefined
  }
  if (pointer === '') {
    return root
  }
  let current = root
  for (const token of pointer.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~')
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function collectLocalRefs(value: unknown, refs: Set<string>): Set<string> {
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (
        (key === '$ref' || key === 'operationRef') &&
        typeof item === 'string' &&
        item.startsWith('#')
      ) {
        refs.add(item)
      } else {
        collectLocalRefs(item, refs)
      }
    }
  }
  return refs
}

/**
 * Every local `$ref` and `operationRef` in `output` that resolved in `input`
 * must still resolve in `output`: a conversion may keep a reference only
 * when its target survives.
 */
export function expectNoNewDanglingRefs(input: object, output: object): void {
  for (const ref of collectLocalRefs(output, new Set())) {
    if (resolvePointer(input, ref) !== undefined) {
      expect(resolvePointer(output, ref), ref).toBeDefined()
    }
  }
}

/**
 * Whether `value` is an array, or an object JSON would see as one: whatever
 * realm it comes from or null prototype it has, as long as it inherits no
 * keys. A downgrade copies these, and keeps other values, such as a `Date`,
 * as they are.
 */
function isPlain(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (Array.isArray(value)) {
    return true
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return (
    proto === null ||
    (Object.getPrototypeOf(proto) === null && Object.keys(proto as object).length === 0)
  )
}

/** Every array and plain object reachable from `value`, with the JSON Pointer it is first reached at. */
function collectPlain(
  value: unknown,
  path: string,
  found: Map<object, string>,
): Map<object, string> {
  if (isPlain(value) && !found.has(value)) {
    found.set(value, path)
    for (const [key, item] of Object.entries(value)) {
      collectPlain(item, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, found)
    }
  }
  return found
}

/**
 * No array or plain object reachable from `output` may be one reachable from
 * `input`, so that changing the output never changes the input.
 */
export function expectNoSharedObjects(input: unknown, output: unknown): void {
  const inputs = collectPlain(input, '#', new Map())
  const shared = [...collectPlain(output, '#', new Map())]
    .filter(([object]) => inputs.has(object))
    .map(([object, path]) => `${path} is the input's ${inputs.get(object)}`)
  expect(shared).toEqual([])
}

/**
 * Validates a document against the official OpenAPI JSON Schema of the
 * version its `openapi` field names.
 */
export async function expectValidAs(spec: object, expectedVersion: Version): Promise<void> {
  const result = await validator.validate(structuredClone(spec) as Record<string, unknown>)
  expect(result.errors ?? []).toEqual([])
  expect(result.valid).toBe(true)
  expect(validator.version).toBe(expectedVersion)
}

/**
 * Downgrades a valid `from` document and checks that the result is a valid
 * `to` document, that every reference that resolved still does, and that it
 * shares no objects with the input. The input is frozen first, so any change
 * to it throws where it is made, and stays frozen.
 */
export async function expectValidDowngrade<I extends object, O extends object>(
  doc: I,
  downgrade: (doc: I) => O,
  from: Version,
  to: Version,
): Promise<O> {
  await expectValidAs(doc, from)
  for (const object of collectPlain(doc, '#', new Map()).keys()) {
    Object.freeze(object)
  }
  const output = downgrade(doc)
  await expectValidAs(output, to)
  expectNoNewDanglingRefs(doc, output)
  expectNoSharedObjects(doc, output)
  return output
}
