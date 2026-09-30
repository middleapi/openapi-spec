// 3.2 lets a content map hold Reference Objects and adds `components.mediaTypes`
// for reusable Media Type Objects:
// https://spec.openapis.org/oas/v3.2.0.html#request-body-content
// https://spec.openapis.org/oas/v3.2.0.html#components-media-types
// A 3.1 content map holds Media Type Objects only
// (https://spec.openapis.org/oas/v3.1.2.html#request-body-content), so each
// reference is replaced by the converted Media Type Object it resolves to.
// A reference that cannot be resolved inside the document (external,
// missing, or looping) cannot be kept either. Its entry becomes an empty
// Media Type Object instead, which keeps the media type and loses only what
// the reference described.

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

  it('follows long acyclic chains without growing the stack', () => {
    const links = Array.from({ length: 10_000 }, (_, index) => [`m${index}`, { $ref: `#/components/mediaTypes/m${index + 1}` }])
    const mediaTypes = Object.fromEntries([...links, ['m10000', { schema: { type: 'string' } }]])
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
  it('keeps entries whose chain loops as empty media types', () => {
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
    )).toEqual({ 'application/json': {}, 'application/xml': {} })
  })

  it('keeps entries with external, missing, and unparseable references as empty media types', () => {
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
    )).toEqual({ 'a/1': {}, 'a/2': {}, 'a/3': {}, 'a/4': {}, 'a/5': {}, 'a/6': { example: 1 } })
  })

  it('does not resolve names through the prototype chain', () => {
    expect(convertContent({ 'application/json': { $ref: '#/components/mediaTypes/hasOwnProperty' } }, { mediaTypes: {} })).toEqual({
      'application/json': {},
    })
  })

  it('keeps empty media types when components.mediaTypes is missing or malformed', () => {
    const content = { 'application/json': { $ref: '#/components/mediaTypes/A' } }
    expect(convertContent(content)).toEqual({ 'application/json': {} })
    expect(convertContent(content, { mediaTypes: 'junk' })).toEqual({ 'application/json': {} })
  })

  it('clones a non-object content value through', () => {
    expect(convertContent('junk')).toBe('junk')
  })

  // With `content`, a parameter or header MUST hold exactly one entry
  // (https://spec.openapis.org/oas/v3.1.2.html#parameter-content), and a
  // path parameter MUST be defined for every template expression
  // (https://spec.openapis.org/oas/v3.1.2.html#path-templating). Keeping the
  // entry keeps both true, and keeps references to the parameter valid.
  it('keeps parameters and headers whose content could not be inlined', () => {
    const missing = { 'application/json': { $ref: '#/components/mediaTypes/Missing' } }
    const result = convertSpec({
      components: {
        headers: { H: { content: missing } },
        parameters: { P: { content: missing, in: 'query', name: 'q' } },
      },
      paths: {
        '/a/{id}': {
          get: {
            parameters: [{ content: missing, in: 'path', name: 'id', required: true }, { $ref: '#/components/parameters/P' }],
            responses: { 200: { description: 'ok', headers: { 'X-H': { $ref: '#/components/headers/H' } } } },
          },
        },
      },
    })
    const empty = { 'application/json': {} }
    expect(result.components).toEqual({ headers: { H: { content: empty } }, parameters: { P: { content: empty, in: 'query', name: 'q' } } })
    expect(result.paths).toEqual({
      '/a/{id}': {
        get: {
          parameters: [{ content: empty, in: 'path', name: 'id', required: true }, { $ref: '#/components/parameters/P' }],
          responses: { 200: { description: 'ok', headers: { 'X-H': { $ref: '#/components/headers/H' } } } },
        },
      },
    })
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
