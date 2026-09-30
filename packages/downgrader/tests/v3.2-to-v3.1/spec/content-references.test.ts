// 3.2 lets a content map hold Reference Objects and adds `components.mediaTypes`
// for reusable Media Type Objects:
// https://spec.openapis.org/oas/v3.2.0.html#request-body-content
// https://spec.openapis.org/oas/v3.2.0.html#components-media-types
// A 3.1 content map holds Media Type Objects only
// (https://spec.openapis.org/oas/v3.1.2.html#request-body-content), so each
// reference is replaced by the converted Media Type Object it resolves to.
// A reference that cannot be resolved inside the document (external,
// missing, or looping) cannot be kept either, so its entry is removed.

import { dig, expectAcyclic } from '../../helpers'
import { convertContent, convertPathItem, convertSpec } from './helpers'

describe('inlining', () => {
  it('replaces a reference with the converted media type', () => {
    expect(convertContent(
      { 'application/jsonl': { $ref: '#/components/mediaTypes/Stream' } },
      { mediaTypes: { Stream: { itemSchema: { type: 'object' } } } },
    )).toEqual({ 'application/jsonl': { schema: { items: { type: 'object' }, type: 'array' } } })
  })

  it('inlines in request body, response, parameter, and header content maps', () => {
    const reference = { 'application/json': { $ref: '#/components/mediaTypes/Json' } }
    const inlined = { 'application/json': { schema: { type: 'string' } } }
    expect(convertPathItem(
      {
        get: {
          parameters: [{ content: reference, in: 'query', name: 'q' }],
          responses: { 200: { content: reference, description: 'ok', headers: { 'X-H': { content: reference } } } },
        },
      },
      { mediaTypes: { Json: { schema: { type: 'string' } } } },
    )).toEqual({
      get: {
        parameters: [{ content: inlined, in: 'query', name: 'q' }],
        responses: { 200: { content: inlined, description: 'ok', headers: { 'X-H': { content: inlined } } } },
      },
    })
  })

  it('follows chains of references down to the final media type', () => {
    expect(convertContent(
      { 'application/json': { $ref: '#/components/mediaTypes/A' } },
      { mediaTypes: { A: { $ref: '#/components/mediaTypes/B' }, B: { schema: { type: 'number' } } } },
    )).toEqual({ 'application/json': { schema: { type: 'number' } } })
  })

  it('follows long acyclic chains', () => {
    const links = Array.from({ length: 40 }, (_, index) => [`m${index}`, { $ref: `#/components/mediaTypes/m${index + 1}` }])
    const mediaTypes = Object.fromEntries([...links, ['m40', { schema: { type: 'string' } }]])
    expect(convertContent({ 'application/json': { $ref: '#/components/mediaTypes/m0' } }, { mediaTypes })).toEqual({
      'application/json': { schema: { type: 'string' } },
    })
  })

  // Any local pointer to a Media Type Object works, not only ones into
  // `components.mediaTypes`. Pointer tokens escape `/` as `~1`: https://www.rfc-editor.org/rfc/rfc6901#section-4
  it('inlines references to any local media type, decoding escaped names', () => {
    expect(convertSpec({
      components: {
        mediaTypes: { 'a/b': { schema: { type: 'string' } } },
        requestBodies: {
          Json: { content: { 'application/json': { schema: { type: 'number' } } } },
          Reuse: {
            content: {
              'application/json': { $ref: '#/components/requestBodies/Json/content/application~1json' },
              'text/plain': { $ref: '#/components/mediaTypes/a~1b' },
            },
          },
        },
      },
    }).components?.requestBodies).toEqual({
      Json: { content: { 'application/json': { schema: { type: 'number' } } } },
      Reuse: {
        content: {
          'application/json': { schema: { type: 'number' } },
          'text/plain': { schema: { type: 'string' } },
        },
      },
    })
  })

  it('removes the mediaTypes map from components', () => {
    expect(convertSpec({
      components: { mediaTypes: { Json: { schema: {} } }, schemas: { S: { type: 'string' } } },
    }).components).toEqual({ schemas: { S: { type: 'string' } } })
  })
})

describe('references that cannot be inlined', () => {
  it('removes entries whose chain loops', () => {
    expect(convertContent(
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
    )).toEqual({})
  })

  it('removes entries with external, missing, and unparseable references', () => {
    expect(convertContent(
      {
        'a/1': { $ref: '#/components/schemas/Foo' },
        'a/2': { $ref: '#/components/mediaTypes/nested/name' },
        'a/3': { $ref: '#/components/mediaTypes/' },
        'a/4': { $ref: 'https://example.com/other.json#/mediaTypes/A' },
        'a/5': { $ref: '#/components/mediaTypes/Unknown' },
        'a/6': { $ref: '#/components/mediaTypes/Known' },
      },
      { mediaTypes: { Known: { example: 1 } } },
    )).toEqual({ 'a/6': { example: 1 } })
  })

  it('does not resolve names through the prototype chain', () => {
    expect(convertContent({ 'application/json': { $ref: '#/components/mediaTypes/hasOwnProperty' } }, { mediaTypes: {} })).toEqual({})
  })

  it('removes entries when components.mediaTypes is missing or malformed', () => {
    const content = { 'application/json': { $ref: '#/components/mediaTypes/A' } }
    expect(convertContent(content)).toEqual({})
    expect(convertContent(content, { mediaTypes: 'junk' })).toEqual({})
  })

  it('clones a non-object content value through', () => {
    expect(convertContent('junk')).toBe('junk')
  })
})

