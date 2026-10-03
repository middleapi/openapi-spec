import { runInNewContext } from 'node:vm'

import { downgradeSchemaV32ToV31, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { expectValidDowngrade } from './validate'

const info = { title: 'API', version: '1.0.0' }

function convert(fields: Omit<OpenAPIV3_2.OpenAPIObject, 'info' | 'openapi'>) {
  return downgradeSpecV32ToV31({ openapi: '3.2.0', info, ...fields })
}

/** Converts `operation` as `GET /a` and returns it. */
function convertOperation(operation: OpenAPIV3_2.OperationObject) {
  return convert({ paths: { '/a': { get: operation } } }).paths?.['/a']?.get
}

describe('downgradeSpecV32ToV31', () => {
  it('converts a document using every 3.2 feature into a valid 3.1 document', async () => {
    const doc: OpenAPIV3_2.OpenAPIObject = {
      openapi: '3.2.0',
      $self: 'https://example.com/openapi.json',
      info,
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17',
      servers: [{ url: 'https://example.com', name: 'production' }],
      tags: [
        { name: 'pets', summary: 'Pets', kind: 'nav' },
        { name: 'cats', parent: 'pets' },
      ],
      paths: {
        '/pets': {
          query: { responses: { 200: { description: 'ok' } } },
          additionalOperations: { PURGE: { responses: { 204: { description: 'purged' } } } },
          get: {
            parameters: [
              {
                in: 'querystring',
                name: 'q',
                content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
              },
              { in: 'cookie', name: 'session', style: 'cookie', schema: { type: 'string' } },
              {
                in: 'cookie',
                name: 'pref',
                style: 'form',
                allowReserved: true,
                schema: { type: 'string' },
              },
              { $ref: '#/components/parameters/Search' },
            ],
            responses: {
              200: {
                summary: 'The pets',
                content: {
                  'application/jsonl': {
                    description: 'One pet per line',
                    itemSchema: { $ref: '#/components/schemas/Pet' },
                  },
                  'application/json': { $ref: '#/components/mediaTypes/Pets' },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            xml: { nodeType: 'element' },
            discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/Pet' },
            properties: {
              kind: { type: 'string' },
              id: { type: 'string', xml: { nodeType: 'attribute' } },
            },
          },
        },
        mediaTypes: {
          Pets: { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } },
        },
        parameters: {
          Search: {
            in: 'querystring',
            name: 'search',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
        examples: { Pet: { dataValue: { kind: 'cat' }, serializedValue: '{"kind":"cat"}' } },
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            deprecated: true,
            oauth2MetadataUrl: 'https://example.com/.well-known/oauth-authorization-server',
            flows: {
              deviceAuthorization: {
                deviceAuthorizationUrl: 'https://example.com/device',
                tokenUrl: 'https://example.com/token',
                scopes: {},
              },
              clientCredentials: { tokenUrl: 'https://example.com/token', scopes: {} },
            },
          },
        },
      },
    }
    await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
  })

  it('sets the version, drops $self, and points the 3.2 dialect at the 3.1 one', () => {
    const out = convert({
      $self: 'https://example.com/openapi.json',
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17',
    })
    expect(out).toEqual({
      openapi: '3.1.2',
      info,
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    })
    expect(convert({ jsonSchemaDialect: 'https://example.com/dialect' }).jsonSchemaDialect).toBe(
      'https://example.com/dialect',
    )
  })

  it('drops Server name wherever servers appear', () => {
    const server = { url: 'https://example.com', name: 'production' }
    const out = convert({
      servers: [server],
      paths: {
        '/a': {
          servers: [server],
          get: {
            servers: [server],
            responses: {
              200: { description: 'ok', links: { self: { operationId: 'a', server } } },
            },
          },
        },
      },
    })
    const expected = { url: 'https://example.com' }
    expect(out.servers).toEqual([expected])
    expect(out.paths?.['/a']?.servers).toEqual([expected])
    expect(out.paths?.['/a']?.get?.servers).toEqual([expected])
    expect(out.paths?.['/a']?.get?.responses?.['200']).toMatchObject({
      links: { self: { server: expected } },
    })
  })

  it('drops Tag summary, parent, and kind, and lets the summary stand in for a missing description', () => {
    expect(
      convert({
        tags: [
          { name: 'cats', summary: 'Cats', parent: 'pets', kind: 'nav', description: 'd' },
          { name: 'dogs', summary: 'Dogs' },
        ],
      }).tags,
    ).toEqual([
      { name: 'cats', description: 'd' },
      { name: 'dogs', description: 'Dogs' },
    ])
  })

  it('drops the query method and additionalOperations', () => {
    const responses = { 200: { description: 'ok' } }
    const out = convert({
      paths: {
        '/a': {
          get: { responses },
          query: { responses },
          additionalOperations: { PURGE: { responses } },
        },
      },
    })
    expect(out.paths).toEqual({ '/a': { get: { responses } } })
  })

  describe('parameters', () => {
    it('drops querystring parameters, and the components and $refs that resolve to them', () => {
      const out = convert({
        paths: {
          '/a': {
            parameters: [{ $ref: '#/components/parameters/Alias' }, { in: 'query', name: 'kept' }],
            get: {
              parameters: [{ in: 'querystring', name: 'q', content: { 'text/plain': {} } }],
              responses: {},
            },
          },
        },
        components: {
          parameters: {
            Q: { in: 'querystring', name: 'q', content: { 'text/plain': {} } },
            Alias: { $ref: '#/components/parameters/Q' },
            Kept: { in: 'query', name: 'k' },
          },
        },
      })
      expect(out.paths?.['/a']?.parameters).toEqual([{ in: 'query', name: 'kept' }])
      expect(out.paths?.['/a']?.get?.parameters).toEqual([])
      expect(out.components?.parameters).toEqual({ Kept: { in: 'query', name: 'k' } })
    })

    it('keeps allowReserved only on query parameters', () => {
      const out = convertOperation({
        parameters: [
          { in: 'query', name: 'q', allowReserved: true },
          { in: 'path', name: 'p', required: true, allowReserved: true },
          { in: 'cookie', name: 'c', style: 'form', allowReserved: true },
        ],
      })
      expect(out?.parameters).toEqual([
        { in: 'query', name: 'q', allowReserved: true },
        { in: 'path', name: 'p', required: true },
        { in: 'cookie', name: 'c', style: 'form' },
      ])
    })

    it('drops style: cookie', () => {
      expect(
        convertOperation({
          parameters: [
            { in: 'cookie', name: 'c', style: 'cookie' },
            { in: 'cookie', name: 'f', style: 'form' },
          ],
        })?.parameters,
      ).toEqual([
        { in: 'cookie', name: 'c' },
        { in: 'cookie', name: 'f', style: 'form' },
      ])
    })

    it('drops the fields 3.1 allows only beside schema from a parameter with content', () => {
      const content = { 'application/json': { example: 1 } }
      // As oRPC emits a query parameter whose queryStyles entry is 'json'.
      const parameter = {
        in: 'query',
        name: 'q',
        content,
        allowEmptyValue: true,
        allowReserved: true,
        style: 'form',
        explode: true,
        example: 1,
        examples: { a: { value: 1 } },
      } as const
      expect(convertOperation({ parameters: [parameter] })?.parameters).toEqual([
        { in: 'query', name: 'q', content, allowEmptyValue: true },
      ])
    })
  })

  describe('media types', () => {
    it('drops description, prefixEncoding, and itemEncoding', () => {
      const out = convertOperation({
        requestBody: {
          content: {
            'multipart/mixed': {
              description: 'd',
              schema: { type: 'array' },
              prefixEncoding: [{ contentType: 'a/b' }],
              itemEncoding: { contentType: 'a/b' },
            },
          },
        },
      })
      expect(out?.requestBody).toEqual({
        content: { 'multipart/mixed': { schema: { type: 'array' } } },
      })
    })

    it('turns a lone itemSchema into an array schema, and drops it beside schema', () => {
      const out = convertOperation({
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/jsonl': {
                itemSchema: { type: 'string', xml: { nodeType: 'attribute' } },
              },
              'text/event-stream': { schema: { type: 'string' }, itemSchema: { type: 'object' } },
            },
          },
        },
      })
      expect(out?.responses?.['200']).toEqual({
        description: 'ok',
        content: {
          'application/jsonl': {
            schema: { type: 'array', items: { type: 'string', xml: { attribute: true } } },
          },
          'text/event-stream': { schema: { type: 'string' } },
        },
      })
    })

    it('drops nested encodings inside an Encoding Object', () => {
      const encoding = {
        contentType: 'multipart/mixed',
        encoding: { a: {} },
        prefixEncoding: [{}],
        itemEncoding: {},
      }
      const out = convertOperation({
        requestBody: { content: { 'multipart/form-data': { encoding: { part: encoding } } } },
      })
      expect(out?.requestBody).toEqual({
        content: {
          'multipart/form-data': { encoding: { part: { contentType: 'multipart/mixed' } } },
        },
      })
    })

    it('inlines $refs to components.mediaTypes, following chains, and drops the components', () => {
      const out = convert({
        paths: {
          '/a': {
            get: {
              responses: {
                200: {
                  description: 'ok',
                  content: { 'application/json': { $ref: '#/components/mediaTypes/Alias' } },
                },
              },
            },
          },
        },
        components: {
          mediaTypes: {
            Alias: { $ref: '#/components/mediaTypes/Pet' },
            Pet: { description: 'A pet', schema: { $ref: '#/components/schemas/Pet' } },
          },
          schemas: { Pet: { type: 'object' } },
        },
      })
      expect(out.paths?.['/a']?.get?.responses?.['200']).toEqual({
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
      })
      expect(out.components).toEqual({ schemas: { Pet: { type: 'object' } } })
    })

    it('drops a content $ref that does not resolve or loops', () => {
      const out = convertOperation({
        requestBody: {
          content: {
            'application/json': { $ref: '#/components/mediaTypes/Missing' },
            'text/plain': { $ref: '#/paths/~1a/get/requestBody/content/text~1plain' },
          },
        },
      })
      expect(out?.requestBody).toEqual({ content: {} })
    })
  })

  it('drops Response summary, using it as the description when that is missing', () => {
    const out = convertOperation({
      responses: {
        200: { summary: 'OK', description: 'Everything went fine' },
        201: { summary: 'Created' },
        204: {},
      },
    })
    expect(out?.responses).toEqual({
      200: { description: 'Everything went fine' },
      201: { description: 'Created' },
      204: { description: '' },
    })
  })

  it('fills Example value from dataValue, or else serializedValue', () => {
    const out = convert({
      components: {
        examples: {
          Data: { dataValue: { a: 1 }, serializedValue: '{"a":1}' },
          Serialized: { serializedValue: 'a=1' },
          Value: { value: 1, dataValue: 2 },
          External: { externalValue: 'https://example.com/a.json', dataValue: 1 },
        },
      },
    })
    expect(out.components?.examples).toEqual({
      Data: { value: { a: 1 } },
      Serialized: { value: 'a=1' },
      Value: { value: 1 },
      External: { externalValue: 'https://example.com/a.json' },
    })
  })

  it('drops the device authorization flow, oauth2MetadataUrl, and deprecated from security schemes', () => {
    const tokenUrl = 'https://example.com/token'
    const out = convert({
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            deprecated: true,
            oauth2MetadataUrl: 'https://example.com/meta',
            flows: {
              deviceAuthorization: {
                deviceAuthorizationUrl: 'https://example.com/device',
                tokenUrl,
                scopes: {},
              },
              clientCredentials: { tokenUrl, scopes: {} },
            },
          },
        },
      },
    })
    expect(out.components?.securitySchemes).toEqual({
      oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl, scopes: {} } } },
    })
  })

  it('converts schemas everywhere in the document', () => {
    const schema: OpenAPIV3_2.SchemaObject = { type: 'string', xml: { nodeType: 'attribute' } }
    const out = convert({
      paths: { '/a': { parameters: [{ in: 'query', name: 'q', schema }] } },
      webhooks: {
        hook: { post: { requestBody: { content: { 'application/json': { schema } } } } },
      },
      components: {
        schemas: { S: schema },
        headers: { H: { schema } },
        pathItems: { P: { parameters: [{ in: 'query', name: 'q', schema }] } },
      },
    })
    const expected = { type: 'string', xml: { attribute: true } }
    expect(out.paths?.['/a']?.parameters?.[0]).toMatchObject({ schema: expected })
    expect(out.webhooks?.hook?.post?.requestBody).toMatchObject({
      content: { 'application/json': { schema: expected } },
    })
    expect(out.components).toMatchObject({
      schemas: { S: expected },
      headers: { H: { schema: expected } },
      pathItems: { P: { parameters: [{ schema: expected }] } },
    })
  })

  it('leaves the input untouched and shares no objects with it', () => {
    const example = { nested: { a: 1 } }
    const doc: OpenAPIV3_2.OpenAPIObject = {
      openapi: '3.2.0',
      info: { ...info, 'x-meta': example },
      paths: {},
    }
    const before = structuredClone(doc)
    const out = downgradeSpecV32ToV31(doc)
    expect(doc).toEqual(before)
    expect(out.info['x-meta']).toEqual(example)
    expect(out.info['x-meta']).not.toBe(example)
  })

  it("reads null-prototype and other-realm objects as JSON would, such as oRPC's generated documents", () => {
    function NullProto() {}
    NullProto.prototype = Object.freeze(Object.create(null))
    const object = (fields: object) => Object.assign(new (NullProto as any)(), fields)
    const doc = object({
      openapi: '3.2.0',
      info: object(info),
      tags: [object({ name: 'a', kind: 'nav' })],
      paths: object({}),
    })
    expect(downgradeSpecV32ToV31(doc)).toEqual({
      openapi: '3.1.2',
      info,
      tags: [{ name: 'a' }],
      paths: {},
    })
    const other = runInNewContext(
      `(${JSON.stringify({ openapi: '3.2.0', info, servers: [{ url: '/', name: 'main' }] })})`,
    )
    expect(downgradeSpecV32ToV31(other)).toEqual({
      openapi: '3.1.2',
      info,
      servers: [{ url: '/' }],
    })
    // Keys an object inherits are not part of it as JSON sees it, so such an object is kept as it is.
    const inherits = Object.create(Object.assign(Object.create(null), { type: 'string' }))
    expect(downgradeSchemaV32ToV31(inherits)).toBe(inherits)
  })

  it('treats keys holding undefined as missing, and keeps non-plain values as they are', () => {
    const date = new Date(0)
    const out = convertOperation({
      'summary': undefined,
      'responses': { 200: { summary: 'OK', description: undefined } },
      'x-date': date,
    })
    expect(out).toEqual({ 'responses': { 200: { description: 'OK' } }, 'x-date': date })
    expect(out?.['x-date']).toBe(date)
  })
})

