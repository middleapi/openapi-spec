// Each official 3.2 document (see tests/corpus.ts) must downgrade to a
// document the official 3.1 JSON Schema accepts, without leaving a reference
// dangling that resolved before.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc as queryExample } from '../../../../types/tests/examples/3-2-query-example'
import { doc as tagsExample } from '../../../../types/tests/examples/3-2-tags-example'
import { doc as mega } from '../../../../types/tests/schema-tests-3.2/mega'
import { corpusV32 } from '../../corpus'
import { expectValidAs, expectValidDowngrade } from '../../validate'

describe('official corpus', () => {
  it.each(corpusV32)('converts %s to a valid 3.1 document', async (_name, doc) => {
    await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
  })
})

describe('official examples', () => {
  it('removes the QUERY operation of the query example, leaving an empty path item', () => {
    const v31 = downgradeSpecV32ToV31(queryExample)
    expect(v31.paths?.['/flights/search']).toEqual({})
    expect(v31).toMatchSnapshot()
  })

  it('flattens the tag hierarchy of the tags example', () => {
    const v31 = downgradeSpecV32ToV31(tagsExample)
    expect(v31.tags).toEqual([
      { description: 'Core flight operations', name: 'flights' },
      { description: 'Flights that cross country borders', name: 'international' },
      { description: 'Flights within a single country', name: 'domestic' },
      {
        description: 'Information about flight delays',
        externalDocs: { description: 'Delay compensation policies', url: 'https://docs.example.com/delay-policies' },
        name: 'delays',
      },
    ])
    expect(v31).toMatchSnapshot()
  })

  it('removes the discriminator with a defaultMapping from the mega document', () => {
    const v31 = downgradeSpecV32ToV31(mega)
    const schema = ['components', 'pathItems', 'myPathItem', 'post', 'requestBody', 'content', 'application/json', 'schema']
    expect(v31).not.toHaveProperty([...schema, 'discriminator'])
    expect(v31).toHaveProperty([...schema, 'anyOf'], [{ $ref: '#/components/schemas/Foo' }])
    expect(v31).toMatchSnapshot()
  })
})

describe('kitchen sink', () => {
  it('converts every 3.2-only construct into a valid 3.1 document', async () => {
    const kitchenSink: OpenAPIV3_2.OpenAPIObject = {
      $self: 'https://api.example.com/openapi.json',
      components: {
        mediaTypes: { JsonPayload: { schema: { items: { type: 'string' }, type: 'array' } } },
        parameters: {
          filter: {
            content: { 'application/json': { schema: { properties: { term: { type: 'string' } }, type: 'object' } } },
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
                  'application/json': { itemSchema: { type: 'object' }, schema: { items: { type: 'object' }, type: 'array' } },
                  'application/jsonl': { itemSchema: { properties: { kind: { type: 'string' } }, type: 'object' } },
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
                content: { 'application/json': { schema: { properties: { term: { type: 'string' } }, type: 'object' } } },
                in: 'querystring',
                name: 'filter',
              },
              {
                examples: {
                  kept: { serializedValue: 'sid=1', value: 'sid=1' },
                  linked: { dataValue: { sid: 2 }, externalValue: 'https://example.com/session.json' },
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
                content: { 'application/json': { $ref: '#/components/mediaTypes/JsonPayload' } },
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
    const before = structuredClone(kitchenSink)
    const v31 = downgradeSpecV32ToV31(kitchenSink)
    expect(v31).toEqual({
      components: {
        parameters: { page: { in: 'query', name: 'page', schema: { type: 'integer' } } },
        securitySchemes: { deviceAuth: { flows: {}, type: 'oauth2' } },
      },
      info: { title: 'Kitchen Sink', version: '1.0.0' },
      openapi: '3.1.2',
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              200: {
                content: {
                  'application/json': { schema: { items: { type: 'object' }, type: 'array' } },
                  'application/jsonl': { schema: { items: { properties: { kind: { type: 'string' } }, type: 'object' }, type: 'array' } },
                },
                description: 'Event stream',
              },
              204: { description: '' },
            },
          },
        },
        '/search': {
          get: {
            operationId: 'searchEvents',
            parameters: [
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
            ],
            responses: {
              200: {
                content: { 'application/json': { schema: { items: { type: 'string' }, type: 'array' } } },
                description: 'Search results',
              },
            },
          },
        },
      },
      security: [{ deviceAuth: ['events:read'] }],
      servers: [{ url: 'https://api.example.com' }],
    })
    await expectValidAs(v31, '3.1')
    expect(kitchenSink).toEqual(before)
  })
})
