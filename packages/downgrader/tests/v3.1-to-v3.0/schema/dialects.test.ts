// A 3.1 schema is read in the dialect its `$schema` names, else in the
// dialect of the schema around it, else in the document's
// `jsonSchemaDialect` (see ../spec/document.test.ts), else in the OAS
// dialect, which builds on JSON Schema 2020-12:
// https://spec.openapis.org/oas/v3.1.2.html#schema-object
// Earlier drafts give some keywords another meaning, so a schema written in
// one of them is converted with that meaning. Any other dialect is read as
// 2020-12.

import { convertSchema } from './helpers'

const DRAFT_04 = 'http://json-schema.org/draft-04/schema#'
const DRAFT_06 = 'http://json-schema.org/draft-06/schema#'
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#'
const DRAFT_2019_09 = 'https://json-schema.org/draft/2019-09/schema'
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

describe('$ref with sibling keywords', () => {
  // Up to draft-07, "All other properties in a "$ref" object MUST be
  // ignored": https://json-schema.org/draft-07/draft-handrews-json-schema-01#rfc.section.8.3
  // The siblings never applied, so only the `$ref` is kept.
  it.each([
    DRAFT_04,
    DRAFT_06,
    DRAFT_07,
    'https://json-schema.org/draft-07/schema',
  ])('keeps the $ref alone under %s', (dialect) => {
    expect(convertSchema({ $ref: '#/c/s', $schema: dialect, description: 'd', type: 'string' })).toEqual({ $ref: '#/c/s' })
  })

  // From 2019-09 on, keywords beside a `$ref` apply too:
  // https://json-schema.org/draft/2019-09/json-schema-core#ref
  it('moves the $ref into allOf under 2019-09, as under 2020-12', () => {
    expect(convertSchema({ $ref: '#/c/s', $schema: DRAFT_2019_09, minLength: 1 })).toEqual({ allOf: [{ $ref: '#/c/s' }], minLength: 1 })
  })

  it.each([
    DRAFT_2020_12,
    'https://spec.openapis.org/oas/3.1/dialect/base',
    'https://example.com/custom-dialect',
  ])('reads %s as 2020-12', (dialect) => {
    expect(convertSchema({ $ref: '#/c/s', $schema: dialect, minLength: 1 })).toEqual({ allOf: [{ $ref: '#/c/s' }], minLength: 1 })
  })
})

describe('array items', () => {
  // Before 2020-12, an array `items` holds one schema per position, and
  // `additionalItems` covers the positions after it:
  // https://json-schema.org/draft/2019-09/json-schema-core#items
  // https://json-schema.org/draft/2019-09/json-schema-core#additionalItems
  // 2020-12 renamed them `prefixItems` and `items`, which 3.0 cannot express
  // either (see removed-keywords.test.ts), so both are removed.
  it.each([DRAFT_07, DRAFT_2019_09])('removes array items and additionalItems under %s', (dialect) => {
    expect(convertSchema({
      $schema: dialect,
      additionalItems: { type: 'integer' },
      items: [{ type: 'string' }],
      type: 'array',
    })).toEqual({ items: {}, type: 'array' })
  })

  it('treats removed array items as loosening', () => {
    expect(convertSchema({ $schema: DRAFT_07, not: { items: [{ type: 'string' }] } })).toEqual({})
    expect(convertSchema({ $schema: DRAFT_07, oneOf: [{ items: [{ type: 'string' }] }, { type: 'string' }] })).toEqual({
      anyOf: [{}, { type: 'string' }],
    })
  })

  // Beside a single-schema `items`, `additionalItems` does nothing, so
  // removing it loosens nothing.
  it('keeps a single-schema items and its meaning', () => {
    expect(convertSchema({
      $schema: DRAFT_07,
      not: { additionalItems: false, items: { type: ['string', 'null'] }, type: 'array' },
    })).toEqual({ not: { items: { nullable: true, type: 'string' }, type: 'array' } })
  })
})

describe('keywords removed after draft-07 and 2019-09', () => {
  // `dependencies` was split into `dependentRequired` and
  // `dependentSchemas` in 2019-09, which 3.0 lacks as well:
  // https://json-schema.org/draft-07/draft-handrews-json-schema-validation-01#rfc.section.6.5.7
  it('removes dependencies as loosening', () => {
    expect(convertSchema({ $schema: DRAFT_07, dependencies: { a: ['b'], c: { required: ['d'] } }, type: 'object' })).toEqual({ type: 'object' })
    expect(convertSchema({ $schema: DRAFT_07, not: { dependencies: { a: ['b'] } } })).toEqual({})
  })

  // `definitions` is the draft-07 name of `$defs`, so it goes the same way.
  it('removes definitions and inlines $refs into them', () => {
    expect(convertSchema({
      $schema: DRAFT_07,
      definitions: { a: { type: ['string', 'null'] } },
      items: { $ref: '#/definitions/a' },
      type: 'array',
    })).toEqual({ items: { nullable: true, type: 'string' }, type: 'array' })
  })

  // 2019-09 recursion became `$dynamicRef` and `$dynamicAnchor` in 2020-12:
  // https://json-schema.org/draft/2019-09/json-schema-core#recursive-ref
  it('removes $recursiveRef as loosening, and $recursiveAnchor', () => {
    expect(convertSchema({
      $recursiveAnchor: true,
      $schema: DRAFT_2019_09,
      properties: { next: { $recursiveRef: '#' } },
      type: 'object',
    })).toEqual({ properties: { next: {} }, type: 'object' })
    expect(convertSchema({ $schema: DRAFT_2019_09, not: { $recursiveRef: '#' } })).toEqual({})
  })

  // Under 2020-12 these keywords are unknown, and unknown keywords are kept.
  it('keeps them under 2020-12', () => {
    const schema = { additionalItems: false, definitions: {}, dependencies: {}, items: [{ type: 'string' }] }
    expect(convertSchema(schema)).toEqual(schema)
  })
})

describe('the dialect of a subschema', () => {
  it('is the dialect of the schema around it', () => {
    expect(convertSchema({ $schema: DRAFT_07, properties: { a: { $ref: '#/c/s', type: 'string' } } })).toEqual({
      properties: { a: { $ref: '#/c/s' } },
    })
  })

  it('is the one it names itself, if any', () => {
    expect(convertSchema({
      $schema: DRAFT_07,
      properties: { a: { $ref: '#/c/s', $schema: DRAFT_2020_12, type: 'string' } },
    })).toEqual({ properties: { a: { allOf: [{ $ref: '#/c/s' }], type: 'string' } } })
    expect(convertSchema({ properties: { a: { $ref: '#/c/s', $schema: DRAFT_07, type: 'string' } } })).toEqual({
      properties: { a: { $ref: '#/c/s' } },
    })
  })

  // A `$ref` target keeps the dialect of the place it is written in, so an
  // inlined target is read there, not where the `$ref` is.
  it('follows an inlined target, not the $ref', () => {
    expect(convertSchema({
      $defs: {
        int: { type: 'integer' },
        legacy: {
          $schema: DRAFT_07,
          definitions: {
            alias: { $ref: '#/$defs/modern' },
            overridden: { $ref: '#/$defs/int', type: 'string' },
          },
        },
        modern: { $ref: '#/$defs/int', type: 'string' },
      },
      properties: {
        a: { $ref: '#/$defs/legacy/definitions/overridden' },
        b: { $ref: '#/$defs/legacy/definitions/alias' },
      },
    })).toEqual({
      properties: {
        a: { type: 'integer' },
        b: { allOf: [{ type: 'integer' }], type: 'string' },
      },
    })
  })
})
