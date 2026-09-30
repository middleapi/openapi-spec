import { convertComponent, convertPathItem } from './helpers'

describe('responses', () => {
  // 3.1 made `responses` optional: https://spec.openapis.org/oas/v3.1.2.html#operation-responses
  // In 3.0 it is REQUIRED: https://spec.openapis.org/oas/v3.0.4.html#operation-responses
  // A `default` response with an empty description says nothing about the
  // responses, just as the missing field did.
  it('adds a minimal default response when an operation has none', () => {
    expect(convertPathItem({ get: { operationId: 'getA' } })).toEqual({
      get: { operationId: 'getA', responses: { default: { description: '' } } },
    })
  })

  it('keeps x- entries of a responses map unconverted', () => {
    const responses = { '200': { description: 'ok' }, 'x-note': { $ref: '#/c/r', summary: 's' } }
    expect(convertPathItem({ get: { responses } })).toEqual({ get: { responses } })
  })
})

describe('parameters', () => {
  it('converts parameter schemas, content, and examples', () => {
    expect(convertPathItem({
      get: {
        parameters: [
          { examples: { e: { $ref: '#/c/e', summary: 's' } }, in: 'query', name: 'p', schema: { type: ['string', 'null'] } },
          { content: { 'text/plain': { schema: { type: ['integer', 'null'] } } }, in: 'query', name: 'q' },
        ],
        responses: {},
      },
    })).toEqual({
      get: {
        parameters: [
          { examples: { e: { $ref: '#/c/e' } }, in: 'query', name: 'p', schema: { nullable: true, type: 'string' } },
          { content: { 'text/plain': { schema: { nullable: true, type: 'integer' } } }, in: 'query', name: 'q' },
        ],
        responses: {},
      },
    })
  })

  // Both versions say a path parameter's `required` "is REQUIRED and its
  // value MUST be true": https://spec.openapis.org/oas/v3.1.2.html#parameter-required
  // The official 3.1 JSON Schema only checks it beside `schema`, so a valid
  // 3.1 document can lack it on a `content` parameter. The official 3.0
  // schema always checks it, so it is added.
  it('adds required: true to path parameters that lack it', () => {
    expect(convertPathItem({
      get: {
        parameters: [
          { content: { 'text/plain': { schema: { type: 'string' } } }, in: 'path', name: 'id' },
          { in: 'query', name: 'q', schema: {} },
        ],
        responses: {},
      },
    })).toEqual({
      get: {
        parameters: [
          { content: { 'text/plain': { schema: { type: 'string' } } }, in: 'path', name: 'id', required: true },
          { in: 'query', name: 'q', schema: {} },
        ],
        responses: {},
      },
    })
  })
})

describe('request bodies', () => {
  it('converts request body content, media type encoding, and encoding headers', () => {
    expect(convertComponent('requestBodies', {
      content: {
        'multipart/form-data': {
          encoding: {
            field: {
              contentType: 'text/plain',
              headers: { H: { $ref: '#/c/h', summary: 's' }, H2: { schema: { type: ['string', 'null'] } } },
            },
          },
          example: { field: 'v' },
          schema: { type: 'object' },
        },
      },
      description: 'body',
      required: true,
    })).toEqual({
      content: {
        'multipart/form-data': {
          encoding: {
            field: {
              contentType: 'text/plain',
              headers: { H: { $ref: '#/c/h' }, H2: { schema: { nullable: true, type: 'string' } } },
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
})

describe('callbacks', () => {
  // Callback Object keys are runtime expressions; only `x-` keys are
  // extensions: https://spec.openapis.org/oas/v3.0.4.html#callback-object
  it('converts inline callbacks, cloning x- keys and malformed entries', () => {
    expect(convertPathItem({
      get: {
        callbacks: { inline: { 'expr': { get: {} }, 'x-k': { expr: { get: {} } } }, junk: 7 },
        responses: {},
      },
    })).toEqual({
      get: {
        callbacks: {
          inline: { 'expr': { get: { responses: { default: { description: '' } } } }, 'x-k': { expr: { get: {} } } },
          junk: 7,
        },
        responses: {},
      },
    })
  })
})
