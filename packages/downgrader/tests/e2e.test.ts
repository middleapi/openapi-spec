import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { doc as queryExample } from '../../types/tests/examples/3-2-query-example'
import { doc as tagsExample } from '../../types/tests/examples/3-2-tags-example'
import { doc as nonOauthScopes } from '../../types/tests/examples/non-oauth-scopes-3-1'
import { doc as petstore } from '../../types/tests/examples/petstore-3-0'
import { doc as tictactoe } from '../../types/tests/examples/tictactoe-3-1'
import { doc as webhookExample } from '../../types/tests/examples/webhook-example-3-1'
import { doc as mega31 } from '../../types/tests/schema-tests-3.1/mega'
import { doc as mega32 } from '../../types/tests/schema-tests-3.2/mega'
import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '../src/index'
import { expectValidAs } from './helpers'

describe('3.1 example documents downgraded to 3.0', () => {
  it('converts the tictactoe example to a valid 3.0.4 document without mutating the input', async () => {
    const before = structuredClone(tictactoe)
    const converted = downgradeSpecV31ToV30(tictactoe)
    expect(converted.openapi).toBe('3.0.4')
    await expectValidAs(converted, '3.0')
    expect(converted).toMatchSnapshot()
    expect(tictactoe).toEqual(before)
  })

  it('converts the webhook example, removing webhooks and synthesizing empty paths', async () => {
    const before = structuredClone(webhookExample)
    const converted = downgradeSpecV31ToV30(webhookExample)
    expect(converted.openapi).toBe('3.0.4')
    expect(converted).not.toHaveProperty('webhooks')
    expect(converted).not.toHaveProperty('x-webhooks')
    expect(converted.paths).toEqual({})
    expect(converted.components).toHaveProperty(['schemas', 'Pet'])
    await expectValidAs(converted, '3.0')
    expect(converted).toMatchSnapshot()
    expect(webhookExample).toEqual(before)
  })

  it('converts the non-OAuth-scopes example, emptying roles on the non-OAuth scheme', async () => {
    const before = structuredClone(nonOauthScopes)
    const converted = downgradeSpecV31ToV30(nonOauthScopes)
    expect(converted.openapi).toBe('3.0.4')
    expect(converted.paths).toMatchObject({
      '/users': { get: { security: [{ bearerAuth: [] }] } },
    })
    expect(converted.paths?.['/users']?.get?.responses).toEqual({
      default: { description: '' },
    })
    await expectValidAs(converted, '3.0')
    expect(converted).toMatchSnapshot()
    expect(nonOauthScopes).toEqual(before)
  })

  it('converts the 3.1 mega document, removing 3.1-only constructs and the mutualTLS scheme', async () => {
    const before = structuredClone(mega31)
    const converted = downgradeSpecV31ToV30(mega31)
    expect(converted.openapi).toBe('3.0.4')
    expect(converted).not.toHaveProperty('webhooks')
    expect(converted).not.toHaveProperty('x-webhooks')
    expect(converted.info).toEqual({
      license: { name: 'Apache 2.0' },
      title: 'My API',
      version: '1.0.0',
    })
    expect(converted.components).not.toHaveProperty('pathItems')
    expect(converted.components).not.toHaveProperty('x-pathItems')
    expect(converted.components?.securitySchemes).toEqual({})
    expect(JSON.stringify(converted)).not.toContain('#/components/pathItems/')
    await expectValidAs(converted, '3.0')
    expect(converted).toMatchSnapshot()
    expect(mega31).toEqual(before)
  })

  it('inlines $refs into the removed components.pathItems so nothing dangles', async () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      components: {
        pathItems: {
          shared: {
            get: { responses: { 200: { description: 'ok' } } },
            summary: 'Shared',
          },
        },
      },
      info: { title: 'Inlined', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/shared': {
          $ref: '#/components/pathItems/shared',
          description: 'Overriding description',
        },
      },
    }
    const before = structuredClone(doc)
    const converted = downgradeSpecV31ToV30(doc)
    expect(converted.components).not.toHaveProperty('pathItems')
    expect(converted.paths?.['/shared']).toEqual({
      description: 'Overriding description',
      get: { responses: { 200: { description: 'ok' } } },
      summary: 'Shared',
    })
    expect(JSON.stringify(converted)).not.toContain('#/components/pathItems/')
    await expectValidAs(converted, '3.0')
    expect(doc).toEqual(before)
  })

  it('resolves $refs into the removed webhooks and components.pathItems and drops links into them so nothing dangles', async () => {
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
                  schema: {
                    properties: { name: { type: 'string' }, parent: { $ref: petSchema } },
                    type: 'object',
                  },
                },
              },
            },
            responses: { 200: { description: 'received' } },
          },
        },
      },
    }
    await expectValidAs(doc, '3.1')
    const before = structuredClone(doc)
    const converted = downgradeSpecV31ToV30(doc)
    const pet = { properties: { name: { type: 'string' }, parent: {} }, type: 'object' }
    expect(converted.components).toEqual({ schemas: { Pet: pet } })
    expect(converted.paths).toEqual({
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
            200: {
              content: { 'application/json': { schema: { items: pet, type: 'array' } } },
              description: 'ok',
              links: {},
            },
            201: { description: 'received' },
          },
        },
      },
    })
    const serialized = JSON.stringify(converted)
    expect(serialized).not.toContain('#/webhooks/')
    expect(serialized).not.toContain('#/components/pathItems/')
    await expectValidAs(converted, '3.0')
    expect(doc).toEqual(before)
  })

  it('clones a discriminator with defaultMapping as-is into the 3.0 document', async () => {
    const doc = {
      components: {
        schemas: {
          Cat: {
            properties: { kind: { type: 'string' } },
            required: ['kind'],
            type: 'object',
          },
          Pet: {
            discriminator: {
              defaultMapping: 'Cat',
              mapping: { cat: '#/components/schemas/Cat' },
              propertyName: 'kind',
            },
            oneOf: [{ $ref: '#/components/schemas/Cat' }],
          },
        },
      },
      info: { title: 'Discriminated', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {},
    } as any
    const before = structuredClone(doc)
    const converted = downgradeSpecV31ToV30(doc)
    expect(converted).toHaveProperty(
      ['components', 'schemas', 'Pet', 'discriminator'],
      {
        defaultMapping: 'Cat',
        mapping: { cat: '#/components/schemas/Cat' },
        propertyName: 'kind',
      },
    )
    await expectValidAs(converted, '3.0')
    expect(doc).toEqual(before)
  })

  it('converts raw and encoded binary schemas to the 3.0 binary and byte formats', async () => {
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
    const before = structuredClone(doc)
    const converted = downgradeSpecV31ToV30(doc)
    expect(converted.paths['/avatar']?.put?.requestBody).toEqual({
      content: {
        'image/png': { schema: { format: 'binary', type: 'string' } },
        'text/plain': { schema: { format: 'byte', type: 'string' } },
      },
    })
    await expectValidAs(converted, '3.0')
    expect(doc).toEqual(before)
  })
})

