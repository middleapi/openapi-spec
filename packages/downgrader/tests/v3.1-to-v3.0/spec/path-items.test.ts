// `components.pathItems` is new in 3.1: https://spec.openapis.org/oas/v3.1.2.html#components-path-items
// 3.0 components cannot hold Path Items, so the map is removed and every
// Path Item `$ref` into it is replaced by the converted Path Item.
//
// The spec leaves a field defined both beside the `$ref` and in its target
// undefined, but says `$ref` will move toward Reference Object behavior, where
// the referencing side's fields override the target's:
// https://spec.openapis.org/oas/v3.1.2.html#path-item-ref
// So when a Path Item `$ref` is inlined, its own fields win.

import { convertPathItem, convertSpec } from './helpers'

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

describe('inlining', () => {
  it('inlines the converted entry and lets the referencing fields win', () => {
    const result = convertWithPathItems(
      {
        '/a': { $ref: '#/components/pathItems/Reusable' },
        '/b': { $ref: '#/components/pathItems/Reusable', description: 'own', summary: 'Own summary' },
      },
      { Reusable: reusable },
    )
    expect(result.components).toEqual({})
    expect(result.paths).toEqual({
      '/a': inlined,
      '/b': { ...inlined, description: 'own', summary: 'Own summary' },
    })
  })

  // Each hop of a chain adds the fields the hops before it did not set.
  it('follows chains of path item references, merging the fields of every hop', () => {
    expect(convertWithPathItems(
      { '/a': { $ref: '#/components/pathItems/Alias', summary: 'Own' } },
      {
        Alias: { $ref: '#/components/pathItems/Reusable', description: 'alias' },
        Reusable: reusable,
      },
    ).paths).toEqual({ '/a': { ...inlined, description: 'alias', summary: 'Own' } })
  })

  // The target is an external reference, which stays valid, so the result is
  // that reference with the referencing Path Item's fields beside it.
  it('inlines an entry that references an external file', () => {
    expect(convertWithPathItems(
      { '/a': { $ref: '#/components/pathItems/External', summary: 'Own' } },
      { External: { $ref: './paths/a.yaml' } },
    ).paths).toEqual({ '/a': { $ref: './paths/a.yaml', summary: 'Own' } })
  })

  it('inlines references inside callbacks', () => {
    expect(convertWithPathItems(
      {
        '/a': {
          post: {
            callbacks: { onEvent: { '{$request.body#/url}': { $ref: '#/components/pathItems/Reusable' } } },
            responses: {},
          },
        },
      },
      { Reusable: reusable },
    ).paths).toEqual({
      '/a': { post: { callbacks: { onEvent: { '{$request.body#/url}': inlined } }, responses: {} } },
    })
  })

  it('converts the inlined path item like any other, removing mutualTLS requirements', () => {
    const result = convertWithPathItems(
      { '/a': { $ref: '#/components/pathItems/Secured' } },
      { Secured: { get: { responses: {}, security: [{ mtls: [] }, { api: ['r'] }] } } },
      { securitySchemes: { api: { in: 'header', name: 'k', type: 'apiKey' }, mtls: { type: 'mutualTLS' } } },
    )
    expect(result.paths).toEqual({ '/a': { get: { responses: {}, security: [{ api: [] }] } } })
  })
})

describe('references left as written', () => {
  // Only a pointer to an existing Path Item is inlined. A pointer that
  // resolves to nothing, or to something that is not an object, dangles
  // already, and there is nothing to inline.
  it.each([
    ['an unknown entry', '#/components/pathItems/Missing', { Reusable: reusable }],
    ['an empty name', '#/components/pathItems/', { Reusable: reusable }],
    ['a malformed entry', '#/components/pathItems/Junk', { Junk: 42 }],
    ['a prototype member', '#/components/pathItems/hasOwnProperty', {}],
    ['a malformed pathItems map', '#/components/pathItems/Reusable', 'junk'],
  ])('leaves a reference to %s untouched', (_name, ref, pathItems) => {
    expect(convertWithPathItems({ '/a': { $ref: ref, summary: 's' } }, pathItems).paths).toEqual({ '/a': { $ref: ref, summary: 's' } })
  })

  // `#/components/pathItems/Reusable/get` resolves to an Operation. A Path
  // Item `$ref` must point at a Path Item, so this one is not merged; it is
  // left as written, like a reference to any other invalid target.
  it('leaves a reference to something that is not a path item untouched', () => {
    expect(convertWithPathItems(
      { '/a': { $ref: '#/components/pathItems/Reusable/get', summary: 's' } },
      { Reusable: reusable },
    ).paths).toEqual({ '/a': { $ref: '#/components/pathItems/Reusable/get', summary: 's' } })
  })

  it('leaves a reference untouched when components.pathItems is missing', () => {
    expect(convertPathItem({ $ref: '#/components/pathItems/Reusable' })).toEqual({ $ref: '#/components/pathItems/Reusable' })
  })

  it('leaves a chain that loops without reaching a path item as written', () => {
    expect(convertWithPathItems(
      { '/a': { $ref: '#/components/pathItems/Ping', summary: 'Own' } },
      {
        Ping: { $ref: '#/components/pathItems/Pong', description: 'ping' },
        Pong: { $ref: '#/components/pathItems/Ping' },
      },
    ).paths).toEqual({ '/a': { $ref: '#/components/pathItems/Ping', summary: 'Own' } })
  })
})

describe('recursion', () => {
  // A Path Item that reaches itself through its callbacks would inline
  // forever. The inner reference keeps only its own fields instead, since a
  // Path Item has no "accept anything" form like the `{}` schema.
  it('cuts a path item that reaches itself through its callbacks down to its own fields', () => {
    expect(convertWithPathItems(
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
    ).paths).toEqual({
      '/a': { post: { callbacks: { loop: { bare: {}, own: { summary: 'own' } } }, responses: {} } },
    })
  })

  it('keeps the fields of every hop when it cuts a recursive chain', () => {
    const result = convertSpec({
      components: {
        pathItems: {
          A: { post: { callbacks: { cb: { expr: { $ref: '#/components/pathItems/Alias', summary: 'outer' } } }, responses: {} } },
          Alias: { $ref: '#/components/pathItems/A', description: 'alias' },
        },
      },
      paths: { '/a': { $ref: '#/components/pathItems/A' } },
    })
    expect(result.paths?.['/a']).toEqual({
      post: { callbacks: { cb: { expr: { description: 'alias', summary: 'outer' } } }, responses: {} },
    })
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
})
