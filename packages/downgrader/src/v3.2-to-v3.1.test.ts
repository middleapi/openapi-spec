import type { OpenAPIV3_2 } from '@openapi-spec/types'

import { dig } from '../tests/helpers'
import { downgradeSchemaV32ToV31, downgradeSpecV32ToV31 } from './v3.2-to-v3.1'

function convertSpec(fields: Record<string, unknown>) {
  return downgradeSpecV32ToV31({ openapi: '3.2.0', ...fields } as any)
}

function convertPathItem(pathItem: unknown, components: Record<string, unknown> = {}): unknown {
  return dig(convertSpec({ components, paths: { '/a': pathItem } }), 'paths', '/a')
}

function convertComponent(kind: string, value: unknown, components: Record<string, unknown> = {}): unknown {
  return dig(
    convertSpec({ components: { ...components, [kind]: { X: value } } }),
    'components',
    kind,
    'X',
  )
}

function convertContent(content: unknown, components: Record<string, unknown> = {}): unknown {
  return dig(
    convertPathItem(
      { post: { requestBody: { content }, responses: {} } },
      components,
    ),
    'post',
    'requestBody',
    'content',
  )
}

describe('downgradeSpecV32ToV31', () => {
  describe('document', () => {
    it('rewrites the openapi field to 3.1.2', () => {
      expect(
        downgradeSpecV32ToV31({
          info: { title: 't', version: '1.0.0' },
          openapi: '3.2.0',
        }),
      ).toEqual({
        info: { title: 't', version: '1.0.0' },
        openapi: '3.1.2',
      })
    })

    it('adds openapi: 3.1.2 when the input has no openapi field', () => {
      expect(downgradeSpecV32ToV31({} as any)).toEqual({ openapi: '3.1.2' })
    })

    it('removes $self', () => {
      expect(convertSpec({ $self: 'https://example.com/api.json' })).toEqual({
        openapi: '3.1.2',
      })
    })

    it.each([
      [
        'rewrites the dated 3.2 OAS dialect to the 3.1 base dialect',
        'https://spec.openapis.org/oas/3.2/dialect/2025-09-17',
        'https://spec.openapis.org/oas/3.1/dialect/base',
      ],
      [
        'rewrites a draft 3.2 OAS dialect to the 3.1 base dialect',
        'https://spec.openapis.org/oas/3.2/dialect/WORK-IN-PROGRESS',
        'https://spec.openapis.org/oas/3.1/dialect/base',
      ],
      [
        'keeps a 3.1 OAS dialect',
        'https://spec.openapis.org/oas/3.1/dialect/base',
        'https://spec.openapis.org/oas/3.1/dialect/base',
      ],
      [
        'keeps a custom dialect',
        'https://example.com/my-dialect',
        'https://example.com/my-dialect',
      ],
      ['clones a malformed dialect through', { junk: true }, { junk: true }],
    ])('%s', (_name, dialect, expected) => {
      expect(convertSpec({ jsonSchemaDialect: dialect })).toEqual({
        jsonSchemaDialect: expected,
        openapi: '3.1.2',
      })
    })

    it('returns non-object input unchanged', () => {
      expect(downgradeSpecV32ToV31(null as any)).toBeNull()
      expect(downgradeSpecV32ToV31('junk' as any)).toBe('junk')
      expect(downgradeSpecV32ToV31([1, 2] as any)).toEqual([1, 2])
    })

    it('preserves x- keys and unknown keys at the document, path item, and operation levels', () => {
      const fields = {
        'futureKey': { anything: [1] },
        'info': { title: 't', version: '1' },
        'jsonSchemaDialect': 'https://spec.openapis.org/oas/3.1/dialect/base',
        'paths': {
          '/a': {
            'get': {
              'operationId': 'getA',
              'responses': {},
              'unknownOperationKey': 1,
              'x-op': true,
            },
            'unknownPathItemKey': 'kept',
            'x-item': [1, 2],
          },
        },
        'security': [{ oauth: ['read'] }],
        'x-root': { deep: { value: 1 } },
      }
      expect(convertSpec(fields)).toEqual({ ...fields, openapi: '3.1.2' })
    })
  })

  describe('servers', () => {
    it('removes server name at the root, path item, operation, and link levels', () => {
      const result = convertSpec({
        components: {
          links: { L: { operationId: 'op', server: { name: 's', url: '/u' } } },
        },
        paths: {
          '/a': {
            get: { responses: {}, servers: [{ name: 's', url: '/u' }] },
            servers: [{ name: 's', url: '/u' }],
          },
        },
        servers: [
          { description: 'd', name: 'prod', url: 'https://example.com' },
        ],
      })
      expect(result).toEqual({
        components: {
          links: { L: { operationId: 'op', server: { url: '/u' } } },
        },
        openapi: '3.1.2',
        paths: {
          '/a': {
            get: { responses: {}, servers: [{ url: '/u' }] },
            servers: [{ url: '/u' }],
          },
        },
        servers: [{ description: 'd', url: 'https://example.com' }],
      })
    })

    it('clones non-array servers and non-object server entries through', () => {
      expect(
        convertSpec({
          paths: { '/a': { servers: 'junk' } },
          servers: [5, null],
        }),
      ).toEqual({
        openapi: '3.1.2',
        paths: { '/a': { servers: 'junk' } },
        servers: [5, null],
      })
    })
  })

  describe('tags', () => {
    it('removes tag summary, parent, and kind and keeps other fields', () => {
      expect(
        convertSpec({
          tags: [
            {
              description: 'd',
              externalDocs: { url: 'https://example.com' },
              kind: 'nav',
              name: 'pets',
              parent: 'animals',
              summary: 'Pets',
            },
            'junk',
            1,
          ],
        }).tags,
      ).toEqual([
        {
          description: 'd',
          externalDocs: { url: 'https://example.com' },
          name: 'pets',
        },
        'junk',
        1,
      ])
    })
  })

  describe('paths and path items', () => {
    it('removes the query operation and additionalOperations whatever their shape', () => {
      expect(
        convertSpec({
          paths: {
            '/a': {
              get: { responses: {} },
              query: { description: 'q', responses: {} },
            },
            '/b': { additionalOperations: { NOTIFY: { description: 'n' } } },
            '/c': { additionalOperations: 'junk' },
            '/d': { additionalOperations: 42, query: 'junk' },
          },
        }).paths,
      ).toEqual({
        '/a': { get: { responses: {} } },
        '/b': {},
        '/c': {},
        '/d': {},
      })
    })

    it('converts only keys starting with a slash and clones the rest', () => {
      expect(
        convertSpec({
          paths: {
            '/a': { query: { description: 'dropped' } },
            'x-meta': { query: { description: 'kept' } },
          },
        }).paths,
      ).toEqual({ '/a': {}, 'x-meta': { query: { description: 'kept' } } })
    })

    it('clones malformed paths, path items, and nested objects through', () => {
      expect(convertSpec({ paths: 'junk' }).paths).toBe('junk')
      const paths = {
        '/a': {
          get: 'junk',
          post: {
            requestBody: {
              content: {
                'application/json': 42,
                'multipart/form-data': {
                  encoding: { field: 'junk' },
                  example: 5,
                },
              },
            },
          },
          put: { requestBody: 42, responses: { 200: 42 } },
        },
      }
      expect(convertSpec({ paths }).paths).toEqual(paths)
    })
  })

  describe('parameters', () => {
    it('removes querystring parameters from operation and path item lists, keeping neighbors and references', () => {
      expect(
        convertPathItem({
          get: {
            parameters: [
              {
                content: { 'application/x-www-form-urlencoded': {} },
                in: 'querystring',
                name: 'q',
              },
              { in: 'query', name: 'keep' },
              { $ref: '#/components/parameters/P' },
            ],
            responses: {},
          },
          parameters: [
            { in: 'querystring', name: 'q' },
            { in: 'path', name: 'id', required: true },
          ],
        }),
      ).toEqual({
        get: {
          parameters: [
            { in: 'query', name: 'keep' },
            { $ref: '#/components/parameters/P' },
          ],
          responses: {},
        },
        parameters: [{ in: 'path', name: 'id', required: true }],
      })
    })

    it('removes querystring entries from components.parameters, keeping neighbors and reference entries', () => {
      expect(
        convertSpec({
          components: {
            parameters: {
              N: { in: 'header', name: 'h' },
              Q: { in: 'querystring', name: 'q' },
              R: { $ref: '#/components/parameters/N' },
            },
          },
        }).components,
      ).toEqual({
        parameters: {
          N: { in: 'header', name: 'h' },
          R: { $ref: '#/components/parameters/N' },
        },
      })
    })

    it('removes references to removed querystring parameters, following alias chains', () => {
      const result = convertSpec({
        components: {
          parameters: {
            Alias: { $ref: '#/components/parameters/Qs' },
            AliasOfAlias: { $ref: '#/components/parameters/Alias' },
            Keep: { in: 'query', name: 'k', schema: {} },
            Qs: {
              content: { 'application/x-www-form-urlencoded': { schema: {} } },
              in: 'querystring',
              name: 'filter',
            },
          },
        },
        paths: {
          '/a': {
            get: {
              parameters: [
                { $ref: '#/components/parameters/AliasOfAlias' },
                { $ref: '#/components/parameters/Qs' },
                { $ref: '#/components/parameters/Keep' },
              ],
              responses: {},
            },
            parameters: [{ $ref: '#/components/parameters/Qs' }],
          },
        },
      })
      expect(result.components).toEqual({
        parameters: { Keep: { in: 'query', name: 'k', schema: {} } },
      })
      expect(result.paths).toEqual({
        '/a': {
          get: {
            parameters: [{ $ref: '#/components/parameters/Keep' }],
            responses: {},
          },
          parameters: [],
        },
      })
    })

    it.each([
      [
        'removes style: cookie and keeps the other fields',
        { in: 'cookie', name: 'c', style: 'cookie' },
        { in: 'cookie', name: 'c' },
      ],
      [
        'keeps other style values',
        { in: 'query', name: 'q', style: 'deepObject' },
        { in: 'query', name: 'q', style: 'deepObject' },
      ],
      [
        'keeps allowReserved on query parameters',
        { allowReserved: true, in: 'query', name: 'q', schema: {} },
        { allowReserved: true, in: 'query', name: 'q', schema: {} },
      ],
      [
        'removes allowReserved on path parameters',
        {
          allowReserved: true,
          in: 'path',
          name: 'id',
          required: true,
          schema: {},
        },
        { in: 'path', name: 'id', required: true, schema: {} },
      ],
      [
        'removes allowReserved on cookie parameters',
        { allowReserved: true, in: 'cookie', name: 'c', schema: {} },
        { in: 'cookie', name: 'c', schema: {} },
      ],
      [
        'keeps allowReserved on objects without an in field',
        { allowReserved: true, schema: {} },
        { allowReserved: true, schema: {} },
      ],
      [
        'keeps parameter schemas verbatim and converts example maps',
        {
          examples: {
            inline: { dataValue: 1 },
            referenced: { $ref: '#/components/examples/E' },
          },
          in: 'query',
          name: 'q',
          schema: { type: 'string', xml: { nodeType: 'attribute' } },
        },
        {
          examples: {
            inline: { value: 1 },
            referenced: { $ref: '#/components/examples/E' },
          },
          in: 'query',
          name: 'q',
          schema: { type: 'string', xml: { nodeType: 'attribute' } },
        },
      ],
    ])('%s', (_name, input, expected) => {
      expect(convertComponent('parameters', input)).toEqual(expected)
    })

    it('clones non-object parameter entries, non-array lists, and a malformed components map through', () => {
      expect(convertPathItem({ parameters: [null, 'junk'] })).toEqual({
        parameters: [null, 'junk'],
      })
      expect(convertPathItem({ parameters: 'junk' })).toEqual({
        parameters: 'junk',
      })
      expect(
        convertSpec({ components: { parameters: 'junk' } }).components,
      ).toEqual({
        parameters: 'junk',
      })
    })
  })

  describe('components.mediaTypes inlining', () => {
    it('inlines a media type reference with the converted media type', () => {
      expect(
        convertContent(
          { 'application/jsonl': { $ref: '#/components/mediaTypes/Stream' } },
          { mediaTypes: { Stream: { itemSchema: { type: 'object' } } } },
        ),
      ).toEqual({
        'application/jsonl': {
          schema: { items: { type: 'object' }, type: 'array' },
        },
      })
    })

    it('inlines media type references in response, parameter, and header content maps', () => {
      const reference = {
        'application/json': { $ref: '#/components/mediaTypes/Json' },
      }
      const inlined = { 'application/json': { schema: { type: 'string' } } }
      expect(
        convertPathItem(
          {
            get: {
              parameters: [{ content: reference, in: 'query', name: 'q' }],
              responses: {
                200: {
                  content: reference,
                  description: 'ok',
                  headers: { 'X-H': { content: reference } },
                },
              },
            },
          },
          { mediaTypes: { Json: { schema: { type: 'string' } } } },
        ),
      ).toEqual({
        get: {
          parameters: [{ content: inlined, in: 'query', name: 'q' }],
          responses: {
            200: {
              content: inlined,
              description: 'ok',
              headers: { 'X-H': { content: inlined } },
            },
          },
        },
      })
    })

    it('resolves chained media type references down to the final object', () => {
      expect(
        convertContent(
          { 'application/json': { $ref: '#/components/mediaTypes/A' } },
          {
            mediaTypes: {
              A: { $ref: '#/components/mediaTypes/B' },
              B: { schema: { type: 'number' } },
            },
          },
        ),
      ).toEqual({ 'application/json': { schema: { type: 'number' } } })
    })

    it('resolves long acyclic reference chains', () => {
      const links = Array.from({ length: 40 }, (_unused, index) => [
        `m${index}`,
        { $ref: `#/components/mediaTypes/m${index + 1}` },
      ])
      const mediaTypes = Object.fromEntries([
        ...links,
        ['m40', { schema: { type: 'string' } }],
      ])
      expect(
        convertContent(
          { 'application/json': { $ref: '#/components/mediaTypes/m0' } },
          { mediaTypes },
        ),
      ).toEqual({ 'application/json': { schema: { type: 'string' } } })
    })

    it('removes content entries whose reference chain is cyclic', () => {
      expect(
        convertContent(
          {
            'application/json': { $ref: '#/components/mediaTypes/Loop' },
            'application/xml': { $ref: '#/components/mediaTypes/Ping' },
          },
          {
            mediaTypes: {
              Loop: { $ref: '#/components/mediaTypes/Loop' },
              Ping: { $ref: '#/components/mediaTypes/Pong' },
              Pong: { $ref: '#/components/mediaTypes/Ping' },
            },
          },
        ),
      ).toEqual({})
    })

    it('removes content entries with external, unknown, and unparseable references', () => {
      expect(
        convertContent(
          {
            'a/1': { $ref: '#/components/schemas/Foo' },
            'a/2': { $ref: '#/components/mediaTypes/nested/name' },
            'a/3': { $ref: '#/components/mediaTypes/' },
            'a/4': { $ref: 'https://example.com/other.json#/mediaTypes/A' },
            'a/5': { $ref: '#/components/mediaTypes/Unknown' },
            'a/6': { $ref: '#/components/mediaTypes/Known' },
          },
          { mediaTypes: { Known: { example: 1 } } },
        ),
      ).toEqual({ 'a/6': { example: 1 } })
    })

    it('inlines content-map references to any local media type, decoding escaped names', () => {
      expect(
        convertSpec({
          components: {
            mediaTypes: { 'a/b': { schema: { type: 'string' } } },
            requestBodies: {
              Json: { content: { 'application/json': { schema: { type: 'number' } } } },
              Reuse: {
                content: {
                  'application/json': {
                    $ref: '#/components/requestBodies/Json/content/application~1json',
                  },
                  'text/plain': { $ref: '#/components/mediaTypes/a~1b' },
                },
              },
            },
          },
        }).components?.requestBodies,
      ).toEqual({
        Json: { content: { 'application/json': { schema: { type: 'number' } } } },
        Reuse: {
          content: {
            'application/json': { schema: { type: 'number' } },
            'text/plain': { schema: { type: 'string' } },
          },
        },
      })
    })

    it('does not resolve names through the prototype chain of the mediaTypes map', () => {
      expect(
        convertContent(
          {
            'application/json': {
              $ref: '#/components/mediaTypes/hasOwnProperty',
            },
          },
          { mediaTypes: {} },
        ),
      ).toEqual({})
    })

    it('removes media type references when components.mediaTypes is missing or malformed', () => {
      const content = {
        'application/json': { $ref: '#/components/mediaTypes/A' },
      }
      expect(
        convertSpec({
          paths: {
            '/a': { post: { requestBody: { content }, responses: {} } },
          },
        }),
      ).toEqual({
        openapi: '3.1.2',
        paths: {
          '/a': { post: { requestBody: { content: {} }, responses: {} } },
        },
      })
      expect(convertContent(content, { mediaTypes: 'junk' })).toEqual({})
    })

    it('removes the mediaTypes map from components', () => {
      expect(
        convertSpec({
          components: {
            mediaTypes: { Json: { schema: {} } },
            schemas: { S: { type: 'string' } },
          },
        }).components,
      ).toEqual({ schemas: { S: { type: 'string' } } })
    })

    it('clones a non-object content value through', () => {
      expect(convertContent('junk')).toBe('junk')
    })

    describe('parameters and headers losing their entire content', () => {
      const missing = {
        'application/json': { $ref: '#/components/mediaTypes/Missing' },
      }

      it('removes a parameter whose only content entry could not be inlined', () => {
        expect(
          convertPathItem({
            get: {
              parameters: [
                { content: missing, in: 'query', name: 'q' },
                { in: 'query', name: 'keep', schema: {} },
              ],
              responses: {},
            },
          }),
        ).toEqual({
          get: {
            parameters: [{ in: 'query', name: 'keep', schema: {} }],
            responses: {},
          },
        })
      })

      it('keeps a parameter when part of its content could be inlined', () => {
        expect(
          convertPathItem(
            {
              get: {
                parameters: [
                  {
                    content: {
                      ...missing,
                      'application/xml': {
                        $ref: '#/components/mediaTypes/Known',
                      },
                    },
                    in: 'query',
                    name: 'q',
                  },
                ],
                responses: {},
              },
            },
            { mediaTypes: { Known: { example: 1 } } },
          ),
        ).toEqual({
          get: {
            parameters: [
              {
                content: { 'application/xml': { example: 1 } },
                in: 'query',
                name: 'q',
              },
            ],
            responses: {},
          },
        })
      })

      it('removes headers and component parameters whose entire content could not be inlined', () => {
        const result = convertSpec({
          components: {
            headers: { Broken: { content: missing }, Keep: { schema: {} } },
            parameters: {
              Broken: { content: missing, in: 'query', name: 'q' },
            },
          },
          paths: {
            '/a': {
              get: {
                responses: {
                  200: {
                    description: 'ok',
                    headers: {
                      'X-Broken': { content: missing },
                      'X-Keep': { schema: {} },
                    },
                  },
                },
              },
            },
          },
        })
        expect(result.components).toEqual({
          headers: { Keep: { schema: {} } },
          parameters: {},
        })
        expect(result.paths).toEqual({
          '/a': {
            get: {
              responses: {
                200: {
                  description: 'ok',
                  headers: { 'X-Keep': { schema: {} } },
                },
              },
            },
          },
        })
      })

      it('removes references to removed parameters and headers, following alias chains', () => {
        const result = convertSpec({
          components: {
            headers: {
              Broken: {
                content: {
                  'text/plain': { $ref: '#/components/mediaTypes/Loop' },
                },
              },
              BrokenAlias: { $ref: '#/components/headers/Broken' },
            },
            mediaTypes: { Loop: { $ref: '#/components/mediaTypes/Loop' } },
            parameters: {
              Broken: { content: missing, in: 'query', name: 'q' },
              BrokenAlias: { $ref: '#/components/parameters/Broken' },
            },
          },
          paths: {
            '/a': {
              get: {
                parameters: [
                  { $ref: '#/components/parameters/Broken' },
                  { $ref: '#/components/parameters/BrokenAlias' },
                ],
                responses: {
                  200: {
                    description: 'ok',
                    headers: {
                      'X-Broken': { $ref: '#/components/headers/Broken' },
                      'X-BrokenAlias': {
                        $ref: '#/components/headers/BrokenAlias',
                      },
                    },
                  },
                },
              },
            },
          },
        })
        expect(result.components).toEqual({ headers: {}, parameters: {} })
        expect(result.paths).toEqual({
          '/a': {
            get: {
              parameters: [],
              responses: { 200: { description: 'ok', headers: {} } },
            },
          },
        })
      })
    })
  })

  describe('media types', () => {
    it('turns itemSchema into a deep-cloned array schema when no schema exists', () => {
      const itemSchema = { type: 'object', xml: { nodeType: 'text' } }
      const result = convertContent({ 'application/jsonl': { itemSchema } })
      expect(result).toEqual({
        'application/jsonl': {
          schema: {
            items: { type: 'object', xml: { nodeType: 'text' } },
            type: 'array',
          },
        },
      })
      const promoted = dig(result, 'application/jsonl', 'schema', 'items')
      expect(promoted).not.toBe(itemSchema)
      expect(dig(promoted, 'xml')).not.toBe(itemSchema.xml)
    })

    it.each([
      [
        'removes itemSchema when a schema already exists',
        { itemSchema: { type: 'string' }, schema: { type: 'array' } },
        { schema: { type: 'array' } },
      ],
      [
        'removes prefixEncoding and itemEncoding',
        {
          example: 1,
          itemEncoding: { contentType: 'text/plain' },
          prefixEncoding: [{ contentType: 'application/json' }],
        },
        { example: 1 },
      ],
      [
        'removes the 3.2-only description and keeps other fields',
        {
          description: 'a JSON payload',
          example: 5,
          schema: { type: 'integer' },
        },
        { example: 5, schema: { type: 'integer' } },
      ],
      [
        'converts example maps',
        {
          examples: {
            inline: { serializedValue: 'raw' },
            referenced: { $ref: '#/components/examples/E' },
          },
        },
        {
          examples: {
            inline: { value: 'raw' },
            referenced: { $ref: '#/components/examples/E' },
          },
        },
      ],
    ])('%s', (_name, mediaType, expected) => {
      expect(convertContent({ 'application/json': mediaType })).toEqual({
        'application/json': expected,
      })
    })

    it('removes nested and positional encoding inside encoding objects while still converting headers', () => {
      expect(
        convertContent({
          'multipart/form-data': {
            encoding: {
              part: {
                contentType: 'application/json',
                encoding: {
                  inner: { headers: { 'X-C': { style: 'cookie' } } },
                },
                headers: {
                  'Referenced': { $ref: '#/components/headers/H' },
                  'X-H': { description: 'h', style: 'cookie' },
                },
                itemEncoding: { contentType: 'text/plain' },
                prefixEncoding: [{ contentType: 'text/csv' }],
              },
            },
          },
        }),
      ).toEqual({
        'multipart/form-data': {
          encoding: {
            part: {
              contentType: 'application/json',
              headers: {
                'Referenced': { $ref: '#/components/headers/H' },
                'X-H': { description: 'h' },
              },
            },
          },
        },
      })
    })
  })

  describe('responses', () => {
    it.each([
      [
        'uses summary as the description when none exists',
        { summary: 'ok' },
        { description: 'ok' },
      ],
      [
        'removes summary when a description exists',
        { description: 'd', summary: 's' },
        { description: 'd' },
      ],
      [
        'synthesizes an empty description when neither summary nor description exist',
        {},
        { description: '' },
      ],
      [
        'synthesizes an empty description instead of promoting a malformed summary',
        { summary: 42 },
        { description: '' },
      ],
      [
        'clones a non-object headers value through',
        { description: 'ok', headers: 'junk' },
        { description: 'ok', headers: 'junk' },
      ],
      [
        'leaves response reference objects untouched, including summary and description overrides',
        {
          $ref: '#/components/responses/R',
          description: 'override',
          summary: 'kept',
        },
        {
          $ref: '#/components/responses/R',
          description: 'override',
          summary: 'kept',
        },
      ],
    ])('%s', (_name, response, expected) => {
      expect(convertComponent('responses', response)).toEqual(expected)
    })

    it('clones x- keys of the responses map without response conversion', () => {
      expect(
        convertPathItem({
          get: {
            responses: {
              '200': { summary: 'ok' },
              'x-note': { summary: 'not a response' },
            },
          },
        }),
      ).toEqual({
        get: {
          responses: {
            '200': { description: 'ok' },
            'x-note': { summary: 'not a response' },
          },
        },
      })
    })

    it('converts response headers, content, and links', () => {
      expect(
        convertComponent('responses', {
          content: { 'application/json': { itemSchema: { type: 'string' } } },
          description: 'ok',
          headers: { 'X-H': { style: 'cookie' } },
          links: {
            inline: { server: { name: 's', url: '/u' } },
            referenced: { $ref: '#/components/links/L' },
          },
        }),
      ).toEqual({
        content: {
          'application/json': {
            schema: { items: { type: 'string' }, type: 'array' },
          },
        },
        description: 'ok',
        headers: { 'X-H': {} },
        links: {
          inline: { server: { url: '/u' } },
          referenced: { $ref: '#/components/links/L' },
        },
      })
    })
  })

  describe('examples', () => {
    it.each([
      [
        'moves dataValue into the free value slot',
        { dataValue: { a: 1 } },
        { value: { a: 1 } },
      ],
      [
        'moves serializedValue into the free value slot',
        { serializedValue: 'a=1' },
        { value: 'a=1' },
      ],
      [
        'removes dataValue when value already exists',
        { dataValue: 1, value: 2 },
        { value: 2 },
      ],
      [
        'removes serializedValue when value already exists',
        { serializedValue: 's', value: 2 },
        { value: 2 },
      ],
      [
        'removes dataValue and serializedValue when externalValue exists',
        {
          dataValue: 1,
          externalValue: 'https://example.com/e.json',
          serializedValue: 's',
        },
        { externalValue: 'https://example.com/e.json' },
      ],
      [
        'lets dataValue win the value slot over serializedValue',
        { dataValue: 1, serializedValue: 's' },
        { value: 1 },
      ],
      [
        'keeps other example fields untouched',
        { dataValue: 1, description: 'd', summary: 's' },
        { description: 'd', summary: 's', value: 1 },
      ],
      [
        'leaves an example without any value fields unchanged',
        { summary: 's' },
        { summary: 's' },
      ],
      ['clones a malformed example through', 42, 42],
    ])('%s', (_name, example, expected) => {
      expect(convertComponent('examples', example)).toEqual(expected)
    })
  })

  describe('security schemes', () => {
    const flow = {
      authorizationUrl: 'https://example.com/auth',
      scopes: {},
      tokenUrl: 'https://example.com/token',
    }

    it.each([
      [
        'removes deprecated: true',
        { deprecated: true, type: 'http' },
        { type: 'http' },
      ],
      [
        'removes deprecated: false',
        { deprecated: false, type: 'http' },
        { type: 'http' },
      ],
      [
        'removes a malformed deprecated',
        { deprecated: 'yes', type: 'http' },
        { type: 'http' },
      ],
      [
        'removes oauth2MetadataUrl',
        { oauth2MetadataUrl: 'https://example.com/meta', type: 'oauth2' },
        { type: 'oauth2' },
      ],
      [
        'removes a malformed oauth2MetadataUrl',
        { oauth2MetadataUrl: 42, type: 'oauth2' },
        { type: 'oauth2' },
      ],
      [
        'removes the deviceAuthorization flow and keeps other flows',
        {
          flows: {
            authorizationCode: flow,
            deviceAuthorization: {
              deviceAuthorizationUrl: 'https://example.com/device',
              scopes: {},
              tokenUrl: flow.tokenUrl,
            },
          },
          type: 'oauth2',
        },
        { flows: { authorizationCode: flow }, type: 'oauth2' },
      ],
      [
        'removes a malformed deviceAuthorization',
        { flows: { deviceAuthorization: 'junk' }, type: 'oauth2' },
        { flows: {}, type: 'oauth2' },
      ],
      [
        'clones malformed flows through',
        { flows: 'junk', type: 'oauth2' },
        { flows: 'junk', type: 'oauth2' },
      ],
      [
        'clones references through',
        { $ref: '#/components/securitySchemes/Other' },
        { $ref: '#/components/securitySchemes/Other' },
      ],
      ['passes a non-object security scheme through', 'junk', 'junk'],
    ])('%s', (_name, scheme, expected) => {
      expect(convertComponent('securitySchemes', scheme)).toEqual(expected)
    })
  })

  describe('webhooks and components.pathItems', () => {
    it('converts webhook path items and removes their query operation', () => {
      expect(
        convertSpec({
          webhooks: {
            newPet: {
              post: { responses: { 200: { summary: 'ok' } } },
              query: { description: 'q' },
            },
          },
        }).webhooks,
      ).toEqual({
        newPet: { post: { responses: { 200: { description: 'ok' } } } },
      })
    })

    it('converts components.pathItems path items and removes their query operation', () => {
      expect(
        convertComponent('pathItems', {
          get: { responses: {} },
          query: { description: 'q' },
        }),
      ).toEqual({ get: { responses: {} } })
    })
  })

  describe('callbacks', () => {
    it('converts path items in operation-level callbacks and clones x- keys', () => {
      expect(
        convertPathItem({
          post: {
            callbacks: {
              onEvent: {
                'x-note': { query: { description: 'kept' } },
                '{$request.body#/url}': {
                  post: { responses: { 200: { summary: 'ok' } } },
                  query: { description: 'q' },
                },
              },
              referenced: { $ref: '#/components/callbacks/C' },
            },
            responses: {},
          },
        }),
      ).toEqual({
        post: {
          callbacks: {
            onEvent: {
              'x-note': { query: { description: 'kept' } },
              '{$request.body#/url}': {
                post: { responses: { 200: { description: 'ok' } } },
              },
            },
            referenced: { $ref: '#/components/callbacks/C' },
          },
          responses: {},
        },
      })
    })

    it('converts components.callbacks, handling both references and inline callbacks', () => {
      expect(
        convertSpec({
          components: {
            callbacks: {
              inline: {
                'https://example.com/cb': {
                  post: { responses: { 200: { summary: 'ok' } } },
                  query: { description: 'q' },
                },
              },
              referenced: { $ref: '#/components/callbacks/inline' },
            },
          },
        }).components,
      ).toEqual({
        callbacks: {
          inline: {
            'https://example.com/cb': {
              post: { responses: { 200: { description: 'ok' } } },
            },
          },
          referenced: { $ref: '#/components/callbacks/inline' },
        },
      })
    })
  })

  describe('components', () => {
    it('handles references and inline objects across component maps', () => {
      expect(
        convertSpec({
          components: {
            examples: {
              E: { dataValue: 1 },
              ERef: { $ref: '#/components/examples/E' },
            },
            headers: {
              H: { style: 'cookie' },
              HRef: { $ref: '#/components/headers/H' },
            },
            links: { junkLink: 42 },
            parameters: {
              P: { in: 'querystring', name: 'q' },
              PRef: { $ref: '#/components/parameters/P' },
            },
            requestBodies: {
              B: {
                content: {
                  'application/json': { itemSchema: { type: 'string' } },
                },
              },
              BRef: { $ref: '#/components/requestBodies/B' },
            },
            responses: {
              R: { summary: 'ok' },
              RRef: { $ref: '#/components/responses/R' },
            },
          },
        }).components,
      ).toEqual({
        examples: {
          E: { value: 1 },
          ERef: { $ref: '#/components/examples/E' },
        },
        headers: { H: {}, HRef: { $ref: '#/components/headers/H' } },
        links: { junkLink: 42 },
        parameters: {},
        requestBodies: {
          B: {
            content: {
              'application/json': {
                schema: { items: { type: 'string' }, type: 'array' },
              },
            },
          },
          BRef: { $ref: '#/components/requestBodies/B' },
        },
        responses: {
          R: { description: 'ok' },
          RRef: { $ref: '#/components/responses/R' },
        },
      })
    })

    it('clones components.schemas entries unchanged, keeping 3.2 OAS vocabulary fields', () => {
      const schema = {
        discriminator: { defaultMapping: 'Dog', propertyName: 'kind' },
        xml: { nodeType: 'attribute' },
      }
      expect(convertComponent('schemas', schema)).toEqual(schema)
    })

    it('clones unknown component keys and passes non-object components through', () => {
      expect(
        convertSpec({ components: { custom: { anything: true } } }).components,
      ).toEqual({
        custom: { anything: true },
      })
      expect(convertSpec({ components: 'junk' }).components).toBe('junk')
    })
  })

  describe('references into removed parts', () => {
    const petRef = { $ref: '#/components/mediaTypes/Pet/schema' }
    const pet = { type: 'object', xml: { nodeType: 'element' } }

    it('inlines schema $refs at every subschema position', () => {
      const everyPosition = (schema: unknown) => ({
        $defs: { d: schema },
        additionalProperties: schema,
        allOf: [schema],
        anyOf: [schema],
        contains: schema,
        contentSchema: schema,
        dependentSchemas: { d: schema },
        else: schema,
        if: schema,
        items: schema,
        not: schema,
        oneOf: [schema],
        patternProperties: { '^x': schema },
        prefixItems: [schema],
        properties: { p: schema },
        propertyNames: schema,
        then: schema,
        unevaluatedItems: schema,
        unevaluatedProperties: schema,
      })
      expect(
        convertComponent('schemas', everyPosition(petRef), {
          mediaTypes: { Pet: { schema: pet } },
        }),
      ).toEqual(everyPosition(pet))
    })

    it('inlines schema $refs in parameter, header, media type, and itemSchema positions', () => {
      expect(
        convertSpec({
          components: {
            headers: { H: { schema: petRef } },
            mediaTypes: { Pet: { schema: pet } },
            parameters: { P: { in: 'query', name: 'p', schema: petRef } },
            requestBodies: {
              B: {
                content: {
                  'application/json': { schema: petRef },
                  'application/jsonl': { itemSchema: petRef },
                },
              },
            },
          },
        }).components,
      ).toEqual({
        headers: { H: { schema: pet } },
        parameters: { P: { in: 'query', name: 'p', schema: pet } },
        requestBodies: {
          B: {
            content: {
              'application/json': { schema: pet },
              'application/jsonl': { schema: { items: pet, type: 'array' } },
            },
          },
        },
      })
    })

    it('keeps data keywords, extensions, and non-string $ref values verbatim', () => {
      const schema = {
        'const': petRef,
        'default': petRef,
        'enum': [petRef],
        'examples': [petRef],
        'properties': { p: { $ref: 42 } },
        'x-data': petRef,
      }
      expect(
        convertSpec({
          components: {
            headers: { H: { schema: petRef } },
            mediaTypes: { Pet: { schema: pet } },
            schemas: { S: schema },
          },
        }).components,
      ).toEqual({ headers: { H: { schema: pet } }, schemas: { S: schema } })
    })

    it.each([
      [
        'adds allOf beside sibling annotations',
        { $ref: petRef.$ref, description: 'd' },
        { allOf: [pet], description: 'd' },
      ],
      [
        'appends to an existing allOf, keeping its indices',
        { $ref: petRef.$ref, allOf: [{ required: ['a'] }] },
        { allOf: [{ required: ['a'] }, pet] },
      ],
      [
        'nests the siblings when allOf is malformed',
        { $ref: petRef.$ref, allOf: 'junk' },
        { allOf: [{ allOf: 'junk' }, pet] },
      ],
    ])('merges a dangling schema $ref with its siblings: %s', (_name, schema, expected) => {
      expect(
        convertComponent('schemas', schema, { mediaTypes: { Pet: { schema: pet } } }),
      ).toEqual(expected)
    })

    it('inlines a boolean target schema', () => {
      expect(
        convertComponent('schemas', { $ref: '#/components/mediaTypes/None/schema' }, {
          mediaTypes: { None: { schema: false } },
        }),
      ).toBe(false)
    })

    it('inlines Reference Objects into query, additionalOperations, and components.mediaTypes, converting each target', () => {
      const result = convertSpec({
        components: {
          callbacks: { C: { $ref: '#/paths/~1search/query/callbacks/onDone' } },
          examples: { E: { $ref: '#/components/mediaTypes/Pet/examples/e' } },
          headers: {
            H: { $ref: '#/components/mediaTypes/Pet/encoding/file/headers/X-Rate' },
          },
          links: { L: { $ref: '#/paths/~1search/query/responses/200/links/next' } },
          mediaTypes: {
            Pet: {
              encoding: {
                file: {
                  headers: {
                    'X-Rate': { examples: { a: { serializedValue: '1' } } },
                  },
                },
              },
              examples: { e: { dataValue: 1 } },
            },
          },
        },
        paths: {
          '/search': {
            additionalOperations: {
              COPY: { responses: { 201: { summary: 'Copied' } } },
            },
            post: {
              parameters: [{ $ref: '#/paths/~1search/query/parameters/0' }],
              requestBody: { $ref: '#/paths/~1search/query/requestBody' },
              responses: {
                200: { $ref: '#/paths/~1search/query/responses/200' },
                201: {
                  $ref: '#/paths/~1search/additionalOperations/COPY/responses/201',
                },
              },
            },
            query: {
              callbacks: {
                onDone: {
                  '{$request.body#/url}': {
                    post: { responses: { 200: { summary: 'ack' } } },
                  },
                },
              },
              parameters: [{ in: 'cookie', name: 'c', style: 'cookie' }],
              requestBody: {
                content: { 'application/jsonl': { itemSchema: { type: 'string' } } },
              },
              responses: {
                200: {
                  links: { next: { operationId: 'x', server: { name: 'n', url: '/' } } },
                  summary: 'Found',
                },
              },
            },
          },
        },
      })
      expect(result.components).toEqual({
        callbacks: {
          C: {
            '{$request.body#/url}': {
              post: { responses: { 200: { description: 'ack' } } },
            },
          },
        },
        examples: { E: { value: 1 } },
        headers: { H: { examples: { a: { value: '1' } } } },
        links: { L: { operationId: 'x', server: { url: '/' } } },
      })
      expect(result.paths).toEqual({
        '/search': {
          post: {
            parameters: [{ in: 'cookie', name: 'c' }],
            requestBody: {
              content: {
                'application/jsonl': {
                  schema: { items: { type: 'string' }, type: 'array' },
                },
              },
            },
            responses: {
              200: {
                description: 'Found',
                links: { next: { operationId: 'x', server: { url: '/' } } },
              },
              201: { description: 'Copied' },
            },
          },
        },
      })
    })

    it('follows reference chains through removed parts and keeps references that reach surviving ones', () => {
      const result = convertSpec({
        components: {
          responses: {
            Deep: { $ref: '#/paths/~1a/query/responses/200' },
            Kept: { $ref: '#/paths/~1a/query/responses/201' },
            Real: { description: 'real' },
          },
        },
        paths: {
          '/a': {
            query: {
              responses: {
                200: { $ref: '#/paths/~1b/query/responses/200' },
                201: { $ref: '#/components/responses/Real' },
              },
            },
          },
          '/b': { query: { responses: { 200: { summary: 'deep' } } } },
        },
      })
      expect(result.components).toEqual({
        responses: {
          Deep: { description: 'deep' },
          Kept: { $ref: '#/components/responses/Real' },
          Real: { description: 'real' },
        },
      })
      expect(result.paths).toEqual({ '/a': {}, '/b': {} })
    })

    it('removes a Reference Object whose inlining cycles', () => {
      expect(
        convertSpec({
          components: {
            responses: {
              Keep: { description: 'k' },
              Loop: { $ref: '#/paths/~1a/query/responses/200' },
            },
          },
          paths: {
            '/a': { query: { responses: { 200: { $ref: '#/paths/~1b/query/responses/200' } } } },
            '/b': { query: { responses: { 200: { $ref: '#/paths/~1a/query/responses/200' } } } },
          },
        }).components,
      ).toEqual({ responses: { Keep: { description: 'k' } } })
    })

    it('cuts a recursive schema at its first repeat by removing only the $ref keyword', () => {
      const tree = {
        properties: {
          children: {
            items: { $ref: '#/components/mediaTypes/Tree/schema' },
            type: 'array',
          },
          parent: { $ref: '#/components/mediaTypes/Tree/schema', description: 'up' },
        },
        type: 'object',
      }
      expect(
        convertComponent('schemas', { $ref: '#/components/mediaTypes/Tree/schema' }, {
          mediaTypes: { Tree: { schema: tree } },
        }),
      ).toEqual({
        properties: {
          children: { items: {}, type: 'array' },
          parent: { description: 'up' },
        },
        type: 'object',
      })
    })

    it('inlines references into a parameter list that lost entries, since its indices shift', () => {
      const result = convertSpec({
        components: {
          parameters: {
            Kept: { $ref: '#/paths/~1b/get/parameters/0' },
            Shifted: { $ref: '#/paths/~1a/get/parameters/1' },
          },
        },
        paths: {
          '/a': {
            get: {
              parameters: [
                { in: 'querystring', name: 'qs' },
                { in: 'query', name: 'b' },
              ],
              responses: {},
            },
          },
          '/b': { get: { parameters: [{ in: 'query', name: 'c' }], responses: {} } },
        },
      })
      expect(result.components).toEqual({
        parameters: {
          Kept: { $ref: '#/paths/~1b/get/parameters/0' },
          Shifted: { in: 'query', name: 'b' },
        },
      })
      expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([
        { in: 'query', name: 'b' },
      ])
    })

    it('removes parameter and header references that resolve to removed ones through any pointer', () => {
      expect(
        convertSpec({
          components: {
            headers: {
              H: { $ref: '#/paths/~1a/get/responses/200/headers/X-Broken' },
            },
            parameters: { P: { $ref: '#/paths/~1a/get/parameters/0' } },
          },
          paths: {
            '/a': {
              get: {
                parameters: [{ in: 'querystring', name: 'qs' }],
                responses: {
                  200: {
                    description: 'ok',
                    headers: {
                      'X-Broken': {
                        content: {
                          'application/json': { $ref: '#/components/mediaTypes/Missing' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }).components,
      ).toEqual({ headers: {}, parameters: {} })
    })

    it('keeps parameter references whose alias chain cycles', () => {
      const parameters = {
        A: { $ref: '#/components/parameters/B' },
        B: { $ref: '#/components/parameters/A' },
      }
      expect(convertSpec({ components: { parameters } }).components).toEqual({
        parameters,
      })
    })

    it('leaves external, anchor, root, unparseable, and already dangling references untouched', () => {
      const schemas = {
        Anchor: { $ref: '#pet' },
        BadEscape: { $ref: '#/components/mediaTypes/%E0%A4%A' },
        External: {
          $ref: 'https://example.com/api.json#/components/mediaTypes/Pet/schema',
        },
        Missing: { $ref: '#/components/mediaTypes/Nope/schema' },
        Root: { $ref: '#' },
      }
      expect(
        convertSpec({
          components: {
            headers: { H: { schema: petRef } },
            mediaTypes: { Pet: { schema: pet } },
            schemas,
          },
        }).components,
      ).toEqual({ headers: { H: { schema: pet } }, schemas })
    })

    it('decodes escaped and percent-encoded pointer tokens', () => {
      expect(
        convertSpec({
          components: {
            mediaTypes: {
              'a/b~c': { schema: { type: 'string' } },
              'My Type': { schema: { type: 'number' } },
            },
            schemas: {
              Escaped: { $ref: '#/components/mediaTypes/a~1b~0c/schema' },
              Percent: { $ref: '#/components/mediaTypes/My%20Type/schema' },
              Templated: {
                $ref: '#/paths/~1pets~1%7Bid%7D/query/requestBody/content/application~1json/schema',
              },
            },
          },
          paths: {
            '/pets/{id}': {
              query: {
                requestBody: {
                  content: { 'application/json': { schema: { type: 'integer' } } },
                },
              },
            },
          },
        }).components,
      ).toEqual({
        schemas: {
          Escaped: { type: 'string' },
          Percent: { type: 'number' },
          Templated: { type: 'integer' },
        },
      })
    })

    it('inlines pointers to an itemSchema that the conversion moves or removes', () => {
      expect(
        convertSpec({
          components: {
            requestBodies: {
              B: {
                content: {
                  'application/json': {
                    itemSchema: { type: 'number' },
                    schema: { type: 'array' },
                  },
                  'application/jsonl': { itemSchema: { type: 'string' } },
                },
              },
            },
            schemas: {
              Moved: {
                $ref: '#/components/requestBodies/B/content/application~1jsonl/itemSchema',
              },
              Removed: {
                $ref: '#/components/requestBodies/B/content/application~1json/itemSchema',
              },
            },
          },
        }).components?.schemas,
      ).toEqual({ Moved: { type: 'string' }, Removed: { type: 'number' } })
    })
  })

  describe('robustness', () => {
    it('never mutates the input document', () => {
      const spec = {
        $self: 'https://example.com/api.json',
        components: {
          examples: { E: { dataValue: 1, serializedValue: 's' } },
          mediaTypes: {
            A: { $ref: '#/components/mediaTypes/B' },
            B: { itemSchema: { xml: { nodeType: 'text' } } },
          },
          pathItems: { P: { query: { description: 'q' } } },
          schemas: {
            R: { $ref: '#/components/mediaTypes/B/itemSchema', description: 'r' },
            S: { discriminator: { defaultMapping: 'Dog' } },
          },
          securitySchemes: { O: { deprecated: true, type: 'oauth2' } },
        },
        openapi: '3.2.0',
        paths: {
          '/a': {
            additionalOperations: { NOTIFY: { description: 'n' } },
            get: {
              parameters: [{ in: 'querystring', name: 'q' }],
              requestBody: {
                content: {
                  'application/json': { $ref: '#/components/mediaTypes/A' },
                },
              },
              responses: { 200: { summary: 'ok' } },
            },
            query: { description: 'q' },
            servers: [{ name: 's', url: '/u' }],
          },
        },
        servers: [{ name: 'root', url: 'https://example.com' }],
        tags: [{ kind: 'nav', name: 't', parent: 'p', summary: 's' }],
        webhooks: { hook: { query: { description: 'wq' } } },
      } as any
      const before = structuredClone(spec)
      downgradeSpecV32ToV31(spec)
      expect(spec).toEqual(before)
    })

    it('converts a path item that cycles through its callbacks, pointing the cycle at the converted path item', () => {
      const callback: Record<string, unknown> = {}
      const pathItem: Record<string, unknown> = {
        get: { callbacks: { cb: callback }, responses: { 200: { summary: 'ok' } } },
        query: { description: 'q' },
      }
      callback.expr = pathItem
      const result = convertPathItem(pathItem)
      expect(result).not.toHaveProperty('query')
      expect(dig(result, 'get', 'responses', '200')).toEqual({ description: 'ok' })
      expect(dig(result, 'get', 'callbacks', 'cb', 'expr')).toBe(result)
    })
  })
})

describe('downgradeSchemaV32ToV31', () => {
  it('deep-clones schemas, preserving discriminator defaultMapping and xml nodeType verbatim', () => {
    const source = {
      discriminator: {
        defaultMapping: 'Dog',
        mapping: { dog: '#/components/schemas/Dog' },
        propertyName: 'kind',
      },
      properties: { a: { xml: { nodeType: 'text' } } },
      type: 'object',
      xml: { nodeType: 'attribute' },
    } satisfies OpenAPIV3_2.SchemaObject
    const result = downgradeSchemaV32ToV31(source)
    expect(result).toEqual(source)
    expect(result).not.toBe(source)
    expect(dig(result, 'discriminator')).not.toBe(source.discriminator)
    expect(dig(result, 'properties')).not.toBe(source.properties)
    expect(dig(result, 'properties', 'a')).not.toBe(source.properties.a)
    expect(dig(result, 'properties', 'a', 'xml')).not.toBe(
      source.properties.a.xml,
    )
    expect(dig(result, 'xml')).not.toBe(source.xml)
  })

  it('clones subschema containers at every level', () => {
    const source = {
      allOf: [{ discriminator: { defaultMapping: 'Dog' } }, true],
      items: { xml: { nodeType: 'cdata' } },
    }
    const result = downgradeSchemaV32ToV31(source as any)
    expect(result).toEqual(source)
    expect(dig(result, 'allOf')).not.toBe(source.allOf)
    expect(dig(result, 'allOf', '0')).not.toBe(source.allOf[0])
    expect(dig(result, 'items')).not.toBe(source.items)
  })

  it('keeps unknown schema keywords, validation keywords, and extensions unchanged', () => {
    const source = {
      'customKeyword': { nested: true },
      'maximum': 5,
      'type': 'number',
      'x-note': 'kept',
    }
    expect(downgradeSchemaV32ToV31(source as any)).toEqual(source)
  })

  it('passes boolean and junk schema input through', () => {
    expect(downgradeSchemaV32ToV31(true)).toBe(true)
    expect(downgradeSchemaV32ToV31(false)).toBe(false)
    expect(downgradeSchemaV32ToV31('junk' as any)).toBe('junk')
    expect(downgradeSchemaV32ToV31(null as any)).toBeNull()
    expect(
      downgradeSchemaV32ToV31({ allOf: 'junk', properties: 5 } as any),
    ).toEqual({
      allOf: 'junk',
      properties: 5,
    })
  })

  it('never mutates the input schema', () => {
    const schema: OpenAPIV3_2.SchemaObject = {
      discriminator: { defaultMapping: 'Dog', propertyName: 'kind' },
      properties: { a: { xml: { nodeType: 'attribute' } } },
      type: 'object',
    }
    const before = structuredClone(schema)
    downgradeSchemaV32ToV31(schema)
    expect(schema).toEqual(before)
  })

  it('converts deeply nested schemas without throwing', () => {
    let deep: OpenAPIV3_2.SchemaObject = { type: 'string' }
    for (let index = 0; index < 1000; index += 1) {
      deep = { items: deep, type: 'array' }
    }
    expect(() => downgradeSchemaV32ToV31(deep)).not.toThrow()
  })
})
