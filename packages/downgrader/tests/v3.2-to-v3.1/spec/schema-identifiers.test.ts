// `$id`, `$anchor`, and `$dynamicAnchor` give a schema a URI. JSON Schema
// forbids two schemas from claiming the same one: "there is no way for a URI
// to identify more than one schema":
// https://json-schema.org/draft/2020-12/json-schema-core#section-9.1.2
// Inlining a schema in several places would copy its identifiers, so only
// the first copy keeps them. A copy that loses its `$id` resolves its own
// relative `$ref`s against the enclosing base instead (a known limitation
// listed in the README).

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { countReads, dig } from '../../helpers'
import { expectValidAs } from '../../validate'
import { convertPathItem, convertSpec } from './helpers'

it('keeps $id and $anchor on the first copy of a schema inlined in several places', () => {
  const pet = { $id: 'https://example.com/pet', properties: { name: { $anchor: 'name', type: 'string' } }, type: 'object' }
  const result = convertSpec({
    components: {
      mediaTypes: { Pet: { schema: pet } },
      schemas: { Named: { $ref: '#/components/mediaTypes/Pet/schema', description: 'named' } },
    },
    paths: {
      '/a': { get: { responses: { 200: { content: { 'application/json': { $ref: '#/components/mediaTypes/Pet' } }, description: 'ok' } } } },
    },
  })
  expect(dig(result, 'components', 'schemas', 'Named')).toEqual({ allOf: [pet], description: 'named' })
  expect(dig(result, 'paths', '/a', 'get', 'responses', '200', 'content')).toEqual({
    'application/json': { schema: { properties: { name: { type: 'string' } }, type: 'object' } },
  })
})

// When the original survives (moved into `schema.items`, or shifted in a
// parameter list), it keeps its identifiers and the inlined copies lose them.
it('keeps identifiers on a moved or shifted original rather than on the copies inlined from it', () => {
  expect(convertPathItem({
    get: {
      parameters: [
        { content: { 'text/plain': {} }, in: 'querystring', name: 'q' },
        { in: 'query', name: 'p', schema: { $dynamicAnchor: 'p', type: 'string' } },
      ],
      responses: {
        200: { content: { 'application/jsonl': { itemSchema: { $id: 'https://example.com/item' } } }, description: 'ok' },
      },
    },
    post: {
      parameters: [{ $ref: '#/paths/~1a/get/parameters/1' }],
      requestBody: {
        content: { 'application/json': { schema: { $ref: '#/paths/~1a/get/responses/200/content/application~1jsonl/itemSchema' } } },
      },
    },
  })).toEqual({
    get: {
      parameters: [{ in: 'query', name: 'p', schema: { $dynamicAnchor: 'p', type: 'string' } }],
      responses: {
        200: { content: { 'application/jsonl': { schema: { items: { $id: 'https://example.com/item' }, type: 'array' } } }, description: 'ok' },
      },
    },
    post: {
      parameters: [{ in: 'query', name: 'p', schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: {} } } },
    },
  })
})

it('produces a valid 3.1 document with unique identifiers', async () => {
  const doc: OpenAPIV3_2.OpenAPIObject = {
    components: {
      mediaTypes: {
        Pet: {
          schema: {
            $id: 'https://example.com/pet',
            properties: { name: { $anchor: 'name', type: 'string' } },
            type: 'object',
          },
        },
      },
    },
    info: { title: 'Identifiers', version: '1.0.0' },
    openapi: '3.2.0',
    paths: {
      '/pets': {
        get: {
          responses: { 200: { content: { 'application/json': { $ref: '#/components/mediaTypes/Pet' } }, description: 'Pet' } },
        },
        post: {
          requestBody: { content: { 'application/json': { $ref: '#/components/mediaTypes/Pet' } } },
          responses: {
            201: {
              content: { 'application/json': { schema: { $ref: '#/components/mediaTypes/Pet/schema/properties/name' } } },
              description: 'Name',
            },
          },
        },
      },
    },
  }
  const v31 = downgradeSpecV32ToV31(doc)
  const serialized = JSON.stringify(v31)
  expect(serialized.match(/"\$id"/g)).toHaveLength(1)
  expect(serialized.match(/"\$anchor"/g)).toHaveLength(1)
  await expectValidAs(v31, '3.1')
})

