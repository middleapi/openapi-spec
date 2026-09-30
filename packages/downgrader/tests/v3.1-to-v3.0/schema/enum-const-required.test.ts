import { downgradeSchemaV31ToV30 } from '@openapi-spec/downgrader'

function convert(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

describe('const', () => {
  // `const` arrived in JSON Schema draft 06, after the draft Wright-00 (05)
  // that 3.0 builds on. A single-value `enum` means the same:
  // https://json-schema.org/draft/2020-12/json-schema-validation#section-6.1.3
  it.each([
    ['turns const into a single-value enum', { const: 'a' }, { enum: ['a'] }],
    ['keeps a zero const', { const: 0 }, { enum: [0] }],
    ['keeps a false const', { const: false }, { enum: [false] }],
    ['keeps an empty-string const', { const: '' }, { enum: [''] }],
    ['keeps a null const', { const: null }, { enum: [null] }],
    ['keeps a null const beside a null-only type', { const: null, type: ['null'] }, { enum: [null] }],
    [
      'keeps the nullable branches of a multi-type null const',
      { const: null, type: ['string', 'integer', 'null'] },
      { anyOf: [{ nullable: true, type: 'string' }, { nullable: true, type: 'integer' }], enum: [null] },
    ],
    // Accepts nothing in both versions: null is not a string, and 3.0 does
    // not add null to a type without `nullable: true`.
    ['keeps a null const that contradicts its type', { const: null, type: 'string' }, { enum: [null], type: 'string' }],
    ['matches nothing when a non-null const contradicts a null-only type', { const: 7, type: ['null'] }, { enum: [7], not: {} }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })

  // A value must satisfy both `const` and `enum`. When the const value is in
  // the enum, the const alone says it all. When it is not, nothing matches
  // in 3.1, and the single enum is looser (see loosening.test.ts).
  it('replaces an existing enum with the const value', () => {
    expect(convert({ const: 5, enum: [1, 2, 5] })).toEqual({ enum: [5] })
    expect(convert({ const: 5, enum: [1, 2] })).toEqual({ enum: [5] })
  })
})

describe('enum', () => {
  // The official 3.0 schema requires at least one entry (`minItems: 1`):
  // https://spec.openapis.org/oas/3.0/schema/2021-09-28
  // In 3.1 an empty enum matches nothing; without it the 3.0 schema is
  // looser (see loosening.test.ts for what that means under `not`).
  it.each([
    ['removes an empty enum', { enum: [], type: 'string' }, { type: 'string' }],
    ['keeps a non-empty enum', { enum: ['a'], type: 'string' }, { enum: ['a'], type: 'string' }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })
})

describe('required', () => {
  // The official 3.0 schema requires a non-empty list of unique names
  // (`minItems: 1`, `uniqueItems: true`): https://spec.openapis.org/oas/3.0/schema/2021-09-28
  // An empty list requires nothing, and a repeated name requires nothing
  // more, so both fixes keep the meaning.
  it.each([
    ['removes an empty required list', { required: [] }, {}],
    ['keeps a non-empty required list', { required: ['a'] }, { required: ['a'] }],
    ['deduplicates required names', { required: ['a', 'b', 'a'], type: 'object' }, { required: ['a', 'b'], type: 'object' }],
    ['passes a malformed required value through', { required: 'junk' }, { required: 'junk' }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })
})
