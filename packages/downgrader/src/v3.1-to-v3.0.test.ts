import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { dig } from '../tests/helpers'
import { downgradeSchemaV31ToV30, downgradeSpecV31ToV30 } from './v3.1-to-v3.0'

const info = { title: 't', version: '1' }

const base = { info, openapi: '3.1.0', paths: {} }
const converted = { info, openapi: '3.0.4', paths: {} }

function convertSpec(fields: Record<string, unknown>) {
  return downgradeSpecV31ToV30({ ...base, ...fields } as any)
}

function convertPathItem(pathItem: unknown): unknown {
  return dig(convertSpec({ paths: { '/a': pathItem } }), 'paths', '/a')
}

function convertComponent(kind: string, value: unknown): unknown {
  return dig(
    convertSpec({ components: { [kind]: { X: value } } }),
    'components',
    kind,
    'X',
  )
}

function convertSchema(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

describe('downgradeSpecV31ToV30', () => {
  describe('document', () => {
    it('rewrites the openapi version to 3.0.4', () => {
      expect(
        downgradeSpecV31ToV30({ info, openapi: '3.1.1', paths: {} }),
      ).toEqual(converted)
    })

    it('adds openapi 3.0.4 and an empty paths object when they are missing', () => {
      expect(downgradeSpecV31ToV30({ info } as any)).toEqual(converted)
    })

    it('removes jsonSchemaDialect and webhooks without leaving traces', () => {
      const result = convertSpec({
        jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
        webhooks: { newPet: { post: { summary: 's' } } },
      })
      expect(result).toEqual(converted)
      expect(result).not.toHaveProperty('x-webhooks')
    })

    it('preserves unknown top-level keys and extensions', () => {
      expect(convertSpec({ 'future': { a: 1 }, 'x-root': true })).toEqual({
        ...converted,
        'future': { a: 1 },
        'x-root': true,
      })
    })

    it('clones non-object input unchanged', () => {
      expect(downgradeSpecV31ToV30(null as any)).toBeNull()
      expect(downgradeSpecV31ToV30(42 as any)).toBe(42)
      expect(downgradeSpecV31ToV30('spec' as any)).toBe('spec')
      const list = [1, { a: 1 }]
      const result = downgradeSpecV31ToV30(list as any)
      expect(result).toEqual(list)
      expect(result).not.toBe(list)
    })
  })

  describe('info', () => {
    it('removes summary and license.identifier and keeps the other fields', () => {
      expect(
        convertSpec({
          info: {
            license: {
              identifier: 'MIT',
              name: 'MIT',
              url: 'https://opensource.org/license/mit',
            },
            summary: 'short',
            title: 't',
            version: '1',
          },
        }).info,
      ).toEqual({
        license: { name: 'MIT', url: 'https://opensource.org/license/mit' },
        title: 't',
        version: '1',
      })
    })

    it('clones malformed info and license values unchanged', () => {
      expect(convertSpec({ info: 42 }).info).toBe(42)
      expect(
        convertSpec({ info: { license: 'MIT', title: 't', version: '1' } }).info,
      ).toEqual({
        license: 'MIT',
        title: 't',
        version: '1',
      })
    })
  })

  describe('paths', () => {
    it('converts path items and clones non-path keys', () => {
      expect(
        convertSpec({
          paths: {
            '/a': { get: { summary: 's' } },
            'x-note': { get: { summary: 's' } },
          },
        }).paths,
      ).toEqual({
        '/a': {
          get: { responses: { default: { description: '' } }, summary: 's' },
        },
        'x-note': { get: { summary: 's' } },
      })
    })

    it('leaves a path item $ref that points outside components.pathItems untouched, string or not', () => {
      expect(
        convertPathItem({ $ref: '#/paths/~1other', summary: 's' }),
      ).toEqual({ $ref: '#/paths/~1other', summary: 's' })
      expect(
        convertPathItem({ $ref: 'https://example.com/paths.json#/a' }),
      ).toEqual({ $ref: 'https://example.com/paths.json#/a' })
      expect(convertPathItem({ $ref: 42 })).toEqual({ $ref: 42 })
    })

    it('clones malformed paths, path items, operations, and nested objects unchanged', () => {
      expect(convertSpec({ paths: 'junk' }).paths).toBe('junk')
      const paths = {
        '/a': {
          get: { requestBody: 42, responses: { 200: 'junk', 201: { description: 'ok', links: 'junk' } } },
          parameters: [42],
        },
        '/b': {
          post: {
            requestBody: {
              content: {
                'application/json': 'junk',
                'multipart/form-data': { encoding: { field: 'junk' } },
              },
            },
            responses: {},
          },
        },
        '/c': { get: 'junk' },
        '/junk': 'junk',
      }
      expect(convertSpec({ paths }).paths).toEqual(paths)
    })
  })

  describe('components.pathItems inlining', () => {
    const reusable = {
      get: { responses: { 200: { description: 'ok' } } },
      parameters: [{ in: 'query', name: 'q', schema: { type: ['string', 'null'] } }],
      summary: 'Reusable',
    }
    const inlined = {
      get: { responses: { 200: { description: 'ok' } } },
      parameters: [{ in: 'query', name: 'q', schema: { nullable: true, type: 'string' } }],
      summary: 'Reusable',
    }

    function convertWithPathItems(paths: unknown, pathItems: unknown, extra: Record<string, unknown> = {}) {
      return convertSpec({ components: { pathItems, ...extra }, paths })
    }

    it('inlines the converted entry and lets the referencing fields win', () => {
      const result = convertWithPathItems(
        {
          '/a': { $ref: '#/components/pathItems/Reusable' },
          '/b': {
            $ref: '#/components/pathItems/Reusable',
            description: 'own',
            summary: 'Own summary',
          },
        },
        { Reusable: reusable },
      )
      expect(result.components).toEqual({})
      expect(result.paths).toEqual({
        '/a': inlined,
        '/b': { ...inlined, description: 'own', summary: 'Own summary' },
      })
    })

    it('follows chains of path item references', () => {
      expect(
        convertWithPathItems(
          { '/a': { $ref: '#/components/pathItems/Alias', summary: 'Own' } },
          {
            Alias: { $ref: '#/components/pathItems/Reusable', description: 'alias' },
            Reusable: reusable,
          },
        ).paths,
      ).toEqual({ '/a': { ...inlined, description: 'alias', summary: 'Own' } })
    })

    it('inlines references inside callbacks', () => {
      expect(
        convertWithPathItems(
          {
            '/a': {
              post: {
                callbacks: {
                  onEvent: { '{$request.body#/url}': { $ref: '#/components/pathItems/Reusable' } },
                },
                responses: {},
              },
            },
          },
          { Reusable: reusable },
        ).paths,
      ).toEqual({
        '/a': {
          post: {
            callbacks: { onEvent: { '{$request.body#/url}': inlined } },
            responses: {},
          },
        },
      })
    })

    it.each([
      ['an unknown entry', '#/components/pathItems/Missing', { Reusable: reusable }],
      ['a nested pointer', '#/components/pathItems/Reusable/get', { Reusable: reusable }],
      ['an empty name', '#/components/pathItems/', { Reusable: reusable }],
      ['a malformed entry', '#/components/pathItems/Junk', { Junk: 42 }],
      ['a prototype member', '#/components/pathItems/hasOwnProperty', {}],
      ['a malformed pathItems map', '#/components/pathItems/Reusable', 'junk'],
    ])('leaves a reference to %s untouched', (_name, ref, pathItems) => {
      expect(
        convertWithPathItems({ '/a': { $ref: ref, summary: 's' } }, pathItems).paths,
      ).toEqual({ '/a': { $ref: ref, summary: 's' } })
    })

    it('leaves a reference untouched when components.pathItems is missing', () => {
      expect(
        convertPathItem({ $ref: '#/components/pathItems/Reusable' }),
      ).toEqual({ $ref: '#/components/pathItems/Reusable' })
    })

    it('leaves a reference chain that loops without reaching a path item as written', () => {
      expect(
        convertWithPathItems(
          { '/a': { $ref: '#/components/pathItems/Ping', summary: 'Own' } },
          {
            Ping: { $ref: '#/components/pathItems/Pong', description: 'ping' },
            Pong: { $ref: '#/components/pathItems/Ping' },
          },
        ).paths,
      ).toEqual({ '/a': { $ref: '#/components/pathItems/Ping', summary: 'Own' } })
    })

    it('cuts a path item that reaches itself through its callbacks down to its own fields', () => {
      const result = convertWithPathItems(
        { '/a': { $ref: '#/components/pathItems/Self' } },
        {
          Self: {
            post: {
              callbacks: {
                loop: {
                  bare: { $ref: '#/components/pathItems/Self' },
                  own: { $ref: '#/components/pathItems/Self', summary: 'own' },
                },
              },
              responses: {},
            },
          },
        },
      )
      expect(result.paths).toEqual({
        '/a': {
          post: {
            callbacks: { loop: { bare: {}, own: { summary: 'own' } } },
            responses: {},
          },
        },
      })
    })

    it('applies mutualTLS removal inside inlined path items', () => {
      const result = convertWithPathItems(
        { '/a': { $ref: '#/components/pathItems/Secured' } },
        { Secured: { get: { responses: {}, security: [{ mtls: [] }, { api: ['r'] }] } } },
        { securitySchemes: { api: { in: 'header', name: 'k', type: 'apiKey' }, mtls: { type: 'mutualTLS' } } },
      )
      expect(result.paths).toEqual({
        '/a': { get: { responses: {}, security: [{ api: [] }] } },
      })
    })
  })

  describe('references into webhooks and components.pathItems', () => {
    const removedPointer = /#\/(?:webhooks|components\/pathItems)/
    const schemaPointer = '#/webhooks/newPet/post/requestBody/content/application~1json/schema'
    const hook = {
      post: {
        operationId: 'newPetHook',
        parameters: [{ description: 'orig', in: 'header', name: 'X-Hook', schema: { type: ['string', 'null'] } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { properties: { name: { type: 'string' } }, type: 'object' },
            },
          },
        },
        responses: { 200: { description: 'ok' } },
      },
    }
    const hookParameter = { description: 'orig', in: 'header', name: 'X-Hook', schema: { nullable: true, type: 'string' } }
    const item = {
      get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
      parameters: [{ in: 'query', name: 'q', schema: { const: 'x' } }],
    }

    it('inlines the reported references without mutating the input', () => {
      const input = {
        ...base,
        components: {
          pathItems: { Item: item },
          schemas: { Pet: { $ref: schemaPointer } },
        },
        paths: {
          '/a': {
            get: {
              parameters: [
                { $ref: '#/webhooks/newPet/post/parameters/0' },
                { $ref: '#/components/pathItems/Item/parameters/0' },
              ],
              responses: {
                200: { $ref: '#/webhooks/newPet/post/responses/200' },
                201: {
                  description: 'created',
                  links: {
                    l1: { operationRef: '#/webhooks/newPet/post' },
                    l2: { operationRef: '#/components/pathItems/Item/get' },
                  },
                },
              },
            },
          },
          '/b': { $ref: '#/webhooks/newPet' },
        },
        webhooks: { newPet: hook },
      }
      const before = structuredClone(input)
      const result = downgradeSpecV31ToV30(input as any)
      expect(result.components).toEqual({
        schemas: { Pet: { properties: { name: { type: 'string' } }, type: 'object' } },
      })
      expect(result.paths).toEqual({
        '/a': {
          get: {
            parameters: [hookParameter, { in: 'query', name: 'q', schema: { enum: ['x'] } }],
            responses: {
              200: { description: 'ok' },
              201: { description: 'created', links: { l1: { operationId: 'newPetHook' } } },
            },
          },
        },
        '/b': { post: { ...hook.post, parameters: [hookParameter] } },
      })
      expect(JSON.stringify(result)).not.toMatch(removedPointer)
      expect(input).toEqual(before)
    })

    it('converts each inlined target for its position, in every component map', () => {
      const pointer = (path: string) => `#/webhooks/full/post/${path}`
      const response = {
        content: { 'application/json': { examples: { e: { value: 1 } } } },
        description: 'ok',
        headers: { H: { schema: { const: 1 } } },
      }
      const result = convertSpec({
        components: {
          callbacks: { C: { $ref: pointer('callbacks/cb') } },
          examples: { E: { $ref: pointer('responses/200/content/application~1json/examples/e') } },
          headers: { H: { $ref: pointer('responses/200/headers/H') } },
          parameters: { P: { $ref: pointer('parameters/0') } },
          requestBodies: { B: { $ref: pointer('requestBody') } },
          responses: { R: { $ref: pointer('responses/200') } },
          securitySchemes: { S: { $ref: pointer('x-scheme') } },
        },
        webhooks: {
          full: {
            post: {
              'callbacks': { cb: { '{$url}': { get: {} } } },
              'parameters': [{ in: 'path', name: 'id' }],
              'requestBody': {
                content: { 'application/json': { schema: { type: ['string', 'null'] } } },
              },
              'responses': { 200: response },
              'x-scheme': { in: 'header', name: 'k', type: 'apiKey' },
            },
          },
        },
      })
      expect(result.components).toEqual({
        callbacks: { C: { '{$url}': { get: { responses: { default: { description: '' } } } } } },
        examples: { E: { value: 1 } },
        headers: { H: { schema: { enum: [1] } } },
        parameters: { P: { in: 'path', name: 'id', required: true } },
        requestBodies: {
          B: { content: { 'application/json': { schema: { nullable: true, type: 'string' } } } },
        },
        responses: { R: { ...response, headers: { H: { schema: { enum: [1] } } } } },
        securitySchemes: { S: { in: 'header', name: 'k', type: 'apiKey' } },
      })
    })

    it('follows chains through the removed parts and keeps the reference where a chain leaves them', () => {
      const result = convertSpec({
        components: {
          parameters: { Shared: { in: 'query', name: 'shared' } },
          pathItems: { Deep: { parameters: [{ in: 'query', name: 'deep' }] } },
          schemas: {
            Exit: { $ref: '#/webhooks/chain/post/requestBody/content/application~1json/schema' },
            Name: { type: 'string' },
          },
        },
        paths: {
          '/a': {
            post: {
              parameters: [
                { $ref: '#/webhooks/chain/post/parameters/0' },
                { $ref: '#/webhooks/chain/post/parameters/1', description: 'dropped' },
              ],
              responses: {},
            },
          },
          '/b': { $ref: '#/webhooks/alias', description: 'own' },
        },
        webhooks: {
          alias: { $ref: '#/paths/~1a', summary: 'alias' },
          chain: {
            post: {
              parameters: [
                { $ref: '#/components/pathItems/Deep/parameters/0' },
                { $ref: '#/components/parameters/Shared' },
              ],
              requestBody: {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Name' } } },
              },
            },
          },
        },
      })
      expect(result.components?.schemas?.Exit).toEqual({ $ref: '#/components/schemas/Name' })
      expect(result.paths).toEqual({
        '/a': {
          post: {
            parameters: [{ in: 'query', name: 'deep' }, { $ref: '#/components/parameters/Shared' }],
            responses: {},
          },
        },
        '/b': { $ref: '#/paths/~1a', description: 'own', summary: 'alias' },
      })
    })

    it('follows long chains without growing the stack', () => {
      const webhooks: Record<string, unknown> = { w10000: { get: { responses: {} } } }
      for (let index = 0; index < 10_000; index++) {
        webhooks[`w${index}`] = { $ref: `#/webhooks/w${index + 1}` }
      }
      expect(convertSpec({ paths: { '/a': { $ref: '#/webhooks/w0' } }, webhooks }).paths).toEqual({
        '/a': { get: { responses: {} } },
      })
    })

    it('applies the outermost summary and description override where the target has that field', () => {
      const result = convertSpec({
        components: {
          callbacks: { C: { $ref: '#/webhooks/newPet/x-callback', description: 'ignored' } },
          examples: { E: { $ref: '#/webhooks/newPet/x-example', summary: 'outer' } },
          parameters: { P: { $ref: '#/webhooks/newPet/x-alias', description: 'outer' } },
        },
        webhooks: {
          newPet: {
            ...hook,
            'x-alias': { $ref: '#/webhooks/newPet/post/parameters/0', description: 'inner' },
            'x-callback': { '{$url}': { summary: 's' } },
            'x-example': { description: 'd', summary: 's', value: 1 },
          },
        },
      })
      expect(result.components).toEqual({
        callbacks: { C: { '{$url}': { summary: 's' } } },
        examples: { E: { description: 'd', summary: 'outer', value: 1 } },
        parameters: { P: { ...hookParameter, description: 'outer' } },
      })
    })

    it.each([
      ['a missing target', '#/webhooks/newPet/post/parameters/9'],
      ['a non-object target', '#/webhooks/newPet/post/operationId'],
      ['a looping chain', '#/components/pathItems/Loop/parameters/0'],
      ['a malformed percent escape', '#/webhooks/%E0%A4%A'],
    ])('leaves a reference to %s as written, in every position', (_name, ref) => {
      const reference = { $ref: ref, description: 'd' }
      const bare = { $ref: ref }
      const result = convertSpec({
        components: {
          callbacks: { C: reference },
          examples: { E: reference },
          headers: { H: reference },
          links: { L: reference },
          parameters: { P: reference },
          pathItems: {
            Loop: {
              parameters: [
                { $ref: '#/components/pathItems/Loop/parameters/1' },
                { $ref: '#/components/pathItems/Loop/parameters/0' },
              ],
            },
          },
          requestBodies: { B: reference },
          responses: { R: reference },
          schemas: { S: bare, T: { $ref: ref, type: 'string' } },
          securitySchemes: { S: reference },
        },
        paths: {
          '/a': {
            get: {
              callbacks: { cb: reference },
              parameters: [reference, { in: 'query', name: 'kept' }],
              requestBody: reference,
              responses: {
                200: {
                  content: {
                    'application/json': {
                      encoding: { f: { headers: { H: reference } } },
                      examples: { e: reference },
                      schema: bare,
                    },
                  },
                  description: 'ok',
                  headers: { H: reference },
                  links: { l: reference },
                },
                201: reference,
              },
            },
            parameters: [reference],
          },
          '/b': reference,
        },
        webhooks: { newPet: hook },
      })
      expect(result.components).toEqual({
        callbacks: { C: bare },
        examples: { E: bare },
        headers: { H: bare },
        links: { L: bare },
        parameters: { P: bare },
        requestBodies: { B: bare },
        responses: { R: bare },
        schemas: { S: bare, T: { allOf: [bare], type: 'string' } },
        securitySchemes: { S: bare },
      })
      expect(result.paths).toEqual({
        '/a': {
          get: {
            callbacks: { cb: bare },
            parameters: [bare, { in: 'query', name: 'kept' }],
            requestBody: bare,
            responses: {
              200: {
                content: {
                  'application/json': {
                    encoding: { f: { headers: { H: bare } } },
                    examples: { e: bare },
                    schema: bare,
                  },
                },
                description: 'ok',
                headers: { H: bare },
                links: { l: bare },
              },
              201: bare,
            },
          },
          parameters: [bare],
        },
        '/b': reference,
      })
    })

    it('inlines Schema $refs with or without siblings and converts boolean targets', () => {
      const pointer = (path: string) => `#/components/pathItems/Schemas/x-schemas/${path}`
      const result = convertSpec({
        components: {
          pathItems: {
            Schemas: {
              'x-schemas': {
                alias: { $ref: pointer('nullable') },
                never: false,
                nullable: { type: ['string', 'null'] },
                withSiblings: { $ref: pointer('nullable'), description: 'wrapped' },
              },
            },
          },
          schemas: {
            Alias: { $ref: pointer('alias') },
            Never: { $ref: pointer('never') },
            NotNever: { not: { $ref: pointer('never') } },
            Siblings: { $ref: pointer('nullable'), description: 'd' },
            WithSiblings: { $ref: pointer('withSiblings') },
          },
        },
      })
      const nullable = { nullable: true, type: 'string' }
      expect(result.components).toEqual({
        schemas: {
          Alias: nullable,
          Never: { not: {} },
          NotNever: { not: { not: {} } },
          Siblings: { allOf: [nullable], description: 'd' },
          WithSiblings: { allOf: [nullable], description: 'wrapped' },
        },
      })
    })

    it('cuts recursion into {} for schemas and into own fields for path items, keeping the output acyclic', () => {
      const result = convertSpec({
        components: { schemas: { Tree: { $ref: '#/webhooks/tree/post/requestBody/content/application~1json/schema' } } },
        paths: {
          '/ping': { $ref: '#/webhooks/ping' },
          '/tree': { $ref: '#/webhooks/tree' },
        },
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
                    schema: {
                      properties: {
                        children: { items: { $ref: '#/webhooks/tree/post/requestBody/content/application~1json/schema' }, type: 'array' },
                      },
                      type: 'object',
                    },
                  },
                },
              },
              responses: {},
            },
          },
        },
      })
      expect(result.components).toEqual({
        schemas: { Tree: { properties: { children: { items: {}, type: 'array' } }, type: 'object' } },
      })
      expect(
        dig(result, 'paths', '/tree', 'post', 'requestBody', 'content', 'application/json', 'schema'),
      ).toBe(dig(result, 'components', 'schemas', 'Tree'))
      expect(dig(result, 'paths', '/ping', 'post', 'callbacks')).toEqual({
        pong: { '{$request.body#/url}': {} },
        self: { '{$request.body#/url}': {} },
      })
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
      expect(JSON.stringify(result)).not.toMatch(removedPointer)
    })

    it('converts a target reached through many references once', () => {
      const pointer = (index: number) => `#/webhooks/w${index}/post/requestBody/content/application~1json/schema`
      const leaf = { content: { 'application/json': { schema: { type: ['string', 'null'] } } } }
      const webhooks: Record<string, unknown> = { w64: { post: { requestBody: leaf } } }
      for (let index = 0; index < 64; index++) {
        const schema = { properties: { a: { $ref: pointer(index + 1) }, b: { $ref: pointer(index + 1) } }, type: 'object' }
        webhooks[`w${index}`] = { post: { requestBody: { content: { 'application/json': { schema } } } } }
      }
      let node = dig(convertSpec({ components: { schemas: { Root: { $ref: pointer(0) } } }, webhooks }), 'components', 'schemas', 'Root')
      for (let index = 0; index < 64; index++) {
        expect(dig(node, 'properties', 'a')).toBe(dig(node, 'properties', 'b'))
        node = dig(node, 'properties', 'a')
      }
      expect(node).toEqual({ nullable: true, type: 'string' })
    })

    it('resolves percent-encoded and tilde-escaped pointers', () => {
      const result = convertSpec({
        paths: {
          '/a': {
            get: {
              parameters: [
                { $ref: '#/webhooks/new%20pet/post/parameters/0' },
                { $ref: '#/webhooks/a~0b~1c/post/parameters/0' },
                { $ref: '#%2Fwebhooks%2Fnew%20pet%2Fpost%2Fparameters%2F1' },
              ],
              responses: {},
            },
          },
          '/b': { $ref: '#/webhooks/new%20pet/post/callbacks/cb/%7B$request.body%23~1url%7D' },
        },
        webhooks: {
          'a~b/c': { post: { parameters: [{ in: 'query', name: 'tilde' }] } },
          'new pet': {
            post: {
              callbacks: { cb: { '{$request.body#/url}': { summary: 'callback' } } },
              parameters: [
                { in: 'query', name: 'space' },
                { in: 'query', name: 'encoded' },
              ],
            },
          },
        },
      })
      expect(result.paths).toEqual({
        '/a': {
          get: {
            parameters: [
              { in: 'query', name: 'space' },
              { in: 'query', name: 'tilde' },
              { in: 'query', name: 'encoded' },
            ],
            responses: {},
          },
        },
        '/b': { summary: 'callback' },
      })
    })

    it('resolves pointer tokens only against keys and indices the document owns', () => {
      const refs = [
        '#/webhooks/__proto__/post/parameters/0',
        '#/webhooks/__proto__/post/parameters/length',
        '#/webhooks/__proto__/post/parameters/00',
        '#/webhooks/__proto__/post/parameters/-',
        '#/webhooks/constructor',
        '#/webhooks/hasOwnProperty',
      ]
      const result = convertSpec({
        paths: { '/a': { get: { parameters: refs.map($ref => ({ $ref })), responses: {} } } },
        webhooks: JSON.parse('{"__proto__":{"post":{"parameters":[{"in":"query","name":"own"}]}}}'),
      })
      expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([
        { in: 'query', name: 'own' },
        ...refs.slice(1).map($ref => ({ $ref })),
      ])
    })

    it('rewrites links into the removed parts to the operationId of an operation still in the output and removes the rest', () => {
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
              callbacks: {
                cb: { '{$request.body#/url}': { $ref: '#/components/pathItems/Item' } },
              },
              responses: {
                200: {
                  description: 'ok',
                  links: {
                    both: { operationId: 'stale', operationRef: '#/webhooks/newPet/post' },
                    byCallback: {
                      operationRef: '#/components/pathItems/Item/get',
                      parameters: { id: '$response.body#/id' },
                    },
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
              responses: {
                200: {
                  description: 'ok',
                  links: { self: { operationRef: '#/webhooks/newPet/post' } },
                },
              },
            },
          },
          orphan: { post: { operationId: 'orphanHook', responses: {} } },
        },
      })
      expect(result.components).toEqual({
        callbacks: { Hook: { '{$url}': { post: { operationId: 'callbackHookOp', responses: {} } } } },
        links: {
          ByComponentCallback: { operationId: 'callbackHookOp' },
          Kept: { description: 'kept', operationId: 'newPetHook' },
        },
      })
      expect(dig(result, 'paths', '/a', 'get', 'responses', '200', 'links')).toEqual({
        both: { operationId: 'newPetHook' },
        byCallback: { operationId: 'getItem', parameters: { id: '$response.body#/id' } },
        byId: { operationId: 'orphanHook' },
        byPath: { operationRef: '#/paths/~1b/post' },
        external: { $ref: 'https://example.com/links.json#/Kept' },
        inlined: { operationId: 'newPetHook' },
        refKept: { $ref: '#/components/links/Kept' },
        refUnknown: { $ref: '#/components/links/Unknown' },
      })
      expect(dig(result, 'paths', '/b', 'post', 'responses', '200', 'links')).toEqual({
        self: { operationId: 'newPetHook' },
      })
      expect(JSON.stringify(result)).not.toMatch(removedPointer)
    })

    it('removes a link to an operation that an own field of the referencing path item replaces', () => {
      expect(
        convertSpec({
          components: { links: { L: { operationRef: '#/webhooks/w/post' } } },
          paths: { '/a': { $ref: '#/webhooks/w', post: { responses: {} } } },
          webhooks: { w: { post: { operationId: 'hidden', responses: {} } } },
        }).components,
      ).toEqual({ links: {} })
    })

    it('removes a link to a removed operation in a document without components', () => {
      expect(
        convertSpec({
          paths: {
            '/a': {
              get: {
                callbacks: { junk: 42 },
                responses: { 200: { description: 'ok', links: { l: { operationRef: '#/webhooks/w/post' } } } },
              },
            },
          },
          webhooks: { w: { post: { operationId: 'hook', responses: {} } } },
        }).paths,
      ).toEqual({
        '/a': { get: { callbacks: { junk: 42 }, responses: { 200: { description: 'ok', links: {} } } } },
      })
    })

    it('removes discriminator mapping entries into the removed parts', () => {
      expect(
        convertSpec({
          components: {
            schemas: {
              Junk: { discriminator: { mapping: 'junk', propertyName: 'kind' } },
              Pet: {
                discriminator: {
                  mapping: {
                    cat: '#/components/schemas/Cat',
                    dog: schemaPointer,
                    fish: 'Fish',
                    hamster: '#/components/pathItems/Item',
                  },
                  propertyName: 'kind',
                },
              },
            },
          },
        }).components,
      ).toEqual({
        schemas: {
          Junk: { discriminator: { mapping: 'junk', propertyName: 'kind' } },
          Pet: {
            discriminator: {
              mapping: { cat: '#/components/schemas/Cat', fish: 'Fish' },
              propertyName: 'kind',
            },
          },
        },
      })
    })

    it('inlines into a cyclic input graph, preserving its cycle', () => {
      const node: Record<string, unknown> = { type: 'object' }
      node.properties = { hook: { $ref: schemaPointer }, self: node }
      const result = convertSpec({ components: { schemas: { Node: node } }, webhooks: { newPet: hook } })
      const converted = dig(result, 'components', 'schemas', 'Node')
      expect(dig(converted, 'properties', 'self')).toBe(converted)
      expect(dig(converted, 'properties', 'hook')).toEqual({ properties: { name: { type: 'string' } }, type: 'object' })
    })

    it('inlines references in operation, path item, media type, parameter, and encoding positions', () => {
      const pointer = (path: string) => `#/webhooks/full/post/${path}`
      const result = convertSpec({
        paths: {
          '/a': {
            get: {
              parameters: [{
                examples: { e: { $ref: pointer('x-example') } },
                in: 'query',
                name: 'q',
              }],
              requestBody: { $ref: pointer('requestBody') },
              responses: {
                200: {
                  content: {
                    'application/json': {
                      encoding: { f: { headers: { H: { $ref: pointer('x-header') } } } },
                      examples: { e: { $ref: pointer('x-example') } },
                    },
                  },
                  description: 'ok',
                },
              },
            },
            parameters: [{ $ref: pointer('x-parameter') }],
          },
        },
        webhooks: {
          full: {
            post: {
              'requestBody': { content: { 'text/plain': { schema: { const: 'x' } } } },
              'x-example': { value: 1 },
              'x-header': { schema: { type: ['string', 'null'] } },
              'x-parameter': { in: 'path', name: 'id' },
            },
          },
        },
      })
      expect(result.paths).toEqual({
        '/a': {
          get: {
            parameters: [{ examples: { e: { value: 1 } }, in: 'query', name: 'q' }],
            requestBody: { content: { 'text/plain': { schema: { enum: ['x'] } } } },
            responses: {
              200: {
                content: {
                  'application/json': {
                    encoding: { f: { headers: { H: { schema: { nullable: true, type: 'string' } } } } },
                    examples: { e: { value: 1 } },
                  },
                },
                description: 'ok',
              },
            },
          },
          parameters: [{ in: 'path', name: 'id', required: true }],
        },
      })
    })

    it('cuts callbacks that reach back into an enclosing callback, keeping the output acyclic', () => {
      const responses = { 200: { description: 'ok' } }
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
        paths: {
          '/item': { $ref: '#/components/pathItems/Item' },
          '/self': { $ref: '#/webhooks/w' },
        },
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
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    })

    it('cuts own fields that lead back into a path item still being converted', () => {
      const responses = { 200: { description: 'ok' } }
      const loop = {
        $ref: '#/components/pathItems/T',
        get: { callbacks: { d: { '{$url}': { $ref: '#/components/pathItems/A' } } }, responses },
      }
      const result = convertSpec({
        components: {
          callbacks: { C: { '{$url}': { $ref: '#/components/pathItems/A/post/callbacks/c/{$url}' } } },
          pathItems: {
            A: { post: { callbacks: { c: { '{$url}': loop } }, responses } },
            T: { summary: 't' },
          },
        },
      })
      expect(dig(result, 'components', 'callbacks', 'C', '{$url}', 'get', 'callbacks', 'd', '{$url}', 'post', 'callbacks')).toEqual({
        c: { '{$url}': { summary: 't' } },
      })
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    })

    it('cuts fields inherited from a later hop that lead back into it', () => {
      const responses = { 200: { description: 'ok' } }
      const result = convertSpec({
        components: {
          pathItems: {
            A: { $ref: '#/components/pathItems/T', post: { callbacks: { c: { '{$url}': { $ref: '#/components/pathItems/A' } } }, responses } },
            T: { summary: 't' },
          },
        },
        paths: { '/p': { $ref: '#/components/pathItems/A' } },
      })
      expect(result.paths).toEqual({
        '/p': { post: { callbacks: { c: { '{$url}': { summary: 't' } } }, responses }, summary: 't' },
      })
    })

    it('keeps an object cycle that an inlined target also reaches', () => {
      const a: Record<string, unknown> = { properties: {}, type: 'object' }
      const b = { properties: { back: a }, type: 'object' }
      a.properties = { hook: { $ref: schemaPointer }, b }
      const result = convertSpec({
        components: { schemas: { A: a } },
        webhooks: { newPet: { post: { requestBody: { content: { 'application/json': { schema: { properties: { b }, type: 'object' } } } } } } },
      })
      const converted = dig(result, 'components', 'schemas', 'A')
      expect(dig(converted, 'properties', 'b', 'properties', 'back')).toBe(converted)
      expect(dig(converted, 'properties', 'hook', 'properties', 'b', 'properties', 'back')).toEqual({})
    })

    it('cuts a reference that comes back to an object shared within the input', () => {
      const shared: Record<string, unknown> = { properties: { a: { $ref: schemaPointer } }, type: 'object' }
      const result = convertSpec({
        components: { schemas: { S: shared } },
        webhooks: {
          newPet: { post: { requestBody: { content: { 'application/json': { schema: { properties: { b: shared }, type: 'object' } } } } } },
        },
      })
      expect(dig(result, 'components', 'schemas', 'S')).toEqual({
        properties: { a: { properties: { b: {} }, type: 'object' } },
        type: 'object',
      })
    })

    it('expands an enclosing path item once before cutting the reference back into it', () => {
      const result = convertSpec({
        components: { callbacks: { C: { $ref: '#/webhooks/ping/post/callbacks/self' } } },
        webhooks: {
          ping: { post: { callbacks: { self: { expr: { $ref: '#/webhooks/ping' } } }, responses: {} } },
        },
      })
      expect(dig(result, 'components', 'callbacks', 'C')).toEqual({
        expr: { post: { callbacks: { self: { expr: {} } }, responses: {} } },
      })
    })

    it('keeps the fields of every hop when it cuts a recursive path item', () => {
      const result = convertSpec({
        paths: { '/a': { $ref: '#/webhooks/a' } },
        webhooks: {
          a: { post: { callbacks: { cb: { expr: { $ref: '#/webhooks/alias', summary: 'outer' } } }, responses: {} } },
          alias: { $ref: '#/webhooks/a', description: 'alias' },
        },
      })
      expect(dig(result, 'paths', '/a', 'post', 'callbacks', 'cb', 'expr')).toEqual({ description: 'alias', summary: 'outer' })
    })

    it('converts path items and headers reached through many references once', () => {
      const webhooks: Record<string, unknown> = { w30: { 'get': { responses: {} }, 'x-header': { schema: { type: 'string' } } } }
      for (let index = 0; index < 30; index++) {
        const next = { $ref: `#/webhooks/w${index + 1}` }
        const header = { $ref: `#/webhooks/w${index + 1}/x-header` }
        webhooks[`w${index}`] = {
          'get': { callbacks: { a: { expr: next }, b: { expr: next } }, responses: {} },
          'x-header': { content: { 'text/plain': { encoding: { e: { headers: { a: header, b: header } } } } } },
        }
      }
      const result = convertSpec({
        components: { headers: { H: { $ref: '#/webhooks/w0/x-header' } } },
        paths: { '/a': { $ref: '#/webhooks/w0' } },
        webhooks,
      })
      let pathItem = dig(result, 'paths', '/a')
      let header = dig(result, 'components', 'headers', 'H')
      for (let index = 0; index < 30; index++) {
        expect(dig(pathItem, 'get', 'callbacks', 'a', 'expr')).toBe(dig(pathItem, 'get', 'callbacks', 'b', 'expr'))
        pathItem = dig(pathItem, 'get', 'callbacks', 'a', 'expr')
        const headers = dig(header, 'content', 'text/plain', 'encoding', 'e', 'headers')
        expect(dig(headers, 'a')).toBe(dig(headers, 'b'))
        header = dig(headers, 'a')
      }
      expect(pathItem).toEqual({ 'get': { responses: {} }, 'x-header': { schema: { type: 'string' } } })
      expect(header).toEqual({ schema: { type: 'string' } })
    })

    it.each([
      ['a schema property named callbacks', '#/webhooks/w/post/requestBody/content/a~1b/schema/properties/callbacks/properties/x'],
      ['a webhook named callbacks', '#/webhooks/callbacks/get/responses'],
      ['a callback extension', '#/webhooks/w/post/callbacks/c/x-note'],
    ])('leaves a Path Item $ref to %s as written', (_name, ref) => {
      expect(
        convertSpec({
          paths: { '/a': { $ref: ref } },
          webhooks: {
            callbacks: { get: { responses: { 200: { description: 'ok' } } } },
            w: {
              post: {
                callbacks: { c: { 'x-note': { get: {} } } },
                requestBody: {
                  content: { 'a/b': { schema: { properties: { callbacks: { properties: { x: { get: 'prop', type: 'string' } } } } } } },
                },
              },
            },
          },
        }).paths,
      ).toEqual({ '/a': { $ref: ref } })
    })

    it('inlines a Path Item $ref to a callback nested in another callback', () => {
      expect(
        convertSpec({
          paths: { '/a': { $ref: '#/webhooks/w/post/callbacks/c/{$url}/get/callbacks/d/{$url}' } },
          webhooks: {
            w: { post: { callbacks: { c: { '{$url}': { get: { callbacks: { d: { '{$url}': { summary: 'nested' } } } } } } } } },
          },
        }).paths,
      ).toEqual({ '/a': { summary: 'nested' } })
    })

    it('removes security schemes aliased into the removed parts by type', () => {
      const result = convertSpec({
        components: {
          securitySchemes: {
            'Escaped': { $ref: '#/components/securitySchemes/m~1tls' },
            'Http': { $ref: '#/webhooks/w/x-http' },
            'm/tls': { type: 'mutualTLS' },
            'Tls': { $ref: '#/webhooks/w/x-tls' },
          },
        },
        paths: { '/a': { get: { responses: {}, security: [{ Tls: [] }, { Escaped: [] }, { Http: ['read'] }] } } },
        security: [{ Tls: [] }],
        webhooks: { w: { 'x-http': { scheme: 'bearer', type: 'http' }, 'x-tls': { type: 'mutualTLS' } } },
      })
      expect(result.components).toEqual({ securitySchemes: { Http: { scheme: 'bearer', type: 'http' } } })
      expect(result.security).toBeUndefined()
      expect(dig(result, 'paths', '/a', 'get', 'security')).toEqual([{ Http: [] }])
    })

    it('leaves references and mapping entries in a standalone schema untouched', () => {
      const schema = {
        discriminator: { mapping: { a: schemaPointer }, propertyName: 'kind' },
        properties: { a: { $ref: schemaPointer } },
      }
      expect(downgradeSchemaV31ToV30(schema as any)).toEqual(schema)
    })
  })

  describe('reference objects', () => {
    it('strips reference summary and description across components maps', () => {
      expect(
        convertSpec({
          components: {
            callbacks: { C: { $ref: '#/c/cb', summary: 's' } },
            examples: { E: { $ref: '#/c/e', description: 'd' } },
            headers: { H: { $ref: '#/c/h', summary: 's' } },
            links: { L: { $ref: '#/c/l', description: 'd' } },
            parameters: {
              P: { $ref: '#/c/p', description: 'd', summary: 's' },
            },
            requestBodies: { B: { $ref: '#/c/b', summary: 's' } },
            responses: { R: { $ref: '#/c/r', description: 'd' } },
            securitySchemes: { S: { $ref: '#/c/s', description: 'd' } },
          },
        }).components,
      ).toEqual({
        callbacks: { C: { $ref: '#/c/cb' } },
        examples: { E: { $ref: '#/c/e' } },
        headers: { H: { $ref: '#/c/h' } },
        links: { L: { $ref: '#/c/l' } },
        parameters: { P: { $ref: '#/c/p' } },
        requestBodies: { B: { $ref: '#/c/b' } },
        responses: { R: { $ref: '#/c/r' } },
        securitySchemes: { S: { $ref: '#/c/s' } },
      })
    })

    it('strips reference overrides inside operations and path items', () => {
      expect(
        convertPathItem({
          get: {
            callbacks: { cb: { $ref: '#/c/cb', summary: 's' } },
            parameters: [{ $ref: '#/c/p', description: 'd' }],
            requestBody: { $ref: '#/c/b', summary: 's' },
            responses: { 200: { $ref: '#/c/r', summary: 's' } },
          },
          parameters: [{ $ref: '#/c/pp', summary: 's' }],
        }),
      ).toEqual({
        get: {
          callbacks: { cb: { $ref: '#/c/cb' } },
          parameters: [{ $ref: '#/c/p' }],
          requestBody: { $ref: '#/c/b' },
          responses: { 200: { $ref: '#/c/r' } },
        },
        parameters: [{ $ref: '#/c/pp' }],
      })
    })

    it('strips reference overrides in response headers, links, and media type examples', () => {
      expect(
        convertComponent('responses', {
          content: {
            'application/json': {
              examples: { e: { $ref: '#/c/e', summary: 's' } },
              schema: { type: ['string', 'null'] },
            },
          },
          description: 'ok',
          headers: { H: { $ref: '#/c/h', summary: 's' } },
          links: { l: { $ref: '#/c/l', description: 'd' } },
        }),
      ).toEqual({
        content: {
          'application/json': {
            examples: { e: { $ref: '#/c/e' } },
            schema: { nullable: true, type: 'string' },
          },
        },
        description: 'ok',
        headers: { H: { $ref: '#/c/h' } },
        links: { l: { $ref: '#/c/l' } },
      })
    })

    it('keeps x- entries in a responses map unconverted', () => {
      const responses = {
        '200': { description: 'ok' },
        'x-note': { $ref: '#/c/r', summary: 's' },
      }
      expect(convertPathItem({ get: { responses } })).toEqual({
        get: { responses },
      })
    })
  })

  describe('operations', () => {
    it('synthesizes a minimal default responses object when an operation lacks one', () => {
      expect(convertPathItem({ get: { operationId: 'getA' } })).toEqual({
        get: {
          operationId: 'getA',
          responses: { default: { description: '' } },
        },
      })
    })

    it('converts parameter schemas, content, and examples', () => {
      expect(
        convertPathItem({
          get: {
            parameters: [
              {
                examples: { e: { $ref: '#/c/e', summary: 's' } },
                in: 'query',
                name: 'p',
                schema: { type: ['string', 'null'] },
              },
              {
                content: {
                  'text/plain': { schema: { type: ['integer', 'null'] } },
                },
                in: 'query',
                name: 'q',
              },
            ],
            responses: {},
          },
        }),
      ).toEqual({
        get: {
          parameters: [
            {
              examples: { e: { $ref: '#/c/e' } },
              in: 'query',
              name: 'p',
              schema: { nullable: true, type: 'string' },
            },
            {
              content: {
                'text/plain': { schema: { nullable: true, type: 'integer' } },
              },
              in: 'query',
              name: 'q',
            },
          ],
          responses: {},
        },
      })
    })

    it('adds required: true to path parameters that lack it', () => {
      expect(
        convertPathItem({
          get: {
            parameters: [
              {
                content: { 'text/plain': { schema: { type: 'string' } } },
                in: 'path',
                name: 'id',
              },
              { in: 'query', name: 'q', schema: {} },
            ],
            responses: {},
          },
        }),
      ).toEqual({
        get: {
          parameters: [
            {
              content: { 'text/plain': { schema: { type: 'string' } } },
              in: 'path',
              name: 'id',
              required: true,
            },
            { in: 'query', name: 'q', schema: {} },
          ],
          responses: {},
        },
      })
    })

    it('converts request body content, media type encoding, and encoding headers', () => {
      expect(
        convertComponent('requestBodies', {
          content: {
            'multipart/form-data': {
              encoding: {
                field: {
                  contentType: 'text/plain',
                  headers: {
                    H: { $ref: '#/c/h', summary: 's' },
                    H2: { schema: { type: ['string', 'null'] } },
                  },
                },
              },
              example: { field: 'v' },
              schema: { type: 'object' },
            },
          },
          description: 'body',
          required: true,
        }),
      ).toEqual({
        content: {
          'multipart/form-data': {
            encoding: {
              field: {
                contentType: 'text/plain',
                headers: {
                  H: { $ref: '#/c/h' },
                  H2: { schema: { nullable: true, type: 'string' } },
                },
              },
            },
            example: { field: 'v' },
            schema: { type: 'object' },
          },
        },
        description: 'body',
        required: true,
      })
    })

    it('converts inline callback objects, cloning x- keys and junk entries', () => {
      expect(
        convertPathItem({
          get: {
            callbacks: {
              inline: { 'expr': { get: {} }, 'x-k': { expr: { get: {} } } },
              junk: 7,
            },
            responses: {},
          },
        }),
      ).toEqual({
        get: {
          callbacks: {
            inline: {
              'expr': { get: { responses: { default: { description: '' } } } },
              'x-k': { expr: { get: {} } },
            },
            junk: 7,
          },
          responses: {},
        },
      })
    })
  })

  describe('components', () => {
    it('removes pathItems and keeps the other component maps', () => {
      const result = convertSpec({
        components: {
          pathItems: { Reusable: { get: { summary: 's' } } },
          schemas: { S: { type: 'string' } },
        },
      })
      expect(result.components).toEqual({ schemas: { S: { type: 'string' } } })
      expect(result.components).not.toHaveProperty('x-pathItems')
    })

    it('strips overrides from a callback reference to a missing path item', () => {
      expect(
        convertComponent('callbacks', {
          $ref: '#/components/pathItems/Reusable',
          summary: 's',
        }),
      ).toEqual({ $ref: '#/components/pathItems/Reusable' })
    })

    it('converts component callbacks and schemas, including boolean schemas', () => {
      expect(
        convertSpec({
          components: {
            'callbacks': {
              junkCallback: 42,
              realCallback: {
                'x-note': { '{$expr}': { get: {} } },
                '{$request.body#/url}': { post: { summary: 's' } },
              },
            },
            'schemas': { S: { type: ['string', 'null'] }, T: true },
            'x-extra': { keep: true },
          },
        }).components,
      ).toEqual({
        'callbacks': {
          junkCallback: 42,
          realCallback: {
            'x-note': { '{$expr}': { get: {} } },
            '{$request.body#/url}': {
              post: {
                responses: { default: { description: '' } },
                summary: 's',
              },
            },
          },
        },
        'schemas': { S: { nullable: true, type: 'string' }, T: {} },
        'x-extra': { keep: true },
      })
    })

    it('clones a malformed components value unchanged', () => {
      expect(convertSpec({ components: 'junk' }).components).toBe('junk')
    })
  })

  describe('security', () => {
    const apiKey = { in: 'header', name: 'k', type: 'apiKey' }

    it('removes mutualTLS schemes and drops requirements that become empty', () => {
      const result = convertSpec({
        components: {
          securitySchemes: { api: apiKey, mtls: { type: 'mutualTLS' } },
        },
        security: [{ mtls: [] }, { api: [], mtls: [] }, {}],
      })
      expect(result.components).toEqual({ securitySchemes: { api: apiKey } })
      expect(result.security).toEqual([{ api: [] }, {}])
    })

    it('removes reference aliases of mutualTLS schemes and their requirements', () => {
      const result = convertSpec({
        components: {
          securitySchemes: {
            api: apiKey,
            clientCert: { $ref: '#/components/securitySchemes/mtlsBase' },
            mtlsBase: { type: 'mutualTLS' },
          },
        },
        security: [{ clientCert: [] }, { api: [] }],
      })
      expect(result.components).toEqual({ securitySchemes: { api: apiKey } })
      expect(result.security).toEqual([{ api: [] }])
    })

    it('survives cyclic, dangling, external, and malformed scheme aliases', () => {
      const securitySchemes = {
        dangling: { $ref: '#/components/securitySchemes/missing' },
        external: { $ref: 'https://example.com/s.json#/schemes/a' },
        junk: 42,
        nested: { $ref: '#/components/securitySchemes/a/b' },
        ping: { $ref: '#/components/securitySchemes/pong' },
        pong: { $ref: '#/components/securitySchemes/ping' },
      }
      expect(
        convertSpec({ components: { securitySchemes } }).components,
      ).toEqual({
        securitySchemes,
      })
    })

    it('empties roles on non-OAuth schemes and keeps them elsewhere', () => {
      expect(
        convertSpec({
          components: {
            securitySchemes: {
              api: apiKey,
              basic: { scheme: 'basic', type: 'http' },
              oauth: { flows: {}, type: 'oauth2' },
              oidc: { openIdConnectUrl: 'https://x', type: 'openIdConnect' },
            },
          },
          security: [
            { api: ['read'], basic: ['admin'] },
            { oauth: ['read'], oidc: ['a'], unknownScheme: ['s'] },
          ],
        }).security,
      ).toEqual([
        { api: [], basic: [] },
        { oauth: ['read'], oidc: ['a'], unknownScheme: ['s'] },
      ])
    })

    it('converts operation-level security lists', () => {
      expect(
        convertSpec({
          components: {
            securitySchemes: { api: apiKey, mtls: { type: 'mutualTLS' } },
          },
          paths: {
            '/a': {
              get: {
                responses: {},
                security: [{ mtls: [] }, { api: ['read'] }],
              },
            },
          },
        }).paths,
      ).toEqual({ '/a': { get: { responses: {}, security: [{ api: [] }] } } })
    })

    it('omits a security list that mutualTLS removal emptied instead of making it public', () => {
      const result = convertSpec({
        components: { securitySchemes: { mtls: { type: 'mutualTLS' } } },
        paths: {
          '/admin': { get: { responses: {}, security: [{ mtls: [] }] } },
        },
        security: [{ mtls: [] }],
      })
      expect(result.paths).toEqual({ '/admin': { get: { responses: {} } } })
      expect(result).not.toHaveProperty('security')
    })

    it('keeps an explicitly empty security list', () => {
      const result = convertSpec({
        paths: { '/a': { get: { responses: {}, security: [] } } },
        security: [],
      })
      expect(result.paths).toEqual({
        '/a': { get: { responses: {}, security: [] } },
      })
      expect(result.security).toEqual([])
    })

    it('clones malformed security values and scheme maps unchanged', () => {
      expect(
        convertSpec({ security: [{ api: [] }, 'junk', 42] }).security,
      ).toEqual([{ api: [] }, 'junk', 42])
      expect(convertSpec({ security: { api: [] } }).security).toEqual({
        api: [],
      })
      expect(
        convertSpec({ components: { securitySchemes: 'junk' } }).components,
      ).toEqual({
        securitySchemes: 'junk',
      })
    })
  })

  describe('robustness', () => {
    it('never mutates the input document', () => {
      const input: OpenAPIV3_1.OpenAPIObject = {
        components: {
          pathItems: { Reusable: { get: { summary: 's' } } },
          schemas: { S: { $ref: '#/c/s', type: ['string', 'null'] } },
          securitySchemes: {
            api: { in: 'header', name: 'k', type: 'apiKey' },
            mtls: { type: 'mutualTLS' },
          },
        },
        info: {
          license: { identifier: 'MIT', name: 'MIT' },
          summary: 'short',
          title: 't',
          version: '1',
        },
        jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
        openapi: '3.1.0',
        paths: {
          '/a': {
            get: {
              parameters: [{ $ref: '#/c/p', summary: 's' }],
              security: [{ mtls: [] }, { api: ['read'] }],
            },
          },
        },
        security: [{ mtls: [] }],
        webhooks: { newPet: { post: { summary: 's' } } },
      }
      const before = structuredClone(input)
      downgradeSpecV31ToV30(input)
      expect(input).toEqual(before)
    })

    it('converts a path item that cycles through its callbacks, pointing the cycle at the converted path item', () => {
      const callback: Record<string, unknown> = {}
      const pathItem: Record<string, unknown> = {
        get: { callbacks: { cb: callback } },
      }
      callback.expr = pathItem
      const result = convertPathItem(pathItem)
      expect(dig(result, 'get', 'responses')).toEqual({ default: { description: '' } })
      expect(dig(result, 'get', 'callbacks', 'cb', 'expr')).toBe(result)
    })

    it('converts a dereferenced schema shared across the document once', () => {
      const pet = { properties: { name: { type: ['string', 'null'] } }, type: 'object' }
      const result = convertSpec({
        components: { schemas: { Pet: pet } },
        paths: { '/pets': { get: { responses: { 200: { content: { 'application/json': { schema: pet } }, description: 'ok' } } } } },
      })
      const schema = dig(result, 'components', 'schemas', 'Pet')
      expect(schema).toEqual({
        properties: { name: { nullable: true, type: 'string' } },
        type: 'object',
      })
      expect(dig(result, 'paths', '/pets', 'get', 'responses', '200', 'content', 'application/json', 'schema')).toBe(schema)
    })
  })
})

