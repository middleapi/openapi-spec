import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSchemaV31ToV30, downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { expectValidDowngrade } from './validate'

const info = { title: 'API', version: '1.0.0' }
const responses = { 200: { description: 'ok' } }

function convert(fields: Omit<OpenAPIV3_1.OpenAPIObject, 'info' | 'openapi'>) {
  return downgradeSpecV31ToV30({ openapi: '3.1.2', info, ...fields })
}

describe('downgradeSpecV31ToV30', () => {
  it('converts a document using every 3.1 feature into a valid 3.0 document', async () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      openapi: '3.1.2',
      info: { ...info, summary: 'An API', license: { name: 'MIT', identifier: 'MIT' } },
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
      security: [{ mtls: [] }, { bearer: [] }],
      paths: {
        '/pets/{id}': { $ref: '#/components/pathItems/Pet', summary: 'A pet' },
        '/pets': {
          post: {
            security: [{ mtls: [] }],
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      photo: { type: 'string', contentMediaType: 'image/png' },
                      tags: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false },
                    },
                  },
                },
              },
            },
            callbacks: { onCreated: { '{$request.body#/url}': { $ref: '#/webhooks/created' } } },
          },
        },
      },
      webhooks: { created: { post: { requestBody: { $ref: '#/components/requestBodies/Pet', summary: 'A pet' }, responses } } },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id', 'kind'],
            properties: {
              id: { type: 'string', examples: ['p1'] },
              kind: { const: 'pet' },
              name: { type: ['string', 'null'] },
              age: { type: 'integer', exclusiveMinimum: 0 },
              owner: { $ref: '#/components/schemas/Owner', description: 'Who owns it' },
              parent: { anyOf: [{ $ref: '#/components/schemas/Pet/$defs/Self' }, { type: 'null' }] },
              labels: { type: 'object', propertyNames: { pattern: '^[a-z]+$' }, additionalProperties: { type: 'string' } },
            },
            $defs: { Self: { type: 'object' } },
          },
          Owner: { type: 'object', properties: { name: { type: 'string' } } },
        },
        parameters: { Id: { in: 'path', name: 'id', required: true, schema: { type: 'string' } } },
        requestBodies: { Pet: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
        pathItems: { Pet: { parameters: [{ $ref: '#/components/parameters/Id', description: 'The pet id' }], get: { responses } } },
        securitySchemes: { mtls: { type: 'mutualTLS' }, bearer: { type: 'http', scheme: 'bearer' } },
      },
    }
    await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
  })

  it('sets the version, drops jsonSchemaDialect and webhooks, and adds the paths 3.0 requires', () => {
    expect(convert({ jsonSchemaDialect: 'https://example.com/dialect', webhooks: { hook: { post: { responses } } } }))
      .toEqual({ openapi: '3.0.4', info, paths: {} })
  })

  it('drops Info summary and License identifier', () => {
    expect(downgradeSpecV31ToV30({ openapi: '3.1.2', info: { ...info, summary: 's', license: { name: 'MIT', identifier: 'MIT' } }, paths: {} }).info)
      .toEqual({ ...info, license: { name: 'MIT' } })
  })

  it('strips Reference Objects down to $ref', () => {
    const out = convert({
      paths: {
        '/a': {
          get: {
            parameters: [{ $ref: '#/components/parameters/P', summary: 's', description: 'd' }],
            responses: { 200: { $ref: '#/components/responses/R', description: 'd' } },
          },
        },
      },
    })
    expect(out.paths['/a']?.get).toEqual({
      parameters: [{ $ref: '#/components/parameters/P' }],
      responses: { 200: { $ref: '#/components/responses/R' } },
    })
  })

  it('gives an operation without responses a default one', () => {
    expect(convert({ paths: { '/a': { get: {} } } }).paths['/a']?.get).toEqual({ responses: { default: { description: '' } } })
  })

  describe('path items', () => {
    it('merges a $ref to components.pathItems into the referencing Path Item, whose own fields win', () => {
      const out = convert({
        paths: { '/a': { $ref: '#/components/pathItems/A', summary: 'own', get: { operationId: 'own', responses } } },
        components: { pathItems: { A: { summary: 'target', get: { operationId: 'target', responses }, post: { responses } } } },
      })
      expect(out.paths['/a']).toEqual({ summary: 'own', get: { operationId: 'own', responses }, post: { responses } })
      expect(out.components).toEqual({})
    })

    it('follows chains of Path Item $refs, including into webhooks and from callbacks', () => {
      const out = convert({
        paths: {
          '/a': {
            post: { callbacks: { cb: { '{$request.body#/url}': { $ref: '#/components/pathItems/Alias' } } }, responses },
          },
        },
        webhooks: { hook: { put: { responses } } },
        components: { pathItems: { Alias: { $ref: '#/webhooks/hook', get: { responses } } } },
      })
      expect(out.paths['/a']?.post?.callbacks).toEqual({ cb: { '{$request.body#/url}': { get: { responses }, put: { responses } } } })
    })

    it('stops where a Path Item refers back to itself', () => {
      const out = convert({
        paths: { '/a': { $ref: '#/components/pathItems/Loop' } },
        components: {
          pathItems: {
            Loop: { post: { callbacks: { cb: { '{$url}': { $ref: '#/components/pathItems/Loop' } } }, responses } },
          },
        },
      })
      expect(out.paths['/a']).toEqual({ post: { callbacks: { cb: { '{$url}': {} } }, responses } })
    })

    it('keeps $refs to Path Items that 3.0 keeps, and those that dangle', () => {
      const out = convert({ paths: { '/a': { get: { responses } }, '/b': { $ref: '#/paths/~1a' }, '/c': { $ref: '#/components/pathItems/Missing' } } })
      expect(out.paths['/b']).toEqual({ $ref: '#/paths/~1a' })
      expect(out.paths['/c']).toEqual({ $ref: '#/components/pathItems/Missing' })
    })

    it('inlines other $refs into removed parts', () => {
      const out = convert({
        paths: { '/a': { get: { parameters: [{ $ref: '#/webhooks/hook/post/parameters/0' }], responses } } },
        webhooks: { hook: { post: { parameters: [{ in: 'query', name: 'q', schema: { const: 1 } }], responses } } },
      })
      expect(out.paths['/a']?.get?.parameters).toEqual([{ in: 'query', name: 'q', schema: { enum: [1] } }])
    })
  })

  describe('mutual TLS', () => {
    it('drops mutualTLS schemes, and the $refs that resolve to them', () => {
      const out = convert({
        components: {
          securitySchemes: {
            mtls: { type: 'mutualTLS' },
            alias: { $ref: '#/components/securitySchemes/mtls' },
            key: { type: 'apiKey', name: 'k', in: 'header' },
          },
        },
      })
      expect(out.components?.securitySchemes).toEqual({ key: { type: 'apiKey', name: 'k', in: 'header' } })
    })

    it('drops their names from security requirements, then emptied requirements and lists', () => {
      const out = convert({
        security: [{ mtls: [] }],
        paths: {
          '/a': {
            get: { security: [{ mtls: [], key: [] }, { alias: [] }, {}], responses },
            put: { security: [{ mtls: [] }], responses },
            post: { security: [], responses },
          },
        },
        components: {
          securitySchemes: {
            mtls: { type: 'mutualTLS' },
            alias: { $ref: '#/components/securitySchemes/mtls' },
            key: { type: 'apiKey', name: 'k', in: 'header' },
          },
        },
      })
      expect(out.security).toBeUndefined()
      expect(out.paths['/a']?.get?.security).toEqual([{ key: [] }, {}])
      expect(out.paths['/a']?.put).toEqual({ responses })
      expect(out.paths['/a']?.post?.security).toEqual([])
    })
  })

  it('converts schemas everywhere in the document', () => {
    const schema: OpenAPIV3_1.SchemaObject = { type: ['string', 'null'] }
    const out = convert({
      paths: {
        '/a': {
          parameters: [{ in: 'query', name: 'q', schema }],
          get: {
            requestBody: { content: { 'multipart/form-data': { schema, encoding: { a: { headers: { H: { schema } } } } } } },
            responses: { 200: { description: 'ok', headers: { H: { schema } }, content: { 'application/json': { schema } } } },
          },
        },
      },
      components: { schemas: { S: schema }, headers: { H: { schema } }, parameters: { P: { in: 'query', name: 'p', content: { 'application/json': { schema } } } } },
    })
    const expected = { type: 'string', nullable: true }
    const get = out.paths['/a']?.get
    expect(out.paths['/a']?.parameters?.[0]).toMatchObject({ schema: expected })
    expect(get?.requestBody).toMatchObject({ content: { 'multipart/form-data': { schema: expected, encoding: { a: { headers: { H: { schema: expected } } } } } } })
    expect(get?.responses['200']).toMatchObject({ headers: { H: { schema: expected } }, content: { 'application/json': { schema: expected } } })
    expect(out.components).toMatchObject({ schemas: { S: expected }, headers: { H: { schema: expected } }, parameters: { P: { content: { 'application/json': { schema: expected } } } } })
  })

  it('leaves the input untouched', () => {
    const doc: OpenAPIV3_1.OpenAPIObject = { openapi: '3.1.2', info, paths: { '/a': { $ref: '#/components/pathItems/A' } }, components: { pathItems: { A: { get: { responses } } } } }
    const before = structuredClone(doc)
    downgradeSpecV31ToV30(doc)
    expect(doc).toEqual(before)
  })
})

