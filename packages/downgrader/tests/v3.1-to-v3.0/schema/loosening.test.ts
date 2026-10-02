// Removing a keyword with no 3.0 form (see removed-keywords.test.ts) can make
// a schema accept more values: it is "loosened". A looser schema never rejects
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

import { dig } from '../../helpers'
import { convertSchema } from './helpers'

describe('not', () => {
  it.each([
    ['removes a not whose operand lost a keyword', { not: { patternProperties: { a: {} } } }, {}],
    ['removes a not whose operand is loosened deeper down', { not: { properties: { a: { unevaluatedProperties: false } } } }, {}],
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
    ['keeps a not whose const lies inside its enum', { not: { const: 1, enum: [1, 2] } }, { not: { enum: [1] } }],
    // `const` and `enum` compare values structurally, with object keys in any
    // order: https://json-schema.org/draft/2020-12/json-schema-core#section-4.2.2
    ['keeps a not whose array const equals an enum entry', { not: { const: [1], enum: [[1], [2]] } }, { not: { enum: [[1]] } }],
    [
      'keeps a not whose object const equals an enum entry',
      { not: { const: { a: 1, b: [{ c: null }] }, enum: [{ b: [{ c: null }], a: 1 }] } },
      { not: { enum: [{ a: 1, b: [{ c: null }] }] } },
    ],
    ['removes a not whose array const differs from its enum entries in order', { not: { const: [1, 2], enum: [[2, 1]] } }, {}],
    ['removes a not whose object const differs from its enum entries in keys', { not: { const: { a: 1 }, enum: [{ a: 1, b: 2 }, [1]] } }, {}],
    ['keeps a not whose operand converts exactly', { not: { type: ['string', 'null'] } }, { not: { nullable: true, type: 'string' } }],
    ['keeps a not whose null-only operand matches nothing exactly', { not: { const: 'a', type: 'null' } }, { not: { enum: ['a'], not: {} } }],
    // 3.1 ignores `nullable`, so this accepts null. Dropping `nullable` is
    // exact, so the not stays and keeps accepting null.
    ['keeps a not whose operand had a 3.0 nullable', { not: { nullable: true, type: 'string' } }, { not: { type: 'string' } }],
    ['keeps a not over a boolean schema', { not: false }, { not: { not: {} } }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
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
    // 3.1 ignores `nullable`, so only the second branch accepts null. Kept, it
    // would make both accept null, and oneOf would reject it.
    [
      'keeps a oneOf whose branch had a 3.0 nullable',
      { oneOf: [{ nullable: true, type: 'string' }, { type: 'null' }] },
      { oneOf: [{ type: 'string' }, { enum: [null] }] },
    ],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('removed keywords that restrict nothing', () => {
  // A removed keyword loosens a schema only when it can reject a value:
  // - `then` and `else` apply only beside `if`, and `if` alone rejects
  //   nothing: https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.2
  // - `minContains` and `maxContains` apply only beside `contains`:
  //   https://json-schema.org/draft/2020-12/json-schema-validation#section-6.4.4
  // - A `true` or `{}` subschema accepts everything.
  // - `propertyNames` only sees strings, so a subschema that accepts every
  //   string rejects nothing. zod v4 records emit `propertyNames: { type: 'string' }`.
  // - `dependentRequired` without names requires nothing.
  // Anything less certain, such as a malformed value, still loosens.
  // `patternProperties` and `prefixItems` always do, because they take the
  // `additionalProperties` or `items` beside them (see removed-keywords.test.ts).
  it.each([
    ['keeps a not whose then has no if', { not: { then: { minLength: 1 }, type: 'string' } }, { not: { type: 'string' } }],
    ['keeps a not whose else has no if', { not: { else: false, type: 'string' } }, { not: { type: 'string' } }],
    ['keeps a not whose if has no then or else', { not: { if: { minLength: 1 }, type: 'string' } }, { not: { type: 'string' } }],
    ['keeps a not whose then and else accept everything', { not: { else: {}, if: { minLength: 1 }, then: true, type: 'string' } }, { not: { type: 'string' } }],
    ['keeps a not whose minContains and maxContains have no contains', { not: { maxContains: 2, minContains: 1, minItems: 1 } }, { not: { minItems: 1 } }],
    ['keeps a not whose unevaluatedProperties is true', { not: { type: 'object', unevaluatedProperties: true } }, { not: { type: 'object' } }],
    ['keeps a not whose unevaluatedItems is empty', { not: { minItems: 1, unevaluatedItems: {} } }, { not: { minItems: 1 } }],
    ['keeps a not whose dependentRequired is empty', { not: { dependentRequired: {}, type: 'object' } }, { not: { type: 'object' } }],
    ['keeps a not whose dependentRequired lists no names', { not: { dependentRequired: { a: [] }, type: 'object' } }, { not: { type: 'object' } }],
    ['keeps a not whose dependentSchemas accept everything', { not: { dependentSchemas: { a: true, b: {} }, type: 'object' } }, { not: { type: 'object' } }],
    [
      'keeps a oneOf whose branch is a zod v4 record',
      { oneOf: [{ additionalProperties: { type: 'number' }, propertyNames: { type: 'string' }, type: 'object' }, { type: 'string' }] },
      { oneOf: [{ additionalProperties: { type: 'number' }, type: 'object' }, { type: 'string' }] },
    ],
    ['removes a not whose then applies beside if', { not: { if: { type: 'string' }, then: { minLength: 1 } } }, {}],
    ['removes a not whose else applies beside if', { not: { else: false, if: { type: 'string' } } }, {}],
    ['removes a not whose minContains applies beside contains', { not: { contains: true, minContains: 2 } }, {}],
    ['removes a not whose unevaluatedProperties rejects', { not: { unevaluatedProperties: false } }, {}],
    ['removes a not whose unevaluatedItems rejects', { not: { unevaluatedItems: { type: 'string' } } }, {}],
    ['removes a not whose propertyNames rejects some strings', { not: { propertyNames: { maxLength: 3, type: 'string' } } }, {}],
    ['removes a not whose dependentRequired names a property', { not: { dependentRequired: { a: ['b'] } } }, {}],
    ['removes a not whose dependentSchemas reject', { not: { dependentSchemas: { a: true, b: { required: ['c'] } } } }, {}],
    ['removes a not whose dependentRequired is malformed', { not: { dependentRequired: 'junk' } }, {}],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('object cycles', () => {
  // A dereferenced schema can contain itself. The cycle is kept as a cycle,
  // but it cannot be proven exact, so it counts as loosened.
  it('treats a cycle of the input graph as loosened under not and oneOf', () => {
    const negated: any = { not: { properties: {} }, patternProperties: { '^x': { type: 'string' } } }
    negated.not.properties.p = negated
    expect(convertSchema(negated)).toEqual({})

    const tree: any = { oneOf: [{ required: ['value'], type: 'object' }], unevaluatedProperties: false }
    tree.oneOf.push({ properties: { children: { items: tree, type: 'array' } }, type: 'object' })
    const out = convertSchema(tree)
    expect(out).not.toHaveProperty('oneOf')
    expect(dig(out, 'anyOf', '1', 'properties', 'children', 'items')).toBe(out)
  })

  // A `const` can contain itself too, although JSON cannot. Compared with an
  // `enum` entry, the repeat matches only the same object.
  it('compares a cyclic const by identity where it repeats', () => {
    const value: any = [1]
    value.push(value)
    const copy: any = [1]
    copy.push(copy)
    expect(convertSchema({ not: { const: value, enum: [copy] } })).toEqual({})
    expect(convertSchema({ not: { const: value, enum: [value] } })).toEqual({ not: { enum: [value] } })
  })
})