// Only the first copy is special. The copies after it are identical, so they
// share one converted object, like any other target inlined several times.
it('shares one identifier-free copy among the places after the first', () => {
  const pet = { $id: 'https://example.com/pet', type: 'object' }
  const result = convertSpec({
    components: {
      mediaTypes: { Pet: { schema: pet } },
      schemas: {
        A: { $ref: '#/components/mediaTypes/Pet/schema' },
        B: { $ref: '#/components/mediaTypes/Pet/schema' },
        C: { $ref: '#/components/mediaTypes/Pet/schema' },
      },
    },
  })
  const schemas = dig(result, 'components', 'schemas')
  expect(schemas).toEqual({ A: pet, B: { type: 'object' }, C: { type: 'object' } })
  expect(dig(schemas, 'C')).toBe(dig(schemas, 'B'))
})

// The first copy is the first one the output keeps. A copy converted only to
// be discarded keeps nothing, or the identifiers would vanish from the output
// and every `$ref` to them would dangle.
describe('discarded copies', () => {
  const id = 'https://example.com/s'
  const schema = { $id: id, type: 'string' }
  const responses = { 200: { description: 'ok' } }
  const own = { operationId: 'own', responses }
  const removed = '#/paths/~1q/query/callbacks/cb'
  const inRemoved = (pathItems: Record<string, unknown>): unknown => ({ query: { callbacks: { cb: pathItems }, responses } })
  const withSchema = (schema: unknown): unknown => ({ parameters: [{ in: 'query', name: 'p', schema }], responses })

  // A Path Item `$ref` into a removed operation is merged with the
  // referrer's own fields, which win:
  // https://spec.openapis.org/oas/v3.2.0.html#path-item-ref
  // So `/h` drops the `get` it merges, and `/b` holds the only copy left.
  it.each([['/h', '/b'], ['/b', '/h']])('keeps identifiers on the copy a merge keeps, not on a field the referrer overrides (%s first)', async (first, second) => {
    const paths: Record<string, unknown> = { '/b': { $ref: `${removed}/t` }, '/h': { $ref: `${removed}/t`, get: own } }
    const result = convertSpec({
      components: { schemas: { UsesId: { $ref: id } } },
      info: { title: 'Identifiers', version: '1.0.0' },
      paths: { '/q': inRemoved({ t: { get: withSchema(schema) } }), [first]: paths[first], [second]: paths[second] },
    })
    expect(dig(result, 'paths', '/h')).toEqual({ get: own })
    expect(dig(result, 'paths', '/b')).toEqual({ get: withSchema(schema) })
    expect(JSON.stringify(result).match(/"\$id"/g)).toHaveLength(1)
    await expectValidAs(result, '3.1')
  })

  // Converting the overridden `get` first would strip the copy under `put`.
  it('keeps identifiers on a kept field of a merge when an overridden field held the first copy', () => {
    const result = convertSpec({
      paths: {
        '/q': inRemoved({ t: { get: withSchema(schema), put: withSchema({ $ref: `${removed}/t/get/parameters/0/schema` }) } }),
        '/h': { $ref: `${removed}/t`, get: own },
      },
    })
    expect(dig(result, 'paths', '/h')).toEqual({ get: own, put: withSchema(schema) })
  })

  // `/h` merges the chain `h` → `t`. Whether the overridden `get` comes from
  // the hop or from the end of the chain, `/b` enters the same chain later
  // and needs the merge `/h` discarded part of, so that merge is not reused.
  it.each([
    ['a hop', { $ref: `${removed}/t`, get: withSchema(schema) }, { summary: 's' }],
    ['the end of a chain', { $ref: `${removed}/t`, summary: 's' }, { get: withSchema(schema) }],
  ])('keeps identifiers on the copy a chain keeps when the referrer overrides %s', (_, h, t) => {
    const result = convertSpec({
      paths: {
        '/q': inRemoved({ h, t }),
        '/h': { $ref: `${removed}/h`, get: own },
        '/b': { $ref: `${removed}/h` },
      },
    })
    expect(dig(result, 'paths', '/h')).toEqual({ get: own, summary: 's' })
    expect(dig(result, 'paths', '/b')).toEqual({ get: withSchema(schema), summary: 's' })
  })

  // A merge redone without the overridden fields is cached like any other,
  // so the referrers that override the same fields share it: the Path Item is
  // converted once in full and once without them. Each test counts reads of
  // the field a conversion walks into.
  it('converts a Path Item twice however many referrers override its first copy', () => {
    const reads = { count: 0 }
    const length = 50
    const t = countReads({ get: withSchema(schema), put: { responses } }, 'put', reads)
    const paths: Record<string, unknown> = { '/q': inRemoved({ t }) }
    for (let index = 0; index < length; index++) {
      paths[`/p${index}`] = { $ref: `${removed}/t`, get: own }
    }
    const result = convertSpec({ paths })
    expect(reads.count).toBe(2)
    expect(dig(result, 'paths', '/p49')).toEqual({ get: own, put: { responses } })
  })

  // Inlining each path through this graph separately would convert its Path
  // Items about k! times. Every one of them overrides the `get` of `base`.
  it('converts each hop of a cyclic callback graph once when every hop overrides the first copy', () => {
    const reads = { count: 0 }
    const k = 6
    const items: Record<string, unknown> = { base: { get: withSchema(schema) } }
    for (let i = 0; i < k; i++) {
      const callbacks = Object.fromEntries(Array.from({ length: k }, (_, j) => [`c${j}`, { '{$url}': { $ref: `${removed}/h${j}`, get: own } }]))
      items[`h${i}`] = countReads({ $ref: `${removed}/base`, get: own, post: { callbacks, responses } }, 'post', reads)
    }
    convertSpec({ paths: { '/a': { $ref: `${removed}/h0`, get: own }, '/q': inRemoved(items) } })
    expect(reads.count).toBe(k)
  })

  // A parameter whose every `content` entry points nowhere is removed. Its
  // `schema`, invalid next to `content`, was converted first (`paths` comes
  // before `components`), but that copy is gone with the parameter.
  const dropped = (schema: unknown): unknown => ({
    get: { parameters: [{ content: { 'text/plain': { $ref: '#/nowhere' } }, in: 'query', name: 'p', schema }], responses },
  })

  it('keeps identifiers on a copy of the schema of a removed parameter', () => {
    const result = convertSpec({
      paths: { '/a': dropped(schema) },
      components: { schemas: { Copy: { $ref: '#/paths/~1a/get/parameters/0/schema' } } },
    })
    expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([])
    expect(dig(result, 'components', 'schemas', 'Copy')).toEqual(schema)
  })

  // `Shared` is the same object as the schema of the removed parameter, as in
  // a dereferenced input. The conversion of that schema is discarded with the
  // parameter, so `Shared` converts it anew and is the copy that keeps `$id`.
  it('keeps identifiers once on a schema shared with a removed parameter', () => {
    const result = convertSpec({
      paths: { '/a': dropped(schema) },
      components: { schemas: { Shared: schema, Copy: { $ref: '#/paths/~1a/get/parameters/0/schema' } } },
    })
    expect(dig(result, 'components', 'schemas')).toEqual({ Copy: { type: 'string' }, Shared: schema })
  })

  // Inside the removed parameter, `M` is inlined while `a` has already given
  // its `$anchor` to that discarded copy. `UsesM` does not reuse that copy of
  // `M` with `a` stripped, so the `$anchor` survives.
  it('does not reuse what a removed parameter inlined', () => {
    const anchored = { $anchor: 'a', type: 'string' }
    const result = convertSpec({
      paths: { '/a': dropped({ $id: id, properties: { a: anchored, b: { $ref: '#/components/mediaTypes/M/schema' } } }) },
      components: {
        mediaTypes: { M: { schema: { properties: { x: { $ref: '#/paths/~1a/get/parameters/0/schema/properties/a' } } } } },
        schemas: { UsesM: { $ref: '#/components/mediaTypes/M/schema' } },
      },
    })
    expect(dig(result, 'components', 'schemas', 'UsesM')).toEqual({ properties: { x: anchored } })
  })

  // Without identifiers, what a removed parameter inlined is reused as usual.
  it('reuses what a removed parameter inlined when it identified nothing', () => {
    const reads = { count: 0 }
    const length = 50
    const moved = countReads({ properties: { a: { type: 'string' } }, type: 'object' }, 'properties', reads)
    const parameters = Array.from({ length }, (_, index) => ({
      content: { 'text/plain': { $ref: '#/nowhere' } },
      in: 'query',
      name: `p${index}`,
      schema: { $ref: '#/components/mediaTypes/M/schema' },
    }))
    const result = convertSpec({ components: { mediaTypes: { M: { schema: moved } } }, paths: { '/a': { get: { parameters, responses } } } })
    expect(reads.count).toBe(1)
    expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([])
  })
})