describe('3.2 example documents downgraded to 3.1 and chained to 3.0', () => {
  it('removes the query operation of the query example, leaving an empty path item', async () => {
    const before = structuredClone(queryExample)
    const v31 = downgradeSpecV32ToV31(queryExample)
    expect(v31.openapi).toBe('3.1.2')
    expect(v31.paths?.['/flights/search']).toEqual({})
    expect(JSON.stringify(v31)).not.toContain('x-additionalOperations')
    await expectValidAs(v31, '3.1')
    expect(v31).toMatchSnapshot('v3.1')

    const v30 = downgradeSpecV31ToV30(v31)
    expect(v30.openapi).toBe('3.0.4')
    await expectValidAs(v30, '3.0')
    expect(v30).toMatchSnapshot('v3.0')
    expect(queryExample).toEqual(before)
  })

  it('removes tag summary, parent, and kind of the tags example', async () => {
    const before = structuredClone(tagsExample)
    const v31 = downgradeSpecV32ToV31(tagsExample)
    expect(v31.openapi).toBe('3.1.2')
    expect(v31.tags).toEqual([
      { description: 'Core flight operations', name: 'flights' },
      {
        description: 'Flights that cross country borders',
        name: 'international',
      },
      { description: 'Flights within a single country', name: 'domestic' },
      {
        description: 'Information about flight delays',
        externalDocs: {
          description: 'Delay compensation policies',
          url: 'https://docs.example.com/delay-policies',
        },
        name: 'delays',
      },
    ])
    await expectValidAs(v31, '3.1')
    expect(v31).toMatchSnapshot('v3.1')

    const v30 = downgradeSpecV31ToV30(v31)
    expect(v30.openapi).toBe('3.0.4')
    await expectValidAs(v30, '3.0')
    expect(v30).toMatchSnapshot('v3.0')
    expect(tagsExample).toEqual(before)
  })

  it('inlines $refs into removed 3.2 parts so nothing dangles', async () => {
    const pet: OpenAPIV3_2.SchemaObject = { properties: { name: { type: 'string' } }, type: 'object' }
    const doc: OpenAPIV3_2.OpenAPIObject = {
      components: {
        mediaTypes: {
          Pet: { examples: { tom: { dataValue: { name: 'Tom' } } }, schema: pet },
        },
        schemas: { Pet: { $ref: '#/components/mediaTypes/Pet/schema' } },
      },
      info: { title: 'Dangling', version: '1.0.0' },
      openapi: '3.2.0',
      paths: {
        '/pets': {
          additionalOperations: {
            COPY: { responses: { 201: { description: 'Copied' } } },
          },
          get: {
            parameters: [
              {
                content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
                in: 'querystring',
                name: 'filter',
              },
              { in: 'query', name: 'limit', schema: { type: 'integer' } },
            ],
            responses: {
              200: {
                content: {
                  'application/json': {
                    examples: { tom: { $ref: '#/components/mediaTypes/Pet/examples/tom' } },
                    schema: { items: { $ref: '#/components/schemas/Pet' }, type: 'array' },
                  },
                },
                description: 'Pets',
              },
            },
          },
          post: {
            parameters: [{ $ref: '#/paths/~1pets/get/parameters/1' }],
            requestBody: { $ref: '#/paths/~1pets/query/requestBody' },
            responses: {
              200: { $ref: '#/paths/~1pets/query/responses/200' },
              201: { $ref: '#/paths/~1pets/additionalOperations/COPY/responses/201' },
            },
          },
          query: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/mediaTypes/Pet/schema' } },
              },
            },
            responses: { 200: { summary: 'Matching pets' } },
          },
        },
      },
    }
    const before = structuredClone(doc)

    const v31 = downgradeSpecV32ToV31(doc)
    const serialized = JSON.stringify(v31)
    expect(serialized).not.toContain('#/components/mediaTypes/')
    expect(serialized).not.toContain('~1pets/')
    expect(v31.components?.schemas).toEqual({ Pet: pet })
    expect(v31.paths?.['/pets']?.get?.responses?.['200']).toMatchObject({
      content: { 'application/json': { examples: { tom: { value: { name: 'Tom' } } } } },
    })
    expect(v31.paths?.['/pets']?.post).toEqual({
      parameters: [{ in: 'query', name: 'limit', schema: { type: 'integer' } }],
      requestBody: { content: { 'application/json': { schema: pet } } },
      responses: {
        200: { description: 'Matching pets' },
        201: { description: 'Copied' },
      },
    })
    await expectValidAs(v31, '3.1')

    await expectValidAs(downgradeSpecV31ToV30(v31), '3.0')
    expect(doc).toEqual(before)
  })

  it('converts the 3.2 mega document, removing the discriminator defaultMapping from the schema', async () => {
    const before = structuredClone(mega32)
    const v31 = downgradeSpecV32ToV31(mega32)
    expect(v31.openapi).toBe('3.1.2')
    const megaDiscriminatorPath = [
      'components',
      'pathItems',
      'myPathItem',
      'post',
      'requestBody',
      'content',
      'application/json',
      'schema',
      'discriminator',
    ]
    expect(v31).not.toHaveProperty([...megaDiscriminatorPath, 'defaultMapping'])
    expect(v31).toHaveProperty(
      [...megaDiscriminatorPath, 'propertyName'],
      'type',
    )
    expect(v31).not.toHaveProperty([
      ...megaDiscriminatorPath,
      'x-defaultMapping',
    ])
    await expectValidAs(v31, '3.1')
    expect(v31).toMatchSnapshot('v3.1')

    const v30 = downgradeSpecV31ToV30(v31)
    expect(v30.openapi).toBe('3.0.4')
    expect(v30.components).not.toHaveProperty('pathItems')
    expect(v30).not.toHaveProperty('webhooks')
    await expectValidAs(v30, '3.0')
    expect(v30).toMatchSnapshot('v3.0')
    expect(mega32).toEqual(before)
  })
})

