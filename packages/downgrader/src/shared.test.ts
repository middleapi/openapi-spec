import type { Context } from './shared'

import { dig } from '../tests/helpers'
import {
  allOfItems,
  child,
  clone,
  convertMappingRef,
  convertObject,
  defineFields,
  downgrade,
  DROP,
  getRef,
  inline,
  isRecord,
  list,
  map,
  refOr,
  removedPrefixes,
  resolve,
  setOwn,
} from './shared'

function identity<T>(value: T): T {
  return value
}

function createContext(root: unknown = {}): Context {
  return {
    aliasEnd: () => undefined,
    converting: [],
    copies: new Map(),
    dangles: () => false,
    identified: new Set(),
    inlined: new Map(),
    inlining: new Set(),
    isRemovedPart: () => false,
    markDangling: () => {},
    removals: new Map(),
    resolve: ref => resolve(root, ref),
    seen: new Map(),
  }
}

const NODE_FIELDS = defineFields({
  name: () => 'converted',
  self: convertNode,
})

function convertNode(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, NODE_FIELDS)
}

const convertItemRef = refOr(convertItem)

const ITEM_FIELDS = defineFields({
  next: convertItemRef,
  secret: DROP,
})

const DOCUMENT_FIELDS = defineFields({
  items: list(convertItemRef),
  links: map(convertMappingRef),
  named: map(convertItemRef, key => !key.startsWith('x-')),
  removed: DROP,
})

function convertItem(value: unknown, ctx: Context): unknown {
  return isRecord(value) && value.drop === true ? DROP : convertObject(value, ctx, ITEM_FIELDS)
}

function convertDocument(value: unknown, removed?: string[], fields = DOCUMENT_FIELDS): { out: any, passes: number } {
  let passes = 0
  const out = downgrade(value, (item, ctx) => {
    passes += 1
    return convertObject(item, ctx, fields)
  }, removed)
  return { out, passes }
}

describe('isRecord', () => {
  it('returns true for plain object literals', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('returns true for objects with a null prototype', () => {
    expect(isRecord(Object.create(null))).toBe(true)
  })

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false)
  })

  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2])).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isRecord('text')).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord(true)).toBe(false)
    expect(isRecord(Symbol('s'))).toBe(false)
    expect(isRecord(10n)).toBe(false)
  })

  it('returns false for class instances', () => {
    expect(isRecord(new Date())).toBe(false)
    expect(isRecord(new Map())).toBe(false)
  })
})

describe('clone', () => {
  it('deep-copies nested plain objects and arrays without sharing references', () => {
    const input = {
      list: [{ deep: { value: 1 } }, [2, 3]],
      nested: { inner: { leaf: 'x' } },
    }
    const copy = clone(input) as typeof input
    expect(copy).toEqual(input)
    expect(copy).not.toBe(input)
    expect(copy.list).not.toBe(input.list)
    expect(copy.list[0]).not.toBe(input.list[0])
    expect(copy.list[1]).not.toBe(input.list[1])
    expect(copy.nested).not.toBe(input.nested)
    expect(copy.nested.inner).not.toBe(input.nested.inner)
  })

  it('keeps functions and class instances by reference', () => {
    const date = new Date()
    const values = new Map<string, number>()
    const copy = clone({ date, fn: identity, values }) as Record<string, unknown>
    expect(copy.fn).toBe(identity)
    expect(copy.date).toBe(date)
    expect(copy.values).toBe(values)
  })

  it('returns primitives as-is', () => {
    expect(clone(1)).toBe(1)
    expect(clone('a')).toBe('a')
    expect(clone(null)).toBe(null)
    expect(clone(true)).toBe(true)
  })

  it('copies a hostile __proto__ own key as a plain own data property without prototype pollution', () => {
    const input: unknown = JSON.parse('{"__proto__": {"polluted": true}}')
    const copy = clone(input) as object
    expect(Object.getOwnPropertyNames(copy)).toContain('__proto__')
    expect(Object.getOwnPropertyDescriptor(copy, '__proto__')?.value).toEqual({ polluted: true })
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect('polluted' in {}).toBe(false)
  })

  it('preserves key order', () => {
    const input: Record<string, unknown> = {}
    input.zebra = 1
    input.apple = 2
    input.mango = 3
    expect(Object.keys(clone(input) as object)).toEqual(['zebra', 'apple', 'mango'])
  })

  it('preserves object cycles instead of recursing forever', () => {
    const inner: Record<string, unknown> = {}
    const node: Record<string, unknown> = { child: inner, name: 'root' }
    inner.parent = node
    const copy = clone(node) as Record<string, unknown>
    expect(copy).not.toBe(node)
    expect(copy.name).toBe('root')
    expect(dig(copy, 'child', 'parent')).toBe(copy)
  })

  it('preserves array cycles', () => {
    const items: unknown[] = [1]
    items.push(items)
    const copy = clone(items) as unknown[]
    expect(copy).not.toBe(items)
    expect(copy[0]).toBe(1)
    expect(copy[1]).toBe(copy)
  })

  it('clones shared references once', () => {
    const shared = { a: 1 }
    const copy = clone({ x: shared, y: shared }) as Record<string, unknown>
    expect(copy.x).toEqual({ a: 1 })
    expect(copy.x).not.toBe(shared)
    expect(copy.x).toBe(copy.y)
  })

  it('returns a fresh copy on every call', () => {
    const shared = { a: 1 }
    expect(clone(shared)).not.toBe(clone(shared))
  })
})

