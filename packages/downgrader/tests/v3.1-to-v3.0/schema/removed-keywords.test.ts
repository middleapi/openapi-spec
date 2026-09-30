// 3.0 supports a fixed subset of JSON Schema, and "additional keywords
// defined by the JSON Schema specification that are not mentioned here are
// strictly unsupported": https://spec.openapis.org/oas/v3.0.4.html#json-schema-keywords
// The official 3.0 schema rejects them (`additionalProperties: false`), so
// JSON Schema 2020-12 keywords without a 3.0 form are removed.

import { downgradeSchemaV31ToV30 } from '@openapi-spec/downgrader'

function convert(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

it('removes every keyword with no 3.0 equivalent', () => {
  expect(convert({
    $anchor: 'a',
    $comment: 'c',
    $defs: { D: { type: 'string' } },
    $dynamicAnchor: 'da',
    $dynamicRef: '#dr',
    $id: 'https://example.com/s',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $vocabulary: { 'https://example.com/v': true },
    contains: { type: 'string' },
    contentSchema: { type: 'string' },
    dependentRequired: { a: ['b'] },
    dependentSchemas: { a: { type: 'object' } },
    else: { title: 'e' },
    if: { title: 'i' },
    maxContains: 2,
    minContains: 1,
    patternProperties: { '^x': { type: 'string' } },
    prefixItems: [{ type: 'string' }],
    propertyNames: { pattern: '^a' },
    then: { title: 't' },
    type: 'string',
    unevaluatedItems: false,
    unevaluatedProperties: false,
  })).toEqual({ type: 'string' })
})

// Some keywords only mean something together with a removed neighbor:
// - Beside `prefixItems`, `items` applies to the items after the prefix
//   only: https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.1.2
//   Kept alone, it would wrongly constrain the prefix items too.
// - Beside `patternProperties`, `additionalProperties` skips the
//   properties the patterns match: https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.2.3
//   Kept alone, it would wrongly constrain those properties too.
it.each([
  ['removes items together with prefixItems', { items: { type: 'integer' }, prefixItems: [{ type: 'string' }] }, {}],
  [
    'removes a boolean additionalProperties together with patternProperties',
    { additionalProperties: false, patternProperties: { '^x-': {} }, properties: { name: { type: 'string' } }, type: 'object' },
    { properties: { name: { type: 'string' } }, type: 'object' },
  ],
  [
    'removes a schema additionalProperties together with patternProperties',
    { additionalProperties: { type: 'integer' }, patternProperties: { '^x-': {} }, type: 'object' },
    { type: 'object' },
  ],
])('%s', (_name, input, expected) => {
  expect(convert(input)).toEqual(expected)
})

// An array keeps its `type`, so it needs an `items` again once the removed
// `prefixItems` took the original one with it.
it('gives an array that lost its items an empty one', () => {
  expect(convert({ items: { type: 'integer' }, prefixItems: [{ type: 'string' }], type: 'array' })).toEqual({ items: {}, type: 'array' })
})

it('keeps extensions and unknown keywords', () => {
  const input = { 'customKeyword': 'v', 'title': 't', 'x-foo': { a: 1 } }
  expect(convert(input)).toEqual(input)
})
