import { convertSchema } from './helpers'

describe('examples', () => {
  // 3.1 uses the JSON Schema `examples` list, and deprecates the singular
  // OpenAPI `example`: https://spec.openapis.org/oas/v3.1.2.html#schema-example
  // 3.0 only has the singular one: https://spec.openapis.org/oas/v3.0.4.html#schema-example
  // https://learn.openapis.org/upgrading/v3.0-to-v3.1.html#change-schema-example-to-examples
  it.each([
    ['promotes the first entry to example', { examples: ['a', 'b'] }, { example: 'a' }],
    ['keeps an explicit example over the entries', { example: 'e', examples: ['a'] }, { example: 'e' }],
    ['keeps a falsy first entry', { examples: [0] }, { example: 0 }],
    ['drops an empty list', { examples: [] }, {}],
    ['drops a malformed value', { examples: 'junk' }, {}],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('binary content', () => {
  // 3.1 describes binary strings with `contentEncoding` and
  // `contentMediaType`, where 3.0 used `format: byte` and `format: binary`:
  // https://spec.openapis.org/oas/v3.1.2.html#migrating-binary-descriptions-from-oas-3-0
  // https://spec.openapis.org/oas/v3.0.4.html#working-with-binary-data
  // - encoded binary (`contentEncoding: base64`) is `format: byte`
  // - raw binary (`contentMediaType` without an encoding) is `format: binary`
  // Raw binary has no `type` in 3.1 because it is not a JSON value, but in 3.0
  // it is a `string`.
  it.each([
    ['turns base64 into format: byte', { contentEncoding: 'base64', contentMediaType: 'image/png', type: 'string' }, { format: 'byte', type: 'string' }],
    ['turns raw binary into type: string with format: binary', { contentMediaType: 'image/png' }, { format: 'binary', type: 'string' }],
    ['adds type: string beside base64 when type is missing', { contentEncoding: 'base64' }, { format: 'byte', type: 'string' }],
    ['keeps nullable on binary strings', { contentMediaType: 'image/png', type: ['string', 'null'] }, { format: 'binary', nullable: true, type: 'string' }],
    [
      'keeps format beside a type union that includes string',
      { contentMediaType: 'image/png', type: ['string', 'integer'] },
      { anyOf: [{ type: 'string' }, { type: 'integer' }], format: 'binary' },
    ],
    ['keeps an existing format', { contentEncoding: 'base64', format: 'custom' }, { format: 'custom', type: 'string' }],
    // `format: byte` is base64 as in RFC 4648 section 4, so it cannot describe
    // the URL-safe alphabet of section 5, or any other encoding:
    // https://spec.openapis.org/oas/v3.0.4.html#data-type-format
    // Content keywords on a type that is not a string have nothing to map to.
    ['drops base64url, which format: byte does not cover', { contentEncoding: 'base64url', contentMediaType: 'image/png', type: 'string' }, { type: 'string' }],
    ['drops content keywords on non-string types', { contentMediaType: 'image/png', type: 'object' }, { type: 'object' }],
    ['drops a malformed contentMediaType', { contentMediaType: 42 }, {}],
    ['drops contentSchema', { contentSchema: { type: 'string' } }, {}],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('xml.nodeType', () => {
  // `nodeType` is a 3.2 field (https://spec.openapis.org/oas/v3.2.0.html#xml-node-type)
  // that can reach a 3.1 document written by hand or by a lenient tool. The
  // 3.2 → 3.1 converter maps it the same way.
  it.each([
    ['maps attribute to attribute: true', { type: 'string', xml: { name: 'n', nodeType: 'attribute' } }, { type: 'string', xml: { attribute: true, name: 'n' } }],
    ['maps element on an array to wrapped: true', { items: {}, type: 'array', xml: { nodeType: 'element' } }, { items: {}, type: 'array', xml: { wrapped: true } }],
    ['maps element on a nullable array to wrapped: true', { type: ['array', 'null'], xml: { nodeType: 'element' } }, { items: {}, nullable: true, type: 'array', xml: { wrapped: true } }],
    ['removes element on other schemas', { type: 'string', xml: { nodeType: 'element' } }, { type: 'string', xml: {} }],
    ['removes values 3.0 cannot express', { type: 'string', xml: { name: 'n', nodeType: 'text' } }, { type: 'string', xml: { name: 'n' } }],
    ['keeps an xml object without nodeType', { type: 'string', xml: { attribute: true, name: 'n' } }, { type: 'string', xml: { attribute: true, name: 'n' } }],
    ['passes a malformed xml value through', { type: 'string', xml: 'junk' }, { type: 'string', xml: 'junk' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('discriminator', () => {
  it('keeps the discriminator and its mapping', () => {
    const schema = {
      discriminator: { mapping: { cat: '#/components/schemas/Cat' }, propertyName: 'kind' },
      oneOf: [{ $ref: '#/components/schemas/Cat' }],
    }
    expect(convertSchema(schema)).toEqual(schema)
  })

  it('passes a malformed discriminator through', () => {
    expect(convertSchema({ discriminator: 'junk' })).toEqual({ discriminator: 'junk' })
  })
})

describe('default', () => {
  // Unlike JSON Schema, 3.0 requires `default` to conform to the `type` at
  // the same level: https://spec.openapis.org/oas/v3.0.4.html#json-schema-keywords
  // 3.1 only recommends it, so a valid 3.1 default can break the 3.0 rule.
  // `default` is an annotation, so removing it loses detail but no meaning.
  it.each([
    ['keeps a default that matches the type', { default: 'a', type: 'string' }, { default: 'a', type: 'string' }],
    ['removes a default of another type', { default: '10', type: 'integer' }, { type: 'integer' }],
    ['removes null beside a type that excludes it', { default: null, type: 'string' }, { type: 'string' }],
    ['keeps null once nullable', { default: null, type: ['string', 'null'] }, { default: null, nullable: true, type: 'string' }],
    ['removes a default that only matches the null of a nullable type', { default: 1, type: ['string', 'null'] }, { nullable: true, type: 'string' }],
    ['keeps an integral number as an integer', { default: 1.0, type: 'integer' }, { default: 1, type: 'integer' }],
    ['removes a fractional number beside integer', { default: 1.5, type: 'integer' }, { type: 'integer' }],
    ['keeps an integer as a number', { default: 1, type: 'number' }, { default: 1, type: 'number' }],
    ['keeps a matching boolean', { default: false, type: 'boolean' }, { default: false, type: 'boolean' }],
    ['keeps a matching array', { default: [1], items: {}, type: 'array' }, { default: [1], items: {}, type: 'array' }],
    ['removes an object beside array', { default: {}, type: 'array' }, { items: {}, type: 'array' }],
    ['keeps a matching object', { default: { a: 1 }, type: 'object' }, { default: { a: 1 }, type: 'object' }],
    ['removes an array beside object', { default: [], type: 'object' }, { type: 'object' }],
    // The type the conversion adds counts too.
    ['removes a default that does not match an added type: string', { contentEncoding: 'base64', default: 1 }, { format: 'byte', type: 'string' }],
    // Without a `type` at the same level, 3.0 puts no rule on `default`.
    ['keeps any default without a type', { default: 1 }, { default: 1 }],
    ['keeps any default beside a null-only type, which leaves no type', { default: 'x', type: 'null' }, { default: 'x', enum: [null] }],
    ['keeps any default beside a type union, which moves into anyOf', { default: true, type: ['string', 'integer'] }, { anyOf: [{ type: 'string' }, { type: 'integer' }], default: true }],
    ['keeps any default beside a type 3.0 does not define', { default: 1, type: 'file' }, { default: 1, type: 'file' }],
    ['keeps any default beside a malformed type', { default: 1, type: 42 }, { default: 1, type: 42 }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})

describe('readOnly and writeOnly', () => {
  // "A property MUST NOT be marked as both `readOnly` and `writeOnly` being
  // `true`": https://spec.openapis.org/oas/v3.0.4.html#schema-read-only
  // 3.1 allows both, so both are removed. Each only annotates the property,
  // and in 3.0 relaxes `required` for one direction, so without them the
  // property is validated in both directions, as 3.1 validates it.
  it.each([
    ['removes both when both are true', { readOnly: true, type: 'string', writeOnly: true }, { type: 'string' }],
    ['keeps readOnly alone', { readOnly: true, type: 'string' }, { readOnly: true, type: 'string' }],
    ['keeps writeOnly alone', { type: 'string', writeOnly: true }, { type: 'string', writeOnly: true }],
    ['keeps a true flag beside a false one', { readOnly: true, type: 'string', writeOnly: false }, { readOnly: true, type: 'string', writeOnly: false }],
    ['passes malformed values through', { readOnly: 'yes', writeOnly: true }, { readOnly: 'yes', writeOnly: true }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})