describe('convertObject', () => {
  it('routes listed fields through their converters and deep-clones the rest', () => {
    const extra = { deep: true }
    const result = convertObject({ a: 1, b: 2, extra }, createContext(), defineFields({ a: item => [item], b: () => 'converted' })) as Record<string, unknown>
    expect(result).toEqual({ a: [1], b: 'converted', extra: { deep: true } })
    expect(result.extra).not.toBe(extra)
  })

  it('removes fields mapped to DROP and fields whose converter returns DROP', () => {
    const result = convertObject({ gone: 1, kept: 2, maybe: 3 }, createContext(), defineFields({ gone: DROP, maybe: item => (item === 3 ? DROP : item) }))
    expect(result).toEqual({ kept: 2 })
  })

  it('passes the whole source record to converters and to finish', () => {
    const source = { flag: true, value: 1 }
    const result = convertObject(
      source,
      createContext(),
      defineFields({ value: (item, _ctx, record) => (record.flag ? item : DROP) }),
      (out, record) => ({ ...out, sameSource: record === source }),
    )
    expect(result).toEqual({ flag: true, sameSource: true, value: 1 })
  })

  it('lets finish replace the whole result', () => {
    expect(convertObject({ a: 1 }, createContext(), defineFields({}), () => DROP)).toBe(DROP)
  })

  it('preserves key order', () => {
    const input: Record<string, unknown> = {}
    input.zebra = 1
    input.apple = 2
    input.mango = 3
    const result = convertObject(input, createContext(), defineFields({ apple: identity })) as Record<string, unknown>
    expect(Object.keys(result)).toEqual(['zebra', 'apple', 'mango'])
  })

  it('deep-clones non-object input without consulting the table', () => {
    const convert = vi.fn(identity)
    const items = [{ a: 1 }]
    const result = convertObject(items, createContext(), defineFields({ a: convert }))
    expect(result).toEqual(items)
    expect(result).not.toBe(items)
    expect(convertObject('text', createContext(), defineFields({ a: convert }))).toBe('text')
    expect(convertObject(null, createContext(), defineFields({ a: convert }))).toBe(null)
    expect(convert).not.toHaveBeenCalled()
  })

  it('does not look up table entries through the prototype chain', () => {
    const input: unknown = JSON.parse('{"constructor": 1, "toString": 2, "__proto__": {"polluted": true}}')
    const result = convertObject(input, createContext(), defineFields({})) as object
    expect(Object.getOwnPropertyDescriptor(result, 'constructor')?.value).toBe(1)
    expect(Object.getOwnPropertyDescriptor(result, 'toString')?.value).toBe(2)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ polluted: true })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect('polluted' in {}).toBe(false)
  })

  it('points a cyclic reference at the converted ancestor when re-entered for the same object', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const result = convertNode(node, createContext()) as Record<string, unknown>
    expect(result.name).toBe('converted')
    expect(result.self).toBe(result)
    expect(node.self).toBe(node)
  })

  it('converts a cycle that closes several levels down', () => {
    const grandchild: Record<string, unknown> = { name: 'grandchild' }
    const inner: Record<string, unknown> = { name: 'child', self: grandchild }
    const root: Record<string, unknown> = { name: 'root', self: inner }
    grandchild.self = inner
    const result = convertNode(root, createContext()) as Record<string, unknown>
    const convertedChild = result.self as Record<string, unknown>
    const convertedGrandchild = convertedChild.self as Record<string, unknown>
    expect(convertedChild.name).toBe('converted')
    expect(convertedGrandchild.name).toBe('converted')
    expect(convertedGrandchild.self).toBe(convertedChild)
    expect(inner.self).toBe(grandchild)
  })

  it('releases the cycle guard once a conversion finishes', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const first = convertNode(node, createContext()) as Record<string, unknown>
    const second = convertNode(node, createContext()) as Record<string, unknown>
    expect(second).not.toBe(first)
    expect(second.self).toBe(second)
  })

  it('converts a shared reference once per call and reuses the result', () => {
    const shared = { name: 'x' }
    const fields = defineFields({ name: () => 'converted' })
    const convert = (item: unknown, ctx: Context): unknown => convertObject(item, ctx, fields)
    const result = convertObject({ a: shared, b: shared }, createContext(), defineFields({ a: convert, b: convert }))
    expect(result).toEqual({ a: { name: 'converted' }, b: { name: 'converted' } })
    expect(dig(result, 'b')).toBe(dig(result, 'a'))
  })

  it('clones a shared reference once per call', () => {
    const shared = { deep: true }
    const result = convertObject({ a: shared, b: [shared] }, createContext(), defineFields({}))
    expect(result).toEqual({ a: { deep: true }, b: [{ deep: true }] })
    expect(dig(result, 'b', '0')).toBe(dig(result, 'a'))
    expect(dig(result, 'a')).not.toBe(shared)
  })

  it('reuses a finished result only for the same field table', () => {
    const shared = { name: 'x' }
    const fields = defineFields({ name: () => 'converted' })
    const wrap = (out: Record<string, unknown>): unknown => ({ wrapped: out })
    const result = convertObject({ a: shared, b: shared, c: shared }, createContext(), defineFields({
      a: (item, ctx) => convertObject(item, ctx, fields, wrap),
      b: (item, ctx) => convertObject(item, ctx, fields, wrap),
      c: (item, ctx) => convertObject(item, ctx, defineFields({})),
    }))
    expect(result).toEqual({
      a: { wrapped: { name: 'converted' } },
      b: { wrapped: { name: 'converted' } },
      c: { name: 'x' },
    })
    expect(dig(result, 'b')).toBe(dig(result, 'a'))
  })

  it('remembers the finished result, including DROP, for objects seen again', () => {
    const ctx = createContext()
    const fields = defineFields({})
    const finish = vi.fn(() => DROP)
    const input = { a: 1 }
    expect(convertObject(input, ctx, fields, finish)).toBe(DROP)
    expect(convertObject(input, ctx, fields, finish)).toBe(DROP)
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('returns fresh results on every call', () => {
    const shared = { name: 'x' }
    const fields = defineFields({ name: () => 'converted' })
    expect(convertObject(shared, createContext(), fields)).not.toBe(convertObject(shared, createContext(), fields))
    expect(dig(convertObject({ a: shared }, createContext(), defineFields({})), 'a')).not.toBe(dig(convertObject({ a: shared }, createContext(), defineFields({})), 'a'))
  })

  it('releases the cycle guard when a converter throws', () => {
    const value = { a: 1 }
    expect(() => convertObject(value, createContext(), defineFields({
      a: () => {
        throw new Error('boom')
      },
    }))).toThrow('boom')
    expect(convertObject(value, createContext(), defineFields({ a: () => 2 }))).toEqual({ a: 2 })
  })

  it('forgets reused results and clones when a converter throws', () => {
    const shared = { name: 'x' }
    const convert = vi.fn(() => 'converted')
    const fields = defineFields({ name: convert })
    let copy: unknown
    expect(() => convertObject({ a: shared }, createContext(), defineFields({
      a: (item, ctx) => {
        convertObject(item, ctx, fields)
        copy = clone(item, ctx)
        throw new Error('boom')
      },
    }))).toThrow('boom')
    const result = convertObject({ a: shared, b: shared }, createContext(), defineFields({ a: (item, ctx) => convertObject(item, ctx, fields) }))
    expect(convert).toHaveBeenCalledTimes(2)
    expect(dig(result, 'b')).not.toBe(copy)
  })

  it('cuts an object still being converted when it is reached from another context', () => {
    const source = { child: 'x' }
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const ctx = createContext({ node })
    const result = convertObject(source, ctx, defineFields({
      child: (_item, c) => ({ back: convertObject(source, c, defineFields({})), node: inline('#/node', c, convertNode) }),
    }))
    expect(dig(result, 'child', 'back')).toBe(DROP)
    expect(dig(result, 'child', 'node', 'self')).toBe(dig(result, 'child', 'node'))
  })

  it('converts again, outside an inlined target, an object that was cut inside it', () => {
    const LINK_FIELDS = defineFields({
      cut: (_item, c) => inline('#/child', c, convertLink),
      self: convertLink,
    })
    function convertLink(value: unknown, c: Context): unknown {
      return convertObject(value, c, LINK_FIELDS)
    }
    const node: Record<string, unknown> = { cut: 'x' }
    const inner = { self: node }
    node.self = inner
    const result = convertLink(node, createContext({ child: inner }))
    expect(dig(result, 'cut')).toEqual({})
    expect(dig(result, 'self', 'self')).toBe(result)
  })

  it('tracks only source records whose conversion is still in progress', () => {
    const inner = { a: 1 }
    const source = { child: inner }
    const ctx = createContext()
    const flags: boolean[] = []
    convertObject(source, ctx, defineFields({
      child: (item, c) => {
        flags.push(c.converting.includes(source), c.converting.includes(item))
        return item
      },
    }))
    expect(flags).toEqual([true, false])
    expect(ctx.converting).toEqual([])
  })
})

