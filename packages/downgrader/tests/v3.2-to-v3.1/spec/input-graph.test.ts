// A document is usually parsed JSON or YAML, but it can also come from a
// dereferencing tool that turns every `$ref` into a shared JavaScript object,
// possibly with cycles. These tests pin down how the conversion treats the
// input as an object graph rather than as text.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'
import { convertPathItem, convertSpec } from './helpers'

describe('the input document', () => {
  it('is never mutated', () => {
    const spec = {
      $self: 'https://example.com/api.json',
      components: {
        examples: { E: { dataValue: 1, serializedValue: 's' } },
        mediaTypes: { A: { $ref: '#/components/mediaTypes/B' }, B: { itemSchema: { xml: { nodeType: 'text' } } } },
        pathItems: { P: { query: { description: 'q' } } },
        schemas: {
          R: { $ref: '#/components/mediaTypes/B/itemSchema', description: 'r' },
          S: { discriminator: { defaultMapping: 'Dog' } },
        },
        securitySchemes: { O: { deprecated: true, type: 'oauth2' } },
      },
      openapi: '3.2.0',
      paths: {
        '/a': {
          additionalOperations: { NOTIFY: { description: 'n' } },
          get: {
            parameters: [{ in: 'querystring', name: 'q' }],
            requestBody: { content: { 'application/json': { $ref: '#/components/mediaTypes/A' } } },
            responses: { 200: { summary: 'ok' } },
          },
          query: { description: 'q' },
          servers: [{ name: 's', url: '/u' }],
        },
      },
      servers: [{ name: 'root', url: 'https://example.com' }],
      tags: [{ kind: 'nav', name: 't', parent: 'p', summary: 's' }],
      webhooks: { hook: { query: { description: 'wq' } } },
    }
    const before = structuredClone(spec)
    downgradeSpecV32ToV31(spec as any)
    expect(spec).toEqual(before)
  })

  it('returns a fresh copy on every call', () => {
    const spec: OpenAPIV3_2.OpenAPIObject = { info: { title: 't', version: '1' }, openapi: '3.2.0', paths: {} }
    const first = downgradeSpecV32ToV31(spec)
    const second = downgradeSpecV32ToV31(spec)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.info).not.toBe(spec.info)
  })

  // Some parsers build objects without a prototype so that keys such as
  // `__proto__` or `constructor` cannot collide with Object.prototype.
  it('accepts objects with a null prototype, as some parsers produce', () => {
    const response = Object.assign(Object.create(null), { summary: 'ok' })
    const operation = Object.assign(Object.create(null), { responses: { 200: response } })
    expect(convertPathItem({ get: operation, query: {} })).toEqual({
      get: { responses: { 200: { description: 'ok' } } },
    })
  })

  // Values such as a Date or a Map cannot come from JSON or YAML. They are
  // not walked into, and are kept as the same instance.
  it('keeps values that are not plain objects or arrays by reference', () => {
    const date = new Date(0)
    const values = new Map([['a', 1]])
    const result = convertSpec({ 'x-date': date, 'x-values': values })
    expect(dig(result, 'x-date')).toBe(date)
    expect(dig(result, 'x-values')).toBe(values)
  })
})

describe('keys', () => {
  it('keeps the key order of the input', () => {
    const result = convertSpec({ 'zebra': 1, 'x-apple': 2, 'info': { version: '1', title: 't' }, 'paths': {} })
    expect(Object.keys(result)).toEqual(['openapi', 'zebra', 'x-apple', 'info', 'paths'])
    expect(Object.keys(result.info)).toEqual(['version', 'title'])
  })

  // JSON.parse creates a real own `__proto__` key. Assigning it with `=`
  // would instead replace the prototype of the output object.
  it('copies a __proto__ key as a plain own property without polluting prototypes', () => {
    const spec = JSON.parse('{"openapi":"3.2.0","x-data":{"__proto__":{"polluted":true}},"components":{"schemas":{"__proto__":{"xml":{"nodeType":"attribute"}}}}}')
    const result = downgradeSpecV32ToV31(spec)
    const data = dig(result, 'x-data') as object
    const schemas = dig(result, 'components', 'schemas') as object
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(data, '__proto__')?.value).toEqual({ polluted: true })
    expect(Object.getOwnPropertyDescriptor(schemas, '__proto__')?.value).toEqual({ xml: { attribute: true } })
    expect('polluted' in {}).toBe(false)
  })

  it('treats keys named like Object.prototype members as ordinary keys', () => {
    const spec = JSON.parse('{"openapi":"3.2.0","constructor":1,"toString":2,"components":{"hasOwnProperty":{"a":1}}}')
    const result = downgradeSpecV32ToV31(spec)
    expect(Object.getOwnPropertyDescriptor(result, 'constructor')?.value).toBe(1)
    expect(Object.getOwnPropertyDescriptor(result, 'toString')?.value).toBe(2)
    expect(dig(result, 'components', 'hasOwnProperty')).toEqual({ a: 1 })
  })
})

