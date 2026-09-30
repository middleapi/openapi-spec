// A Link's `operationRef` and a discriminator `mapping` value are references
// too: https://spec.openapis.org/oas/v3.0.4.html#link-operation-ref
// https://spec.openapis.org/oas/v3.0.4.html#discriminator-mapping
// One that points into `webhooks` or `components.pathItems` cannot be kept,
// since its target is removed, and cannot be inlined either, since both
// fields must hold a pointer. So it is removed, along with any Reference
// Object that resolves to such a Link.

import { dig } from '../../helpers'
import { convertSpec } from './helpers'

const item = {
  get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
  parameters: [{ in: 'query', name: 'q', schema: { const: 'x' } }],
}

describe('links', () => {
  it('removes links whose operationRef points into the removed parts, together with references to them', () => {
    const result = convertSpec({
      components: {
        callbacks: { Hook: { '{$url}': { $ref: '#/webhooks/callbackHook' } } },
        links: {
          ByComponentCallback: { operationRef: '#/webhooks/callbackHook/post' },
          Gone: { operationRef: '#/webhooks/orphan/post' },
          Kept: { description: 'kept', operationRef: '#/webhooks/newPet/post' },
        },
        pathItems: { Item: item, NoId: { get: { responses: {} } } },
      },
      paths: {
        '/a': {
          get: {
            callbacks: { cb: { '{$request.body#/url}': { $ref: '#/components/pathItems/Item' } } },
            responses: {
              200: {
                description: 'ok',
                links: {
                  both: { operationId: 'stale', operationRef: '#/webhooks/newPet/post' },
                  byCallback: { operationRef: '#/components/pathItems/Item/get', parameters: { id: '$response.body#/id' } },
                  byId: { operationId: 'orphanHook' },
                  byPath: { operationRef: '#/paths/~1b/post' },
                  external: { $ref: 'https://example.com/links.json#/Kept' },
                  inlined: { $ref: '#/webhooks/newPet/post/responses/200/links/self' },
                  missing: { operationRef: '#/webhooks/missing/post' },
                  noId: { operationRef: '#/components/pathItems/NoId/get' },
                  refGone: { $ref: '#/components/links/Gone' },
                  refKept: { $ref: '#/components/links/Kept' },
                  refUnknown: { $ref: '#/components/links/Unknown' },
                },
              },
            },
          },
        },
        '/b': { $ref: '#/webhooks/newPet' },
        '/c': { $ref: '#/components/pathItems/NoId' },
        '/d': { $ref: '#/webhooks/newPet' },
        '/junk': 'junk',
        'x-orphan': { post: { operationId: 'orphanHook' } },
      },
      webhooks: {
        callbackHook: { post: { operationId: 'callbackHookOp', responses: {} } },
        newPet: {
          post: {
            operationId: 'newPetHook',
            responses: { 200: { description: 'ok', links: { self: { operationRef: '#/webhooks/newPet/post' } } } },
          },
        },
        orphan: { post: { operationId: 'orphanHook', responses: {} } },
      },
    })
    expect(result.components).toEqual({
      callbacks: { Hook: { '{$url}': { post: { operationId: 'callbackHookOp', responses: {} } } } },
      links: {},
    })
    // `byId` names its operation by `operationId`, which is not a pointer,
    // and is kept even though that operation is gone (a known limitation).
    expect(dig(result, 'paths', '/a', 'get', 'responses', '200', 'links')).toEqual({
      byId: { operationId: 'orphanHook' },
      byPath: { operationRef: '#/paths/~1b/post' },
      external: { $ref: 'https://example.com/links.json#/Kept' },
      refUnknown: { $ref: '#/components/links/Unknown' },
    })
    expect(dig(result, 'paths', '/b', 'post', 'responses', '200', 'links')).toEqual({})
    expect(JSON.stringify(result)).not.toMatch(/#\/(?:webhooks|components\/pathItems)/)
  })

  // `/a` inlines the webhook but defines its own `post`, which wins, so the
  // webhook's `post` does not survive anywhere in the output.
  it('removes a link to an operation that an own field of the referencing path item replaces', () => {
    expect(convertSpec({
      components: { links: { L: { operationRef: '#/webhooks/w/post' } } },
      paths: { '/a': { $ref: '#/webhooks/w', post: { responses: {} } } },
      webhooks: { w: { post: { operationId: 'hidden', responses: {} } } },
    }).components).toEqual({ links: {} })
  })

  it('removes a link to a removed operation in a document without components', () => {
    expect(convertSpec({
      paths: {
        '/a': {
          get: {
            callbacks: { junk: 42 },
            responses: { 200: { description: 'ok', links: { l: { operationRef: '#/webhooks/w/post' } } } },
          },
        },
      },
      webhooks: { w: { post: { operationId: 'hook', responses: {} } } },
    }).paths).toEqual({
      '/a': { get: { callbacks: { junk: 42 }, responses: { 200: { description: 'ok', links: {} } } } },
    })
  })
})

describe('discriminator mappings', () => {
  // A mapping value is either a schema name or a reference. Names and
  // references that stay valid are kept.
  it('removes mapping entries that point into the removed parts', () => {
    expect(convertSpec({
      components: {
        schemas: {
          Junk: { discriminator: { mapping: 'junk', propertyName: 'kind' } },
          Pet: {
            discriminator: {
              mapping: {
                cat: '#/components/schemas/Cat',
                dog: '#/webhooks/newPet/post/requestBody/content/application~1json/schema',
                fish: 'Fish',
                hamster: '#/components/pathItems/Item',
              },
              propertyName: 'kind',
            },
          },
        },
      },
    }).components).toEqual({
      schemas: {
        Junk: { discriminator: { mapping: 'junk', propertyName: 'kind' } },
        Pet: { discriminator: { mapping: { cat: '#/components/schemas/Cat', fish: 'Fish' }, propertyName: 'kind' } },
      },
    })
  })
})