describe('map', () => {
  it('applies the converter to the entries isEntry selects and clones the others', () => {
    const keys: string[] = []
    const result = map(item => (item as number) * 10, (key) => {
      keys.push(key)
      return key !== 'raw'
    })({ a: 1, b: 2, raw: 3 }, createContext())
    expect(result).toEqual({ a: 10, b: 20, raw: 3 })
    expect(keys).toEqual(['a', 'b', 'raw'])
  })

  it('passes each entry key to the converter', () => {
    expect(map((item, _ctx, key) => `${key}=${item}`)({ a: 1, b: 2 }, createContext())).toEqual({ a: 'a=1', b: 'b=2' })
  })

  it('leaves out entries whose converter returns DROP', () => {
    expect(map(item => (item === 2 ? DROP : item))({ a: 1, b: 2, c: 3 }, createContext())).toEqual({ a: 1, c: 3 })
  })

  it('preserves key order', () => {
    const input: Record<string, unknown> = {}
    input.zebra = 1
    input.apple = 2
    expect(Object.keys(map(identity)(input, createContext()) as object)).toEqual(['zebra', 'apple'])
  })

  it('deep-clones non-object input unchanged without calling the converter', () => {
    const convert = vi.fn(identity)
    const items = [{ nested: true }]
    const result = map(convert)(items, createContext())
    expect(result).toEqual(items)
    expect(result).not.toBe(items)
    expect(map(convert)('text', createContext())).toBe('text')
    expect(map(convert)(null, createContext())).toBe(null)
    expect(convert).not.toHaveBeenCalled()
  })
})

