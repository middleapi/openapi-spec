// Inlining a target that refers back to itself would never end, and the
// result must stay a plain acyclic JSON value. The recursion is cut at its
// first repeat:
// - in a schema, the inner reference becomes `{}`, which accepts anything,
//   so validation can only get looser
// - on a Path Item, the inner reference keeps only its own fields
// - anywhere else, the inner Reference Object is removed

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig, expectAcyclic } from '../../helpers'
import { expectValidDowngrade } from '../../validate'
import { convertSpec, info, webhookSchemaPointer } from './helpers'

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
  const cut = { '{$url}': { post: { callbacks: {}, responses } } }
  expect(dig(result, 'paths', '/self', 'post', 'callbacks', 'cb', '{$url}', 'post', 'callbacks')).toEqual({ again: cut })
  expect(dig(result, 'paths', '/item', 'post', 'callbacks', 'A', '{$url}', 'post', 'callbacks', 'toB', '{$url}', 'post', 'callbacks')).toEqual({ toA: cut })
  expectAcyclic(result)
})

it('cuts a callback that reaches back into the path item that contains it', () => {
  expect(dig(convertSpec({
    components: { callbacks: { C: { $ref: '#/webhooks/ping/post/callbacks/self' } } },
    webhooks: { ping: { post: { callbacks: { self: { expr: { $ref: '#/webhooks/ping' } } }, responses: {} } } },
  }), 'components', 'callbacks', 'C')).toEqual({
    expr: { post: { callbacks: { self: { expr: {} } }, responses: {} } },
  })
})

it('keeps only the own fields of a reference that leads back into a path item still being converted', () => {
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
    c: { '{$url}': { get: { callbacks: { d: { '{$url}': {} } }, responses }, summary: 't' } },
  })
  expectAcyclic(result)
})

describe('object cycles of the input', () => {
  // A cycle the input graph already has is kept as a cycle, both in the
  // original and in the copy that inlining makes of it. The copy cannot
  // point back into the original, so it is cut at its inner reference.
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
    const copy = dig(converted, 'properties', 'hook', 'properties', 'b', 'properties', 'back')
    expect(copy).not.toBe(converted)
    expect(dig(copy, 'properties', 'b', 'properties', 'back')).toBe(copy)
    expect(dig(copy, 'properties', 'hook')).toEqual({})
  })

  it('cuts a reference that comes back to an object shared within the input', () => {
    const shared: Record<string, unknown> = { properties: { a: { $ref: webhookSchemaPointer } }, type: 'object' }
    expect(dig(convertSpec({
      components: { schemas: { S: shared } },
      webhooks: { newPet: { post: { requestBody: { content: { 'application/json': { schema: { properties: { b: shared }, type: 'object' } } } } } } },
    }), 'components', 'schemas', 'S')).toEqual({
      properties: { a: { properties: { b: { properties: { a: {} }, type: 'object' } }, type: 'object' } },
      type: 'object',
    })
  })

  // 3.2 → 3.1 shares one inlined Media Type between every place that
  // referenced it, so its header can lead back to the very object that is
  // still being converted. The copy inlined for the header converts it again
  // and cuts only its inner reference: an empty `content` is invalid in 3.0.
  it.each(['multipart/form-data', 'application/json'])('cuts only the inner reference when an inlined header leads back to a shared %s media type', async (type) => {
    const mediaType: OpenAPIV3_1.MediaTypeObject = {
      encoding: { a: { headers: { 'X-Trace': { $ref: '#/webhooks/done/post/responses/200/headers/X-Trace' } } } },
      schema: { type: 'object' },
    }
    const doc: OpenAPIV3_1.OpenAPIObject = {
      info,
      openapi: '3.1.0',
      paths: { '/a': { post: { requestBody: { content: { [type]: mediaType } }, responses } } },
      webhooks: {
        done: { post: { responses: { 200: { description: 'ok', headers: { 'X-Trace': { content: { [type]: mediaType } } } } } } },
      },
    }
    const result = await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
    expect(dig(result, 'paths', '/a', 'post', 'requestBody', 'content', type, 'encoding', 'a', 'headers')).toEqual({
      'X-Trace': { content: { [type]: { encoding: { a: { headers: {} } }, schema: { type: 'object' } } } },
    })
    expectAcyclic(result)
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
