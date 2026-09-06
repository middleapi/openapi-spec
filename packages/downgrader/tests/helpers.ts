import { Validator } from '@seriousme/openapi-schema-validator'
import { expect } from 'vitest'

/** Walks converter output along `path`; the surrounding assertions pin down its shape. */
export function dig(value: unknown, ...path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export async function expectValidAs(spec: object, expectedVersion: string): Promise<void> {
  const validator = new Validator()
  const result = await validator.validate(structuredClone(spec) as Record<string, unknown>)
  expect(result.errors ?? []).toEqual([])
  expect(result.valid).toBe(true)
  expect(validator.version).toBe(expectedVersion)
}
