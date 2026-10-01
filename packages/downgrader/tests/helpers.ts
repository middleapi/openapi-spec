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
 * Counts the values a consumer that expands `value` as a tree, such as
 * `JSON.stringify`, would visit. Counting stops past `limit`, so a result
 * that would expand exponentially fails fast instead of hanging.
 */
export function expandedSize(value: unknown, limit: number): number {
  let size = 0
  const stack = [value]
  while (stack.length > 0 && size <= limit) {
    const item = stack.pop()
    size++
    if (typeof item === 'object' && item !== null) {
      stack.push(...Object.values(item))
    }
  }
  return size
}