describe('already-3.0-shaped documents', () => {
  it('passes the petstore example through untouched apart from the version stamp', () => {
    const before = structuredClone(petstore)
    const converted = downgradeSpecV31ToV30(petstore as any)
    expect(converted).toEqual({
      ...structuredClone(petstore),
      openapi: '3.0.4',
    })
    expect(petstore).toEqual(before)
  })
})

describe('kitchen-sink 3.2 document chained down to 3.0', () => {
  const kitchenSink: OpenAPIV3_2.OpenAPIObject = {
    $self: 'https://api.example.com/openapi.json',
    components: {
      mediaTypes: {
        JsonPayload: {
          schema: { items: { type: 'string' }, type: 'array' },
        },
      },
      parameters: {
        filter: {
          content: {
            'application/json': {
              schema: {
                properties: { term: { type: 'string' } },
                type: 'object',
              },
            },
          },
          in: 'querystring',
          name: 'filter',
        },
        page: { in: 'query', name: 'page', schema: { type: 'integer' } },
      },
      securitySchemes: {
        deviceAuth: {
          deprecated: true,
          flows: {
            deviceAuthorization: {
              deviceAuthorizationUrl: 'https://auth.example.com/device',
              scopes: { 'events:read': 'Read events' },
              tokenUrl: 'https://auth.example.com/token',
            },
          },
          oauth2MetadataUrl: 'https://auth.example.com/.well-known/oauth',
          type: 'oauth2',
        },
      },
    },
    info: { title: 'Kitchen Sink', version: '1.0.0' },
    openapi: '3.2.0',
    paths: {
      '/events': {
        get: {
          operationId: 'streamEvents',
          responses: {
            200: {
              content: {
                'application/json': {
                  itemSchema: { type: 'object' },
                  schema: { items: { type: 'object' }, type: 'array' },
                },
                'application/jsonl': {
                  itemSchema: {
                    properties: { kind: { type: 'string' } },
                    type: 'object',
                  },
                },
              },
              summary: 'Event stream',
            },
            204: {},
          },
        },
      },
      '/search': {
        get: {
          operationId: 'searchEvents',
          parameters: [
            {
              content: {
                'application/json': {
                  schema: {
                    properties: { term: { type: 'string' } },
                    type: 'object',
                  },
                },
              },
              in: 'querystring',
              name: 'filter',
            },
            {
              examples: {
                kept: { serializedValue: 'sid=1', value: 'sid=1' },
                linked: {
                  dataValue: { sid: 2 },
                  externalValue: 'https://example.com/session.json',
                },
                promoted: { dataValue: 'sid=3' },
              },
              in: 'cookie',
              name: 'session',
              schema: { type: 'string' },
              style: 'cookie',
            },
          ],
          responses: {
            200: {
              content: {
                'application/json': {
                  $ref: '#/components/mediaTypes/JsonPayload',
                },
              },
              description: 'Search results',
              summary: 'Results',
            },
          },
        },
      },
    },
    security: [{ deviceAuth: ['events:read'] }],
    servers: [{ name: 'production', url: 'https://api.example.com' }],
  }

  it('converts every 3.2-only construct and stays valid through both hops', async () => {
    const before = structuredClone(kitchenSink)

    const v31 = downgradeSpecV32ToV31(kitchenSink)
    expect(v31.openapi).toBe('3.1.2')
    expect(v31).not.toHaveProperty('$self')
    expect(v31).not.toHaveProperty('x-self')
    expect(v31.servers).toEqual([{ url: 'https://api.example.com' }])
    expect(v31.components).not.toHaveProperty('mediaTypes')
    expect(JSON.stringify(v31)).not.toContain('#/components/mediaTypes/')
    expect(v31.components?.parameters).toEqual({
      page: { in: 'query', name: 'page', schema: { type: 'integer' } },
    })
    expect(v31.components?.securitySchemes).toEqual({
      deviceAuth: { flows: {}, type: 'oauth2' },
    })
    expect(v31.paths?.['/events']?.get?.responses).toEqual({
      200: {
        content: {
          'application/json': {
            schema: { items: { type: 'object' }, type: 'array' },
          },
          'application/jsonl': {
            schema: {
              items: {
                properties: { kind: { type: 'string' } },
                type: 'object',
              },
              type: 'array',
            },
          },
        },
        description: 'Event stream',
      },
      204: { description: '' },
    })
    expect(v31.paths?.['/search']?.get?.parameters).toEqual([
      {
        examples: {
          kept: { value: 'sid=1' },
          linked: { externalValue: 'https://example.com/session.json' },
          promoted: { value: 'sid=3' },
        },
        in: 'cookie',
        name: 'session',
        schema: { type: 'string' },
      },
    ])
    expect(v31.paths?.['/search']?.get?.responses?.['200']).toEqual({
      content: {
        'application/json': {
          schema: { items: { type: 'string' }, type: 'array' },
        },
      },
      description: 'Search results',
    })
    expect(v31.security).toEqual([{ deviceAuth: ['events:read'] }])
    await expectValidAs(v31, '3.1')
    expect(v31).toMatchSnapshot('v3.1')

    const v30 = downgradeSpecV31ToV30(v31)
    expect(v30.openapi).toBe('3.0.4')
    await expectValidAs(v30, '3.0')
    expect(v30).toMatchSnapshot('v3.0')

    expect(kitchenSink).toEqual(before)
  })
})
