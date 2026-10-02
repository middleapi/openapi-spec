// Inlining a target that refers back to itself would never end, and the
// result must stay a plain acyclic JSON value. The recursion is cut at its
// first repeat:
// - in a schema, the inner reference becomes `{}`, which accepts anything,
//   so validation can only get looser
// - on a Path Item, the inner reference keeps only its own fields
// - anywhere else, the inner Reference Object is removed

import { countReads, dig, expectAcyclic } from '../../helpers'
import { expectValidAs } from '../../validate'
import { convertSpec, webhookSchemaPointer } from './helpers'

const responses = { 200: { description: 'ok' } }

it('cuts recursion into {} for schemas and into own fields for path items, keeping the output acyclic', () => {
  const tree = '#/webhooks/tree/post/requestBody/content/application~1json/schema'
  const result = convertSpec({
    components: { schemas: { Tree: { $ref: tree } } },
    paths: { '/ping': { $ref: '#/webhooks/ping' }, '/tree': { $ref: '#/webhooks/tree' } },
    webhooks: {
      ping: {
        post: {
          callbacks: {
            pong: { $ref: '#/webhooks/ping/post/callbacks/self' },
            self: { '{$request.body#/url}': { $ref: '#/webhooks/ping' } },
          },
          responses: {},
        },
      },
      tree: {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { properties: { children: { items: { $ref: tree }, type: 'array' } }, type: 'object' },
              },
            },
          },
          responses: {},
        },
      },
    },
  })
  expect(result.components).toEqual({ schemas: { Tree: { properties: { children: { items: {}, type: 'array' } }, type: 'object' } } })
  expect(dig(result, 'paths', '/tree', 'post', 'requestBody', 'content', 'application/json', 'schema')).toEqual(dig(result, 'components', 'schemas', 'Tree'))
  expect(dig(result, 'paths', '/ping', 'post', 'callbacks')).toEqual({
    pong: { '{$request.body#/url}': {} },
    self: { '{$request.body#/url}': {} },
  })
  expectAcyclic(result)
})

it('cuts callbacks that reach back into an enclosing callback', () => {
  const result = convertSpec({
    components: {
      pathItems: {
        Item: {
          post: {
            callbacks: {
              A: { '{$url}': { post: { callbacks: { toB: { $ref: '#/components/pathItems/Item/post/callbacks/B' } }, responses } } },
              B: { '{$url}': { post: { callbacks: { toA: { $ref: '#/components/pathItems/Item/post/callbacks/A' } }, responses } } },
            },
            responses,
          },
        },
      },
    },
    paths: { '/item': { $ref: '#/components/pathItems/Item' }, '/self': { $ref: '#/webhooks/w' } },
    webhooks: {
      w: {
        post: {
          callbacks: { cb: { '{$url}': { post: { callbacks: { again: { $ref: '#/webhooks/w/post/callbacks/cb' } }, responses } } } },
          responses,
        },
      },
    },
  })
  expect(dig(result, 'paths', '/self', 'post', 'callbacks', 'cb', '{$url}', 'post', 'callbacks')).toEqual({ again: {} })
  expect(dig(result, 'paths', '/item', 'post', 'callbacks', 'A', '{$url}', 'post', 'callbacks', 'toB', '{$url}', 'post', 'callbacks')).toEqual({ toA: {} })
  expectAcyclic(result)
})

it('cuts a callback that reaches back into the path item that contains it', () => {
  expect(dig(convertSpec({
    components: { callbacks: { C: { $ref: '#/webhooks/ping/post/callbacks/self' } } },
    webhooks: { ping: { post: { callbacks: { self: { expr: { $ref: '#/webhooks/ping' } } }, responses: {} } } },
  }), 'components', 'callbacks', 'C')).toEqual({
    expr: { post: { callbacks: { self: {} }, responses: {} } },
  })
})

it('cuts own fields that lead back into a path item still being converted', () => {
  const loop = {
    $ref: '#/components/pathItems/T',
    get: { callbacks: { d: { '{$url}': { $ref: '#/components/pathItems/A' } } }, responses },
  }
  const result = convertSpec({
    components: {
      callbacks: { C: { '{$url}': { $ref: '#/components/pathItems/A/post/callbacks/c/{$url}' } } },
      pathItems: { A: { post: { callbacks: { c: { '{$url}': loop } }, responses } }, T: { summary: 't' } },
    },
  })
  expect(dig(result, 'components', 'callbacks', 'C', '{$url}', 'get', 'callbacks', 'd', '{$url}', 'post', 'callbacks')).toEqual({
    c: { '{$url}': { summary: 't' } },
  })
  expectAcyclic(result)
})

