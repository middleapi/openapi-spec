// Inlining a target that refers back to itself would never end, and the
// result must stay a plain acyclic JSON value. The recursion is cut at its
// first repeat:
// - in a schema, the inner reference becomes `{}`, which accepts anything,
//   so validation can only get looser
// - on a Path Item, the inner reference keeps only its own fields
// - anywhere else, the inner Reference Object is removed

import { dig, expectAcyclic, inOrder } from '../../helpers'
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

// A copy of `Q` made inside `P` is cut where it refers back to `P`, so it is
// not reused for `/q`, where `P` does not enclose it. Each path keeps the
// operations of both Path Items, whichever path comes first.
it.each([['/p', '/q'], ['/q', '/p']])('keeps the operations of mutually recursive path items (%s first)', (...order) => {
  const pathItem = (operationId: string, other: string) => ({
    post: { callbacks: { cb: { '{$url}': { $ref: `#/components/pathItems/${other}` } } }, operationId, responses },
  })
  const refs = { '/p': { $ref: '#/components/pathItems/P' }, '/q': { $ref: '#/components/pathItems/Q' } }
  const result = convertSpec({
    components: { pathItems: { P: pathItem('p', 'Q'), Q: pathItem('q', 'P') } },
    paths: inOrder(refs, order),
  })
  const converted = (operationId: string, other: unknown) => ({ post: { callbacks: { cb: { '{$url}': other } }, operationId, responses } })
  expect(result.paths).toEqual({
    '/p': converted('p', converted('q', {})),
    '/q': converted('q', converted('p', {})),
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
