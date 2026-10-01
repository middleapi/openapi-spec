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

import { dig } from '../../helpers'
import { expectValidAs, expectValidDowngrade } from '../../validate'
import { convertPathItem, convertSpec } from './helpers'

/**
 * Counts the `$id`s that JSON.stringify would write for `value`, without
 * writing the text, which repeats a shared object once per place.
 */
function countIds(value: unknown, counts = new Map<object, number>()): number {
  if (typeof value !== 'object' || value === null) {
    return 0
  }
  let count = counts.get(value)
  if (count === undefined) {
    count = Object.entries(value).reduce((sum, [key, item]) => sum + (key === '$id' ? 1 : countIds(item, counts)), 0)
    counts.set(value, count)
  }
  return count
}

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

// A YAML alias (`'200': *ok` after `'200': &ok`), like any object a document
// reuses, puts one input object in several places. Converting it once for all
// of them would repeat the identifiers of the schema inlined into it, so each
// place after the first converts it again and gets the identifier-free copy.
it('keeps identifiers unique where the input reuses an object that inlines an identified schema', async () => {
  const pet: OpenAPIV3_2.SchemaObject = { $id: 'https://example.com/pet', properties: { name: { $anchor: 'name', type: 'string' } }, type: 'object' }
  const response = {
    content: { 'application/json': { schema: { $ref: '#/components/mediaTypes/Pet/schema' } } },
    description: 'ok',
  }
  const doc: OpenAPIV3_2.OpenAPIObject = {
    components: { mediaTypes: { Pet: { schema: pet } } },
    info: { title: 'Aliases', version: '1.0.0' },
    openapi: '3.2.0',
    paths: {
      '/a': { get: { responses: { 200: response } } },
      '/b': { get: { responses: { 200: response } } },
      '/c': { get: { responses: { 200: response } } },
    },
  }
  const v31 = await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
  const serialized = JSON.stringify(v31)
  expect(serialized.match(/"\$id"/g)).toHaveLength(1)
  expect(serialized.match(/"\$anchor"/g)).toHaveLength(1)
  const responses = (path: string): unknown => dig(v31, 'paths', path, 'get', 'responses', '200')
  expect(dig(responses('/a'), 'content', 'application/json', 'schema')).toEqual(pet)
  expect(dig(responses('/b'), 'content', 'application/json', 'schema')).toEqual({
    properties: { name: { type: 'string' } },
    type: 'object',
  })
  expect(responses('/c')).toBe(responses('/b'))
})

// Callbacks under the removed `query` operation are gone in 3.1, so a Path
// Item `$ref` into them is replaced by the Path Items along its chain.
it('keeps identifiers unique where the input reuses a Path Item whose $ref chain is merged into it', async () => {
  const pathItem = { $ref: '#/paths/~1x/query/callbacks/cb/first' }
  const doc: OpenAPIV3_2.OpenAPIObject = {
    info: { title: 'Aliases', version: '1.0.0' },
    openapi: '3.2.0',
    paths: {
      '/a': pathItem,
      '/b': pathItem,
      '/x': {
        query: {
          callbacks: {
            cb: {
              first: {
                $ref: '#/paths/~1x/query/callbacks/cb/second',
                get: {
                  responses: {
                    200: { content: { 'application/json': { schema: { $id: 'https://example.com/pet' } } }, description: 'ok' },
                  },
                },
              },
              second: { post: { responses: { 200: { description: 'ok' } } } },
            },
          },
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  }
  const v31 = await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
  expect(JSON.stringify(v31).match(/"\$id"/g)).toHaveLength(1)
  const schema = (path: string): unknown => dig(v31, 'paths', path, 'get', 'responses', '200', 'content', 'application/json', 'schema')
  expect(schema('/a')).toEqual({ $id: 'https://example.com/pet' })
  expect(schema('/b')).toEqual({})
  expect(dig(v31, 'paths', '/b', 'post')).toEqual({ responses: { 200: { description: 'ok' } } })
})

// A shared object is converted again only until a copy without identifiers
// exists, so a deep diamond (2^40 paths) still takes linear work.
it('keeps identifiers unique in a deep shared diamond that inlines an identified schema', () => {
  let schema: Record<string, unknown> = { $ref: '#/components/mediaTypes/Leaf/schema' }
  for (let depth = 0; depth < 40; depth++) {
    schema = { properties: { a: schema, b: schema }, type: 'object' }
  }
  const result = convertSpec({
    components: {
      mediaTypes: { Leaf: { schema: { $id: 'https://example.com/leaf', type: 'string' } } },
      schemas: { Root: schema },
    },
  })
  expect(countIds(result)).toBe(1)
  const copy = dig(result, 'components', 'schemas', 'Root', 'properties', 'b')
  expect(dig(copy, 'properties', 'a')).toBe(dig(copy, 'properties', 'b'))
})
