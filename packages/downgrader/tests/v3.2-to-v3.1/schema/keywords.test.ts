// Both versions use JSON Schema 2020-12, so a Schema Object only changes in
// the two OpenAPI-specific keywords that 3.2 extended: `xml` and
// `discriminator`. Every other keyword passes through as is.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'
import { convertSchema } from './helpers'

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
  // `cdata`, and `none` have no 3.1 form, so those are removed. 3.2 ignores
  // `name` on those three, while 3.1 would name an element after it, so it
  // goes too.
  it.each([
    ['maps an attribute node to attribute: true', { xml: { name: 'n', nodeType: 'attribute' } }, { xml: { attribute: true, name: 'n' } }],
    ['maps an element node on an array to wrapped: true', { type: 'array', xml: { nodeType: 'element' } }, { type: 'array', xml: { wrapped: true } }],
    ['maps an element node on a nullable array to wrapped: true', { type: ['array', 'null'], xml: { nodeType: 'element' } }, { type: ['array', 'null'], xml: { wrapped: true } }],
    ['removes an element node elsewhere, where it is the default', { type: 'object', xml: { nodeType: 'element' } }, { type: 'object', xml: {} }],
    ['removes a text node and its name', { xml: { name: 'n', nodeType: 'text' } }, { xml: {} }],
    ['removes a cdata node and its name', { xml: { name: 'n', nodeType: 'cdata' } }, { xml: {} }],
    ['removes a none node and its name', { xml: { name: 'n', nodeType: 'none' } }, { xml: {} }],
    ['keeps the rest of a text node', { xml: { name: 'n', namespace: 'urn:x', nodeType: 'text', prefix: 'p' } }, { xml: { namespace: 'urn:x', prefix: 'p' } }],
    ['keeps an xml object without nodeType', { xml: { name: 'n', prefix: 'p' } }, { xml: { name: 'n', prefix: 'p' } }],
    ['passes a malformed xml value through', { xml: 'junk' }, { xml: 'junk' }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })

  // A `$ref` also defaults to `none`, so an explicit `element` beside one
  // wraps the referenced array, which 3.1 writes as `wrapped: true`:
  // https://spec.openapis.org/oas/v3.2.0.html#xml-node-type
  // The type is looked up along the whole `$ref` chain.
  it.each([
    ['maps an element node on a $ref to an array to wrapped: true', { $defs: { arr: { type: 'array' } }, $ref: '#/$defs/arr' }, { wrapped: true }],
    ['follows an alias to the array', { $defs: { alias: { $ref: '#/$defs/arr' }, arr: { type: ['array', 'null'] } }, $ref: '#/$defs/alias' }, { wrapped: true }],
    ['stops at a hop that is an array', { $defs: { arr: { $ref: '#/$defs/base', type: 'array' }, base: { minItems: 1 } }, $ref: '#/$defs/arr' }, { wrapped: true }],
    ['removes an element node on a $ref to a non-array', { $defs: { obj: { type: 'object' } }, $ref: '#/$defs/obj' }, {}],
    ['removes an element node on an unresolvable $ref', { $ref: '#/$defs/missing' }, {}],
    ['removes an element node on a $ref loop', { $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }, {}],
  ])('%s', (_name, refs, xml) => {
    expect(convertSchema({ ...refs, xml: { nodeType: 'element' } })).toEqual({ ...refs, xml })
  })

  // Inside a schema with an `$id`, the `$ref` resolves against that `$id`:
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.1
  it('resolves the $ref against the enclosing $id', () => {
    const list = { $defs: { arr: { type: 'array' } }, $id: 'https://example.com/list', $ref: '#/$defs/arr' }
    expect(convertSchema({
      $defs: { arr: { type: 'object' } },
      properties: { list: { ...list, xml: { nodeType: 'element' } } },
    })).toEqual({
      $defs: { arr: { type: 'object' } },
      properties: { list: { ...list, xml: { wrapped: true } } },
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
