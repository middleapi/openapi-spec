import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'
import { convertSchema } from './helpers'

describe('input shapes', () => {
  // `true` and `false` are complete schemas in JSON Schema 2020-12, and 3.1
  // accepts them as they are: https://json-schema.org/draft/2020-12/json-schema-core#section-4.3.2
  it('passes boolean schemas through', () => {
    expect(downgradeSchemaV32ToV31(true)).toBe(true)
    expect(downgradeSchemaV32ToV31(false)).toBe(false)
  })

  it('passes non-schema input through', () => {
    expect(convertSchema('junk')).toBe('junk')
    expect(convertSchema(null)).toBeNull()
    expect(convertSchema([{ type: 'string' }])).toEqual([{ type: 'string' }])
  })
})

describe('copies', () => {
  it('deep-clones the schema, sharing nothing with the input', () => {
    const source = {
      allOf: [{ discriminator: { defaultMapping: 'Dog' } }, true],
      discriminator: { mapping: { dog: '#/components/schemas/Dog' }, propertyName: 'kind' },
      items: { xml: { nodeType: 'cdata' } },
      properties: { a: { xml: { name: 'a' } } },
    }
    const result = convertSchema(source)
    expect(result).toEqual({
      allOf: [{ discriminator: {} }, true],
      discriminator: { mapping: { dog: '#/components/schemas/Dog' }, propertyName: 'kind' },
      items: { xml: {} },
      properties: { a: { xml: { name: 'a' } } },
    })
    expect(result).not.toBe(source)
    for (const path of [['allOf'], ['allOf', '0'], ['discriminator'], ['discriminator', 'mapping'], ['items'], ['properties'], ['properties', 'a'], ['properties', 'a', 'xml']]) {
      expect(dig(result, ...path)).not.toBe(dig(source, ...path))
    }
  })

  it('returns a fresh copy on every call', () => {
    const schema: OpenAPIV3_2.SchemaObject = { properties: { a: { type: 'string' } }, type: 'object' }
    expect(downgradeSchemaV32ToV31(schema)).not.toBe(downgradeSchemaV32ToV31(schema))
  })

  it('never mutates the input schema', () => {
    const schema: OpenAPIV3_2.SchemaObject = {
      discriminator: { defaultMapping: 'Dog', propertyName: 'kind' },
      properties: { a: { xml: { nodeType: 'attribute' } } },
      type: 'object',
    }
    const before = structuredClone(schema)
    downgradeSchemaV32ToV31(schema)
    expect(schema).toEqual(before)
  })

  it('keeps the key order of the input', () => {
    expect(Object.keys(downgradeSchemaV32ToV31({ type: 'object', required: ['a'], properties: {}, description: 'd' }))).toEqual([
      'type',
      'required',
      'properties',
      'description',
    ])
  })

  // JSON.parse creates a real own `__proto__` key, here a property name.
  it('copies a __proto__ property as a plain own key without polluting prototypes', () => {
    const result = downgradeSchemaV32ToV31(JSON.parse('{"properties":{"__proto__":{"xml":{"nodeType":"attribute"}}}}'))
    const properties = dig(result, 'properties') as object
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(properties, '__proto__')?.value).toEqual({ xml: { attribute: true } })
    expect('xml' in {}).toBe(false)
  })
})

describe('object graphs', () => {
  // A dereferenced schema can contain itself. The output keeps the same
  // shape: the cycle points at the converted ancestor.
  it('converts a cyclic schema, pointing the cycle at the converted ancestor', () => {
    const node: Record<string, unknown> = { discriminator: { defaultMapping: 'A', propertyName: 'kind' }, type: 'object' }
    node.properties = { self: node, children: { items: node, type: 'array' } }
    const result = downgradeSchemaV32ToV31(node)
    expect(dig(result, 'discriminator')).toEqual({ propertyName: 'kind' })
    expect(dig(result, 'properties', 'self')).toBe(result)
    expect(dig(result, 'properties', 'children', 'items')).toBe(result)
  })

  it('converts a subschema shared by several positions once', () => {
    const shared = { xml: { nodeType: 'attribute' } }
    const result = convertSchema({ properties: { a: shared, b: shared } })
    expect(dig(result, 'properties', 'a')).toEqual({ xml: { attribute: true } })
    expect(dig(result, 'properties', 'b')).toBe(dig(result, 'properties', 'a'))
  })

  it('converts deeply nested schemas without overflowing the stack', () => {
    let deep: OpenAPIV3_2.SchemaObject = { type: 'string' }
    for (let index = 0; index < 1000; index += 1) {
      deep = { items: deep, type: 'array' }
    }
    expect(() => downgradeSchemaV32ToV31(deep)).not.toThrow()
  })
})
