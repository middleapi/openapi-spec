import { downgradeSchemaV31ToV30, downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'
import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'
import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

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
                      tags: {
                        type: 'array',
                        prefixItems: [{ type: 'string' }, { type: 'integer' }],
                        items: false,
                      },
                    },
                  },
                },
              },
            },
            callbacks: { onCreated: { '{$request.body#/url}': { $ref: '#/webhooks/created' } } },
          },
        },
      },
      webhooks: {
        created: {
          post: {
            requestBody: { $ref: '#/components/requestBodies/Pet', summary: 'A pet' },
            responses,
          },
        },
      },
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
              parent: {
                anyOf: [{ $ref: '#/components/schemas/Pet/$defs/Self' }, { type: 'null' }],
              },
              labels: {
                type: 'object',
                propertyNames: { pattern: '^[a-z]+$' },
                additionalProperties: { type: 'string' },
              },
            },
            $defs: { Self: { type: 'object' } },
          },
          Owner: { type: 'object', properties: { name: { type: 'string' } } },
        },
        parameters: { Id: { in: 'path', name: 'id', required: true, schema: { type: 'string' } } },
        requestBodies: {
          Pet: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
        pathItems: {
          Pet: {
            parameters: [{ $ref: '#/components/parameters/Id', description: 'The pet id' }],
            get: { responses },
          },
        },
        securitySchemes: {
          mtls: { type: 'mutualTLS' },
          bearer: { type: 'http', scheme: 'bearer' },
        },
      },
    }
    await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
  })

  it('sets the version, drops jsonSchemaDialect and webhooks, and adds the paths 3.0 requires', () => {
    expect(
      convert({
        jsonSchemaDialect: 'https://example.com/dialect',
        webhooks: { hook: { post: { responses } } },
      }),
    ).toEqual({ openapi: '3.0.4', info, paths: {} })
  })

  it('drops Info summary and License identifier, and lets the summary stand in for a missing description', () => {
    expect(
      downgradeSpecV31ToV30({
        openapi: '3.1.2',
        info: {
          ...info,
          summary: 's',
          description: 'd',
          license: { name: 'MIT', identifier: 'MIT' },
        },
        paths: {},
      }).info,
    ).toEqual({ ...info, description: 'd', license: { name: 'MIT' } })
    expect(
      downgradeSpecV31ToV30({ openapi: '3.1.2', info: { ...info, summary: 's' }, paths: {} }).info,
    ).toEqual({ ...info, description: 's' })
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
    expect(convert({ paths: { '/a': { get: {} } } }).paths['/a']?.get).toEqual({
      responses: { default: { description: '' } },
    })
  })

  describe('path items', () => {
    it('merges a $ref to components.pathItems into the referencing Path Item, whose own fields win', () => {
      const out = convert({
        paths: {
          '/a': {
            $ref: '#/components/pathItems/A',
            summary: 'own',
            get: { operationId: 'own', responses },
          },
        },
        components: {
          pathItems: {
            A: {
              summary: 'target',
              get: { operationId: 'target', responses },
              post: { responses },
            },
          },
        },
      })
      expect(out.paths['/a']).toEqual({
        summary: 'own',
        get: { operationId: 'own', responses },
        post: { responses },
      })
      expect(out.components).toEqual({})
    })

    it('follows chains of Path Item $refs, including into webhooks and from callbacks', () => {
      const out = convert({
        paths: {
          '/a': {
            post: {
              callbacks: {
                cb: { '{$request.body#/url}': { $ref: '#/components/pathItems/Alias' } },
              },
              responses,
            },
          },
        },
        webhooks: { hook: { put: { responses } } },
        components: { pathItems: { Alias: { $ref: '#/webhooks/hook', get: { responses } } } },
      })
      expect(out.paths['/a']?.post?.callbacks).toEqual({
        cb: { '{$request.body#/url}': { get: { responses }, put: { responses } } },
      })
    })

    it('stops where a Path Item refers back to itself', () => {
      const out = convert({
        paths: { '/a': { $ref: '#/components/pathItems/Loop' } },
        components: {
          pathItems: {
            Loop: {
              post: {
                callbacks: { cb: { '{$url}': { $ref: '#/components/pathItems/Loop' } } },
                responses,
              },
            },
          },
        },
      })
      expect(out.paths['/a']).toEqual({ post: { callbacks: { cb: { '{$url}': {} } }, responses } })
    })

    it('keeps $refs to Path Items that 3.0 keeps, and those that dangle', () => {
      const out = convert({
        paths: {
          '/a': { get: { responses } },
          '/b': { $ref: '#/paths/~1a' },
          '/c': { $ref: '#/components/pathItems/Missing' },
        },
      })
      expect(out.paths['/b']).toEqual({ $ref: '#/paths/~1a' })
      expect(out.paths['/c']).toEqual({ $ref: '#/components/pathItems/Missing' })
    })

    it('inlines other $refs into removed parts', () => {
      const out = convert({
        paths: {
          '/a': { get: { parameters: [{ $ref: '#/webhooks/hook/post/parameters/0' }], responses } },
        },
        webhooks: {
          hook: {
            post: { parameters: [{ in: 'query', name: 'q', schema: { const: 1 } }], responses },
          },
        },
      })
      expect(out.paths['/a']?.get?.parameters).toEqual([
        { in: 'query', name: 'q', schema: { type: 'integer', enum: [1] } },
      ])
    })

    it('inlines a $ref into part of a webhook from inside it, cutting recursion with {}', () => {
      const schema = {
        type: 'object',
        properties: {
          next: { $ref: '#/webhooks/hook/post/requestBody/content/application~1json/schema' },
        },
      } as const
      const out = convert({
        paths: { '/a': { $ref: '#/webhooks/hook' } },
        webhooks: {
          hook: {
            post: { requestBody: { content: { 'application/json': { schema } } }, responses },
          },
        },
      })
      expect(out.paths['/a']?.post?.requestBody).toEqual({
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { next: { type: 'object', properties: { next: {} } } },
            },
          },
        },
      })
      expect(() => JSON.stringify(out)).not.toThrow()
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
      expect(out.components?.securitySchemes).toEqual({
        key: { type: 'apiKey', name: 'k', in: 'header' },
      })
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

  it('empties the scopes of apiKey and http requirements, which 3.0 allows only for OAuth2 and OpenID Connect', () => {
    const out = convert({
      security: [{ key: ['tasks.get'], oidc: ['openid'] }],
      paths: {
        '/a': {
          get: {
            security: [{ bearer: ['read:users'] }, { alias: ['x'] }, { oauth: ['write'] }],
            responses,
          },
        },
      },
      components: {
        securitySchemes: {
          key: { type: 'apiKey', name: 'k', in: 'header' },
          bearer: { type: 'http', scheme: 'bearer' },
          alias: { $ref: '#/components/securitySchemes/key' },
          oidc: {
            type: 'openIdConnect',
            openIdConnectUrl: 'https://example.com/.well-known/openid-configuration',
          },
          oauth: {
            type: 'oauth2',
            flows: {
              clientCredentials: { tokenUrl: 'https://example.com/token', scopes: { write: 'w' } },
            },
          },
        },
      },
    })
    expect(out.security).toEqual([{ key: [], oidc: ['openid'] }])
    expect(out.paths['/a']?.get?.security).toEqual([
      { bearer: [] },
      { alias: [] },
      { oauth: ['write'] },
    ])
  })

  it('converts schemas everywhere in the document', () => {
    const schema: OpenAPIV3_1.SchemaObject = { type: ['string', 'null'] }
    const out = convert({
      paths: {
        '/a': {
          parameters: [{ in: 'query', name: 'q', schema }],
          get: {
            requestBody: {
              content: {
                'multipart/form-data': { schema, encoding: { a: { headers: { H: { schema } } } } },
              },
            },
            responses: {
              200: {
                description: 'ok',
                headers: { H: { schema } },
                content: { 'application/json': { schema } },
              },
            },
          },
        },
      },
      components: {
        schemas: { S: schema },
        headers: { H: { schema } },
        parameters: { P: { in: 'query', name: 'p', content: { 'application/json': { schema } } } },
      },
    })
    const expected = { type: 'string', nullable: true }
    const get = out.paths['/a']?.get
    expect(out.paths['/a']?.parameters?.[0]).toMatchObject({ schema: expected })
    expect(get?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: expected,
          encoding: { a: { headers: { H: { schema: expected } } } },
        },
      },
    })
    expect(get?.responses['200']).toMatchObject({
      headers: { H: { schema: expected } },
      content: { 'application/json': { schema: expected } },
    })
    expect(out.components).toMatchObject({
      schemas: { S: expected },
      headers: { H: { schema: expected } },
      parameters: { P: { content: { 'application/json': { schema: expected } } } },
    })
  })

  it('copies extensions in paths, responses, and callbacks as they are', () => {
    const extension = { $ref: '#/paths/~1a', get: {} }
    const operation = { responses: { 'x-a': extension }, callbacks: { cb: { 'x-a': extension } } }
    const out = convert({ paths: { 'x-a': extension, '/a': { post: operation } } })
    expect(out.paths).toEqual({ 'x-a': extension, '/a': { post: operation } })
  })

  it('leaves the input untouched', () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      openapi: '3.1.2',
      info,
      paths: { '/a': { $ref: '#/components/pathItems/A' } },
      components: { pathItems: { A: { get: { responses } } } },
    }
    const before = structuredClone(doc)
    downgradeSpecV31ToV30(doc)
    expect(doc).toEqual(before)
  })
})

