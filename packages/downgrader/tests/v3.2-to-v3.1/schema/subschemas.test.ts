import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'

const inner = { discriminator: { defaultMapping: 'A', propertyName: 'kind' } }
const converted = { discriminator: { propertyName: 'kind' } }

// Every JSON Schema 2020-12 keyword that takes a schema, a list of schemas, or
// a map of schemas: https://json-schema.org/draft/2020-12/json-schema-core#section-10
const single = ['additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'items', 'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties']
const lists = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const maps = ['$defs', 'dependentSchemas', 'patternProperties', 'properties']

it('converts nested schemas at every subschema position', () => {
  expect(downgradeSchemaV32ToV31({
    ...Object.fromEntries(single.map(key => [key, inner])),
    ...Object.fromEntries(lists.map(key => [key, [inner, true]])),
    ...Object.fromEntries(maps.map(key => [key, { a: inner }])),
  } as any)).toEqual({
    ...Object.fromEntries(single.map(key => [key, converted])),
    ...Object.fromEntries(lists.map(key => [key, [converted, true]])),
    ...Object.fromEntries(maps.map(key => [key, { a: converted }])),
  })
})

// `const`, `default`, `enum`, and `examples` hold instance data, and
// extensions hold anything. A value there that looks like a schema is not
// one, so it is copied as is.
it('does not convert schema-like values outside subschema positions', () => {
  const schema = { 'const': inner, 'default': inner, 'enum': [inner], 'examples': [inner], 'x-extension': inner }
  expect(downgradeSchemaV32ToV31(schema as any)).toEqual(schema)
})

it('converts nested schemas at any depth', () => {
  expect(downgradeSchemaV32ToV31({
    items: { properties: { a: { anyOf: [{ xml: { nodeType: 'attribute' } }] } } },
  })).toEqual({
    items: { properties: { a: { anyOf: [{ xml: { attribute: true } }] } } },
  })
})

it('clones malformed subschema containers through', () => {
  expect(downgradeSchemaV32ToV31({ allOf: 'junk', properties: 5 } as any)).toEqual({ allOf: 'junk', properties: 5 })
})
