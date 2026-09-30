import { Validator } from '@seriousme/openapi-schema-validator'
import { expect } from 'vitest'

/**
 * Reads a nested value, one own key per step, so assertions can reach deep
 * into a converted document without optional chaining at every level.
 */
export function dig(value: unknown, ...path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Resolves a local `$ref` such as `#/components/schemas/Pet` against `root`.
 * The fragment is percent-decoded first (RFC 3986) and then split into
 * JSON Pointer tokens with `~1` and `~0` unescaped (RFC 6901).
 */
export function resolvePointer(root: unknown, ref: string): unknown {
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
      if ((key === '$ref' || key === 'operationRef') && typeof item === 'string' && item.startsWith('#')) {
        refs.add(item)
      }
      else {
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
 * Validates a document against the official OpenAPI JSON Schema of the
 * version its `openapi` field names.
 */
export async function expectValidAs(spec: object, expectedVersion: '3.0' | '3.1' | '3.2'): Promise<void> {
  const validator = new Validator()
  const result = await validator.validate(structuredClone(spec) as Record<string, unknown>)
  expect(result.errors ?? []).toEqual([])
  expect(result.valid).toBe(true)
  expect(validator.version).toBe(expectedVersion)
}
