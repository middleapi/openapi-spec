import { convertComponent, convertPathItem, convertSpec } from './helpers'

describe('operations 3.1 cannot hold', () => {
  // 3.2 adds the QUERY method and `additionalOperations` for any other method:
  // https://spec.openapis.org/oas/v3.2.0.html#path-item-query
  // https://spec.openapis.org/oas/v3.2.0.html#path-item-additional-operations
  // A 3.1 Path Item only has fixed fields for the eight classic methods, and
  // an extension would not describe a callable operation either, so both are
  // removed rather than moved.
  it('removes the query operation and additionalOperations whatever their shape', () => {
    expect(convertSpec({
      paths: {
        '/a': { get: { responses: {} }, query: { description: 'q', responses: {} } },
        '/b': { additionalOperations: { NOTIFY: { description: 'n' } } },
        '/c': { additionalOperations: 'junk' },
        '/d': { additionalOperations: 42, query: 'junk' },
      },
    }).paths).toEqual({
      '/a': { get: { responses: {} } },
      '/b': {},
      '/c': {},
      '/d': {},
    })
  })

  it('removes them from webhooks and components.pathItems too', () => {
    expect(convertSpec({
      components: { pathItems: { P: { get: { responses: {} }, query: { description: 'q' } } } },
      webhooks: { newPet: { post: { responses: { 200: { summary: 'ok' } } }, query: { description: 'q' } } },
    })).toEqual({
      components: { pathItems: { P: { get: { responses: {} } } } },
      openapi: '3.1.2',
      webhooks: { newPet: { post: { responses: { 200: { description: 'ok' } } } } },
    })
  })

  it('removes them from path items inside callbacks', () => {
    expect(convertComponent('callbacks', {
      'https://example.com/cb': { post: { responses: { 200: { summary: 'ok' } } }, query: { description: 'q' } },
    })).toEqual({
      'https://example.com/cb': { post: { responses: { 200: { description: 'ok' } } } },
    })
  })
})

describe('paths', () => {
  // Paths Object keys are templates that start with a slash; any other key
  // can only be a specification extension: https://spec.openapis.org/oas/v3.2.0.html#paths-object
  it('converts only keys starting with a slash and clones the rest', () => {
    expect(convertSpec({
      paths: {
        '/a': { query: { description: 'dropped' } },
        'x-meta': { query: { description: 'kept' } },
      },
    }).paths).toEqual({ '/a': {}, 'x-meta': { query: { description: 'kept' } } })
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
              'multipart/form-data': { encoding: { field: 'junk' }, example: 5 },
            },
          },
        },
        put: { requestBody: 42, responses: { 200: 42 } },
      },
    }
    expect(convertSpec({ paths }).paths).toEqual(paths)
  })
})

describe('callbacks', () => {
  // Callback Object keys are runtime expressions; only `x-` keys are
  // extensions: https://spec.openapis.org/oas/v3.2.0.html#callback-object
  it('converts the path items of operation callbacks and clones x- keys and references', () => {
    expect(convertPathItem({
      post: {
        callbacks: {
          onEvent: {
            'x-note': { query: { description: 'kept' } },
            '{$request.body#/url}': { post: { responses: { 200: { summary: 'ok' } } }, query: { description: 'q' } },
          },
          referenced: { $ref: '#/components/callbacks/C' },
        },
        responses: {},
      },
    })).toEqual({
      post: {
        callbacks: {
          onEvent: {
            'x-note': { query: { description: 'kept' } },
            '{$request.body#/url}': { post: { responses: { 200: { description: 'ok' } } } },
          },
          referenced: { $ref: '#/components/callbacks/C' },
        },
        responses: {},
      },
    })
  })

  it('converts components.callbacks, keeping references to surviving callbacks', () => {
    expect(convertSpec({
      components: {
        callbacks: {
          inline: { 'https://example.com/cb': { post: { responses: { 200: { summary: 'ok' } } } } },
          referenced: { $ref: '#/components/callbacks/inline' },
        },
      },
    }).components).toEqual({
      callbacks: {
        inline: { 'https://example.com/cb': { post: { responses: { 200: { description: 'ok' } } } } },
        referenced: { $ref: '#/components/callbacks/inline' },
      },
    })
  })
})
