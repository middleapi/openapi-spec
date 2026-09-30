// Both versions use JSON Schema 2020-12, so a Schema Object only changes in
// the two OpenAPI-specific keywords that 3.2 extended: `xml` and
// `discriminator`. Every other keyword passes through as is.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'

describe('xml.nodeType', () => {
  // 3.2 replaces the `attribute` and `wrapped` flags with `nodeType`, one of
  // `element`, `attribute`, `text`, `cdata`, or `none`:
  // https://spec.openapis.org/oas/v3.2.0.html#xml-node-type
  // 3.1 can express two of them:
  // - `attribute` as `attribute: true`: https://spec.openapis.org/oas/v3.1.2.html#xml-attribute
  // - `element` on an array as `wrapped: true`, since arrays default to
  //   `none` (unwrapped) and an explicit `element` wraps them:
  //   https://spec.openapis.org/oas/v3.2.0.html#modeling-element-lists
  //   https://spec.openapis.org/oas/v3.1.2.html#xml-wrapped
  // `element` on any other schema is the default anyway, and `text`,
  // `cdata`, and `none` have no 3.1 form, so those are removed.
  it.each([
    ['maps an attribute node to attribute: true', { xml: { name: 'n', nodeType: 'attribute' } }, { xml: { attribute: true, name: 'n' } }],
    ['maps an element node on an array to wrapped: true', { type: 'array', xml: { nodeType: 'element' } }, { type: 'array', xml: { wrapped: true } }],
    ['maps an element node on a nullable array to wrapped: true', { type: ['array', 'null'], xml: { nodeType: 'element' } }, { type: ['array', 'null'], xml: { wrapped: true } }],
    ['removes an element node elsewhere, where it is the default', { type: 'object', xml: { nodeType: 'element' } }, { type: 'object', xml: {} }],
    ['removes a text node', { xml: { nodeType: 'text' } }, { xml: {} }],
    ['removes a cdata node', { xml: { nodeType: 'cdata' } }, { xml: {} }],
    ['removes a none node', { xml: { nodeType: 'none' } }, { xml: {} }],
    ['keeps an xml object without nodeType', { xml: { name: 'n', prefix: 'p' } }, { xml: { name: 'n', prefix: 'p' } }],
    ['passes a malformed xml value through', { xml: 'junk' }, { xml: 'junk' }],
  ])('%s', (_name, input, expected) => {
    expect(downgradeSchemaV32ToV31(input as any)).toEqual(expected)
  })
})

describe('discriminator.defaultMapping', () => {
  // 3.2 lets a discriminator name the schema to use when the property is
  // absent or its value is unmapped:
  // https://spec.openapis.org/oas/v3.2.0.html#discriminator-default-mapping
  // 3.1 has no fallback, so the field is removed and `mapping` is kept.
  it('removes defaultMapping and keeps mapping and propertyName', () => {
    expect(downgradeSchemaV32ToV31({
      discriminator: { defaultMapping: 'Dog', mapping: { dog: '#/components/schemas/Dog' }, propertyName: 'kind' },
      oneOf: [{ $ref: '#/components/schemas/Dog' }],
    })).toEqual({
      discriminator: { mapping: { dog: '#/components/schemas/Dog' }, propertyName: 'kind' },
      oneOf: [{ $ref: '#/components/schemas/Dog' }],
    })
  })

  it('passes a malformed discriminator or mapping through', () => {
    expect(downgradeSchemaV32ToV31({ discriminator: 'junk' } as any)).toEqual({ discriminator: 'junk' })
    expect(downgradeSchemaV32ToV31({ discriminator: { mapping: 'junk', propertyName: 'kind' } } as any)).toEqual({
      discriminator: { mapping: 'junk', propertyName: 'kind' },
    })
  })
})

describe('other keywords', () => {
  it('keeps JSON Schema keywords, unknown keywords, and extensions unchanged', () => {
    const schema = {
      '$comment': 'c',
      '$defs': { a: { type: 'string' } },
      '$id': 'https://example.com/s',
      '$schema': 'https://spec.openapis.org/oas/3.1/dialect/base',
      'const': 1,
      'customKeyword': { nested: true },
      'examples': [1],
      'externalDocs': { url: 'https://example.com' },
      'maximum': 5,
      'type': 'number',
      'x-note': 'kept',
    }
    expect(downgradeSchemaV32ToV31(schema as OpenAPIV3_2.SchemaObject)).toEqual(schema)
  })
})
