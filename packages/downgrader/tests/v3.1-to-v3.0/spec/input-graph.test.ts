// A document is usually parsed JSON or YAML, but it can also come from a
// dereferencing tool that turns every `$ref` into a shared JavaScript object,
// possibly with cycles. These tests pin down how the conversion treats the
// input as an object graph rather than as text.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { runInNewContext } from 'node:vm'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig, fromOtherRealm } from '../../helpers'
import { expectValidDowngrade } from '../../validate'
import { convertPathItem, convertSpec, info } from './helpers'

describe('the input document', () => {
  it('is never mutated', () => {
    const input: OpenAPIV3_1.OpenAPIObject = {
      components: {
        pathItems: { Reusable: { get: { summary: 's' } } },
        schemas: { S: { $ref: '#/c/s', type: ['string', 'null'] } },
        securitySchemes: { api: { in: 'header', name: 'k', type: 'apiKey' }, mtls: { type: 'mutualTLS' } },
      },
      info: { license: { identifier: 'MIT', name: 'MIT' }, summary: 'short', title: 't', version: '1' },
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
      openapi: '3.1.0',
      paths: {
        '/a': {
          get: {
            parameters: [{ $ref: '#/c/p', summary: 's' }],
            security: [{ mtls: [] }, { api: ['read'] }],
          },
        },
        '/b': { $ref: '#/components/pathItems/Reusable' },
      },
      security: [{ mtls: [] }],
      webhooks: { newPet: { post: { summary: 's' } } },
    }
    const before = structuredClone(input)
    downgradeSpecV31ToV30(input)
    expect(input).toEqual(before)
  })

  it('returns a fresh copy on every call', () => {
    const spec: OpenAPIV3_1.OpenAPIObject = { info, openapi: '3.1.0', paths: {} }
    const first = downgradeSpecV31ToV30(spec)
    expect(first).toEqual(downgradeSpecV31ToV30(spec))
    expect(first).not.toBe(downgradeSpecV31ToV30(spec))
    expect(first.info).not.toBe(spec.info)
  })

  // Some parsers build objects without a prototype so that keys such as
  // `__proto__` or `constructor` cannot collide with Object.prototype.
  it('accepts objects with a null prototype, as some parsers produce', () => {
    const schema = Object.assign(Object.create(null), { type: ['string', 'null'] })
    const operation = Object.assign(Object.create(null), { parameters: [{ in: 'path', name: 'id', schema }] })
    expect(convertPathItem({ get: operation })).toEqual({
      get: {
        parameters: [{ in: 'path', name: 'id', required: true, schema: { nullable: true, type: 'string' } }],
        responses: { default: { description: '' } },
      },
    })
  })

  // JSON parsed in a `vm` context, an iframe, or a Vitest VM pool inherits
  // from the Object.prototype of another realm. It is still plain JSON, and
  // the result is built from this realm's objects and arrays.
  it('converts a document parsed in another realm into a new document', async () => {
    const input = fromOtherRealm<OpenAPIV3_1.OpenAPIObject>({
      components: {
        schemas: { Name: { type: ['string', 'null'] } },
        securitySchemes: { api: { in: 'header', name: 'k', type: 'apiKey' }, mtls: { type: 'mutualTLS' } },
      },
      info,
      openapi: '3.1.0',
      paths: {},
      security: [{ mtls: [] }, { api: [] }],
      webhooks: { newPet: { post: { responses: { 200: { description: 'ok' } } } } },
    })
    const output = await expectValidDowngrade(input, downgradeSpecV31ToV30, '3.1', '3.0')
    expect(output).toEqual({
      components: {
        schemas: { Name: { nullable: true, type: 'string' } },
        securitySchemes: { api: { in: 'header', name: 'k', type: 'apiKey' } },
      },
      info,
      openapi: '3.0.4',
      paths: {},
      security: [{ api: [] }],
    })
    expect(output).toBeInstanceOf(Object)
    expect(output.security).toBeInstanceOf(Array)
    output.info.title = 'changed'
    expect(input.info.title).toBe(info.title)
  })

  it('converts a part parsed in another realm inside a document', () => {
    const result = convertSpec({ components: { schemas: { Name: fromOtherRealm({ type: ['string', 'null'] }) } } })
    expect(dig(result, 'components', 'schemas', 'Name')).toEqual({ nullable: true, type: 'string' })
    expect(dig(result, 'components', 'schemas', 'Name')).toBeInstanceOf(Object)
  })

  // Values such as a Date or a Map cannot come from JSON or YAML. They are
  // not walked into, and are kept as the same instance.
  it('keeps values that are not plain objects or arrays by reference', () => {
    const date = new Date(0)
    const result = convertSpec({ 'components': { schemas: { S: { default: date } } }, 'x-date': date })
    expect(dig(result, 'x-date')).toBe(date)
    expect(dig(result, 'components', 'schemas', 'S', 'default')).toBe(date)
  })

  it('keeps values that are not plain objects or arrays by reference when they come from another realm', () => {
    const date = runInNewContext('new Date(0)')
    const values = runInNewContext('new Map([["a", 1]])')
    const result = convertSpec({ 'x-date': date, 'x-values': values })
    expect(dig(result, 'x-date')).toBe(date)
    expect(dig(result, 'x-values')).toBe(values)
  })
})

