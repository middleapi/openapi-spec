// In 3.0, `type` MUST be a single string and `"null"` is not a type:
// https://spec.openapis.org/oas/v3.0.4.html#json-schema-keywords
// https://spec.openapis.org/oas/v3.0.4.html#data-types
// Null is allowed with `nullable: true` instead, which only takes effect
// beside an explicit `type`: https://spec.openapis.org/oas/v3.0.4.html#schema-nullable
// The official guide shows the same mapping in the other direction:
// https://learn.openapis.org/upgrading/v3.0-to-v3.1.html#replace-nullable-with-type-arrays

import { convertSchema } from './helpers'

describe('a single type', () => {
  it.each([
    ['keeps a single type', { type: 'string' }, { type: 'string' }],
    ['turns a type and null into nullable', { type: ['string', 'null'] }, { nullable: true, type: 'string' }],
    ['deduplicates entries', { type: ['string', 'string'] }, { type: 'string' }],
    ['ignores non-string entries beside valid ones', { type: ['string', 42] }, { type: 'string' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('only null', () => {
  // `nullable` does nothing without a `type` beside it, so a schema that
  // accepts only null becomes an enum of the single value null.
  it.each([
    ['turns type: "null" into a null enum', { type: 'null' }, { enum: [null] }],
    ['turns type: ["null"] into a null enum', { type: ['null'] }, { enum: [null] }],
    ['narrows an existing enum that allows null', { enum: ['a', null], type: ['null'] }, { enum: [null] }],
    ['converts a null-only anyOf branch', { anyOf: [{ type: 'string' }, { type: 'null' }] }, { anyOf: [{ type: 'string' }, { enum: [null] }] }],
    // Here the 3.1 schema accepts nothing at all: the value must be null and
    // also one of the enum values, none of which is null. `not: {}` keeps
    // that meaning, since `{}` accepts everything.
    ['matches nothing when the enum of a null-only type excludes null', { enum: ['a'], type: ['null'] }, { enum: ['a'], not: {} }],
    ['drops the type beside a malformed enum', { enum: 'junk', type: ['null'] }, { enum: 'junk' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('a 3.0 nullable in the input', () => {
  // 3.1 removed `nullable`, so in a 3.1 schema it is an unknown keyword that
  // admits nothing: https://learn.openapis.org/upgrading/v3.0-to-v3.1.html#replace-nullable-with-type-arrays
  // Kept, it would admit null in 3.0. Only a `"null"` entry in `type` makes
  // the output nullable, so `nullable` never appears without a `type`.
  it.each([
    ['drops it beside a single type', { nullable: true, type: 'string' }, { type: 'string' }],
    ['drops it beside a null-only type', { nullable: true, type: 'null' }, { enum: [null] }],
    ['drops it beside several types', { nullable: true, type: ['string', 'integer'] }, { anyOf: [{ type: 'string' }, { type: 'integer' }] }],
    ['drops it without a type', { nullable: true }, {}],
    ['lets null in type override nullable: false', { nullable: false, type: ['string', 'null'] }, { nullable: true, type: 'string' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('several types', () => {
  // A union of types has no 3.0 `type` form, so each type becomes its own
  // `anyOf` branch. When null was listed, every branch is nullable.
  it.each([
    ['turns several types into anyOf branches', { type: ['string', 'integer'] }, { anyOf: [{ type: 'string' }, { type: 'integer' }] }],
    [
      'makes every branch nullable when null was listed',
      { type: ['string', 'integer', 'null'] },
      { anyOf: [{ nullable: true, type: 'string' }, { nullable: true, type: 'integer' }] },
    ],
    // 3.0 requires `items` wherever `type` is `"array"`, so the array branch
    // takes the sibling `items`, or an empty one when there is none. Other
    // types ignore `items`, so it moves rather than being copied.
    ['gives the array branch an empty items', { type: ['array', 'string'] }, { anyOf: [{ items: {}, type: 'array' }, { type: 'string' }] }],
    [
      'moves a sibling items into the array branch',
      { items: { type: 'integer' }, type: ['array', 'string', 'null'] },
      { anyOf: [{ items: { type: 'integer' }, nullable: true, type: 'array' }, { nullable: true, type: 'string' }] },
    ],
    // `xml.wrapped` likewise applies only beside `type: "array"`:
    // https://spec.openapis.org/oas/v3.0.4.html#xml-wrapped
    // The rest of `xml` names the element whatever its type, so it stays.
    [
      'moves xml.wrapped into the array branch',
      { type: ['array', 'string', 'null'], xml: { name: 'w', prefix: 'p', wrapped: true } },
      {
        anyOf: [{ items: {}, nullable: true, type: 'array', xml: { name: 'w', prefix: 'p', wrapped: true } }, { nullable: true, type: 'string' }],
        xml: { name: 'w', prefix: 'p' },
      },
    ],
    [
      'leaves xml in place when no branch is an array',
      { type: ['object', 'string'], xml: { name: 'w', wrapped: true } },
      { anyOf: [{ type: 'object' }, { type: 'string' }], xml: { name: 'w', wrapped: true } },
    ],
    [
      'leaves items in place when no branch is an array',
      { items: { type: 'integer' }, type: ['object', 'string'] },
      { anyOf: [{ type: 'object' }, { type: 'string' }], items: { type: 'integer' } },
    ],
    // An existing `anyOf` must keep applying too, so the type union joins
    // `allOf` rather than replacing or merging into it.
    [
      'wraps the union into allOf when anyOf already exists',
      { anyOf: [{ minLength: 1 }], type: ['string', 'integer'] },
      { allOf: [{ anyOf: [{ type: 'string' }, { type: 'integer' }] }], anyOf: [{ minLength: 1 }] },
    ],
    [
      'appends the union to an existing allOf',
      { allOf: [{ title: 't' }], anyOf: [{ minLength: 1 }], type: ['string', 'integer'] },
      { allOf: [{ title: 't' }, { anyOf: [{ type: 'string' }, { type: 'integer' }] }], anyOf: [{ minLength: 1 }] },
    ],
    [
      'nests a malformed allOf beside the union',
      { allOf: 'junk', anyOf: [{ type: 'string' }], items: { type: 'integer' }, type: ['array', 'string'] },
      {
        allOf: [{ allOf: 'junk' }, { anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'string' }] }],
        anyOf: [{ type: 'string' }],
      },
    ],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })

  // Each level moves `items` into one branch instead of copying it into
  // several, so nested unions grow linearly rather than doubling per level.
  it('keeps nested multi-type arrays linear instead of doubling per level', () => {
    let input: unknown = { type: 'string' }
    let expected: unknown = { type: 'string' }
    for (let index = 0; index < 10; index += 1) {
      input = { items: input, type: ['array', 'object'] }
      expected = { anyOf: [{ items: expected, type: 'array' }, { type: 'object' }] }
    }
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('arrays', () => {
  // "`items` MUST be present if `type` is `"array"`":
  // https://spec.openapis.org/oas/v3.0.4.html#json-schema-keywords
  // `{}` accepts every item, which is what an absent `items` means in 3.1.
  it.each([
    ['adds an empty items to an array without one', { type: 'array' }, { items: {}, type: 'array' }],
    ['adds an empty items to a nullable array without one', { type: ['array', 'null'] }, { items: {}, nullable: true, type: 'array' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('malformed type values', () => {
  it.each([
    ['passes an array of non-string entries through', { type: [42] }, { type: [42] }],
    ['passes a number through', { type: 42 }, { type: 42 }],
    ['passes an object through', { type: { a: 1 } }, { type: { a: 1 } }],
    ['drops an empty array', { type: [] }, {}],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})
