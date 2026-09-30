import { dig } from '../../helpers'
import { convertComponent, convertPathItem, convertSpec } from './helpers'

describe('in: querystring', () => {
  // 3.2 adds `in: "querystring"` to describe the whole query string with one
  // `content` schema: https://spec.openapis.org/oas/v3.2.0.html#parameter-in
  // 3.1 has no such location, and no query parameter can stand in for it,
  // so the parameter is removed together with every reference to it.
  it('removes querystring parameters from operation and path item lists, keeping neighbors and references', () => {
    expect(convertPathItem({
      get: {
        parameters: [
          { content: { 'application/x-www-form-urlencoded': {} }, in: 'querystring', name: 'q' },
          { in: 'query', name: 'keep' },
          { $ref: '#/components/parameters/P' },
        ],
        responses: {},
      },
      parameters: [
        { in: 'querystring', name: 'q' },
        { in: 'path', name: 'id', required: true },
      ],
    })).toEqual({
      get: {
        parameters: [{ in: 'query', name: 'keep' }, { $ref: '#/components/parameters/P' }],
        responses: {},
      },
      parameters: [{ in: 'path', name: 'id', required: true }],
    })
  })

  it('removes querystring entries from components.parameters, keeping neighbors and references', () => {
    expect(convertSpec({
      components: {
        parameters: {
          N: { in: 'header', name: 'h' },
          Q: { in: 'querystring', name: 'q' },
          R: { $ref: '#/components/parameters/N' },
        },
      },
    }).components).toEqual({
      parameters: {
        N: { in: 'header', name: 'h' },
        R: { $ref: '#/components/parameters/N' },
      },
    })
  })

  // A Reference Object to a removed parameter would dangle, so it goes too.
  // So does a chain of aliases (`$ref` to a `$ref`) that ends at one.
  it('removes references to removed querystring parameters, following alias chains', () => {
    const result = convertSpec({
      components: {
        parameters: {
          Alias: { $ref: '#/components/parameters/Qs' },
          AliasOfAlias: { $ref: '#/components/parameters/Alias' },
          Keep: { in: 'query', name: 'k', schema: {} },
          Qs: { content: { 'application/x-www-form-urlencoded': { schema: {} } }, in: 'querystring', name: 'filter' },
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
    expect(result.components).toEqual({ parameters: { Keep: { in: 'query', name: 'k', schema: {} } } })
    expect(result.paths).toEqual({
      '/a': {
        get: { parameters: [{ $ref: '#/components/parameters/Keep' }], responses: {} },
        parameters: [],
      },
    })
  })

  it('removes a reference to a querystring parameter through any pointer', () => {
    expect(convertSpec({
      components: { parameters: { P: { $ref: '#/paths/~1a/get/parameters/0' } } },
      paths: { '/a': { get: { parameters: [{ in: 'querystring', name: 'qs' }], responses: {} } } },
    }).components).toEqual({ parameters: {} })
  })
})

describe('style and allowReserved', () => {
  // `style: "cookie"` is new in 3.2: https://spec.openapis.org/oas/v3.2.0.html#style-values
  // Without it, a cookie parameter falls back to the 3.1 default for cookies,
  // `form`: https://spec.openapis.org/oas/v3.1.2.html#parameter-style
  //
  // 3.1 defines `allowReserved` for query parameters only
  // (https://spec.openapis.org/oas/v3.1.2.html#parameter-allow-reserved),
  // while 3.2 extends it to every location that percent-encodes
  // (https://spec.openapis.org/oas/v3.2.0.html#parameter-allow-reserved).
  it.each([
    ['removes style: cookie and keeps the other fields', { in: 'cookie', name: 'c', style: 'cookie' }, { in: 'cookie', name: 'c' }],
    ['keeps other style values', { in: 'query', name: 'q', style: 'deepObject' }, { in: 'query', name: 'q', style: 'deepObject' }],
    ['keeps allowReserved on query parameters', { allowReserved: true, in: 'query', name: 'q', schema: {} }, { allowReserved: true, in: 'query', name: 'q', schema: {} }],
    ['removes allowReserved on path parameters', { allowReserved: true, in: 'path', name: 'id', required: true, schema: {} }, { in: 'path', name: 'id', required: true, schema: {} }],
    ['removes allowReserved on cookie parameters', { allowReserved: true, in: 'cookie', name: 'c', schema: {} }, { in: 'cookie', name: 'c', schema: {} }],
    ['keeps allowReserved when there is no in to judge by', { allowReserved: true, schema: {} }, { allowReserved: true, schema: {} }],
  ])('%s', (_name, input, expected) => {
    expect(convertComponent('parameters', input)).toEqual(expected)
  })

  it('removes style: cookie from headers wherever they appear', () => {
    expect(convertComponent('responses', {
      description: 'ok',
      headers: { 'X-H': { description: 'h', style: 'cookie' } },
    })).toEqual({ description: 'ok', headers: { 'X-H': { description: 'h' } } })
  })
})

describe('schemas and examples', () => {
  it('converts the parameter schema and its example map', () => {
    expect(convertComponent('parameters', {
      examples: { inline: { dataValue: 1 }, referenced: { $ref: '#/components/examples/E' } },
      in: 'query',
      name: 'q',
      schema: { type: 'string', xml: { nodeType: 'attribute' } },
    })).toEqual({
      examples: { inline: { value: 1 }, referenced: { $ref: '#/components/examples/E' } },
      in: 'query',
      name: 'q',
      schema: { type: 'string', xml: { attribute: true } },
    })
  })

  // 3.2 lists `example` and `examples` among the fields that MAY be used with
  // either `schema` or `content`: https://spec.openapis.org/oas/v3.2.0.html#parameter-example
  // 3.1 lists them only among the fields for use with `schema`
  // (https://spec.openapis.org/oas/v3.1.2.html#parameter-example), and its
  // official JSON Schema rejects them beside `content`. The media type inside
  // `content` can carry its own examples instead.
  it('removes parameter and header examples beside content', () => {
    const content = { 'a/b': { schema: { type: 'object' } } }
    const operation = dig(convertPathItem({
      get: {
        parameters: [
          { content, example: { a: 1 }, in: 'query', name: 'moved' },
          { content: { 'a/b': { example: 'own' } }, examples: { e: { dataValue: 1 } }, in: 'query', name: 'kept' },
          { content: { 'a/b': {}, 'c/d': {} }, example: 1, in: 'query', name: 'many' },
          { example: 1, in: 'query', name: 'plain', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'ok', headers: { X: { content, examples: { e: { dataValue: 2 } } } } } },
      },
    }), 'get')
    expect(dig(operation, 'parameters')).toEqual([
      { content, in: 'query', name: 'moved' },
      { content: { 'a/b': { example: 'own' } }, in: 'query', name: 'kept' },
      { content: { 'a/b': {}, 'c/d': {} }, in: 'query', name: 'many' },
      { example: 1, in: 'query', name: 'plain', schema: { type: 'integer' } },
    ])
    expect(dig(operation, 'responses', '200', 'headers', 'X')).toEqual({ content })
  })

  it('keeps a parameter whose content map was already empty', () => {
    const parameter = { content: {}, in: 'query', name: 'q' }
    expect(dig(convertPathItem({ get: { parameters: [parameter] } }), 'get', 'parameters')).toEqual([parameter])
  })
})

describe('malformed input', () => {
  it('clones non-object parameter entries, non-array lists, and a malformed components map through', () => {
    expect(convertPathItem({ parameters: [null, 'junk'] })).toEqual({ parameters: [null, 'junk'] })
    expect(convertPathItem({ parameters: 'junk' })).toEqual({ parameters: 'junk' })
    expect(convertSpec({ components: { parameters: 'junk' } }).components).toEqual({ parameters: 'junk' })
  })
})
