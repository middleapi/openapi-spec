// `components.pathItems` is new in 3.1: https://spec.openapis.org/oas/v3.1.2.html#components-path-items
// 3.0 components cannot hold Path Items, so the map is removed and every
// Path Item `$ref` into it is replaced by the converted Path Item.
//
// The spec leaves a field defined both beside the `$ref` and in its target
// undefined, but says `$ref` will move toward Reference Object behavior, where
// the referencing side's fields override the target's:
// https://spec.openapis.org/oas/v3.1.2.html#path-item-ref
// So when a Path Item `$ref` is inlined, its own fields win.

import { countReads, dig } from '../../helpers'
import { expectValidAs } from '../../validate'
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

  // `A` is both a hop of the chain and the Path Item being inlined. Where the
  // inner reference re-enters it, `A` contributes nothing, neither its
  // operations nor its plain fields, and only the later hop `T` is merged.
  it('cuts a hop that the chain re-enters, merging only the hops after it', () => {
    const responses = { 200: { description: 'ok' } }
    const result = convertSpec({
      components: {
        pathItems: {
          A: {
            $ref: '#/components/pathItems/T',
            description: 'a',
            post: { callbacks: { c: { '{$url}': { $ref: '#/components/pathItems/A' } } }, responses },
          },
          T: { summary: 't' },
        },
      },
      paths: { '/p': { $ref: '#/components/pathItems/A' } },
    })
    expect(result.paths).toEqual({
      '/p': { description: 'a', post: { callbacks: { c: { '{$url}': { summary: 't' } } }, responses }, summary: 't' },
    })
  })
})

// A hop is a Path Item with its own fields and a `$ref` to the next one. Like
// any inlined target, each hop is converted once and shared, so the work grows
// with the number of references, not with the number of paths through them.
// Each test counts reads of the field the conversion walks into: a hop's
// operation each time its own fields are converted, or its `$ref` at each step
// along a chain.
describe('hops converted once', () => {
  const responses = { 200: { description: 'ok' } }

  it('shares a hop that many paths point at', () => {
    const reads = { count: 0 }
    const get = { parameters: [{ in: 'query', name: 'q', schema: { type: ['string', 'null'] } }], responses }
    const paths = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`/p${index}`, { $ref: '#/components/pathItems/Hop' }]))
    const result = convertSpec({
      components: {
        pathItems: {
          Base: { summary: 'base' },
          Hop: countReads({ $ref: '#/components/pathItems/Base', get }, 'get', reads),
        },
      },
      paths,
    })
    expect(reads.count).toBe(1)
    const first = result.paths['/p0']
    expect(first).toEqual({
      get: { parameters: [{ in: 'query', name: 'q', schema: { nullable: true, type: 'string' } }], responses },
      summary: 'base',
    })
    for (const item of Object.values(result.paths)) {
      expect(item).toEqual(first)
      expect(item.get).toBe(first?.get)
    }
  })

  it('walks a long alias chain once, however many paths enter it', () => {
    const reads = { count: 0 }
    const length = 1000
    const pathItems: Record<string, unknown> = { [`P${length}`]: { get: { responses } } }
    const paths: Record<string, unknown> = {}
    for (let index = 0; index < length; index++) {
      pathItems[`P${index}`] = countReads({ $ref: `#/components/pathItems/P${index + 1}` }, '$ref', reads)
      paths[`/p${index}`] = { $ref: `#/components/pathItems/P${index}` }
    }
    const result = convertSpec({ components: { pathItems }, paths })
    expect(reads.count).toBeLessThan(50 * length)
    for (const item of Object.values(result.paths)) {
      expect(item).toEqual({ get: { responses } })
    }
  })

  // Every webhook `h<i>` points at `base`, and its callbacks point at every
  // webhook, itself included. Inlining each path through this graph
  // separately would convert the webhooks about k! times.
  it('converts each hop of a cyclic callback graph once', async () => {
    const reads = { count: 0 }
    const k = 8
    const webhooks: Record<string, unknown> = { base: { get: { responses } } }
    for (let i = 0; i < k; i++) {
      const callbacks = Object.fromEntries(Array.from({ length: k }, (_, j) => [`c${j}`, { '{$request.body#/url}': { $ref: `#/webhooks/h${j}` } }]))
      webhooks[`h${i}`] = countReads({ $ref: '#/webhooks/base', post: { callbacks, responses } }, 'post', reads)
    }
    const result = convertSpec({ paths: { '/a': { $ref: '#/webhooks/h0' } }, webhooks })
    expect(reads.count).toBe(k)
    await expectValidAs(result, '3.0')
    const callbacks = dig(result, 'paths', '/a', 'post', 'callbacks')
    // `h0` is in progress inside its own callbacks, so the reference back to
    // it keeps only the fields of `base`.
    expect(dig(callbacks, 'c0', '{$request.body#/url}')).toEqual({ get: { responses } })
    // `h2` is converted inside `h1`, and that copy is shared with `h0`.
    expect(dig(callbacks, 'c2', '{$request.body#/url}', 'post'))
      .toBe(dig(callbacks, 'c1', '{$request.body#/url}', 'post', 'callbacks', 'c2', '{$request.body#/url}', 'post'))
  })

  // The callbacks of `B` enter the chain A0 → … → A499 → B → T, which passes
  // `B` while it is in progress, so every copy inside `B` skips it. That merge
  // is shared among those copies but not with `/q`, which enters the chain from
  // outside and keeps the fields of `B`.
  it('shares a merge that skipped a hop in progress only while that hop is in progress', () => {
    const reads = { count: 0 }
    const length = 500
    const pointer = (name: string): string => `#/components/pathItems/${name}`
    const pathItems: Record<string, unknown> = { T: { summary: 't' } }
    for (let index = 0; index < length; index++) {
      pathItems[`A${index}`] = countReads({ $ref: pointer(index + 1 < length ? `A${index + 1}` : 'B') }, '$ref', reads)
    }
    const callbacks = Object.fromEntries(Array.from({ length }, (_, index) => [`c${index}`, { '{$url}': { $ref: pointer('A0') } }]))
    pathItems.B = { $ref: pointer('T'), get: { callbacks, responses } }
    const result = convertSpec({ components: { pathItems }, paths: { '/p': { $ref: pointer('B') }, '/q': { $ref: pointer('A0') } } })
    expect(reads.count).toBeLessThan(50 * length)
    const inner = Object.fromEntries(Array.from({ length }, (_, index) => [`c${index}`, { '{$url}': { summary: 't' } }]))
    expect(result.paths['/p']).toEqual({ get: { callbacks: inner, responses }, summary: 't' })
    expect(result.paths['/q']).toEqual(result.paths['/p'])
  })
})
