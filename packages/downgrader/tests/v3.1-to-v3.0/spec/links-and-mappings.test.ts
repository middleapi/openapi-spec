// A Link's `operationRef` and a discriminator `mapping` value are references
// too: https://spec.openapis.org/oas/v3.0.4.html#link-operation-ref
// https://spec.openapis.org/oas/v3.0.4.html#discriminator-mapping
// One that points into `webhooks` or `components.pathItems` cannot be kept,
// since its target is removed, and cannot be inlined either, since both
// fields must hold a pointer. So such a Link is removed, along with any
// Reference Object that resolves to it, and so is a discriminator with such
// a `mapping` entry.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'
import { expectValidDowngrade } from '../../validate'
import { convertSpec, info, item, removedPointer, webhookSchemaPointer } from './helpers'

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
    expect(JSON.stringify(result)).not.toMatch(removedPointer)
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
  it('keeps mapping entries that stay valid', () => {
    const schemas = {
      Junk: { discriminator: { mapping: 'junk', propertyName: 'kind' } },
      Pet: {
        discriminator: {
          mapping: { cat: '#/components/schemas/Cat', fish: 'Fish', missing: '#/components/schemas/Missing' },
          propertyName: 'kind',
        },
      },
    }
    expect(convertSpec({ components: { schemas } }).components).toEqual({ schemas })
  })

  // Without an entry, its value would name a schema under
  // `components.schemas` instead, which may not exist or be an unrelated one.
  // So a discriminator with an entry into a removed part is removed whole.
  // It "MUST NOT change the validation outcome", so this loses detail but not
  // meaning: https://spec.openapis.org/oas/v3.0.4.html#discriminator-object
  it('removes a discriminator whose mapping points into the removed parts', () => {
    expect(convertSpec({
      components: {
        schemas: {
          Pet: {
            discriminator: {
              mapping: {
                cat: '#/components/schemas/Cat',
                dog: webhookSchemaPointer,
                fish: 'Fish',
                hamster: '#/components/pathItems/Item',
              },
              propertyName: 'kind',
            },
            type: 'object',
          },
        },
      },
    }).components).toEqual({ schemas: { Pet: { type: 'object' } } })
  })

  // `cat` points at a branch that stays inline, so 3.0 tools that honor the
  // discriminator would send `{ pet_type: 'cat' }` to the unrelated `cat`
  // component, which rejects it. Removing the discriminator leaves plain
  // `oneOf` matching, which picks the right branch.
  it('removes a discriminator rather than misroute a value to a component of the same name', async () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      components: {
        schemas: {
          cat: { type: 'string' },
          Dog: { properties: { pet_type: { const: 'dog' } }, required: ['pet_type'], type: 'object' },
          Pet: {
            $defs: { Cat: { properties: { pet_type: { const: 'cat' } }, required: ['pet_type'], type: 'object' } },
            discriminator: {
              mapping: { cat: '#/components/schemas/Pet/$defs/Cat', dog: '#/components/schemas/Dog' },
              propertyName: 'pet_type',
            },
            oneOf: [{ $ref: '#/components/schemas/Pet/$defs/Cat' }, { $ref: '#/components/schemas/Dog' }],
          },
        },
      },
      info,
      openapi: '3.1.0',
      paths: {},
    }
    const result = await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
    expect(dig(result, 'components', 'schemas', 'Pet')).toEqual({
      oneOf: [
        { properties: { pet_type: { enum: ['cat'] } }, required: ['pet_type'], type: 'object' },
        { $ref: '#/components/schemas/Dog' },
      ],
    })
  })

  // A `oneOf` with a loosened branch becomes `anyOf`, so an entry pointing
  // at one of its branches is a reference into a moved part.
  it('removes a discriminator whose mapping points into a oneOf that became anyOf', () => {
    const cat = { properties: { kind: { const: 'cat' } }, type: 'object' }
    expect(dig(convertSpec({
      components: {
        schemas: {
          Dog: { type: 'object' },
          Pet: {
            discriminator: {
              mapping: { cat: '#/components/schemas/Pet/oneOf/0', dog: '#/components/schemas/Dog' },
              propertyName: 'kind',
            },
            oneOf: [cat, { patternProperties: { '^x': {} }, type: 'object' }],
          },
        },
      },
    }), 'components', 'schemas', 'Pet')).toEqual({
      anyOf: [{ properties: { kind: { enum: ['cat'] } }, type: 'object' }, { type: 'object' }],
    })
  })
})