describe('list', () => {
  it('applies the converter to every element', () => {
    expect(list(item => (item as number) + 1)([1, 2, 3], createContext())).toEqual([2, 3, 4])
  })

  it('leaves out elements whose converter returns DROP', () => {
    expect(list(item => (item === 2 ? DROP : item))([1, 2, 3], createContext())).toEqual([1, 3])
  })

  it('deep-clones non-array input unchanged without calling the converter', () => {
    const convert = vi.fn(identity)
    const record = { nested: { deep: true } }
    const result = list(convert)(record, createContext())
    expect(result).toEqual(record)
    expect(result).not.toBe(record)
    expect(list(convert)(7, createContext())).toBe(7)
    expect(list(convert)(undefined, createContext())).toBe(undefined)
    expect(convert).not.toHaveBeenCalled()
  })
})

describe('getRef', () => {
  it('returns the $ref string of a reference-shaped object', () => {
    expect(getRef({ $ref: '#/components/schemas/Pet' })).toBe('#/components/schemas/Pet')
  })

  it('returns undefined for non-objects', () => {
    expect(getRef(null)).toBeUndefined()
    expect(getRef('#/ref')).toBeUndefined()
    expect(getRef(42)).toBeUndefined()
    expect(getRef([{ $ref: '#/x' }])).toBeUndefined()
  })

  it('returns undefined when $ref is missing or not a string', () => {
    expect(getRef({})).toBeUndefined()
    expect(getRef({ ref: '#/x' })).toBeUndefined()
    expect(getRef({ $ref: 42 })).toBeUndefined()
    expect(getRef({ $ref: { nested: true } })).toBeUndefined()
    expect(getRef({ $ref: null })).toBeUndefined()
  })
})

