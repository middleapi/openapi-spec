import { runInNewContext } from 'node:vm'
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
 * Parses `value` as JSON in a new `vm` context. Like JSON parsed in an iframe
 * or a Vitest VM pool, the result inherits from the Object.prototype and
 * Array.prototype of another realm, so it is not `instanceof` this realm's
 * Object or Array.
 */
export function fromOtherRealm<T>(value: T): T {
  return runInNewContext('JSON.parse(text)', { text: JSON.stringify(value) }) as T
}