describe('downgradeSchemaV32ToV31', () => {
  it('turns XML nodeType into attribute or wrapped, in every subschema', () => {
    expect(
      downgradeSchemaV32ToV31({
        type: 'object',
        xml: { name: 'pet', nodeType: 'element' },
        properties: {
          id: { type: 'string', xml: { nodeType: 'attribute' } },
          tags: {
            type: 'array',
            xml: { nodeType: 'element' },
            items: { type: 'string', xml: { nodeType: 'text' } },
          },
        },
        $defs: { Note: { anyOf: [{ xml: { nodeType: 'cdata' } }] } },
      }),
    ).toEqual({
      type: 'object',
      xml: { name: 'pet' },
      properties: {
        id: { type: 'string', xml: { attribute: true } },
        tags: { type: 'array', xml: { wrapped: true }, items: { type: 'string', xml: {} } },
      },
      $defs: { Note: { anyOf: [{ xml: {} }] } },
    })
  })

  it('drops discriminator defaultMapping', () => {
    expect(
      downgradeSchemaV32ToV31({
        discriminator: { propertyName: 'kind', defaultMapping: 'Cat', mapping: { dog: 'Dog' } },
      }),
    ).toEqual({ discriminator: { propertyName: 'kind', mapping: { dog: 'Dog' } } })
  })

  it('passes everything else through, including properties named like keywords', () => {
    const schema: OpenAPIV3_2.SchemaObject = {
      $schema: 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17',
      $ref: '#/$defs/Base',
      type: ['string', 'null'],
      prefixItems: [true, false],
      properties: { xml: { const: 1 }, discriminator: { type: 'string' } },
      $defs: { Base: { examples: [1] } },
    }
    expect(downgradeSchemaV32ToV31(schema)).toEqual(schema)
    expect(downgradeSchemaV32ToV31(true)).toBe(true)
  })

  it('keeps a cycle as a cycle, in converted and copied values alike', () => {
    const schema: Record<string, any> = { type: 'object', properties: {} }
    schema.properties.self = schema
    schema.default = schema
    const out = downgradeSchemaV32ToV31(schema) as Record<string, any>
    expect(out.properties.self).toBe(out)
    expect(out.default.default).toBe(out.default)
  })
})

describe('unusual input', () => {
  it('reads a type list when deciding whether an XML element wraps an array', () => {
    expect(
      downgradeSchemaV32ToV31({ type: ['array', 'null'], xml: { nodeType: 'element' } }),
    ).toEqual({ type: ['array', 'null'], xml: { wrapped: true } })
  })

  it('tolerates malformed input without throwing', () => {
    expect(downgradeSchemaV32ToV31({ xml: true, allOf: {}, properties: 'none' } as any)).toEqual({
      xml: true,
      allOf: {},
      properties: 'none',
    })
  })
})
