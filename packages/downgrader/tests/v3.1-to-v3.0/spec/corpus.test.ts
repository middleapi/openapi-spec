// Each official 3.1 document (see tests/corpus.ts) must downgrade to a
// document the official 3.0 JSON Schema accepts, without leaving a reference
// dangling that resolved before.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { doc as nonOauthScopesExample } from '../../../../types/tests/examples/non-oauth-scopes-3-1'
import { doc as petstore } from '../../../../types/tests/examples/petstore-3-0'
import { doc as tictactoe } from '../../../../types/tests/examples/tictactoe-3-1'
import { doc as webhookExample } from '../../../../types/tests/examples/webhook-example-3-1'
import { doc as mega } from '../../../../types/tests/schema-tests-3.1/mega'
import { corpusV31 } from '../../corpus'
import { expectValidAs, expectValidDowngrade } from '../../validate'

describe('official corpus', () => {
  it.each(corpusV31)('converts %s to a valid 3.0 document', async (_name, doc) => {
    await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
  })
})

describe('official examples', () => {
  it('converts the tictactoe example', () => {
    expect(downgradeSpecV31ToV30(tictactoe)).toMatchSnapshot()
  })

  it('removes the webhooks of the webhook example, leaving empty paths', () => {
    const v30 = downgradeSpecV31ToV30(webhookExample)
    expect(v30).not.toHaveProperty('webhooks')
    expect(v30.paths).toEqual({})
    expect(v30.components).toHaveProperty(['schemas', 'Pet'])
    expect(v30).toMatchSnapshot()
  })

  it('empties the roles on the non-OAuth scheme of the non-OAuth-scopes example', () => {
    const v30 = downgradeSpecV31ToV30(nonOauthScopesExample)
    expect(v30.paths['/users']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(v30.paths['/users']?.get?.responses).toEqual({ default: { description: '' } })
    expect(v30).toMatchSnapshot()
  })

  it('removes the 3.1-only constructs and the mutualTLS scheme of the mega document', () => {
    const v30 = downgradeSpecV31ToV30(mega)
    expect(v30.info).toEqual({ license: { name: 'Apache 2.0' }, title: 'My API', version: '1.0.0' })
    expect(v30.components).not.toHaveProperty('pathItems')
    expect(v30.components?.securitySchemes).toEqual({})
    expect(JSON.stringify(v30)).not.toContain('#/components/pathItems/')
    expect(v30).toMatchSnapshot()
  })

  // A document that only uses what 3.0 already had comes out unchanged,
  // apart from the version.
  it('passes the 3.0 petstore example through apart from the version', () => {
    expect(downgradeSpecV31ToV30(petstore as any)).toEqual({ ...structuredClone(petstore), openapi: '3.0.4' })
  })
})

describe('hand-written documents', () => {
  it('inlines references into webhooks and components.pathItems into a valid 3.0 document', async () => {
    const petSchema = '#/webhooks/newPet/post/requestBody/content/application~1json/schema'
    const doc: OpenAPIV3_1.OpenAPIObject = {
      components: {
        pathItems: {
          item: {
            get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
            parameters: [{ in: 'query', name: 'q', schema: { type: ['string', 'null'] } }],
          },
        },
        schemas: { Pet: { $ref: petSchema } },
      },
      info: { title: 'Webhook references', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/items': { $ref: '#/components/pathItems/item' },
        '/pets': {
          get: {
            parameters: [
              { $ref: '#/webhooks/newPet/post/parameters/0' },
              { $ref: '#/components/pathItems/item/parameters/0', description: 'Filter' },
            ],
            responses: {
              200: {
                content: { 'application/json': { schema: { items: { $ref: petSchema }, type: 'array' } } },
                description: 'ok',
                links: {
                  hook: { operationRef: '#/webhooks/newPet/post' },
                  item: { operationRef: '#/components/pathItems/item/get' },
                },
              },
              201: { $ref: '#/webhooks/newPet/post/responses/200' },
            },
          },
        },
      },
      webhooks: {
        newPet: {
          post: {
            operationId: 'newPetHook',
            parameters: [{ in: 'header', name: 'X-Signature', schema: { type: 'string' } }],
            requestBody: {
              content: {
                'application/json': {
                  schema: { properties: { name: { type: 'string' }, parent: { $ref: petSchema } }, type: 'object' },
                },
              },
            },
            responses: { 200: { description: 'received' } },
          },
        },
      },
    }
    await expectValidAs(doc, '3.1')
    const v30 = downgradeSpecV31ToV30(doc)
    const pet = { properties: { name: { type: 'string' }, parent: {} }, type: 'object' }
    expect(v30.components).toEqual({ schemas: { Pet: pet } })
    expect(v30.paths).toEqual({
      '/items': {
        get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
        parameters: [{ in: 'query', name: 'q', schema: { nullable: true, type: 'string' } }],
      },
      '/pets': {
        get: {
          parameters: [
            { in: 'header', name: 'X-Signature', schema: { type: 'string' } },
            { in: 'query', name: 'q', schema: { nullable: true, type: 'string' } },
          ],
          responses: {
            200: { content: { 'application/json': { schema: { items: pet, type: 'array' } } }, description: 'ok', links: {} },
            201: { description: 'received' },
          },
        },
      },
    })
    await expectValidAs(v30, '3.0')
  })

  it('converts raw and encoded binary bodies into a valid 3.0 document', async () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      info: { title: 'Uploads', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/avatar': {
          put: {
            requestBody: {
              content: {
                'image/png': { schema: { contentMediaType: 'image/png' } },
                'text/plain': { schema: { contentEncoding: 'base64', contentMediaType: 'image/png', type: 'string' } },
              },
            },
            responses: { 204: { description: 'saved' } },
          },
        },
      },
    }
    const v30 = downgradeSpecV31ToV30(doc)
    expect(v30.paths['/avatar']?.put?.requestBody).toEqual({
      content: {
        'image/png': { schema: { format: 'binary', type: 'string' } },
        'text/plain': { schema: { format: 'byte', type: 'string' } },
      },
    })
    await expectValidAs(v30, '3.0')
  })

  it('keeps untyped multipart parts sent as application/octet-stream in a valid 3.0 document', async () => {
    const schema: OpenAPIV3_1.SchemaObject = {
      properties: {
        addresses: { items: { type: 'object' }, type: 'array' },
        file: { items: {}, type: 'array' },
        id: { format: 'uuid', type: 'string' },
        profileImage: {},
      },
      type: 'object',
    }
    const headers = { 'X-Rate-Limit-Limit': { schema: { type: 'integer' } } } as const
    const doc: OpenAPIV3_1.OpenAPIObject = {
      info: { title: 'Uploads', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/profile': {
          post: {
            requestBody: { content: { 'multipart/form-data': { encoding: { profileImage: { headers } }, schema } } },
            responses: { 204: { description: 'saved' } },
          },
        },
      },
    }
    const v30 = downgradeSpecV31ToV30(doc)
    expect(v30.paths['/profile']?.post?.requestBody).toEqual({
      content: {
        'multipart/form-data': {
          encoding: {
            file: { contentType: 'application/octet-stream' },
            profileImage: { contentType: 'application/octet-stream', headers },
          },
          schema,
        },
      },
    })
    await expectValidAs(v30, '3.0')
  })
})