describe('parameters and headers left without content', () => {
  // With `content`, a parameter or header MUST hold exactly one entry
  // (https://spec.openapis.org/oas/v3.1.2.html#parameter-content), and it
  // has no `schema` to fall back on. Once its only entry is removed it no
  // longer describes anything, so it is removed as well.
  const missing = { 'application/json': { $ref: '#/components/mediaTypes/Missing' } }

  it('removes a parameter whose only content entry could not be inlined', () => {
    expect(convertPathItem({
      get: {
        parameters: [{ content: missing, in: 'query', name: 'q' }, { in: 'query', name: 'keep', schema: {} }],
        responses: {},
      },
    })).toEqual({
      get: { parameters: [{ in: 'query', name: 'keep', schema: {} }], responses: {} },
    })
  })

  it('keeps a parameter when part of its content could be inlined', () => {
    expect(convertPathItem(
      {
        get: {
          parameters: [{ content: { ...missing, 'application/xml': { $ref: '#/components/mediaTypes/Known' } }, in: 'query', name: 'q' }],
          responses: {},
        },
      },
      { mediaTypes: { Known: { example: 1 } } },
    )).toEqual({
      get: { parameters: [{ content: { 'application/xml': { example: 1 } }, in: 'query', name: 'q' }], responses: {} },
    })
  })

  it('removes headers and component parameters whose entire content could not be inlined', () => {
    const result = convertSpec({
      components: {
        headers: { Broken: { content: missing }, Keep: { schema: {} } },
        parameters: { Broken: { content: missing, in: 'query', name: 'q' } },
      },
      paths: {
        '/a': {
          get: { responses: { 200: { description: 'ok', headers: { 'X-Broken': { content: missing }, 'X-Keep': { schema: {} } } } } },
        },
      },
    })
    expect(result.components).toEqual({ headers: { Keep: { schema: {} } }, parameters: {} })
    expect(result.paths).toEqual({
      '/a': { get: { responses: { 200: { description: 'ok', headers: { 'X-Keep': { schema: {} } } } } } },
    })
  })

  it('removes references to removed parameters and headers, following alias chains', () => {
    const result = convertSpec({
      components: {
        headers: {
          Broken: { content: { 'text/plain': { $ref: '#/components/mediaTypes/Loop' } } },
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
            parameters: [{ $ref: '#/components/parameters/Broken' }, { $ref: '#/components/parameters/BrokenAlias' }],
            responses: {
              200: {
                description: 'ok',
                headers: {
                  'X-Broken': { $ref: '#/components/headers/Broken' },
                  'X-BrokenAlias': { $ref: '#/components/headers/BrokenAlias' },
                },
              },
            },
          },
        },
      },
    })
    expect(result.components).toEqual({ headers: {}, parameters: {} })
    expect(result.paths).toEqual({
      '/a': { get: { parameters: [], responses: { 200: { description: 'ok', headers: {} } } } },
    })
  })

  it('removes a reference to such a header through any pointer', () => {
    expect(convertSpec({
      components: { headers: { H: { $ref: '#/paths/~1a/get/responses/200/headers/X-Broken' } } },
      paths: { '/a': { get: { responses: { 200: { description: 'ok', headers: { 'X-Broken': { content: missing } } } } } } },
    }).components).toEqual({ headers: {} })
  })
})

describe('recursive media types', () => {
  // A schema that reaches the media type it is inlined from would make the
  // output an infinite (circular) object. The recursion is cut instead: the
  // inner `$ref` becomes `{}`, the schema that accepts anything, which can
  // only loosen validation, never tighten it.
  it('cuts a recursive schema reached through a content map instead of emitting a circular object', () => {
    const result = convertSpec({
      components: {
        mediaTypes: {
          Tree: {
            schema: {
              properties: { children: { items: { $ref: '#/components/mediaTypes/Tree/schema' }, type: 'array' } },
              type: 'object',
            },
          },
        },
      },
      paths: {
        '/a': {
          get: { responses: { 200: { content: { 'application/json': { $ref: '#/components/mediaTypes/Tree' } }, description: 'ok' } } },
        },
      },
    })
    expectAcyclic(result)
    expect(dig(result, 'paths', '/a', 'get', 'responses', '200', 'content', 'application/json', 'schema')).toEqual({
      properties: { children: { items: {}, type: 'array' } },
      type: 'object',
    })
  })

  // Here the header is reachable both on its own and from inside the media
  // type it contains. The copy reached from inside is cut, but the header
  // itself survives, so references to it stay valid and are kept.
  it('keeps a header alias whose target is only cut by a media type cycle', () => {
    const result = convertSpec({
      components: {
        headers: { A: { $ref: '#/components/mediaTypes/M/encoding/e/headers/h' } },
        mediaTypes: {
          M: {
            encoding: { e: { headers: { h: { content: { 'a/b': { $ref: '#/components/mediaTypes/M' } } }, x: { $ref: '#/components/headers/A' } } } },
            schema: { type: 'string' },
          },
        },
      },
      paths: {
        '/p': {
          get: {
            responses: {
              200: {
                content: { 'a/b': { $ref: '#/components/mediaTypes/M' } },
                description: 'ok',
                headers: { X: { $ref: '#/components/headers/A' } },
              },
            },
          },
        },
      },
    })
    expect(dig(result, 'paths', '/p', 'get', 'responses', '200', 'headers')).toEqual({ X: { $ref: '#/components/headers/A' } })
    expect(dig(result, 'components', 'headers', 'A', 'content', 'a/b', 'schema')).toEqual({ type: 'string' })
  })
})