describe('keys', () => {
  it('keeps the key order of the input', () => {
    const result = downgradeSpecV31ToV30({ 'paths': {}, 'x-first': 1, 'info': { version: '1', title: 't' }, 'openapi': '3.1.0' } as any)
    expect(Object.keys(result)).toEqual(['paths', 'x-first', 'info', 'openapi'])
    expect(Object.keys(result.info)).toEqual(['version', 'title'])
  })

  // JSON.parse creates a real own `__proto__` key. Assigning it with `=`
  // would instead replace the prototype of the output object.
  it('copies a __proto__ key as a plain own property without polluting prototypes', () => {
    const spec = JSON.parse('{"openapi":"3.1.0","paths":{},"x-data":{"__proto__":{"polluted":true}},"components":{"schemas":{"__proto__":{"type":["string","null"]}}}}')
    const result = downgradeSpecV31ToV30(spec)
    const data = dig(result, 'x-data') as object
    const schemas = dig(result, 'components', 'schemas') as object
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(data, '__proto__')?.value).toEqual({ polluted: true })
    expect(Object.getOwnPropertyDescriptor(schemas, '__proto__')?.value).toEqual({ nullable: true, type: 'string' })
    expect('polluted' in {}).toBe(false)
  })
})

describe('shared objects and cycles', () => {
  it('converts a path item that cycles through its callbacks, pointing the cycle at the converted path item', () => {
    const callback: Record<string, unknown> = {}
    const pathItem: Record<string, unknown> = { get: { callbacks: { cb: callback } } }
    callback.expr = pathItem
    const result = convertPathItem(pathItem)
    expect(dig(result, 'get', 'responses')).toEqual({ default: { description: '' } })
    expect(dig(result, 'get', 'callbacks', 'cb', 'expr')).toBe(result)
  })

  it('converts a dereferenced schema shared across the document once', () => {
    const pet = { properties: { name: { type: ['string', 'null'] } }, type: 'object' }
    const result = convertSpec({
      components: { schemas: { Pet: pet } },
      paths: { '/pets': { get: { responses: { 200: { content: { 'application/json': { schema: pet } }, description: 'ok' } } } } },
    })
    const schema = dig(result, 'components', 'schemas', 'Pet')
    expect(schema).toEqual({ properties: { name: { nullable: true, type: 'string' } }, type: 'object' })
    expect(dig(result, 'paths', '/pets', 'get', 'responses', '200', 'content', 'application/json', 'schema')).toBe(schema)
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
  })

  // `#/webhooks/%68ook` percent-decodes to `#/webhooks/hook`, so both name
  // the same target and share one converted copy.
  it('converts a target inlined from several places once, however its pointer is spelled', () => {
    const result = convertSpec({
      paths: { '/a': { $ref: '#/webhooks/hook' }, '/b': { $ref: '#/webhooks/%68ook' } },
      webhooks: { hook: { get: { parameters: [{ in: 'query', name: 'q', schema: { type: ['string', 'null'] } }] } } },
    })
    expect(dig(result, 'paths', '/a', 'get')).toEqual({
      parameters: [{ in: 'query', name: 'q', schema: { nullable: true, type: 'string' } }],
      responses: { default: { description: '' } },
    })
    expect(dig(result, 'paths', '/b', 'get')).toBe(dig(result, 'paths', '/a', 'get'))
  })
})