describe('downgradeSchemaV31ToV30', () => {
  describe('boolean and junk schemas', () => {
    it('converts the boolean schemas', () => {
      expect(downgradeSchemaV31ToV30(true)).toEqual({})
      expect(downgradeSchemaV31ToV30(false)).toEqual({ not: {} })
    })

    it('clones junk input unchanged', () => {
      expect(convertSchema(null)).toBeNull()
      expect(convertSchema(42)).toBe(42)
      expect(convertSchema('x')).toBe('x')
      const list = [{ type: 'string' }]
      const result = convertSchema(list)
      expect(result).toEqual(list)
      expect(result).not.toBe(list)
    })
  })

  describe('$ref', () => {
    it('keeps a pure $ref as a bare reference object, wherever it points', () => {
      const input = { $ref: '#/components/schemas/Pet' }
      const result = downgradeSchemaV31ToV30(input)
      expect(result).toEqual(input)
      expect(result).not.toBe(input)
      expect(convertSchema({ $ref: '#/components/pathItems/Foo' })).toEqual({
        $ref: '#/components/pathItems/Foo',
      })
    })

    it.each([
      [
        'wraps a $ref with sibling keywords into allOf',
        { $ref: '#/c/s', minLength: 1 },
        { allOf: [{ $ref: '#/c/s' }], minLength: 1 },
      ],
      [
        'merges a $ref into an existing allOf',
        { $ref: '#/c/s', allOf: [{ type: 'string' }] },
        { allOf: [{ $ref: '#/c/s' }, { type: 'string' }] },
      ],
      [
        'keeps a malformed allOf and leaves the $ref in place',
        { $ref: '#/c/s', allOf: 'junk' },
        { $ref: '#/c/s', allOf: 'junk' },
      ],
      [
        'passes a non-string $ref through unchanged',
        { $ref: 123, type: 'string' },
        { $ref: 123, type: 'string' },
      ],
      [
        'passes a lone non-string $ref through unchanged',
        { $ref: 123 },
        { $ref: 123 },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('type', () => {
    it.each([
      ['keeps a single string type', { type: 'string' }, { type: 'string' }],
      [
        'converts a type array with null into type plus nullable',
        { type: ['string', 'null'] },
        { nullable: true, type: 'string' },
      ],
      [
        'converts a null-only type array into a null enum',
        { type: ['null'] },
        { enum: [null] },
      ],
      [
        'converts a null-only type string into a null enum',
        { type: 'null' },
        { enum: [null] },
      ],
      [
        'intersects an existing enum with a null-only type',
        { enum: ['a', null], type: ['null'] },
        { enum: [null] },
      ],
      [
        'matches nothing when the enum of a null-only type excludes null',
        { enum: ['a'], type: ['null'] },
        { enum: ['a'], not: {} },
      ],
      [
        'clones a malformed enum of a null-only type through',
        { enum: 'junk', type: ['null'] },
        { enum: 'junk' },
      ],
      [
        'keeps a null const as the enum of a null-only type',
        { const: null, type: ['null'] },
        { enum: [null] },
      ],
      [
        'matches nothing when a non-null const contradicts a null-only type',
        { const: 7, type: ['null'] },
        { enum: [7], not: {} },
      ],
      [
        'converts a null-only anyOf branch into a null enum',
        { anyOf: [{ type: 'string' }, { type: 'null' }] },
        { anyOf: [{ type: 'string' }, { enum: [null] }] },
      ],
      [
        'converts multiple non-null types into anyOf variants',
        { type: ['string', 'integer'] },
        { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      ],
      [
        'converts multiple types with null into nullable anyOf variants',
        { type: ['string', 'integer', 'null'] },
        {
          anyOf: [
            { nullable: true, type: 'string' },
            { nullable: true, type: 'integer' },
          ],
        },
      ],
      [
        'gives synthesized array variants an empty items',
        { type: ['array', 'string'] },
        { anyOf: [{ items: {}, type: 'array' }, { type: 'string' }] },
      ],
      [
        'moves existing items into the synthesized array variant',
        { items: { type: 'integer' }, type: ['array', 'string', 'null'] },
        {
          anyOf: [
            { items: { type: 'integer' }, nullable: true, type: 'array' },
            { nullable: true, type: 'string' },
          ],
        },
      ],
      [
        'keeps items in place when the type union has no array variant',
        { items: { type: 'integer' }, type: ['object', 'string'] },
        {
          anyOf: [{ type: 'object' }, { type: 'string' }],
          items: { type: 'integer' },
        },
      ],
      [
        'wraps the type union into allOf when anyOf already exists',
        { anyOf: [{ minLength: 1 }], type: ['string', 'integer'] },
        {
          allOf: [{ anyOf: [{ type: 'string' }, { type: 'integer' }] }],
          anyOf: [{ minLength: 1 }],
        },
      ],
      [
        'appends the type union to an existing allOf when anyOf also exists',
        {
          allOf: [{ title: 't' }],
          anyOf: [{ minLength: 1 }],
          type: ['string', 'integer'],
        },
        {
          allOf: [
            { title: 't' },
            { anyOf: [{ type: 'string' }, { type: 'integer' }] },
          ],
          anyOf: [{ minLength: 1 }],
        },
      ],
      [
        'drops the type union when anyOf exists and allOf is malformed',
        {
          allOf: 'junk',
          anyOf: [{ type: 'string' }],
          items: { type: 'integer' },
          type: ['array', 'string'],
        },
        { allOf: 'junk', anyOf: [{ type: 'string' }], items: { type: 'integer' } },
      ],
      [
        'deduplicates type array entries',
        { type: ['string', 'string'] },
        { type: 'string' },
      ],
      [
        'ignores non-string type array entries beside valid ones',
        { type: ['string', 42] },
        { type: 'string' },
      ],
      [
        'passes a type array of only junk entries through',
        { type: [42] },
        { type: [42] },
      ],
      ['passes a junk number type through', { type: 42 }, { type: 42 }],
      [
        'passes a junk object type through',
        { type: { a: 1 } },
        { type: { a: 1 } },
      ],
      ['drops an empty type array', { type: [] }, {}],
      [
        'adds empty items to an array type without items',
        { type: 'array' },
        { items: {}, type: 'array' },
      ],
      [
        'adds empty items to a nullable array type without items',
        { type: ['array', 'null'] },
        { items: {}, nullable: true, type: 'array' },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('const', () => {
    it.each([
      [
        'converts const into a single-value enum',
        { const: 'a' },
        { enum: ['a'] },
      ],
      ['converts a zero const', { const: 0 }, { enum: [0] }],
      ['converts a false const', { const: false }, { enum: [false] }],
      ['converts an empty-string const', { const: '' }, { enum: [''] }],
      [
        'converts a null const into a null enum',
        { const: null },
        { enum: [null] },
      ],
      [
        'keeps the nullable variants of a multi-type null const',
        { const: null, type: ['string', 'integer', 'null'] },
        {
          anyOf: [
            { nullable: true, type: 'string' },
            { nullable: true, type: 'integer' },
          ],
          enum: [null],
        },
      ],
      [
        'matches nothing when a null const contradicts a non-null type',
        { const: null, type: 'string' },
        { enum: [null], type: 'string' },
      ],
      [
        'replaces an existing enum with the const value',
        { const: 5, enum: [1, 2] },
        { enum: [5] },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('exclusive bounds', () => {
    it.each([
      [
        'converts a numeric exclusiveMinimum into minimum plus flag',
        { exclusiveMinimum: 3 },
        { exclusiveMinimum: true, minimum: 3 },
      ],
      [
        'keeps a tighter inclusive minimum and drops the exclusive one',
        { exclusiveMinimum: 3, minimum: 5 },
        { minimum: 5 },
      ],
      [
        'overrides a looser inclusive minimum with the exclusive bound',
        { exclusiveMinimum: 5, minimum: 3 },
        { exclusiveMinimum: true, minimum: 5 },
      ],
      [
        'prefers the exclusive form for equal minimum bounds',
        { exclusiveMinimum: 3, minimum: 3 },
        { exclusiveMinimum: true, minimum: 3 },
      ],
      [
        'converts a numeric exclusiveMaximum into maximum plus flag',
        { exclusiveMaximum: 10 },
        { exclusiveMaximum: true, maximum: 10 },
      ],
      [
        'keeps a tighter inclusive maximum and drops the exclusive one',
        { exclusiveMaximum: 10, maximum: 5 },
        { maximum: 5 },
      ],
      [
        'overrides a looser inclusive maximum with the exclusive bound',
        { exclusiveMaximum: 5, maximum: 10 },
        { exclusiveMaximum: true, maximum: 5 },
      ],
      [
        'prefers the exclusive form for equal maximum bounds',
        { exclusiveMaximum: 5, maximum: 5 },
        { exclusiveMaximum: true, maximum: 5 },
      ],
      [
        'passes a 3.0-style boolean exclusiveMinimum through',
        { exclusiveMinimum: true, minimum: 3 },
        { exclusiveMinimum: true, minimum: 3 },
      ],
      [
        'passes a 3.0-style boolean exclusiveMaximum through',
        { exclusiveMaximum: false, maximum: 3 },
        { exclusiveMaximum: false, maximum: 3 },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('examples', () => {
    it.each([
      [
        'promotes the first examples entry to example',
        { examples: ['a', 'b'] },
        { example: 'a' },
      ],
      [
        'keeps an explicit example over the examples entries',
        { example: 'e', examples: ['a'] },
        { example: 'e' },
      ],
      ['drops empty examples arrays', { examples: [] }, {}],
      ['drops non-array examples values', { examples: 'junk' }, {}],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('content keywords', () => {
    it.each([
      [
        'converts encoded binary into type string with format byte',
        { contentEncoding: 'base64', contentMediaType: 'image/png', type: 'string' },
        { format: 'byte', type: 'string' },
      ],
      [
        'converts raw binary into type string with format binary',
        { contentMediaType: 'image/png' },
        { format: 'binary', type: 'string' },
      ],
      [
        'keeps nullable on binary strings',
        { contentMediaType: 'image/png', type: ['string', 'null'] },
        { format: 'binary', nullable: true, type: 'string' },
      ],
      [
        'keeps format beside a multi-type anyOf that includes string',
        { contentMediaType: 'image/png', type: ['string', 'integer'] },
        { anyOf: [{ type: 'string' }, { type: 'integer' }], format: 'binary' },
      ],
      [
        'keeps an existing format over contentEncoding',
        { contentEncoding: 'base64', format: 'custom' },
        { format: 'custom', type: 'string' },
      ],
      [
        'drops content keywords on non-string types',
        { contentMediaType: 'image/png', type: 'object' },
        { type: 'object' },
      ],
      [
        'drops base64url, which format byte does not accept',
        { contentEncoding: 'base64url', contentMediaType: 'image/png', type: 'string' },
        { type: 'string' },
      ],
      [
        'drops non-string content media types',
        { contentMediaType: 42 },
        {},
      ],
      ['drops contentSchema', { contentSchema: { type: 'string' } }, {}],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('dropped keywords', () => {
    it('removes every keyword with no 3.0 equivalent', () => {
      expect(
        convertSchema({
          $anchor: 'a',
          $comment: 'c',
          $defs: { D: { type: 'string' } },
          $dynamicAnchor: 'da',
          $dynamicRef: '#dr',
          $id: 'https://example.com/s',
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $vocabulary: { 'https://example.com/v': true },
          contains: { type: 'string' },
          contentSchema: { type: 'string' },
          dependentRequired: { a: ['b'] },
          dependentSchemas: { a: { type: 'object' } },
          else: { title: 'e' },
          if: { title: 'i' },
          maxContains: 2,
          minContains: 1,
          patternProperties: { '^x': { type: 'string' } },
          prefixItems: [{ type: 'string' }],
          propertyNames: { pattern: '^a' },
          then: { title: 't' },
          type: 'string',
          unevaluatedItems: false,
          unevaluatedProperties: false,
        }),
      ).toEqual({ type: 'string' })
    })

    it.each([
      [
        'drops prefixItems together with its trailing items',
        { items: { type: 'integer' }, prefixItems: [{ type: 'string' }] },
        {},
      ],
      [
        'drops boolean additionalProperties together with patternProperties',
        {
          additionalProperties: false,
          patternProperties: { '^x-': {} },
          properties: { name: { type: 'string' } },
          type: 'object',
        },
        { properties: { name: { type: 'string' } }, type: 'object' },
      ],
      [
        'drops schema-valued additionalProperties together with patternProperties',
        {
          additionalProperties: { type: 'integer' },
          patternProperties: { '^x-': {} },
          type: 'object',
        },
        { type: 'object' },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('enum and required', () => {
    it.each([
      [
        'removes an empty enum',
        { enum: [], type: 'string' },
        { type: 'string' },
      ],
      [
        'keeps a non-empty enum',
        { enum: ['a'], type: 'string' },
        { enum: ['a'], type: 'string' },
      ],
      ['drops an empty required array', { required: [] }, {}],
      [
        'keeps a non-empty required array',
        { required: ['a'] },
        { required: ['a'] },
      ],
      [
        'deduplicates required entries',
        { required: ['a', 'b', 'a'], type: 'object' },
        { required: ['a', 'b'], type: 'object' },
      ],
      [
        'clones a non-array required value unchanged',
        { required: 'junk' },
        { required: 'junk' },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('subschemas', () => {
    it.each([
      [
        'converts nested property schemas',
        {
          properties: { a: { type: ['string', 'null'] }, b: true },
          type: 'object',
        },
        {
          properties: { a: { nullable: true, type: 'string' }, b: {} },
          type: 'object',
        },
      ],
      [
        'keeps boolean additionalProperties',
        { additionalProperties: false },
        { additionalProperties: false },
      ],
      [
        'converts schema additionalProperties',
        { additionalProperties: { type: ['string', 'null'] } },
        { additionalProperties: { nullable: true, type: 'string' } },
      ],
      [
        'converts allOf, anyOf, oneOf, and not members',
        {
          allOf: [true],
          anyOf: [{ const: 1 }],
          not: false,
          oneOf: [{ type: ['integer', 'null'] }],
        },
        {
          allOf: [{}],
          anyOf: [{ enum: [1] }],
          not: { not: {} },
          oneOf: [{ nullable: true, type: 'integer' }],
        },
      ],
      [
        'clones a non-array allOf value unchanged',
        { allOf: 'junk' },
        { allOf: 'junk' },
      ],
      [
        'keeps and converts items when there are no prefixItems',
        { items: { type: ['string', 'null'] } },
        { items: { nullable: true, type: 'string' } },
      ],
      ['converts a true items schema', { items: true }, { items: {} }],
      [
        'converts a false items schema',
        { items: false },
        { items: { not: {} } },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('xml nodeType carried over from 3.2', () => {
    it.each([
      [
        'converts nodeType attribute to attribute: true',
        { type: 'string', xml: { name: 'n', nodeType: 'attribute' } },
        { type: 'string', xml: { attribute: true, name: 'n' } },
      ],
      [
        'converts nodeType element on an array schema to wrapped: true',
        { items: {}, type: 'array', xml: { nodeType: 'element' } },
        { items: {}, type: 'array', xml: { wrapped: true } },
      ],
      [
        'converts nodeType element on a nullable array schema to wrapped: true',
        { type: ['array', 'null'], xml: { nodeType: 'element' } },
        { items: {}, nullable: true, type: 'array', xml: { wrapped: true } },
      ],
      [
        'removes nodeType element on non-array schemas',
        { type: 'string', xml: { nodeType: 'element' } },
        { type: 'string', xml: {} },
      ],
      [
        'removes inexpressible nodeType values',
        { type: 'string', xml: { name: 'n', nodeType: 'text' } },
        { type: 'string', xml: { name: 'n' } },
      ],
      [
        'clones xml objects without nodeType unchanged',
        { type: 'string', xml: { attribute: true, name: 'n' } },
        { type: 'string', xml: { attribute: true, name: 'n' } },
      ],
      [
        'clones malformed xml values unchanged',
        { type: 'string', xml: 'junk' },
        { type: 'string', xml: 'junk' },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertSchema(input)).toEqual(expected)
    })
  })

  describe('extensions and unknown keywords', () => {
    it('preserves x- keys and unknown keywords', () => {
      const input = { 'customKeyword': 'v', 'title': 't', 'x-foo': { a: 1 } }
      expect(convertSchema(input)).toEqual(input)
    })

    it('treats keywords named like Object.prototype members as unknown keywords', () => {
      const input = {
        constructor: 1,
        hasOwnProperty: 2,
        toString: 3,
        type: 'string',
      }
      expect(convertSchema(input)).toEqual(input)
    })
  })

  describe('robustness', () => {
    it('never mutates the input schema', () => {
      const input: OpenAPIV3_1.SchemaObject = {
        $ref: '#/c/s',
        allOf: [{ type: 'string' }],
        const: null,
        examples: ['a'],
        exclusiveMinimum: 5,
        minimum: 3,
        prefixItems: [{ type: 'string' }],
        properties: { a: { type: ['string', 'null'] } },
        type: ['object', 'null'],
      }
      const before = structuredClone(input)
      downgradeSchemaV31ToV30(input)
      expect(input).toEqual(before)
    })

    it('converts deeply nested schemas without throwing', () => {
      let deep: OpenAPIV3_1.SchemaObject = { type: 'string' }
      for (let index = 0; index < 1000; index += 1) {
        deep = { items: deep, type: 'array' }
      }
      expect(() => downgradeSchemaV31ToV30(deep)).not.toThrow()
    })

    it('keeps nested multi-type arrays linear instead of doubling per level', () => {
      let input: OpenAPIV3_1.SchemaObject = { type: 'string' }
      let expected: unknown = { type: 'string' }
      for (let index = 0; index < 10; index += 1) {
        input = { items: input, type: ['array', 'object'] }
        expected = { anyOf: [{ items: expected, type: 'array' }, { type: 'object' }] }
      }
      expect(convertSchema(input)).toEqual(expected)
    })

    it('converts a dereferenced cyclic schema, pointing the cycle at the converted ancestor', () => {
      const properties: Record<string, unknown> = {}
      const node: Record<string, unknown> = {
        properties,
        type: ['object', 'null'],
      }
      properties.self = node
      properties.children = { items: node, type: 'array' }
      const result = convertSchema(node) as Record<string, unknown>
      expect(result.type).toBe('object')
      expect(result.nullable).toBe(true)
      expect(dig(result, 'properties', 'self')).toBe(result)
      expect(dig(result, 'properties', 'children', 'items')).toBe(result)
      expect(node.type).toEqual(['object', 'null'])
    })

    it('converts a dereferenced schema reached along many paths once', () => {
      let node: OpenAPIV3_1.SchemaObject = { type: ['string', 'null'] }
      for (let index = 0; index < 64; index += 1) {
        node = { properties: { left: node, right: node }, type: 'object' }
      }
      const result = convertSchema(node)
      expect(dig(result, 'properties', 'left')).toBe(dig(result, 'properties', 'right'))
      let leaf = result
      for (let index = 0; index < 64; index += 1) {
        leaf = dig(leaf, 'properties', 'left')
      }
      expect(leaf).toEqual({ nullable: true, type: 'string' })
    })

    it('points the array variant of a cyclic multi-type schema at the converted schema', () => {
      const node: Record<string, unknown> = { type: ['array', 'object'] }
      node.items = node
      const result = convertSchema(node) as Record<string, unknown>
      expect(result).not.toHaveProperty('items')
      expect(dig(result, 'anyOf', '0', 'items')).toBe(result)
      expect(dig(result, 'anyOf', '1')).toEqual({ type: 'object' })
      expect(node.items).toBe(node)
    })
  })
})
