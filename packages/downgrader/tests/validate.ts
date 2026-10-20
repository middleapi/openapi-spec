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

function findCycle(
  value: unknown,
  path: string,
  open: Set<object>,
  done: Set<object>,
): string | undefined {
  if (typeof value !== 'object' || value === null || done.has(value)) {
    return undefined
  }
  if (open.has(value)) {
    return path
  }
  open.add(value)
  for (const [key, item] of Object.entries(value)) {
    const pointer = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
    const found = findCycle(item, pointer, open, done)
    if (found !== undefined) {
      return found
    }
  }
  open.delete(value)
  done.add(value)
  return undefined
}

/**
 * No object or array in `value` may contain itself, as JSON.stringify
 * requires. Objects shared between several places are fine. Fails with the
 * JSON Pointer of the first place a cycle comes back to.
 */
export function expectAcyclic(value: unknown, message?: string): void {
  expect(findCycle(value, '#', new Set(), new Set()), message).toBeUndefined()
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
 * Downgrades a valid `from` document and checks that the result is a valid,
 * acyclic `to` document, that every reference that resolved still does, and
 * that the input is left untouched.
 */
export async function expectValidDowngrade<I extends object, O extends object>(
  doc: I,
  downgrade: (doc: I) => O,
  from: Version,
  to: Version,
): Promise<O> {
  await expectValidAs(doc, from)
  const before = structuredClone(doc)
  const output = downgrade(doc)
  expectAcyclic(output)
  await expectValidAs(output, to)
  expectNoNewDanglingRefs(doc, output)
  expect(doc).toEqual(before)
  return output
}
