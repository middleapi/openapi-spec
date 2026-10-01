// Both versions use JSON Schema 2020-12, so a Schema Object only changes in
// the two OpenAPI-specific keywords that 3.2 extended: `xml` and
// `discriminator`. Every other keyword passes through as is.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'
import { convertSchema } from './helpers'

describe('xml.nodeType', () => {
  // 3.2 replaces the `attribute` and `wrapped` flags with `nodeType`, one of
  // `element`, `attribute`, `text`, `cdata`, or `none`. Without it, a schema
  // beside `$ref`, `$dynamicRef`, or an array `type` is a `none` node, and any
  // other schema is an `element`:
  // https://spec.openapis.org/oas/v3.2.0.html#xml-node-type
  // 3.1 can express two node types:
  // - `attribute` as `attribute: true`: https://spec.openapis.org/oas/v3.1.2.html#xml-attribute
  // - `element` on an array as `wrapped: true`, since arrays default to
  //   `none` (unwrapped) and an `element` wraps them:
  //   https://spec.openapis.org/oas/v3.2.0.html#modeling-element-lists
  //   https://spec.openapis.org/oas/v3.1.2.html#xml-wrapped
  //   `wrapped` only applies beside an array `type`, so an array type that
  //   comes through `$ref` or `allOf` is copied beside them. The value must
  //   match that type anyway, so validation is unchanged.
  // An `element` on any other schema is what 3.1 produces without a flag, and
  // `text`, `cdata`, and `none` have no 3.1 form, so `nodeType` is removed.
  // Those three node types have no name, so 3.2 ignores `name` there, along
  // with the `prefix` and `namespace` that qualify it. 3.1 would apply them to
  // an element, so they are removed: https://spec.openapis.org/oas/v3.2.0.html#xml-name
  const xml = { 'name': 'n', 'namespace': 'https://example.com/ns', 'prefix': 'p', 'x-note': 'kept' }
  it.each([
    ['maps an attribute node to attribute: true', { xml: { name: 'n', nodeType: 'attribute' } }, { xml: { attribute: true, name: 'n' } }],
    ['maps an element node on an array to wrapped: true', { type: 'array', xml: { nodeType: 'element' } }, { type: 'array', xml: { wrapped: true } }],
    ['maps an element node on a nullable array to wrapped: true', { type: ['array', 'null'], xml: { nodeType: 'element' } }, { type: ['array', 'null'], xml: { wrapped: true } }],
    ['removes an element node elsewhere, where 3.1 produces an element anyway', { type: 'object', xml: { ...xml, nodeType: 'element' } }, { type: 'object', xml }],
    ['removes a text node and the name it ignores', { xml: { ...xml, nodeType: 'text' } }, { xml: { 'x-note': 'kept' } }],
    ['removes a cdata node and the name it ignores', { xml: { ...xml, nodeType: 'cdata' } }, { xml: { 'x-note': 'kept' } }],
    ['removes a none node and the name it ignores', { xml: { ...xml, nodeType: 'none' } }, { xml: { 'x-note': 'kept' } }],
    ['removes the name of a none node beside $ref', { $ref: 'https://example.com/person.json', xml }, { $ref: 'https://example.com/person.json', xml: { 'x-note': 'kept' } }],
    ['removes the name of a none node beside $dynamicRef', { $dynamicRef: '#node', xml }, { $dynamicRef: '#node', xml: { 'x-note': 'kept' } }],
    ['removes the name of a none node on an array', { type: 'array', xml }, { type: 'array', xml: { 'x-note': 'kept' } }],
    ['keeps the name of an element node beside $ref', { $ref: 'https://example.com/doc.json', xml: { ...xml, nodeType: 'element' } }, { $ref: 'https://example.com/doc.json', xml }],
    ['keeps the name of an attribute node beside $ref', { $ref: 'https://example.com/id.json', xml: { ...xml, nodeType: 'attribute' } }, { $ref: 'https://example.com/id.json', xml: { ...xml, attribute: true } }],
    ['keeps the name of a deprecated attribute beside $ref', { $ref: 'https://example.com/id.json', xml: { ...xml, attribute: true } }, { $ref: 'https://example.com/id.json', xml: { ...xml, attribute: true } }],
    ['keeps the name of a deprecated wrapped array', { type: 'array', xml: { ...xml, wrapped: true } }, { type: 'array', xml: { ...xml, wrapped: true } }],
    ['keeps an xml object without nodeType on an element', { xml: { name: 'n', prefix: 'p' } }, { xml: { name: 'n', prefix: 'p' } }],
    ['passes a malformed xml value through', { xml: 'junk' }, { xml: 'junk' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })

  it('wraps an element node whose array type comes through $ref or allOf, copying that type', () => {
    const $defs = {
      Alias: { $ref: '#/$defs/Books' },
      Books: { items: { type: 'string' }, type: ['array', 'null'] },
      Person: { type: 'object' },
    }
    expect(convertSchema({
      $defs,
      properties: {
        alias: { $ref: '#/$defs/Alias', xml: { nodeType: 'element' } },
        allOf: { allOf: [{ $ref: '#/$defs/Books' }], xml: { name: 'shelf' } },
        external: { $ref: 'https://example.com/books.json', xml: { nodeType: 'element' } },
        none: { $ref: '#/$defs/Books', xml: { name: 'shelf' } },
        object: { $ref: '#/$defs/Person', xml: { name: 'writer', nodeType: 'element' } },
        ref: { $ref: '#/$defs/Books', xml: { name: 'shelf', nodeType: 'element' } },
        typed: { allOf: [{ $ref: '#/$defs/Books' }], type: 'object', xml: { nodeType: 'element' } },
      },
    })).toEqual({
      $defs,
      properties: {
        alias: { $ref: '#/$defs/Alias', type: ['array', 'null'], xml: { wrapped: true } },
        allOf: { allOf: [{ $ref: '#/$defs/Books' }], type: ['array', 'null'], xml: { name: 'shelf', wrapped: true } },
        external: { $ref: 'https://example.com/books.json', xml: {} },
        none: { $ref: '#/$defs/Books', xml: {} },
        object: { $ref: '#/$defs/Person', xml: { name: 'writer' } },
        ref: { $ref: '#/$defs/Books', type: ['array', 'null'], xml: { name: 'shelf', wrapped: true } },
        typed: { allOf: [{ $ref: '#/$defs/Books' }], type: 'object', xml: {} },
      },
    })
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
    expect(convertSchema({ discriminator: 'junk' })).toEqual({ discriminator: 'junk' })
    expect(convertSchema({ discriminator: { mapping: 'junk', propertyName: 'kind' } })).toEqual({
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
