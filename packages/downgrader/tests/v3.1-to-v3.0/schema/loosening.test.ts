// Removing a keyword with no 3.0 form (see removed-keywords.test.ts) makes a
// schema accept more values: it is "loosened". A looser schema never rejects
// a value the original accepted, which is the safe direction for a
// conversion. Two applicators flip that direction:
// - `not` rejects what its operand accepts, so a looser operand rejects
//   more: https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.1.4
//   Such a `not` is removed instead, which loosens the enclosing schema.
// - `oneOf` rejects a value that more than one branch accepts, so a looser
//   branch can start to overlap another and reject valid values:
//   https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.1.3
//   Such a `oneOf` becomes `anyOf`, which accepts any overlap.
// Loosening propagates up through `properties`, `items`,
// `additionalProperties`, `allOf`, and `anyOf`, and a cut recursion or an
// object cycle counts as loosened too.

import { downgradeSchemaV31ToV30 } from '@openapi-spec/downgrader'

function convert(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

describe('not', () => {
  it.each([
    ['removes a not whose operand lost a keyword', { not: { patternProperties: { a: {} } } }, {}],
    ['removes a not whose operand is loosened deeper down', { not: { properties: { a: { if: {} } } } }, {}],
    ['removes a not whose operand lost an empty enum', { not: { enum: [] } }, {}],
    ['removes a not whose operand is a cut recursion', { $defs: { a: { not: { $ref: '#/$defs/a' } } }, $ref: '#/$defs/a' }, { allOf: [{}] }],
    ['removes a not whose null-only type has a malformed enum', { not: { enum: 'junk', type: 'null' } }, {}],
    // `const: 1` with `enum: [2]` accepts nothing, but `enum: [1]` accepts 1.
    ['removes a not whose const falls outside its enum', { not: { const: 1, enum: [2] } }, {}],
    ['removes both nots of a loosened double negation', { not: { not: { prefixItems: [] } } }, {}],
    [
      'follows loosening through items, additionalProperties, allOf, and anyOf',
      { not: { allOf: [{ anyOf: [{ additionalProperties: { items: { contains: {} } } }] }] } },
      {},
    ],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })

  it.each([
    ['keeps a not whose const lies inside its enum', { not: { const: 1, enum: [1, 2] } }, { not: { enum: [1] } }],
    ['keeps a not whose operand converts exactly', { not: { type: ['string', 'null'] } }, { not: { nullable: true, type: 'string' } }],
    ['keeps a not whose null-only operand matches nothing exactly', { not: { const: 'a', type: 'null' } }, { not: { enum: ['a'], not: {} } }],
    ['keeps a not over a boolean schema', { not: false }, { not: { not: {} } }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })
})

describe('oneOf', () => {
  it.each([
    ['turns a oneOf with a loosened branch into anyOf', { oneOf: [{ prefixItems: [] }, { type: 'string' }] }, { anyOf: [{}, { type: 'string' }] }],
    [
      'nests that anyOf in allOf beside an existing anyOf',
      { anyOf: [{ type: 'string' }], oneOf: [{ unevaluatedProperties: false }] },
      { allOf: [{ anyOf: [{}] }], anyOf: [{ type: 'string' }] },
    ],
    ['keeps a oneOf whose branches convert exactly', { oneOf: [{ type: ['integer', 'null'] }, { type: 'string' }] }, { oneOf: [{ nullable: true, type: 'integer' }, { type: 'string' }] }],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })
})

describe('object cycles', () => {
  // A dereferenced schema can contain itself. The cycle is kept as a cycle,
  // but it cannot be proven exact, so it counts as loosened.
  it('treats a cycle of the input graph as loosened under not and oneOf', () => {
    const negated: any = { not: { properties: {} }, patternProperties: { '^x': { type: 'string' } } }
    negated.not.properties.p = negated
    expect(convert(negated)).toEqual({})

    const tree: any = { oneOf: [{ required: ['value'], type: 'object' }], unevaluatedProperties: false }
    tree.oneOf.push({ properties: { children: { items: tree, type: 'array' } }, type: 'object' })
    const out = convert(tree) as any
    expect(out.oneOf).toBeUndefined()
    expect(out.anyOf[1].properties.children.items).toBe(out)
  })
})
