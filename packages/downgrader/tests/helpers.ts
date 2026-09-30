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
