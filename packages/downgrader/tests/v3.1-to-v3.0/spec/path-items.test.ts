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

describe('inlining', () => {
  it('inlines the converted entry and lets the referencing fields win', () => {
    const result = convertSpec({
      components: { pathItems: { Reusable: reusable } },
      paths: {
        '/a': { $ref: '#/components/pathItems/Reusable' },
        '/b': { $ref: '#/components/pathItems/Reusable', description: 'own', summary: 'Own summary' },
      },
    })
    expect(result.components).toEqual({})
    expect(result.paths).toEqual({
      '/a': inlined,
      '/b': { ...inlined, description: 'own', summary: 'Own summary' },
    })
  })

  // Each hop of a chain adds the fields the hops before it did not set.
  it('follows chains of path item references, merging the fields of every hop', () => {
    expect(convertSpec({
      components: {
        pathItems: {
          Alias: { $ref: '#/components/pathItems/Reusable', description: 'alias' },
          Reusable: reusable,
        },
      },
      paths: { '/a': { $ref: '#/components/pathItems/Alias', summary: 'Own' } },
    }).paths).toEqual({ '/a': { ...inlined, description: 'alias', summary: 'Own' } })
  })

  // The target is an external reference, which stays valid, so the result is
  // that reference with the referencing Path Item's fields beside it.
  it('inlines an entry that references an external file', () => {
    expect(convertSpec({
      components: { pathItems: { External: { $ref: './paths/a.yaml' } } },
      paths: { '/a': { $ref: '#/components/pathItems/External', summary: 'Own' } },
    }).paths).toEqual({ '/a': { $ref: './paths/a.yaml', summary: 'Own' } })
  })

  it('inlines references inside callbacks', () => {
    expect(convertSpec({
      components: { pathItems: { Reusable: reusable } },
      paths: {
        '/a': {
          post: {
            callbacks: { onEvent: { '{$request.body#/url}': { $ref: '#/components/pathItems/Reusable' } } },
            responses: {},
          },
        },
      },
    }).paths).toEqual({
      '/a': { post: { callbacks: { onEvent: { '{$request.body#/url}': inlined } }, responses: {} } },
    })
  })

  it('converts the inlined path item like any other, removing mutualTLS requirements', () => {
    expect(convertSpec({
      components: {
        pathItems: { Secured: { get: { responses: {}, security: [{ mtls: [] }, { api: ['r'] }] } } },
        securitySchemes: { api: { in: 'header', name: 'k', type: 'apiKey' }, mtls: { type: 'mutualTLS' } },
      },
      paths: { '/a': { $ref: '#/components/pathItems/Secured' } },
    }).paths).toEqual({ '/a': { get: { responses: {}, security: [{ api: [] }] } } })
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
    expect(convertSpec({ components: { pathItems }, paths: { '/a': { $ref: ref, summary: 's' } } }).paths).toEqual({
      '/a': { $ref: ref, summary: 's' },
    })
  })

  // `#/components/pathItems/Reusable/get` resolves to an Operation. A Path
  // Item `$ref` must point at a Path Item, so this one is not merged; it is
  // left as written, like a reference to any other invalid target.
  it('leaves a reference to something that is not a path item untouched', () => {
    expect(convertSpec({
      components: { pathItems: { Reusable: reusable } },
      paths: { '/a': { $ref: '#/components/pathItems/Reusable/get', summary: 's' } },
    }).paths).toEqual({ '/a': { $ref: '#/components/pathItems/Reusable/get', summary: 's' } })
  })

  it('leaves a reference untouched when components.pathItems is missing', () => {
    expect(convertPathItem({ $ref: '#/components/pathItems/Reusable' })).toEqual({ $ref: '#/components/pathItems/Reusable' })
  })

  it('leaves a chain that loops without reaching a path item as written', () => {
    expect(convertSpec({
      components: {
        pathItems: {
          Ping: { $ref: '#/components/pathItems/Pong', description: 'ping' },
          Pong: { $ref: '#/components/pathItems/Ping' },
        },
      },
      paths: { '/a': { $ref: '#/components/pathItems/Ping', summary: 'Own' } },
    }).paths).toEqual({ '/a': { $ref: '#/components/pathItems/Ping', summary: 'Own' } })
  })
})

describe('recursion', () => {
  // A Path Item that reaches itself through its callbacks would inline
  // forever. The inner reference keeps only its own fields instead, since a
  // Path Item has no "accept anything" form like the `{}` schema.
  it('cuts a path item that reaches itself through its callbacks down to its own fields', () => {
    expect(convertSpec({
      components: {
        pathItems: {
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
      },
      paths: { '/a': { $ref: '#/components/pathItems/Self' } },
    }).paths).toEqual({
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
    expect(result.paths['/a']).toEqual({
      post: { callbacks: { cb: { expr: { description: 'alias', summary: 'outer' } } }, responses: {} },
    })
  })

  // `P2` is both a hop of the chain and the Path Item being inlined. The later
  // hop `P3` is reached only through `P2`, whose fields win over its own, so
  // where the inner reference re-enters `P2` the chain stops, as it does for
  // direct recursion. Merging `P3` there would advertise the `get` that `P2`
  // overrides, and a `post` without the header and server `P2` adds to it.
  it('stops a chain at the hop it re-enters, merging none of the hops after it', () => {
    const responses = { 200: { description: 'ok' } }
    const header = { in: 'header', name: 'X-Token', required: true, schema: { type: 'string' } }
    const servers = [{ url: 'https://hooks.example.com' }]
    const result = convertSpec({
      paths: { '/a': { $ref: '#/webhooks/P2' } },
      webhooks: {
        P2: {
          $ref: '#/webhooks/P3',
          get: { callbacks: { cb: { '{$url}': { $ref: '#/webhooks/P2' } } }, operationId: 'p2get', responses },
          parameters: [header],
          servers,
        },
        P3: { get: { operationId: 'p3get-overridden', responses }, post: { operationId: 'p3post', responses } },
      },
    })
    expect(result.paths).toEqual({
      '/a': {
        get: { callbacks: { cb: { '{$url}': {} } }, operationId: 'p2get', responses },
        parameters: [header],
        post: { operationId: 'p3post', responses },
        servers,
      },
    })
  })
})
