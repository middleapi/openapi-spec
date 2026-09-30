import { downgradeSchemaV31ToV30 } from '@openapi-spec/downgrader'

function convert(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

describe('boolean schemas', () => {
  // `true` and `false` are schemas in JSON Schema 2020-12 that accept
  // everything and nothing: https://json-schema.org/draft/2020-12/json-schema-core#section-4.3.2
  // 3.0 needs Schema Objects, so they become `{}` and `{ not: {} }`.
  it('converts the boolean schemas', () => {
    expect(downgradeSchemaV31ToV30(true)).toEqual({})
    expect(downgradeSchemaV31ToV30(false)).toEqual({ not: {} })
  })

  // `additionalProperties` is the one place 3.0 still takes a boolean:
  // https://spec.openapis.org/oas/v3.0.4.html#json-schema-keywords
  it.each([
    ['keeps a boolean additionalProperties', { additionalProperties: false }, { additionalProperties: false }],
    ['converts a boolean property schema', { properties: { a: true } }, { properties: { a: {} } }],
    ['converts a true items schema', { items: true }, { items: {} }],
    ['converts a false items schema', { items: false }, { items: { not: {} } }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })
})

describe('nested schemas', () => {
  it.each([
    [
      'converts property schemas',
      { properties: { a: { type: ['string', 'null'] }, b: true }, type: 'object' },
      { properties: { a: { nullable: true, type: 'string' }, b: {} }, type: 'object' },
    ],
    ['converts a schema additionalProperties', { additionalProperties: { type: ['string', 'null'] } }, { additionalProperties: { nullable: true, type: 'string' } }],
    [
      'converts allOf, anyOf, oneOf, and not',
      { allOf: [true], anyOf: [{ const: 1 }], not: false, oneOf: [{ type: ['integer', 'null'] }] },
      { allOf: [{}], anyOf: [{ enum: [1] }], not: { not: {} }, oneOf: [{ nullable: true, type: 'integer' }] },
    ],
    ['converts items', { items: { type: ['string', 'null'] } }, { items: { nullable: true, type: 'string' } }],
    ['passes a malformed allOf through', { allOf: 'junk' }, { allOf: 'junk' }],
    ['passes malformed properties through', { properties: 5 }, { properties: 5 }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })

  // `const`, `default`, and `enum` hold instance data: a value there that
  // looks like a schema is copied as is.
  it('does not convert schema-like values outside subschema positions', () => {
    const data = { type: ['string', 'null'] }
    expect(convert({ 'default': data, 'enum': [data], 'x-data': data })).toEqual({ 'default': data, 'enum': [data], 'x-data': data })
  })
})