describe('downgradeSchemaV31ToV30', () => {
  describe('type', () => {
    it('marks null with nullable', () => {
      expect(downgradeSchemaV31ToV30({ type: ['string', 'null'] })).toEqual({ type: 'string', nullable: true })
      expect(downgradeSchemaV31ToV30({ type: 'integer' })).toEqual({ type: 'integer' })
    })

    it('turns several types into anyOf, moving items into the array branch', () => {
      expect(downgradeSchemaV31ToV30({ type: ['array', 'string', 'null'], items: { type: 'number' }, maxLength: 3 })).toEqual({
        maxLength: 3,
        anyOf: [{ type: 'array', items: { type: 'number' }, nullable: true }, { type: 'string', nullable: true }],
      })
    })

    it('nests the type anyOf in allOf when the schema has its own anyOf', () => {
      expect(downgradeSchemaV31ToV30({ type: ['string', 'number'], anyOf: [{ minLength: 1 }, { minimum: 1 }] })).toEqual({
        anyOf: [{ minLength: 1 }, { minimum: 1 }],
        allOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }],
      })
    })

    it('turns type null into enum: [null]', () => {
      expect(downgradeSchemaV31ToV30({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual({ anyOf: [{ type: 'string' }, { enum: [null] }] })
    })

    it('adds the items 3.0 requires on arrays', () => {
      expect(downgradeSchemaV31ToV30({ type: 'array' })).toEqual({ type: 'array', items: {} })
    })
  })

  it('turns const into a single-value enum', () => {
    expect(downgradeSchemaV31ToV30({ type: 'string', const: 'a' })).toEqual({ type: 'string', enum: ['a'] })
    expect(downgradeSchemaV31ToV30({ const: null })).toEqual({ enum: [null] })
  })

  it('turns numeric exclusive bounds into boolean ones, keeping the stricter bound', () => {
    expect(downgradeSchemaV31ToV30({ exclusiveMinimum: 0, exclusiveMaximum: 10 })).toEqual({ minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: true })
    expect(downgradeSchemaV31ToV30({ minimum: 5, exclusiveMinimum: 0 })).toEqual({ minimum: 5 })
    expect(downgradeSchemaV31ToV30({ minimum: 0, exclusiveMinimum: 5 })).toEqual({ minimum: 5, exclusiveMinimum: true })
  })

  it('turns examples into example', () => {
    expect(downgradeSchemaV31ToV30({ examples: ['a', 'b'] })).toEqual({ example: 'a' })
    expect(downgradeSchemaV31ToV30({ example: 'x', examples: ['a'] })).toEqual({ example: 'x' })
  })

  it('turns tuples into arrays whose items match any item schema', () => {
    const prefixItems = [{ type: 'string' }, { type: 'integer' }] as const
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [...prefixItems], items: false, minItems: 2, maxItems: 2 }))
      .toEqual({ type: 'array', items: { anyOf: prefixItems }, minItems: 2, maxItems: 2 })
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } }))
      .toEqual({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } })
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'string' }], items: false })).toEqual({ type: 'array', items: { type: 'string' } })
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'string' }] })).toEqual({ type: 'array', items: {} })
    // As zod emits a Map entry, and a tuple of one type.
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], minItems: 2, maxItems: 2 }))
      .toEqual({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] }, minItems: 2, maxItems: 2 })
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false }))
      .toEqual({ type: 'array', items: { type: 'number' } })
  })

  it('marks binary strings with format', () => {
    expect(downgradeSchemaV31ToV30({ type: 'string', contentEncoding: 'base64' })).toEqual({ type: 'string', format: 'byte' })
    expect(downgradeSchemaV31ToV30({ type: 'string', contentMediaType: 'image/png' })).toEqual({ type: 'string', format: 'binary' })
    expect(downgradeSchemaV31ToV30({ contentMediaType: 'image/png' })).toEqual({ type: 'string', format: 'binary' })
    expect(downgradeSchemaV31ToV30({ type: 'string', format: 'binary', contentEncoding: 'binary', contentMediaType: 'image/png' })).toEqual({ type: 'string', format: 'binary' })
  })

  describe('$ref', () => {
    it('wraps a $ref with siblings in allOf, which 3.0 does not ignore', () => {
      expect(downgradeSchemaV31ToV30({ $ref: '#/components/schemas/User', description: 'The owner' }))
        .toEqual({ description: 'The owner', allOf: [{ $ref: '#/components/schemas/User' }] })
      expect(downgradeSchemaV31ToV30({ $ref: '#/components/schemas/User' })).toEqual({ $ref: '#/components/schemas/User' })
    })

    it('inlines $refs into $defs, cutting recursion with {}', () => {
      expect(downgradeSchemaV31ToV30({
        type: 'object',
        properties: { tree: { $ref: '#/$defs/Tree' }, root: { $ref: '#', description: 'kept' } },
        $defs: { Tree: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/$defs/Tree' } } } } },
      })).toEqual({
        type: 'object',
        properties: {
          tree: { type: 'object', properties: { children: { type: 'array', items: {} } } },
          root: { description: 'kept', allOf: [{ $ref: '#' }] },
        },
      })
    })

    it('leaves a $ref into $defs that does not resolve as written', () => {
      expect(downgradeSchemaV31ToV30({ $ref: '#/$defs/Missing' })).toEqual({ $ref: '#/$defs/Missing' })
    })
  })

  it('drops keywords that 3.0 lacks', () => {
    expect(downgradeSchemaV31ToV30({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/pet',
      $anchor: 'pet',
      $comment: 'c',
      $dynamicAnchor: 'node',
      type: 'object',
      if: { required: ['a'] },
      then: { required: ['b'] },
      else: { required: ['c'] },
      dependentRequired: { a: ['b'] },
      dependentSchemas: { a: { required: ['b'] } },
      propertyNames: { pattern: '^[a-z]+$' },
      unevaluatedProperties: false,
      additionalProperties: { type: 'string' },
      contentSchema: { type: 'object' },
      nullable: true,
    } as OpenAPIV3_1.SchemaObject)).toEqual({ type: 'object', additionalProperties: { type: 'string' } })
    expect(downgradeSchemaV31ToV30({ type: 'array', contains: { type: 'string' }, minContains: 1, maxContains: 2, unevaluatedItems: false }))
      .toEqual({ type: 'array', items: {} })
  })

  it('drops additionalProperties beside patternProperties, which it would contradict', () => {
    expect(downgradeSchemaV31ToV30({ type: 'object', patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false })).toEqual({ type: 'object' })
  })

  it('drops an empty required, which 3.0 forbids', () => {
    expect(downgradeSchemaV31ToV30({ type: 'object', required: [] })).toEqual({ type: 'object' })
  })

  it('turns boolean subschemas into objects, except additionalProperties', () => {
    expect(downgradeSchemaV31ToV30({ properties: { any: true, none: false }, additionalProperties: false, not: true }))
      .toEqual({ properties: { any: {}, none: { not: {} } }, additionalProperties: false, not: {} })
  })

  it('keeps extensions and unknown keywords', () => {
    expect(downgradeSchemaV31ToV30({ 'type': 'string', 'x-native-type': 'date', 'format': 'date-time' } as OpenAPIV3_1.SchemaObject))
      .toEqual({ 'type': 'string', 'x-native-type': 'date', 'format': 'date-time' })
  })

  it('converts a shared object once, and keeps a cycle as a cycle', () => {
    const shared = { type: ['string', 'null'] } as OpenAPIV3_1.SchemaObject
    const node: Record<string, any> = { type: 'object', properties: { a: shared, b: shared } }
    node.properties.self = node
    const out = downgradeSchemaV31ToV30(node) as Record<string, any>
    expect(out.properties.a).toBe(out.properties.b)
    expect(out.properties.self).toBe(out)
  })
})