describe('downgradeSchemaV31ToV30', () => {
  describe('type', () => {
    it('marks null with nullable', () => {
      expect(downgradeSchemaV31ToV30({ type: ['string', 'null'] })).toEqual({
        type: 'string',
        nullable: true,
      })
      expect(downgradeSchemaV31ToV30({ type: 'integer' })).toEqual({ type: 'integer' })
    })

    it('keeps a single type where it was written', () => {
      const keys = (schema: OpenAPIV3_1.SchemaObject) =>
        Object.keys(downgradeSchemaV31ToV30(schema))
      expect(keys({ type: 'string', minLength: 1, const: 'a' })).toEqual([
        'type',
        'minLength',
        'enum',
      ])
      expect(keys({ type: ['object', 'null'], properties: {} })).toEqual([
        'type',
        'properties',
        'nullable',
      ])
    })

    it('keeps a 3.0-style nullable written beside a type, which only 3.0 gives meaning', () => {
      const schema = (fields: Record<string, unknown>) =>
        downgradeSchemaV31ToV30(fields as OpenAPIV3_1.SchemaObject)
      expect(schema({ type: 'string', nullable: true })).toEqual({ type: 'string', nullable: true })
      expect(schema({ nullable: true })).toEqual({})
      expect(schema({ type: 'string', nullable: false })).toEqual({ type: 'string' })
      // It admits null, which the 3.1 schema did not, so the branches can overlap.
      expect(schema({ oneOf: [{ type: 'string', nullable: true }, { type: 'null' }] })).toEqual({
        anyOf: [
          { type: 'string', nullable: true },
          { type: 'string', nullable: true, enum: [null] },
        ],
      })
    })

    it('turns several types into anyOf, moving items into the array branch', () => {
      expect(
        downgradeSchemaV31ToV30({
          type: ['array', 'string', 'null'],
          items: { type: 'number' },
          maxLength: 3,
        }),
      ).toEqual({
        maxLength: 3,
        anyOf: [
          { type: 'array', items: { type: 'number' } },
          { type: 'string' },
          { type: 'string', nullable: true, enum: [null] },
        ],
      })
    })

    it('nests the type anyOf in allOf when the schema has its own anyOf', () => {
      expect(
        downgradeSchemaV31ToV30({
          type: ['string', 'number'],
          anyOf: [{ minLength: 1 }, { minimum: 1 }],
        }),
      ).toEqual({
        anyOf: [{ minLength: 1 }, { minimum: 1 }],
        allOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }],
      })
    })

    it('turns type null into a nullable type that only null matches', () => {
      const onlyNull = { type: 'string', nullable: true, enum: [null] }
      expect(Object.keys(downgradeSchemaV31ToV30({ type: 'null' }))).toEqual([
        'type',
        'nullable',
        'enum',
      ])
      expect(downgradeSchemaV31ToV30({ type: 'null', enum: [null, 'a'] })).toEqual(onlyNull)
      expect(downgradeSchemaV31ToV30({ enum: [null] })).toEqual(onlyNull)
      expect(downgradeSchemaV31ToV30({ enum: [null, 'a'] })).toEqual({ enum: [null, 'a'] })
      // Only null may match the type, and the enum rules it out.
      expect(downgradeSchemaV31ToV30({ type: 'null', enum: ['a'] })).toEqual({
        enum: ['a'],
        allOf: [{ not: {} }],
      })
    })

    it('merges an anyOf of one type and null into that type with nullable, as Zod writes nullable objects', () => {
      const object: OpenAPIV3_1.SchemaObject = {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      }
      expect(
        downgradeSchemaV31ToV30({ description: 'A', anyOf: [object, { type: 'null' }] }),
      ).toEqual({ description: 'A', ...object, nullable: true })
      expect(
        downgradeSchemaV31ToV30({ anyOf: [{ const: null }, { type: 'array', items: {} }] }),
      ).toEqual({ type: 'array', items: {}, nullable: true })
      expect(downgradeSchemaV31ToV30({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual({
        type: 'string',
        nullable: true,
      })
      // As Effect writes a nullish value, with null twice.
      expect(
        downgradeSchemaV31ToV30({
          anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'null' }],
        }),
      ).toEqual({ type: 'string', nullable: true })
      // One branch holds no null to merge, as Valibot writes a union of one schema.
      expect(downgradeSchemaV31ToV30({ anyOf: [{ type: 'string' }] })).toEqual({
        anyOf: [{ type: 'string' }],
      })
      expect(
        downgradeSchemaV31ToV30({
          anyOf: [{ type: 'null' }, { type: 'string', enum: ['a'] }, { type: 'null' }],
        }),
      ).toEqual({
        oneOf: [
          { type: 'string', nullable: true, enum: [null] },
          { type: 'string', enum: ['a'] },
        ],
      })
      // One null object twice still gives null once, or the oneOf rejects it.
      const nullType: OpenAPIV3_1.SchemaObject = { type: 'null' }
      expect(
        downgradeSchemaV31ToV30({ anyOf: [{ type: 'string', enum: ['a'] }, nullType, nullType] }),
      ).toEqual({
        oneOf: [
          { type: 'string', enum: ['a'] },
          { type: 'string', nullable: true, enum: [null] },
        ],
      })
      expect(
        downgradeSchemaV31ToV30({
          anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
        }),
      ).toEqual({
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'string', nullable: true, enum: [null] },
        ],
      })
    })

    it('keeps an anyOf with null whose other branch null would not pass, or shares a key', () => {
      const onlyNull = { type: 'string', nullable: true, enum: [null] }
      // Null matches only the null branch here, so it becomes a oneOf.
      const typed: OpenAPIV3_1.SchemaObject[] = [
        { type: 'string', enum: ['a', 'b'] },
        { type: 'object', allOf: [{ required: ['a'] }] },
        { type: 'integer', not: { const: 0 } },
        { type: 'string', oneOf: [{ minLength: 1 }, { maxLength: 0 }] },
      ]
      for (const branch of typed) {
        expect(downgradeSchemaV31ToV30({ anyOf: [branch, { type: 'null' }] })).toEqual({
          oneOf: [downgradeSchemaV31ToV30(branch), onlyNull],
        })
      }
      const untyped: OpenAPIV3_1.SchemaObject[] = [
        { $ref: '#/components/schemas/Pet' },
        { type: 'string', nullable: true },
        { minLength: 1 },
      ]
      for (const branch of untyped) {
        expect(downgradeSchemaV31ToV30({ anyOf: [branch, { type: 'null' }] })).toEqual({
          anyOf: [downgradeSchemaV31ToV30(branch), onlyNull],
        })
      }
      expect(
        downgradeSchemaV31ToV30({
          description: 'A',
          anyOf: [{ type: 'string', description: 'B' }, { type: 'null' }],
        }),
      ).toEqual({ description: 'A', oneOf: [{ type: 'string', description: 'B' }, onlyNull] })
      expect(
        downgradeSchemaV31ToV30({
          anyOf: [{ type: 'string', enum: ['a'] }, { type: 'null' }],
          oneOf: [{ minLength: 1 }, { maxLength: 0 }],
        }),
      ).toEqual({
        anyOf: [{ type: 'string', enum: ['a'] }, onlyNull],
        oneOf: [{ minLength: 1 }, { maxLength: 0 }],
      })
      // A null branch with more than its type is not only null.
      expect(
        downgradeSchemaV31ToV30({
          anyOf: [{ type: 'object' }, { type: 'null', description: 'd' }],
        }),
      ).toEqual({ anyOf: [{ type: 'object' }, { ...onlyNull, description: 'd' }] })
    })

    it('makes an anyOf of a $ref and null a oneOf when the target rejects null', () => {
      const onlyNull = { type: 'string', nullable: true, enum: [null] }
      const pet = (target: OpenAPIV3_1.SchemaObject) =>
        convert({
          components: {
            schemas: {
              Pet: target,
              Owner: { anyOf: [{ $ref: '#/components/schemas/Pet' }, { type: 'null' }] },
            },
          },
        }).components?.schemas?.Owner
      expect(pet({ type: 'object' })).toEqual({
        oneOf: [{ $ref: '#/components/schemas/Pet' }, onlyNull],
      })
      expect(pet({ type: ['object', 'string'] })).toEqual({
        oneOf: [{ $ref: '#/components/schemas/Pet' }, onlyNull],
      })
      expect(pet({ type: ['object', 'null'] })).toEqual({
        anyOf: [{ $ref: '#/components/schemas/Pet' }, onlyNull],
      })
      expect(pet({ type: 'null' })).toEqual({
        anyOf: [{ $ref: '#/components/schemas/Pet' }, onlyNull],
      })
      expect(pet({ type: 'object', nullable: true } as OpenAPIV3_1.SchemaObject)).toEqual({
        anyOf: [{ $ref: '#/components/schemas/Pet' }, onlyNull],
      })
    })

    it('merges a branch in full where a cycle meets it before its conversion is done', () => {
      const node: Record<string, any> = { type: 'object', properties: {} }
      node.properties.parent = { anyOf: [node, { type: 'null' }] }
      const parent = (downgradeSchemaV31ToV30(node) as Record<string, any>).properties.parent
      expect(parent).toMatchObject({ type: 'object', nullable: true })
      expect(parent.properties.parent).toBe(parent)
    })

    it('adds the items 3.0 requires on arrays', () => {
      expect(downgradeSchemaV31ToV30({ type: 'array' })).toEqual({ type: 'array', items: {} })
    })
  })

  it('turns const into a single-value enum', () => {
    expect(downgradeSchemaV31ToV30({ type: 'string', const: 'a' })).toEqual({
      type: 'string',
      enum: ['a'],
    })
    expect(downgradeSchemaV31ToV30({ const: null })).toEqual({
      type: 'string',
      nullable: true,
      enum: [null],
    })
    // As Zod emits `z.literal(5)`: the written type stays, though 5 is an integer.
    expect(downgradeSchemaV31ToV30({ type: 'number', const: 5 })).toEqual({
      type: 'number',
      enum: [5],
    })
  })

  it('types a const with no type after its value', () => {
    expect(downgradeSchemaV31ToV30({ const: true })).toEqual({ type: 'boolean', enum: [true] })
    expect(downgradeSchemaV31ToV30({ const: 'a' })).toEqual({ type: 'string', enum: ['a'] })
    expect(downgradeSchemaV31ToV30({ const: 1 })).toEqual({ type: 'integer', enum: [1] })
    expect(downgradeSchemaV31ToV30({ const: 1.5 })).toEqual({ type: 'number', enum: [1.5] })
    expect(downgradeSchemaV31ToV30({ const: { a: 1 } })).toEqual({
      type: 'object',
      enum: [{ a: 1 }],
    })
    expect(downgradeSchemaV31ToV30({ const: [1] })).toEqual({
      type: 'array',
      enum: [[1]],
      items: {},
    })
    expect(Object.keys(downgradeSchemaV31ToV30({ description: 'd', const: true }))).toEqual([
      'description',
      'type',
      'enum',
    ])
    // A 3.0-style nullable means nothing in 3.1, so null stays out.
    expect(
      downgradeSchemaV31ToV30({ const: 'a', nullable: true } as OpenAPIV3_1.SchemaObject),
    ).toEqual({ type: 'string', enum: ['a'] })
    // A non-plain value, such as a Date js-yaml loads, has no JSON type to give.
    expect(downgradeSchemaV31ToV30({ const: new Date(0) })).toEqual({ enum: [new Date(0)] })
  })

  it.each<[OpenAPIV3_1.SchemaObject, OpenAPIV3_0.SchemaObject]>([
    [
      { exclusiveMinimum: 0, exclusiveMaximum: 10 },
      { minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: true },
    ],
    [{ minimum: 5, exclusiveMinimum: 0 }, { minimum: 5 }],
    [
      { minimum: 0, exclusiveMinimum: 5 },
      { minimum: 5, exclusiveMinimum: true },
    ],
    [
      { minimum: 5, exclusiveMinimum: 5 },
      { minimum: 5, exclusiveMinimum: true },
    ],
    [{ maximum: 5, exclusiveMaximum: 10 }, { maximum: 5 }],
    [
      { maximum: 10, exclusiveMaximum: 5 },
      { maximum: 5, exclusiveMaximum: true },
    ],
    [
      { maximum: 5, exclusiveMaximum: 5 },
      { maximum: 5, exclusiveMaximum: true },
    ],
  ])(
    'turns numeric exclusive bounds into boolean ones, keeping the stricter bound: %o',
    (schema, expected) => {
      expect(downgradeSchemaV31ToV30(schema)).toEqual(expected)
    },
  )

  it('turns examples into example', () => {
    expect(downgradeSchemaV31ToV30({ examples: ['a', 'b'] })).toEqual({ example: 'a' })
    expect(downgradeSchemaV31ToV30({ example: 'x', examples: ['a'] })).toEqual({ example: 'x' })
    expect(downgradeSchemaV31ToV30({ examples: [] })).toStrictEqual({})
  })

  it('turns tuples into arrays whose items match any item schema', () => {
    const prefixItems = [{ type: 'string' }, { type: 'integer' }] as const
    expect(
      downgradeSchemaV31ToV30({
        type: 'array',
        prefixItems: [...prefixItems],
        items: false,
        minItems: 2,
        maxItems: 2,
      }),
    ).toEqual({ type: 'array', items: { anyOf: prefixItems }, minItems: 2, maxItems: 2 })
    expect(
      downgradeSchemaV31ToV30({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: { type: 'number' },
      }),
    ).toEqual({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } })
    expect(
      downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'string' }], items: false }),
    ).toEqual({ type: 'array', items: { type: 'string' }, maxItems: 1 })
    expect(downgradeSchemaV31ToV30({ type: 'array', prefixItems: [{ type: 'string' }] })).toEqual({
      type: 'array',
      items: {},
    })
    // As zod emits a Map entry, and a tuple of one type.
    expect(
      downgradeSchemaV31ToV30({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        minItems: 2,
        maxItems: 2,
      }),
    ).toEqual({
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      minItems: 2,
      maxItems: 2,
    })
    expect(
      downgradeSchemaV31ToV30({
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: 'number' }],
        items: false,
      }),
    ).toEqual({ type: 'array', items: { type: 'number' }, maxItems: 2 })
  })

  it.each<[OpenAPIV3_1.SchemaObjectFields, OpenAPIV3_0.SchemaObject]>([
    // As ArkType emits a tuple with an optional item.
    [
      { items: false, minItems: 1 },
      { minItems: 1, maxItems: 2 },
    ],
    [{ items: false, maxItems: 1 }, { maxItems: 1 }],
    [{ items: false, maxItems: 3 }, { maxItems: 2 }],
    [{ items: true }, { items: {} }],
    [
      { items: { type: 'boolean' }, maxItems: 3 },
      {
        items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        maxItems: 3,
      },
    ],
  ])(
    'turns a tuple beside %o into an array, bounded by its length when items is false',
    (fields, expected) => {
      expect(
        downgradeSchemaV31ToV30({
          prefixItems: [{ type: 'string' }, { type: 'number' }],
          ...fields,
        }),
      ).toEqual({ items: { anyOf: [{ type: 'string' }, { type: 'number' }] }, ...expected })
    },
  )

  it('marks binary strings with format', () => {
    expect(downgradeSchemaV31ToV30({ type: 'string', contentEncoding: 'base64' })).toEqual({
      type: 'string',
      format: 'byte',
    })
    // Zod's `z.base64()` repeats the encoding as the format.
    expect(
      downgradeSchemaV31ToV30({ type: 'string', format: 'base64', contentEncoding: 'base64' }),
    ).toEqual({ type: 'string', format: 'byte' })
    expect(
      downgradeSchemaV31ToV30({ type: 'string', format: 'email', contentEncoding: 'base64' }),
    ).toEqual({ type: 'string', format: 'email' })
    expect(downgradeSchemaV31ToV30({ type: 'string', contentMediaType: 'image/png' })).toEqual({
      type: 'string',
      format: 'binary',
    })
    expect(downgradeSchemaV31ToV30({ contentMediaType: 'image/png' })).toEqual({
      type: 'string',
      format: 'binary',
    })
    expect(downgradeSchemaV31ToV30({ type: 'string', contentEncoding: 'binary' })).toEqual({
      type: 'string',
      format: 'binary',
    })
    expect(
      downgradeSchemaV31ToV30({
        type: 'string',
        format: 'binary',
        contentEncoding: 'binary',
        contentMediaType: 'image/png',
      }),
    ).toEqual({ type: 'string', format: 'binary' })
    // A string with a contentSchema holds structured text, such as JSON in a server-sent event.
    expect(
      downgradeSchemaV31ToV30({
        type: 'string',
        contentMediaType: 'application/json',
        contentSchema: { type: 'object' },
      }),
    ).toEqual({ type: 'string' })
  })

  it('drops an anyOf whose branch holds only contentMediaType, which matches every value', () => {
    // Zod's `z.file().mime(['image/png', 'image/jpeg'])`.
    expect(
      downgradeSchemaV31ToV30({
        type: 'string',
        format: 'binary',
        contentEncoding: 'binary',
        anyOf: [{ contentMediaType: 'image/png' }, { contentMediaType: 'image/jpeg' }],
      }),
    ).toEqual({ type: 'string', format: 'binary' })
    expect(
      downgradeSchemaV31ToV30({
        anyOf: [
          { contentMediaType: 'image/png' },
          { type: 'string', contentMediaType: 'text/plain' },
        ],
      }),
    ).toEqual({})
    expect(
      downgradeSchemaV31ToV30({
        anyOf: [{ type: 'string', contentMediaType: 'image/png' }, { type: 'integer' }],
      }),
    ).toEqual({ anyOf: [{ type: 'string', format: 'binary' }, { type: 'integer' }] })
  })

  describe('$ref', () => {
    it('wraps a $ref with siblings in allOf, which 3.0 does not ignore', () => {
      expect(
        downgradeSchemaV31ToV30({ $ref: '#/components/schemas/User', description: 'The owner' }),
      ).toEqual({ description: 'The owner', allOf: [{ $ref: '#/components/schemas/User' }] })
      expect(downgradeSchemaV31ToV30({ $ref: '#/components/schemas/User' })).toEqual({
        $ref: '#/components/schemas/User',
      })
    })

    it('inlines $refs into $defs, cutting recursion with {}', () => {
      expect(
        downgradeSchemaV31ToV30({
          type: 'object',
          properties: { tree: { $ref: '#/$defs/Tree' }, root: { $ref: '#', description: 'kept' } },
          $defs: {
            Tree: {
              type: 'object',
              properties: { children: { type: 'array', items: { $ref: '#/$defs/Tree' } } },
            },
          },
        }),
      ).toEqual({
        type: 'object',
        properties: {
          tree: { type: 'object', properties: { children: { type: 'array', items: {} } } },
          root: { description: 'kept', allOf: [{ $ref: '#' }] },
        },
      })
    })

    it('inlines a $ref into part of a $defs entry from inside it, cutting recursion with {}', () => {
      const out = downgradeSchemaV31ToV30({
        type: 'object',
        properties: { a: { $ref: '#/$defs/A' } },
        $defs: {
          A: {
            type: 'object',
            properties: {
              child: {
                type: 'object',
                properties: { next: { $ref: '#/$defs/A/properties/child' } },
              },
            },
          },
        },
      })
      expect(out).toEqual({
        type: 'object',
        properties: {
          a: {
            type: 'object',
            properties: {
              child: {
                type: 'object',
                properties: { next: { type: 'object', properties: { next: {} } } },
              },
            },
          },
        },
      })
      expect(() => JSON.stringify(out)).not.toThrow()
    })

    it('inlines a $ref into part of a $defs entry from another entry inlined inside it', () => {
      const out = downgradeSchemaV31ToV30({
        type: 'object',
        properties: { a: { $ref: '#/$defs/A' } },
        $defs: {
          A: {
            type: 'object',
            properties: { c: { type: 'object', properties: { go: { $ref: '#/$defs/B' } } } },
          },
          B: { type: 'object', properties: { back: { $ref: '#/$defs/A/properties/c' } } },
        },
      })
      const back = { type: 'object', properties: { go: {} } }
      expect(out).toEqual({
        type: 'object',
        properties: {
          a: {
            type: 'object',
            properties: {
              c: {
                type: 'object',
                properties: { go: { type: 'object', properties: { back } } },
              },
            },
          },
        },
      })
      expect(() => JSON.stringify(out)).not.toThrow()
    })

    it('inlines a $ref to the $defs entry around a part being inlined', () => {
      const out = downgradeSchemaV31ToV30({
        type: 'object',
        properties: { p: { $ref: '#/$defs/A/properties/c' }, q: { $ref: '#/$defs/A' } },
        $defs: {
          A: {
            type: 'object',
            properties: {
              c: {
                type: 'object',
                properties: { n: { $ref: '#/$defs/A/properties/c' }, up: { $ref: '#/$defs/A' } },
              },
            },
          },
        },
      })
      const a = {
        type: 'object',
        properties: { c: { type: 'object', properties: { n: {}, up: {} } } },
      }
      expect(out).toEqual({
        type: 'object',
        properties: { p: { type: 'object', properties: { n: {}, up: a } }, q: a },
      })
      expect(() => JSON.stringify(out)).not.toThrow()
    })

    it('reads definitions, the draft-07 name of $defs, as $defs', () => {
      expect(
        downgradeSchemaV31ToV30({
          type: 'object',
          properties: { b: { $ref: '#/definitions/B' } },
          definitions: { B: { type: ['string', 'null'] } },
        } as OpenAPIV3_1.SchemaObject),
      ).toEqual({ type: 'object', properties: { b: { type: 'string', nullable: true } } })
    })

    it('decodes percent-encoding, ~1, and ~0 in a $ref, in that order', () => {
      expect(
        downgradeSchemaV31ToV30({
          properties: { a: { $ref: '#/$defs/a%20b~1c~01' } },
          $defs: { 'a b/c~1': { type: ['string', 'null'] } },
        }),
      ).toEqual({ properties: { a: { type: 'string', nullable: true } } })
    })

    it('keeps an anyOf of a branch and null that a $ref points into, so the $ref still resolves', () => {
      const address = { type: 'object', properties: { city: { type: 'string' } } } as const
      expect(
        downgradeSchemaV31ToV30({
          type: 'object',
          properties: {
            home: { anyOf: [address, { type: 'null' }] },
            work: { anyOf: [{ $ref: '#/properties/home/anyOf/0' }, { type: 'null' }] },
          },
        }),
      ).toEqual({
        type: 'object',
        properties: {
          home: { anyOf: [address, { type: 'string', nullable: true, enum: [null] }] },
          work: {
            oneOf: [
              { $ref: '#/properties/home/anyOf/0' },
              { type: 'string', nullable: true, enum: [null] },
            ],
          },
        },
      })
    })

    it('keeps an anyOf of a branch and null that a $ref inside it points into', () => {
      const node = {
        type: 'object',
        properties: { children: { type: 'array', items: { $ref: '#/anyOf/0' } } },
      } as const
      const out = downgradeSchemaV31ToV30({ anyOf: [node, { type: 'null' }] })
      expect(out).toEqual({ anyOf: [node, { type: 'string', nullable: true, enum: [null] }] })
      expect(() => JSON.stringify(out)).not.toThrow()
    })

    it('leaves a $ref into $defs that does not resolve as written', () => {
      expect(downgradeSchemaV31ToV30({ $ref: '#/$defs/Missing' })).toEqual({
        $ref: '#/$defs/Missing',
      })
    })
  })

  it('drops keywords that 3.0 lacks', () => {
    expect(
      downgradeSchemaV31ToV30({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://example.com/pet',
        $anchor: 'pet',
        $comment: 'c',
        $dynamicAnchor: 'node',
        $dynamicRef: '#node',
        $vocabulary: { 'https://json-schema.org/draft/2020-12/vocab/core': true },
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
      }),
    ).toEqual({ type: 'object', additionalProperties: { type: 'string' } })
    expect(
      downgradeSchemaV31ToV30({
        type: 'array',
        contains: { type: 'string' },
        minContains: 1,
        maxContains: 2,
        unevaluatedItems: false,
      }),
    ).toEqual({ type: 'array', items: {} })
  })

  it('turns unevaluatedProperties into additionalProperties where nothing else evaluates properties', () => {
    const properties = { name: { type: 'string' } } as const
    expect(
      downgradeSchemaV31ToV30({ type: 'object', properties, unevaluatedProperties: false }),
    ).toEqual({ type: 'object', properties, additionalProperties: false })
    expect(
      downgradeSchemaV31ToV30({ properties, unevaluatedProperties: { type: ['integer', 'null'] } }),
    ).toEqual({ properties, additionalProperties: { type: 'integer', nullable: true } })
    // The variants of a closed union stay exclusive.
    expect(
      downgradeSchemaV31ToV30({
        oneOf: [
          { properties, unevaluatedProperties: false },
          { properties: { id: { type: 'integer' } }, unevaluatedProperties: false },
        ],
      }),
    ).toEqual({
      oneOf: [
        { properties, additionalProperties: false },
        { properties: { id: { type: 'integer' } }, additionalProperties: false },
      ],
    })
    // Beside allOf it also sees the properties allOf evaluates, which 3.0 cannot express.
    expect(
      downgradeSchemaV31ToV30({
        allOf: [{ $ref: '#/components/schemas/Base' }],
        properties,
        unevaluatedProperties: false,
      }),
    ).toEqual({ allOf: [{ $ref: '#/components/schemas/Base' }], properties })
  })

  it.each<[string, unknown]>([
    ['$dynamicRef', '#node'],
    ['$ref', '#/components/schemas/Base'],
    ['additionalProperties', true],
    ['allOf', [{ properties: { id: {} } }]],
    ['anyOf', [{ properties: { id: {} } }]],
    ['dependentSchemas', { name: { properties: { id: {} } } }],
    ['else', { properties: { id: {} } }],
    ['if', { properties: { id: {} } }],
    ['oneOf', [{ properties: { id: {} } }]],
    ['patternProperties', { '^id$': {} }],
    ['then', { properties: { id: {} } }],
  ])(
    'keeps unevaluatedProperties beside %s, which evaluates properties too, out of additionalProperties',
    (key, value) => {
      expect(
        downgradeSchemaV31ToV30({
          properties: { name: { type: 'string' } },
          [key]: value,
          unevaluatedProperties: false,
        }),
      ).not.toHaveProperty('additionalProperties', false)
    },
  )

  it('keeps meaning an empty enum, which 3.0 forbids, as a schema that rejects every value', () => {
    expect(downgradeSchemaV31ToV30({ type: 'string', enum: [] })).toEqual({
      type: 'string',
      allOf: [{ not: {} }],
    })
  })

  it('makes additionalProperties beside patternProperties true, which allows what patternProperties did', () => {
    const patternProperties = { '^x-': { type: 'string' } } as const
    // As Zod writes a loose record, and Effect a record with number keys.
    for (const additionalProperties of [undefined, true, false, { type: 'number' }] as const) {
      expect(
        downgradeSchemaV31ToV30({ type: 'object', patternProperties, additionalProperties }),
      ).toEqual({ type: 'object', additionalProperties: true })
    }
    expect(
      downgradeSchemaV31ToV30({ properties: { a: { type: 'string' } }, patternProperties }),
    ).toEqual({ properties: { a: { type: 'string' } }, additionalProperties: true })
  })

  describe('a schema that lost a restriction', () => {
    it('is no longer negated by not', () => {
      expect(downgradeSchemaV31ToV30({ not: { contains: { type: 'string' } } })).toEqual({})
      expect(
        downgradeSchemaV31ToV30({
          type: 'object',
          not: { patternProperties: { '^x-': { type: 'string' } } },
        }),
      ).toEqual({ type: 'object' })
      expect(
        downgradeSchemaV31ToV30({
          not: { properties: { a: { if: { minimum: 1 }, then: { maximum: 2 } } } },
        }),
      ).toEqual({})
      expect(downgradeSchemaV31ToV30({ not: { type: 'string', minLength: 3 } })).toEqual({
        not: { type: 'string', minLength: 3 },
      })
    })

    it('turns an enclosing oneOf into anyOf, since branches may now overlap', () => {
      const branches = [
        { type: 'object', propertyNames: { pattern: '^a' } },
        { type: 'object', propertyNames: { pattern: '^b' } },
      ] as const
      expect(downgradeSchemaV31ToV30({ oneOf: [...branches] })).toEqual({
        anyOf: [{ type: 'object' }, { type: 'object' }],
      })
      expect(downgradeSchemaV31ToV30({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({
        oneOf: [{ type: 'string' }, { type: 'number' }],
      })
      expect(
        downgradeSchemaV31ToV30({ anyOf: [{ minimum: 0 }], oneOf: [{ prefixItems: [true] }, {}] }),
      ).toEqual({ anyOf: [{ minimum: 0 }], allOf: [{ anyOf: [{ items: {} }, {}] }] })
    })

    it('includes propertyNames beyond a string type, and unevaluatedProperties beside an in-place applicator', () => {
      // As zod emits z.record with a key pattern.
      expect(
        downgradeSchemaV31ToV30({
          not: { type: 'object', propertyNames: { type: 'string', pattern: '^a' } },
        }),
      ).toEqual({})
      expect(
        downgradeSchemaV31ToV30({
          not: { allOf: [{ properties: { a: {} } }], unevaluatedProperties: false },
        }),
      ).toEqual({})
    })

    it('excludes propertyNames: true, and unevaluatedProperties beside additionalProperties', () => {
      expect(downgradeSchemaV31ToV30({ not: { type: 'object', propertyNames: true } })).toEqual({
        not: { type: 'object' },
      })
      expect(
        downgradeSchemaV31ToV30({
          not: { additionalProperties: { type: 'string' }, unevaluatedProperties: false },
        }),
      ).toEqual({ not: { additionalProperties: { type: 'string' } } })
    })

    it('carries over to a schema around it, through allOf, anyOf, properties, not, and oneOf', () => {
      const lost = { type: 'object', propertyNames: { pattern: '^a' } } as const
      expect(downgradeSchemaV31ToV30({ not: { allOf: [lost, { required: ['a'] }] } })).toEqual({})
      expect(downgradeSchemaV31ToV30({ not: { anyOf: [lost, { type: 'string' }] } })).toEqual({})
      expect(
        downgradeSchemaV31ToV30({ not: { properties: { a: lost, b: { type: 'string' } } } }),
      ).toEqual({})
      expect(downgradeSchemaV31ToV30({ not: { not: lost } })).toEqual({})
      expect(
        downgradeSchemaV31ToV30({ not: { anyOf: [{ minimum: 0 }], oneOf: [lost, {}] } }),
      ).toEqual({})
    })

    it('excludes keywords that restrict nothing, and tuples converted exactly', () => {
      // As zod emits a discriminated union whose member holds a record or a tuple.
      const record: OpenAPIV3_1.SchemaObject = {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'string' },
      }
      const tuple: OpenAPIV3_1.SchemaObject = {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: 'number' }],
        items: false,
        minItems: 2,
        maxItems: 2,
      }
      expect(
        downgradeSchemaV31ToV30({
          oneOf: [{ properties: { meta: record } }, { properties: { point: tuple } }],
        }),
      ).toEqual({
        oneOf: [
          { properties: { meta: { type: 'object', additionalProperties: { type: 'string' } } } },
          {
            properties: {
              point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            },
          },
        ],
      })
    })

    it('includes a tuple with an item that lost a restriction, even beside an equal item', () => {
      const tuple: OpenAPIV3_1.SchemaObject = {
        type: 'array',
        prefixItems: [{ type: 'object', propertyNames: { pattern: '^a' } }, { type: 'object' }],
        items: false,
      }
      expect(downgradeSchemaV31ToV30({ not: tuple })).toEqual({})
      expect(
        downgradeSchemaV31ToV30({ oneOf: [tuple, { type: 'array', items: { type: 'object' } }] }),
      ).toEqual({
        anyOf: [
          {
            type: 'array',
            items: { anyOf: [{ type: 'object' }, { type: 'object' }] },
            maxItems: 2,
          },
          { type: 'array', items: { type: 'object' } },
        ],
      })
      expect(
        downgradeSchemaV31ToV30({
          $defs: { P: { type: 'array', prefixItems: [{ $ref: '#/$defs/P' }, {}], items: false } },
          not: { $ref: '#/$defs/P' },
        }),
      ).toEqual({})
    })

    it('includes a const outside the enum beside it, which matched nothing', () => {
      expect(downgradeSchemaV31ToV30({ not: { const: 'a', enum: ['b'] } })).toEqual({})
      expect(downgradeSchemaV31ToV30({ not: { const: 'a', enum: [] } })).toEqual({})
      expect(downgradeSchemaV31ToV30({ not: { const: 'a', enum: ['a', 'b'] } })).toEqual({
        not: { type: 'string', enum: ['a'] },
      })
      expect(downgradeSchemaV31ToV30({ not: { const: { a: 1 }, enum: [{ a: 1 }] } })).toEqual({
        not: { type: 'object', enum: [{ a: 1 }] },
      })
    })

    it('includes a $defs target cut at recursion', () => {
      expect(
        downgradeSchemaV31ToV30({
          not: { $ref: '#/$defs/Tree' },
          $defs: { Tree: { type: 'object', properties: { child: { $ref: '#/$defs/Tree' } } } },
        }),
      ).toEqual({})
    })

    it('includes the target of a $ref kept in the output', () => {
      // As zod emits z.xor over tuples registered as components.
      const tuple = (
        a: OpenAPIV3_1.SchemaObjectType,
        b: OpenAPIV3_1.SchemaObjectType,
      ): OpenAPIV3_1.SchemaObject => ({
        type: 'array',
        prefixItems: [{ type: a }, { type: b }],
        items: false,
      })
      const schemas = convert({
        components: {
          schemas: {
            StrNum: tuple('string', 'number'),
            NumStr: tuple('number', 'string'),
            Point: tuple('number', 'number'),
            Alias: { $ref: '#/components/schemas/StrNum' },
            A: { $ref: '#/components/schemas/B' },
            B: { $ref: '#/components/schemas/A' },
            Xor: {
              oneOf: [
                { $ref: '#/components/schemas/StrNum' },
                { $ref: '#/components/schemas/NumStr' },
              ],
            },
            Not: { not: { $ref: '#/components/schemas/StrNum' } },
            Exact: { oneOf: [{ $ref: '#/components/schemas/Point' }, { type: 'string' }] },
            ViaAlias: { oneOf: [{ $ref: '#/components/schemas/Alias' }, { type: 'string' }] },
            Nested: {
              oneOf: [
                { type: 'array', items: { $ref: '#/components/schemas/StrNum' } },
                { type: 'string' },
              ],
            },
            Cycle: { oneOf: [{ $ref: '#/components/schemas/A' }, { type: 'string' }] },
          },
        },
      }).components?.schemas
      expect(schemas?.Xor).toEqual({
        anyOf: [{ $ref: '#/components/schemas/StrNum' }, { $ref: '#/components/schemas/NumStr' }],
      })
      expect(schemas?.Not).toEqual({})
      expect(schemas?.Exact).toEqual({
        oneOf: [{ $ref: '#/components/schemas/Point' }, { type: 'string' }],
      })
      expect(schemas?.ViaAlias).toEqual({
        anyOf: [{ $ref: '#/components/schemas/Alias' }, { type: 'string' }],
      })
      expect(schemas?.Nested).toEqual({
        anyOf: [
          { type: 'array', items: { $ref: '#/components/schemas/StrNum' } },
          { type: 'string' },
        ],
      })
      expect(schemas?.Cycle).toEqual({
        oneOf: [{ $ref: '#/components/schemas/A' }, { type: 'string' }],
      })
    })
  })

  it('drops an empty required, which 3.0 forbids', () => {
    expect(downgradeSchemaV31ToV30({ type: 'object', required: [] })).toEqual({ type: 'object' })
  })

  it('turns boolean subschemas into objects, except additionalProperties', () => {
    expect(
      downgradeSchemaV31ToV30({
        properties: { any: true, none: false },
        additionalProperties: false,
        not: true,
      }),
    ).toEqual({ properties: { any: {}, none: { not: {} } }, additionalProperties: false, not: {} })
  })

  it('keeps every keyword 3.0 shares as it is', () => {
    const schema: OpenAPIV3_1.SchemaObject = {
      title: 'Pet',
      description: 'd',
      type: 'object',
      format: 'pet',
      default: { kind: 'cat' },
      example: { kind: 'cat' },
      enum: [{ kind: 'cat' }],
      readOnly: true,
      writeOnly: false,
      deprecated: true,
      discriminator: { propertyName: 'kind' },
      externalDocs: { url: 'https://example.com' },
      xml: { name: 'pet' },
      multipleOf: 2,
      minimum: 1,
      maximum: 10,
      minLength: 1,
      maxLength: 5,
      pattern: '^a',
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      minProperties: 1,
      maxProperties: 4,
      required: ['kind'],
      properties: { kind: { type: 'string' } },
      additionalProperties: { type: 'string' },
      items: { type: 'string' },
      allOf: [{ minProperties: 1 }],
      anyOf: [{ required: ['kind'] }],
      oneOf: [{ maxProperties: 4 }],
      not: { type: 'string' },
    }
    expect(downgradeSchemaV31ToV30(schema)).toEqual(schema)
  })

  it('keeps extensions, and turns unknown keywords, which 3.0 forbids, into extensions', () => {
    expect(
      downgradeSchemaV31ToV30({
        'type': 'string',
        'x-native-type': 'date',
        'format': 'date-time',
      } as OpenAPIV3_1.SchemaObject),
    ).toEqual({ 'type': 'string', 'x-native-type': 'date', 'format': 'date-time' })
    // As zod `.meta()` keys and generators' custom keywords arrive.
    expect(
      downgradeSchemaV31ToV30({
        'type': 'string',
        'label': 'Name',
        'placeholder': 'Jane',
        'x-label': 'kept',
      } as OpenAPIV3_1.SchemaObject),
    ).toEqual({ 'type': 'string', 'x-label': 'kept', 'x-placeholder': 'Jane' })
    expect(
      downgradeSchemaV31ToV30({
        'type': 'string',
        'label': 'Name',
        'x-label': null,
      } as OpenAPIV3_1.SchemaObject),
    ).toEqual({ 'type': 'string', 'x-label': null })
  })

  it('converts a shared object once, and keeps a cycle as a cycle', () => {
    const shared = { type: ['string', 'null'] } as OpenAPIV3_1.SchemaObject
    const node: Record<string, any> = { type: 'object', properties: { a: shared, b: shared } }
    node.properties.self = node
    const out = downgradeSchemaV31ToV30(node) as Record<string, any>
    expect(out.properties.a).toBe(out.properties.b)
    expect(out.properties.self).toBe(out)
  })

  it('keeps a cycle in a copied value as a cycle', () => {
    const example: Record<string, any> = { name: 'loop' }
    example.self = example
    const out = downgradeSchemaV31ToV30({ type: 'object', example }) as Record<string, any>
    expect(out.example).not.toBe(example)
    expect(out.example.self).toBe(out.example)
  })
})