describe('shared objects and cycles', () => {
  it('converts a path item that cycles through its callbacks, pointing the cycle at the converted path item', () => {
    const callback: Record<string, unknown> = {}
    const pathItem: Record<string, unknown> = {
      get: { callbacks: { cb: callback }, responses: { 200: { summary: 'ok' } } },
      query: { description: 'q' },
    }
    callback.expr = pathItem
    const result = convertPathItem(pathItem)
    expect(result).not.toHaveProperty('query')
    expect(dig(result, 'get', 'responses', '200')).toEqual({ description: 'ok' })
    expect(dig(result, 'get', 'callbacks', 'cb', 'expr')).toBe(result)
    expect(callback.expr).toBe(pathItem)
  })

  it('copies a dereferenced schema shared across the document once', () => {
    const pet = { $anchor: 'pet', $id: 'https://example.com/pet', properties: { name: { type: 'string' } }, type: 'object' }
    const result = convertSpec({
      components: { schemas: { Pet: pet } },
      paths: { '/pets': { get: { responses: { 200: { content: { 'application/json': { schema: pet } }, description: 'ok' } } } } },
    })
    const schema = dig(result, 'components', 'schemas', 'Pet')
    expect(schema).toEqual(pet)
    expect(schema).not.toBe(pet)
    expect(dig(result, 'paths', '/pets', 'get', 'responses', '200', 'content', 'application/json', 'schema')).toBe(schema)
  })

  // A diamond (two properties sharing one subschema) doubles the number of
  // paths per level: 2^40 here. Converting each shared object once keeps the
  // work linear.
  it('converts a deep shared schema diamond once, even when references force a second pass', () => {
    let schema: Record<string, unknown> = { type: 'string' }
    for (let depth = 0; depth < 40; depth++) {
      schema = { properties: { a: schema, b: schema }, type: 'object' }
    }
    const result = convertSpec({
      components: {
        mediaTypes: { Gone: { schema: {} } },
        schemas: { Dangling: { $ref: '#/components/mediaTypes/Gone/schema' }, Root: schema },
      },
    })
    const root = dig(result, 'components', 'schemas', 'Root')
    expect(dig(root, 'properties', 'a')).toBe(dig(root, 'properties', 'b'))
  })

  it('keeps cycles and sharing inside values it only copies', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const list: unknown[] = [1]
    list.push(list)
    const result = convertSpec({ 'x-list': list, 'x-node': node, 'x-same': node })
    expect(dig(result, 'x-node', 'self')).toBe(dig(result, 'x-node'))
    expect(dig(result, 'x-same')).toBe(dig(result, 'x-node'))
    expect(dig(result, 'x-list', '1')).toBe(dig(result, 'x-list'))
    expect(dig(result, 'x-node')).not.toBe(node)
  })

  // `#/components/mediaTypes/%50et` and `#/components/mediaTypes/Pet` name
  // the same target once percent-decoded, so they share one converted copy.
  it('converts a target inlined from several places once, however its pointer is spelled', () => {
    const content = dig(convertPathItem(
      {
        get: {
          responses: {
            200: { content: { 'a/b': { $ref: '#/components/mediaTypes/Pet' } }, description: 'ok' },
            201: { content: { 'a/b': { $ref: '#/components/mediaTypes/%50et' } }, description: 'ok' },
          },
        },
      },
      { mediaTypes: { Pet: { schema: { type: 'string' } } } },
    ), 'get', 'responses') as Record<string, unknown>
    expect(dig(content, '200', 'content', 'a/b')).toEqual({ schema: { type: 'string' } })
    expect(dig(content, '201', 'content', 'a/b')).toBe(dig(content, '200', 'content', 'a/b'))
  })
})

describe('long reference chains', () => {
  // Chains are followed with loops rather than recursion, so their length is
  // not bounded by the call stack.
  it('removes thousands of aliases chained to a removed parameter', () => {
    const parameters: Record<string, unknown> = { p0: { in: 'querystring', name: 'q' } }
    for (let index = 1; index <= 5000; index++) {
      parameters[`p${index}`] = { $ref: `#/components/parameters/p${index - 1}` }
    }
    const result = convertSpec({
      components: { parameters },
      paths: { '/a': { get: { parameters: [{ $ref: '#/components/parameters/p5000' }], responses: {} } } },
    })
    expect(result.components).toEqual({ parameters: {} })
    expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([])
  })
})
