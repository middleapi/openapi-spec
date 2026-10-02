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

/** Copies the entries of `record` named by `keys`, in the order of `keys`. */
export function inOrder(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map(key => [key, record[key]]))
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

/**
 * Builds Path Items `base` and `h0` … `h<k-1>`, keyed by name, where every
 * `h<i>` has a `$ref` to `base` and callbacks pointing at every `h<j>`,
 * itself included. `pointer` says where they live. `reads` counts reads of
 * each `h<i>`'s operation, that is how many times its own fields are converted.
 */
export function cyclicCallbackGraph(k: number, pointer: (name: string) => string, reads: { count: number }): Record<string, unknown> {
  const responses = { 200: { description: 'ok' } }
  const items: Record<string, unknown> = { base: { get: { responses } } }
  for (let i = 0; i < k; i++) {
    const callbacks = Object.fromEntries(Array.from({ length: k }, (_, j) => [`c${j}`, { '{$request.body#/url}': { $ref: pointer(`h${j}`) } }]))
    items[`h${i}`] = countReads({ $ref: pointer('base'), post: { callbacks, responses } }, 'post', reads)
  }
  return items
}