describe('unusual input', () => {
  it('converts valid schemas that combine keywords unusually', () => {
    expect(
      downgradeSchemaV31ToV30({
        $ref: '#/components/schemas/A',
        allOf: [{ minLength: 1 }],
        type: ['string', 'number'],
        anyOf: [{ maxLength: 3 }, { maximum: 3 }],
      }),
    ).toEqual({
      allOf: [
        { $ref: '#/components/schemas/A' },
        { minLength: 1 },
        { anyOf: [{ type: 'string' }, { type: 'number' }] },
      ],
      anyOf: [{ maxLength: 3 }, { maximum: 3 }],
    })
    expect(
      downgradeSchemaV31ToV30({ type: 'null', enum: ['a'], allOf: [{ minLength: 1 }] }),
    ).toEqual({ enum: ['a'], allOf: [{ minLength: 1 }, { not: {} }] })
    expect(downgradeSchemaV31ToV30({ enum: [], allOf: [{ minimum: 0 }] })).toEqual({
      allOf: [{ minimum: 0 }, { not: {} }],
    })
    expect(downgradeSchemaV31ToV30({ type: ['array', 'string'] })).toEqual({
      anyOf: [{ type: 'array', items: {} }, { type: 'string' }],
    })
    expect(downgradeSchemaV31ToV30({ type: ['string'] })).toEqual({ type: 'string' })
    expect(downgradeSchemaV31ToV30({ maximum: 5, exclusiveMaximum: 10 })).toEqual({ maximum: 5 })
  })

  it('keeps own __proto__ keys as keys', () => {
    const out = downgradeSchemaV31ToV30(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":["string","null"]},"1":{}},"example":{"__proto__":1}}',
      ),
    ) as Record<string, any>
    expect(Object.getOwnPropertyDescriptor(out.properties, '__proto__')?.value).toEqual({
      type: 'string',
      nullable: true,
    })
    expect(Object.keys(out.properties)).toEqual(['1', '__proto__'])
    expect(Object.getPrototypeOf(out.properties)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(out.example, '__proto__')?.value).toBe(1)
    expect(Object.getPrototypeOf(out.example)).toBe(Object.prototype)
  })

  it('merges a cyclic tuple item schema with itself', () => {
    const item: Record<string, any> = { type: 'object', properties: {} }
    item.properties.self = item
    const out = downgradeSchemaV31ToV30({
      type: 'array',
      prefixItems: [item, item],
      items: false,
    }) as Record<string, any>
    expect(out.items.properties.self).toBe(out.items)
  })

  it('resolves only local JSON Pointers, leaving other $refs as written', () => {
    for (const ref of [
      './other.json#/$defs/A',
      'x/$defs/A',
      '#x/$defs/A',
      '#/$defs/%E0%A4%A',
      '#/$defs/constructor',
    ]) {
      expect(
        downgradeSchemaV31ToV30({
          properties: { a: { $ref: ref } },
          $defs: { A: { type: 'string' } },
        }),
      ).toEqual({ properties: { a: { $ref: ref } } })
    }
    const out = convert({
      security: [{ anchor: ['a'], loop: ['b'], missing: ['c'] }],
      components: {
        securitySchemes: {
          anchor: { $ref: '#mtls' },
          loop: { $ref: '#/components/securitySchemes/loop' },
          missing: { $ref: '#/components/securitySchemes/none' },
        },
      },
    })
    expect(out.security).toEqual([{ anchor: ['a'], loop: ['b'], missing: ['c'] }])
    expect(Object.keys(out.components?.securitySchemes ?? {})).toEqual([
      'anchor',
      'loop',
      'missing',
    ])
  })

  it('treats keys holding undefined as missing when deciding what to drop or loosen', () => {
    expect(
      downgradeSchemaV31ToV30({
        type: 'string',
        anyOf: [{ contentMediaType: 'image/png', description: undefined }],
      }),
    ).toEqual({ type: 'string' })
    expect(
      downgradeSchemaV31ToV30({
        oneOf: [
          { type: 'object', propertyNames: { type: 'string', description: undefined } },
          { type: 'string' },
        ],
      }),
    ).toEqual({ oneOf: [{ type: 'object' }, { type: 'string' }] })
    expect(
      downgradeSchemaV31ToV30({ oneOf: [{ type: 'object', if: undefined }, { type: 'string' }] }),
    ).toEqual({ oneOf: [{ type: 'object' }, { type: 'string' }] })
  })

  it('tolerates malformed input without throwing', () => {
    const doc = {
      openapi: '3.1.2',
      info,
      security: 'all',
      paths: { '/a': { get: { security: [null, 'x'], parameters: 'none', responses: [] } } },
      components: {
        schemas: {
          S: { properties: 'none', allOf: {}, example: { a: 1, b: undefined } },
          R: { $ref: 1 },
        },
      },
    }
    const out = downgradeSpecV31ToV30(doc as any)
    expect(out.security).toBe('all')
    expect(out.paths['/a']?.get).toEqual({
      security: [null, 'x'],
      parameters: 'none',
      responses: [],
    })
    expect(out.components?.schemas).toEqual({
      S: { properties: 'none', allOf: {}, example: { a: 1 } },
      R: {},
    })
  })
})
