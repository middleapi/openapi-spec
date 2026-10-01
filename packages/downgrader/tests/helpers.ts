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

/** A converted document must stay plain JSON, which cannot hold a cycle. */
export function expectAcyclic(value: unknown): void {
  expect(() => JSON.stringify(value)).not.toThrow()
}

/**
 * Copies `object`, turning its `key` field into a getter that adds one to
 * `reads.count` on every read, so a test can bound how many times the
 * conversion walks into that field.
 */
export function countReads<T extends Record<string, unknown>>(object: T, key: keyof T & string, reads: { count: number }): T {
  const value = object[key]
  return Object.defineProperty({ ...object }, key, {
    enumerable: true,
    get: () => {
      reads.count++
      return value
    },
  })
}
