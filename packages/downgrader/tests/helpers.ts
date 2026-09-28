import { Validator } from '@seriousme/openapi-schema-validator'
import { expect } from 'vitest'

import { resolve } from '../src/shared'

export function dig(value: unknown, ...path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
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

export function expectNoNewDanglingRefs(input: object, output: object): void {
  for (const ref of collectLocalRefs(output, new Set())) {
    if (resolve(input, ref) !== undefined) {
      expect(resolve(output, ref), ref).toBeDefined()
    }
  }
}

export async function expectValidAs(spec: object, expectedVersion: string): Promise<void> {
  const validator = new Validator()
  const result = await validator.validate(structuredClone(spec) as Record<string, unknown>)
  expect(result.errors ?? []).toEqual([])
  expect(result.valid).toBe(true)
  expect(validator.version).toBe(expectedVersion)
}