describe('child', () => {
  it('reads own record keys, including __proto__', () => {
    expect(child({ a: 1 }, 'a')).toBe(1)
    expect(child(JSON.parse('{"__proto__": 2}'), '__proto__')).toBe(2)
  })

  it('reads canonical array indices only', () => {
    const items = ['a', 'b']
    expect(child(items, '1')).toBe('b')
    expect(child(items, '2')).toBeUndefined()
    expect(child(items, '01')).toBeUndefined()
    expect(child(items, '-')).toBeUndefined()
    expect(child(items, 'length')).toBeUndefined()
    // eslint-disable-next-line no-sparse-arrays
    expect(child([, 'b'], '0')).toBeUndefined()
  })

  it('does not read inherited members or step into primitives', () => {
    expect(child({}, 'hasOwnProperty')).toBeUndefined()
    expect(child('text', 'length')).toBeUndefined()
    expect(child(null, 'a')).toBeUndefined()
  })
})

describe('resolve', () => {
  const root = { 'a': [{ 'b/c': 1 }], '': { empty: true }, 'a~b': 2, 'components': { schemas: { Pet: 3 } }, 'paths': { '/pets/{id}': 4 }, '~1': 5 }

  it('resolves a local pointer against the root, unescaping ~1 and ~0', () => {
    expect(resolve(root, '#/a/0/b~1c')).toBe(1)
    expect(resolve(root, '#/components/schemas/Pet')).toBe(3)
    expect(resolve(root, '#/paths/~1pets~1{id}')).toBe(4)
    expect(resolve(root, '#/a~0b')).toBe(2)
    expect(resolve(root, '#/~01')).toBe(5)
  })

  it('percent-decodes the fragment before splitting it', () => {
    expect(resolve(root, '#/paths/~1pets~1%7Bid%7D')).toBe(4)
    expect(resolve({ a: { b: 6 } }, '#/a%2Fb')).toBe(6)
  })

  it('resolves the whole-document pointer and the empty key', () => {
    expect(resolve(root, '#')).toBe(root)
    expect(resolve(root, '#/')).toEqual({ empty: true })
  })

  it('returns undefined for unresolvable, non-local, anchor, and malformed pointers', () => {
    expect(resolve(root, '#/a/1')).toBeUndefined()
    expect(resolve(root, '#/x/y/z')).toBeUndefined()
    expect(resolve(root, 'other.json#/a')).toBeUndefined()
    expect(resolve(root, '#anchor')).toBeUndefined()
    expect(resolve(root, '#/%E0%A4%A')).toBeUndefined()
  })
})

describe('setOwn', () => {
  it('defines an enumerable, writable, configurable own property', () => {
    const target: Record<string, unknown> = {}
    setOwn(target, 'name', 'value')
    expect(Object.getOwnPropertyDescriptor(target, 'name')).toEqual({ configurable: true, enumerable: true, value: 'value', writable: true })
  })

  it('shadows Object.prototype members with own data properties', () => {
    const target: Record<string, unknown> = {}
    setOwn(target, 'constructor', 1)
    setOwn(target, 'hasOwnProperty', 2)
    expect(Object.getOwnPropertyDescriptor(target, 'constructor')?.value).toBe(1)
    expect(Object.getOwnPropertyDescriptor(target, 'hasOwnProperty')?.value).toBe(2)
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
  })

  it('redefines a key already present on the target', () => {
    const target: Record<string, unknown> = {}
    setOwn(target, 'name', 'first')
    setOwn(target, 'name', 'second')
    expect(target).toEqual({ name: 'second' })
  })

  it('sets a __proto__ key as a plain own property without prototype pollution', () => {
    const target: Record<string, unknown> = {}
    setOwn(target, '__proto__', { polluted: true })
    const descriptor = Object.getOwnPropertyDescriptor(target, '__proto__')
    expect(descriptor?.value).toEqual({ polluted: true })
    expect(descriptor?.enumerable).toBe(true)
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
    expect('polluted' in {}).toBe(false)
  })
})