// `components.callbacks.C` references the callback of webhook `h0`. The
// callback of each webhook `h<i>` references the callbacks of all of them,
// itself included, so inlining them is a dense cycle. `reads` counts how many
// times their Path Items are converted.
function callbackCycle(k: number, reads: { count: number }): Record<string, unknown> {
  const pointer = (i: number): string => `#/webhooks/h${i}/post/callbacks/cb`
  const callbacks = Object.fromEntries(Array.from({ length: k }, (_, j) => [`c${j}`, { $ref: pointer(j) }]))
  const webhooks = Object.fromEntries(Array.from({ length: k }, (_, i) => [
    `h${i}`,
    { post: { callbacks: { cb: { '{$url}': countReads({ post: { callbacks, responses } }, 'post', reads) } }, responses } },
  ]))
  return { components: { callbacks: { C: { $ref: pointer(0) } } }, webhooks }
}

describe('cycles of inlined callbacks', () => {
  const inner = (callbacks: Record<string, unknown>): unknown => ({ '{$url}': { post: { callbacks, responses } } })

  // Each copy is cut only at the callbacks that enclose it. Inside `C`, the
  // copy of `h2`'s callback keeps its reference to `h1`'s, which does not
  // enclose it there, although `h2`'s is first copied inside `h1`'s.
  it('cuts a small cycle only at the callbacks that enclose each copy', () => {
    const result = convertSpec(callbackCycle(3, { count: 0 }))
    expect(dig(result, 'components', 'callbacks', 'C')).toEqual(inner({
      c1: inner({ c2: inner({}) }),
      c2: inner({ c1: inner({}) }),
    }))
  })

  // Cutting each copy only at the callbacks that enclose it would take about
  // 2^k copies, so past a budget, copies are shared as soon as they are made.
  it('inlines a dense cycle in linear work', async () => {
    const reads = { count: 0 }
    const k = 8
    const result = convertSpec(callbackCycle(k, reads))
    expect(reads.count).toBeLessThan(3 * k)
    await expectValidAs(result, '3.0')
    expectAcyclic(result)
  })
})

describe('object cycles of the input', () => {
  // A cycle the input graph already has is kept as a cycle. Only the copy
  // that inlining makes of it is cut, since a copy cannot point back into
  // the original.
  it('keeps an object cycle that an inlined target also reaches', () => {
    const a: Record<string, unknown> = { properties: {}, type: 'object' }
    const b = { properties: { back: a }, type: 'object' }
    a.properties = { hook: { $ref: webhookSchemaPointer }, b }
    const result = convertSpec({
      components: { schemas: { A: a } },
      webhooks: { newPet: { post: { requestBody: { content: { 'application/json': { schema: { properties: { b }, type: 'object' } } } } } } },
    })
    const converted = dig(result, 'components', 'schemas', 'A')
    expect(dig(converted, 'properties', 'b', 'properties', 'back')).toBe(converted)
    expect(dig(converted, 'properties', 'hook', 'properties', 'b', 'properties', 'back')).toEqual({})
  })

  it('cuts a reference that comes back to an object shared within the input', () => {
    const shared: Record<string, unknown> = { properties: { a: { $ref: webhookSchemaPointer } }, type: 'object' }
    expect(dig(convertSpec({
      components: { schemas: { S: shared } },
      webhooks: { newPet: { post: { requestBody: { content: { 'application/json': { schema: { properties: { b: shared }, type: 'object' } } } } } } },
    }), 'components', 'schemas', 'S')).toEqual({
      properties: { a: { properties: { b: {} }, type: 'object' } },
      type: 'object',
    })
  })

  it('inlines into a cyclic input graph, preserving its cycle', () => {
    const node: Record<string, unknown> = { type: 'object' }
    node.properties = { hook: { $ref: webhookSchemaPointer }, self: node }
    const result = convertSpec({
      components: { schemas: { Node: node } },
      webhooks: { newPet: { post: { requestBody: { content: { 'application/json': { schema: { properties: { name: { type: 'string' } }, type: 'object' } } } } } } },
    })
    const converted = dig(result, 'components', 'schemas', 'Node')
    expect(dig(converted, 'properties', 'self')).toBe(converted)
    expect(dig(converted, 'properties', 'hook')).toEqual({ properties: { name: { type: 'string' } }, type: 'object' })
  })
})
