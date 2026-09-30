import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSchemaV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'

function convert(schema: unknown): unknown {
  return downgradeSchemaV31ToV30(schema as any)
}

describe('input shapes', () => {
  it('clones non-schema input unchanged', () => {
    expect(convert(null)).toBeNull()
    expect(convert(42)).toBe(42)
    expect(convert('x')).toBe('x')
    const list = [{ type: 'string' }]
    const result = convert(list)
    expect(result).toEqual(list)
    expect(result).not.toBe(list)
  })

  it('treats keywords named like Object.prototype members as unknown keywords', () => {
    const input = JSON.parse('{"constructor":1,"hasOwnProperty":2,"toString":3,"__proto__":{"type":["string","null"]},"type":"string"}')
    const result = convert(input) as object
    expect(Object.getOwnPropertyDescriptor(result, 'constructor')?.value).toBe(1)
    expect(Object.getOwnPropertyDescriptor(result, 'hasOwnProperty')?.value).toBe(2)
    expect(Object.getOwnPropertyDescriptor(result, 'toString')?.value).toBe(3)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ type: ['string', 'null'] })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  // JSON.parse creates a real own `__proto__` key, here a property name.
  // It is converted like any other property.
  it('converts a property named __proto__ without polluting prototypes', () => {
    const properties = dig(convert(JSON.parse('{"properties":{"__proto__":{"type":["string","null"]}}}')), 'properties') as object
    expect(Object.getOwnPropertyDescriptor(properties, '__proto__')?.value).toEqual({ nullable: true, type: 'string' })
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
    expect('nullable' in {}).toBe(false)
  })
})

describe('copies', () => {
  it('never mutates the input schema', () => {
    const input: OpenAPIV3_1.SchemaObject = {
      $ref: '#/c/s',
      allOf: [{ type: 'string' }],
      const: null,
      examples: ['a'],
      exclusiveMinimum: 5,
      minimum: 3,
      prefixItems: [{ type: 'string' }],
      properties: { a: { type: ['string', 'null'] } },
      type: ['object', 'null'],
    }
    const before = structuredClone(input)
    downgradeSchemaV31ToV30(input)
    expect(input).toEqual(before)
  })

  it('returns a fresh copy on every call', () => {
    const schema: OpenAPIV3_1.SchemaObject = { properties: { a: { type: 'string' } }, type: 'object' }
    expect(downgradeSchemaV31ToV30(schema)).not.toBe(downgradeSchemaV31ToV30(schema))
  })

  it('converts deeply nested schemas without overflowing the stack', () => {
    let deep: OpenAPIV3_1.SchemaObject = { type: 'string' }
    for (let index = 0; index < 1000; index += 1) {
      deep = { items: deep, type: 'array' }
    }
    expect(() => downgradeSchemaV31ToV30(deep)).not.toThrow()
  })
})

describe('object graphs', () => {
  // A dereferenced schema can contain itself. The output keeps the same
  // shape: the cycle points at the converted ancestor.
  it('converts a cyclic schema, pointing the cycle at the converted ancestor', () => {
    const properties: Record<string, unknown> = {}
    const node: Record<string, unknown> = { properties, type: ['object', 'null'] }
    properties.self = node
    properties.children = { items: node, type: 'array' }
    const result = convert(node) as Record<string, unknown>
    expect(result.type).toBe('object')
    expect(result.nullable).toBe(true)
    expect(dig(result, 'properties', 'self')).toBe(result)
    expect(dig(result, 'properties', 'children', 'items')).toBe(result)
    expect(node.type).toEqual(['object', 'null'])
  })

  it('converts a cycle that closes several levels down', () => {
    const grandchild: Record<string, unknown> = { type: ['string', 'null'] }
    const child = { properties: { grandchild }, type: 'object' }
    grandchild.items = child
    const result = convert({ properties: { child }, type: 'object' })
    const convertedChild = dig(result, 'properties', 'child')
    expect(dig(convertedChild, 'properties', 'grandchild', 'items')).toBe(convertedChild)
  })

  // The `items` of a multi-type schema moves into the array branch, and the
  // cycle it closes points at the converted schema that holds that branch.
  it('points the array branch of a cyclic multi-type schema at the converted schema', () => {
    const node: Record<string, unknown> = { type: ['array', 'object'] }
    node.items = node
    const result = convert(node) as Record<string, unknown>
    expect(result).not.toHaveProperty('items')
    expect(dig(result, 'anyOf', '0', 'items')).toBe(result)
    expect(dig(result, 'anyOf', '1')).toEqual({ type: 'object' })
    expect(node.items).toBe(node)
  })

  // A diamond (two properties sharing one subschema) doubles the number of
  // paths per level: 2^64 here. Converting each shared object once keeps the
  // work linear.
  it('converts a schema reached along many paths once', () => {
    let node: OpenAPIV3_1.SchemaObject = { type: ['string', 'null'] }
    for (let index = 0; index < 64; index += 1) {
      node = { properties: { left: node, right: node }, type: 'object' }
    }
    const result = convert(node)
    expect(dig(result, 'properties', 'left')).toBe(dig(result, 'properties', 'right'))
    let leaf = result
    for (let index = 0; index < 64; index += 1) {
      leaf = dig(leaf, 'properties', 'left')
    }
    expect(leaf).toEqual({ nullable: true, type: 'string' })
  })
})