describe('allOfItems', () => {
  it('returns allOf entries, nesting a malformed allOf instead of discarding it', () => {
    const entries = [{ type: 'string' }]
    expect(allOfItems(entries)).toBe(entries)
    expect(allOfItems(undefined)).toEqual([])
    expect(allOfItems('junk')).toEqual([{ allOf: 'junk' }])
  })
})

describe('removedPrefixes', () => {
  it('lists pointer prefixes of the fields each table drops', () => {
    expect(removedPrefixes({
      '': defineFields({ kept: clone, removed: DROP }),
      '/nested': defineFields({ gone: DROP }),
    })).toEqual(['#/removed/', '#/nested/gone/'])
  })
})

describe('downgrade', () => {
  it('keeps references that still resolve and inlines references into removed parts', () => {
    expect(convertDocument({
      items: [{ $ref: '#/named/a' }, { $ref: '#/removed/b' }],
      named: { a: { value: 'a' } },
      removed: { b: { value: 'b' } },
    }).out).toEqual({
      items: [{ $ref: '#/named/a' }, { value: 'b' }],
      named: { a: { value: 'a' } },
    })
  })

  it('inlines a reference into a shifted list entry that still exists', () => {
    expect(convertDocument({
      items: [{ drop: true }, { value: 'one' }, { value: 'two' }],
      named: { a: { $ref: '#/items/1' } },
    }).out).toEqual({
      items: [{ value: 'one' }, { value: 'two' }],
      named: { a: { value: 'one' } },
    })
  })

  it('inlines references into dropped fields and shifted list entries', () => {
    expect(convertDocument({
      items: [{ drop: true }, { secret: { value: 's' }, value: 'kept' }],
      named: { a: { $ref: '#/items/1' }, b: { $ref: '#/items/1/secret' } },
    }).out).toEqual({
      items: [{ value: 'kept' }],
      named: { a: { value: 'kept' }, b: { value: 's' } },
    })
  })

  it('inlines a reference whose target is itself an external reference', () => {
    expect(convertDocument({
      items: [{ $ref: '#/removed/a' }],
      removed: { a: { $ref: 'other.json#/a' } },
    }).out).toEqual({ items: [{ $ref: 'other.json#/a' }] })
  })

  it('leaves missing, external, anchor, and malformed references as written', () => {
    const items = [{ $ref: '#/missing' }, { $ref: 'other.json#/a' }, { $ref: '#anchor' }, { $ref: '#/%E0%A4%A' }]
    expect(convertDocument({ items }).out).toEqual({ items })
  })

  it('follows reference chains through removed parts', () => {
    expect(convertDocument({
      items: [{ $ref: '#/removed/a' }],
      removed: { a: { $ref: '#/removed/b' }, b: { value: 'b' } },
    }).out).toEqual({ items: [{ value: 'b' }] })
  })

  it('removes references to a removed target through a chain of aliases in two passes', () => {
    const named = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`a${index + 1}`, { $ref: `#/named/a${index}` }]))
    const { out, passes } = convertDocument({ items: [{ $ref: '#/named/a20' }, { value: 'kept' }], named: { ...named, a0: { drop: true } } })
    expect(out).toEqual({ items: [{ value: 'kept' }], named: {} })
    expect(passes).toBe(2)
  })

  it('re-runs when a reference kept earlier in a pass turns out to target a removed alias', () => {
    const { out } = convertDocument({
      links: { alias: '#/named/alias' },
      named: { alias: { $ref: '#/named/gone' }, gone: { drop: true } },
      items: [{ $ref: '#/named/alias' }],
    })
    expect(out).toEqual({ links: {}, named: {}, items: [] })
  })

  it('follows long alias chains without deep recursion', () => {
    const named: Record<string, unknown> = {}
    for (let index = 5000; index > 0; index -= 1) {
      named[`a${index}`] = { $ref: `#/named/a${index - 1}` }
    }
    named.a0 = { drop: true }
    const { out, passes } = convertDocument({ items: [{ $ref: '#/named/a5000' }], named })
    expect(out).toEqual({ items: [], named: {} })
    expect(passes).toBe(2)
  })

  it('keeps an alias whose target is only cut by a cycle', () => {
    const { out } = convertDocument({
      items: [{ $ref: '#/removed/target' }],
      named: { alias: { $ref: '#/removed/target' } },
      removed: { target: { next: { $ref: '#/named/alias' }, value: 't' } },
    })
    expect(out).toEqual({
      items: [{ next: { $ref: '#/named/alias' }, value: 't' }],
      named: { alias: { next: { $ref: '#/named/alias' }, value: 't' } },
    })
  })

  it('keeps a loop of aliases as written, even in a removed part', () => {
    const items = [{ $ref: '#/named/a' }, { $ref: '#/removed/a' }]
    const named = { a: { $ref: '#/named/b' }, b: { $ref: '#/named/a' } }
    const removed = { a: { $ref: '#/removed/b' }, b: { $ref: '#/removed/a' } }
    expect(convertDocument({ items, named, removed }, ['#/removed/']).out).toEqual({ items, named })
  })

  it('removes references to removed targets, cascading through aliases', () => {
    expect(convertDocument({
      items: [{ $ref: '#/named/alias' }, { $ref: '#/named/gone' }, { value: 'kept' }],
      named: { alias: { $ref: '#/named/gone' }, gone: { drop: true }, other: { $ref: '#/items/2' } },
    }).out).toEqual({
      items: [{ value: 'kept' }],
      named: { other: { value: 'kept' } },
    })
  })

  it('cuts a reference cycle at its first repeat, however the target is spelled', () => {
    const removed = { a: { next: { $ref: '#/removed/b' }, value: 'a' }, b: { next: { $ref: '#/removed/%61' }, value: 'b' } }
    expect(convertDocument({ items: [{ $ref: '#/removed/a' }], removed }).out).toEqual({ items: [{ next: { value: 'b' }, value: 'a' }] })
  })

  it('converts a target inlined from several places once, however it is spelled', () => {
    const { out } = convertDocument({
      items: [{ $ref: '#/removed/a' }, { $ref: '#/removed/a' }, { $ref: '#/removed/%61' }],
      removed: { a: { value: 'a' } },
    })
    expect(out.items[0]).toBe(out.items[1])
    expect(out.items[0]).toBe(out.items[2])
  })

  it('converts a target again for a later place when its conversion identified a value', () => {
    const fields = defineFields({
      items: list(refOr((value, ctx) => {
        const repeated = ctx.identified.has(value)
        ctx.identified.add(value)
        return { repeated }
      })),
    })
    const { out } = convertDocument({ items: [{ $ref: '#/removed/a' }, { $ref: '#/removed/a' }, { $ref: '#/removed/a' }], removed: { a: {} } }, ['#/removed/'], fields)
    expect(out.items).toEqual([{ repeated: false }, { repeated: true }, { repeated: true }])
    expect(out.items[2]).toBe(out.items[1])
  })

  it('resolves references nested in inlined targets without a pass per level', () => {
    const removed = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`r${index}`, { next: { $ref: `#/removed/r${index + 1}` } }]))
    const { out, passes } = convertDocument({ items: [{ $ref: '#/removed/r0' }], removed: { ...removed, r20: { value: 'end' } } })
    expect(JSON.stringify(out)).toContain('"end"')
    expect(JSON.stringify(out)).not.toContain('$ref')
    expect(passes).toBe(2)
  })

  it('treats references under removed prefixes as dangling from the first pass', () => {
    const doc = { items: [{ $ref: '#/removed/a' }, { $ref: '#/removed/missing' }], removed: { a: { value: 'a' } } }
    const { out, passes } = convertDocument(doc, ['#/removed/'])
    expect(out).toEqual({ items: [{ value: 'a' }, { $ref: '#/removed/missing' }] })
    expect(passes).toBe(1)
  })

  it('preserves cycles and sharing of the input graph without mutating it', () => {
    const shared: Record<string, unknown> = { value: 'shared' }
    shared.next = shared
    const input = { items: [shared], named: { 'a': shared, 'x-raw': { $ref: '#/removed/a' } }, removed: { a: {} } }
    const before = structuredClone(input)
    const { out } = convertDocument(input)
    expect(out.items[0]?.next).toBe(out.items[0])
    expect(out.named.a).toBe(out.items[0])
    expect(out.named['x-raw']).toEqual({ $ref: '#/removed/a' })
    expect(input).toEqual(before)
  })
})
