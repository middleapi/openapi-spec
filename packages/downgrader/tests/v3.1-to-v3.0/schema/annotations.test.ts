import { downgradeSchemaV31ToV30 } from '@openapi-spec/downgrader'

function convert(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

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
    expect(convert(input)).toEqual(expected)
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
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
  })

  // `format: byte` is base64 as in RFC 4648 section 4, so it cannot describe
  // the URL-safe alphabet of section 5, or any other encoding:
  // https://spec.openapis.org/oas/v3.0.4.html#data-type-format
  // Content keywords on a type that is not a string have nothing to map to.
  it.each([
    ['drops base64url, which format: byte does not cover', { contentEncoding: 'base64url', contentMediaType: 'image/png', type: 'string' }, { type: 'string' }],
    ['drops content keywords on non-string types', { contentMediaType: 'image/png', type: 'object' }, { type: 'object' }],
    ['drops a malformed contentMediaType', { contentMediaType: 42 }, {}],
    ['drops contentSchema', { contentSchema: { type: 'string' } }, {}],
  ])('%s', (_name, input, expected) => {
    expect(convert(input)).toEqual(expected)
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
    expect(convert(input)).toEqual(expected)
  })
})

describe('discriminator', () => {
  it('keeps the discriminator and its mapping', () => {
    const schema = {
      discriminator: { mapping: { cat: '#/components/schemas/Cat' }, propertyName: 'kind' },
      oneOf: [{ $ref: '#/components/schemas/Cat' }],
    }
    expect(convert(schema)).toEqual(schema)
  })

  it('passes a malformed discriminator through', () => {
    expect(convert({ discriminator: 'junk' })).toEqual({ discriminator: 'junk' })
  })
})
