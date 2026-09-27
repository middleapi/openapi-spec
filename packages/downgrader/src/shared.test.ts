import type { FieldTable } from './shared'

import { dig } from '../tests/helpers'
import {
  convertInlined,
  convertRecord,
  deepClone,
  DROP,
  getChild,
  getRef,
  HTTP_METHODS_UP_TO_V31,
  isConverting,
  isRecord,
  mapArray,
  mapRecord,
  operationFields,
  parseLocalRef,
  resolveLocalRef,
  setOwn,
} from './shared'

function identity<T>(value: T): T {
  return value
}

function convertNode(value: unknown): unknown {
  return convertRecord(value, {
    name: () => 'converted',
    self: item => convertNode(item),
  })
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

describe('deepClone', () => {
  it('deep-copies nested plain objects and arrays without sharing references', () => {
    const input = {
      list: [{ deep: { value: 1 } }, [2, 3]],
      nested: { inner: { leaf: 'x' } },
    }
    const clone = deepClone(input)
    expect(clone).toEqual(input)
    expect(clone).not.toBe(input)
    expect(clone.list).not.toBe(input.list)
    expect(clone.list[0]).not.toBe(input.list[0])
    expect(clone.list[1]).not.toBe(input.list[1])
    expect(clone.nested).not.toBe(input.nested)
    expect(clone.nested.inner).not.toBe(input.nested.inner)
  })

  it('keeps functions and class instances by reference', () => {
    const date = new Date()
    const map = new Map<string, number>()
    const clone = deepClone({ date, fn: identity, map })
    expect(clone.fn).toBe(identity)
    expect(clone.date).toBe(date)
    expect(clone.map).toBe(map)
  })

  it('returns primitives as-is', () => {
    expect(deepClone(1)).toBe(1)
    expect(deepClone('a')).toBe('a')
    expect(deepClone(null)).toBe(null)
    expect(deepClone(true)).toBe(true)
  })

  it('copies a hostile __proto__ own key as a plain own data property without prototype pollution', () => {
    const input: unknown = JSON.parse('{"__proto__": {"polluted": true}}')
    const clone = deepClone(input)
    expect(Object.getOwnPropertyNames(clone)).toContain('__proto__')
    expect(Object.getOwnPropertyDescriptor(clone, '__proto__')?.value).toEqual({
      polluted: true,
    })
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype)
    expect('polluted' in {}).toBe(false)
  })

  it('preserves key order', () => {
    const input: Record<string, unknown> = {}
    input.zebra = 1
    input.apple = 2
    input.mango = 3
    expect(Object.keys(deepClone(input))).toEqual(['zebra', 'apple', 'mango'])
  })

  it('preserves object cycles instead of recursing forever', () => {
    const child: Record<string, unknown> = {}
    const node: Record<string, unknown> = { child, name: 'root' }
    child.parent = node
    const clone = deepClone(node)
    expect(clone).not.toBe(node)
    expect(clone.name).toBe('root')
    expect(dig(clone, 'child', 'parent')).toBe(clone)
  })

  it('preserves array cycles', () => {
    const list: unknown[] = [1]
    list.push(list)
    const clone = deepClone(list)
    expect(clone).not.toBe(list)
    expect(clone[0]).toBe(1)
    expect(clone[1]).toBe(clone)
  })

  it('clones shared references once', () => {
    const shared = { a: 1 }
    const clone = deepClone({ x: shared, y: shared })
    expect(clone.x).toEqual({ a: 1 })
    expect(clone.x).not.toBe(shared)
    expect(clone.x).toBe(clone.y)
  })

  it('returns a fresh copy on every call', () => {
    const shared = { a: 1 }
    expect(deepClone(shared)).not.toBe(deepClone(shared))
  })
})

describe('convertRecord', () => {
  it('routes listed fields through their converters and deep-clones the rest', () => {
    const extra = { deep: true }
    const result = convertRecord(
      { a: 1, b: 2, extra },
      { a: item => [item], b: () => 'converted' },
    ) as Record<string, unknown>
    expect(result).toEqual({ a: [1], b: 'converted', extra: { deep: true } })
    expect(result.extra).not.toBe(extra)
  })

  it('removes fields mapped to DROP and fields whose converter returns DROP', () => {
    const result = convertRecord(
      { gone: 1, kept: 2, maybe: 3 },
      { gone: DROP, maybe: item => (item === 3 ? DROP : item) },
    )
    expect(result).toEqual({ kept: 2 })
  })

  it('passes the whole source record to converters and to finish', () => {
    const source = { flag: true, value: 1 }
    const result = convertRecord(
      source,
      { value: (item, record) => (record.flag ? item : DROP) },
      (out, record) => ({ ...out, sameSource: record === source }),
    )
    expect(result).toEqual({ flag: true, sameSource: true, value: 1 })
  })

  it('lets finish replace the whole result', () => {
    expect(convertRecord({ a: 1 }, {}, () => DROP)).toBe(DROP)
  })

  it('preserves key order', () => {
    const input: Record<string, unknown> = {}
    input.zebra = 1
    input.apple = 2
    input.mango = 3
    const result = convertRecord(input, { apple: identity }) as Record<string, unknown>
    expect(Object.keys(result)).toEqual(['zebra', 'apple', 'mango'])
  })

  it('deep-clones non-object input without consulting the table', () => {
    const convert = vi.fn(identity)
    const list = [{ a: 1 }]
    const result = convertRecord(list, { a: convert })
    expect(result).toEqual(list)
    expect(result).not.toBe(list)
    expect(convertRecord('text', { a: convert })).toBe('text')
    expect(convertRecord(null, { a: convert })).toBe(null)
    expect(convert).not.toHaveBeenCalled()
  })

  it('does not look up table entries through the prototype chain', () => {
    const input: unknown = JSON.parse(
      '{"constructor": 1, "toString": 2, "__proto__": {"polluted": true}}',
    )
    const result = convertRecord(input, {})
    expect(Object.getOwnPropertyDescriptor(result, 'constructor')?.value).toBe(
      1,
    )
    expect(Object.getOwnPropertyDescriptor(result, 'toString')?.value).toBe(2)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual(
      { polluted: true },
    )
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect('polluted' in {}).toBe(false)
  })

  it('points a cyclic reference at the converted ancestor when re-entered for the same object', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const result = convertNode(node) as Record<string, unknown>
    expect(result.name).toBe('converted')
    expect(result.self).toBe(result)
    expect(node.self).toBe(node)
  })

  it('converts a cycle that closes several levels down', () => {
    const grandchild: Record<string, unknown> = { name: 'grandchild' }
    const child: Record<string, unknown> = { name: 'child', self: grandchild }
    const root: Record<string, unknown> = { name: 'root', self: child }
    grandchild.self = child
    const result = convertNode(root) as Record<string, unknown>
    const convertedChild = result.self as Record<string, unknown>
    const convertedGrandchild = convertedChild.self as Record<string, unknown>
    expect(convertedChild.name).toBe('converted')
    expect(convertedGrandchild.name).toBe('converted')
    expect(convertedGrandchild.self).toBe(convertedChild)
    expect(child.self).toBe(grandchild)
  })

  it('releases the cycle guard once a conversion finishes', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const first = convertNode(node) as Record<string, unknown>
    const second = convertNode(node) as Record<string, unknown>
    expect(second).not.toBe(first)
    expect(second.self).toBe(second)
  })

  it('converts a shared reference once per call and reuses the result', () => {
    const shared = { name: 'x' }
    const fields: FieldTable = { name: () => 'converted' }
    const convert = (item: unknown) => convertRecord(item, fields)
    const result = convertRecord({ a: shared, b: shared }, { a: convert, b: convert })
    expect(result).toEqual({ a: { name: 'converted' }, b: { name: 'converted' } })
    expect(dig(result, 'b')).toBe(dig(result, 'a'))
  })

  it('clones a shared reference once per call', () => {
    const shared = { deep: true }
    const result = convertRecord({ a: shared, b: [shared] }, {})
    expect(result).toEqual({ a: { deep: true }, b: [{ deep: true }] })
    expect(dig(result, 'b', '0')).toBe(dig(result, 'a'))
    expect(dig(result, 'a')).not.toBe(shared)
  })

  it('reuses a finished result only for the same field table and finish', () => {
    const shared = { name: 'x' }
    const fields: FieldTable = { name: () => 'converted' }
    const wrap = (out: Record<string, unknown>) => ({ wrapped: out })
    const result = convertRecord(
      { a: shared, b: shared, c: shared, d: shared },
      {
        a: item => convertRecord(item, fields, wrap),
        b: item => convertRecord(item, fields, wrap),
        c: item => convertRecord(item, fields),
        d: item => convertRecord(item, {}),
      },
    )
    expect(result).toEqual({
      a: { wrapped: { name: 'converted' } },
      b: { wrapped: { name: 'converted' } },
      c: { name: 'converted' },
      d: { name: 'x' },
    })
    expect(dig(result, 'b')).toBe(dig(result, 'a'))
  })

  it('returns fresh results on every call', () => {
    const shared = { name: 'x' }
    const fields: FieldTable = { name: () => 'converted' }
    expect(convertRecord(shared, fields)).not.toBe(convertRecord(shared, fields))
    expect(dig(convertRecord({ a: shared }, {}), 'a')).not.toBe(dig(convertRecord({ a: shared }, {}), 'a'))
  })

  it('releases the cycle guard when a converter throws', () => {
    const value = { a: 1 }
    expect(() =>
      convertRecord(value, {
        a: () => {
          throw new Error('boom')
        },
      }),
    ).toThrow('boom')
    expect(convertRecord(value, { a: () => 2 })).toEqual({ a: 2 })
  })

  it('forgets reused results and clones when a converter throws', () => {
    const shared = { name: 'x' }
    const convert = vi.fn(() => 'converted')
    const fields: FieldTable = { name: convert }
    let clone: unknown
    expect(() =>
      convertRecord({ a: shared }, {
        a: (item) => {
          convertRecord(item, fields)
          clone = deepClone(item)
          throw new Error('boom')
        },
      }),
    ).toThrow('boom')
    const result = convertRecord({ a: shared, b: shared }, { a: item => convertRecord(item, fields) })
    expect(convert).toHaveBeenCalledTimes(2)
    expect(dig(result, 'b')).not.toBe(clone)
  })
})

describe('operationFields', () => {
  it('routes every HTTP method of a path item to the converter', () => {
    const fields = operationFields(identity)
    expect(Object.keys(fields)).toEqual([...HTTP_METHODS_UP_TO_V31])
    expect(Object.values(fields).every(entry => entry === identity)).toBe(
      true,
    )
  })
})

describe('mapRecord', () => {
  it('applies the converter to every value with the key as second argument', () => {
    const calls: [unknown, string][] = []
    const result = mapRecord({ a: 1, b: 2 }, (item, key) => {
      calls.push([item, key])
      return (item as number) * 10
    })
    expect(result).toEqual({ a: 10, b: 20 })
    expect(calls).toEqual([
      [1, 'a'],
      [2, 'b'],
    ])
  })

  it('leaves out entries whose converter returns DROP', () => {
    const result = mapRecord({ a: 1, b: 2, c: 3 }, item =>
      item === 2 ? DROP : item)
    expect(result).toEqual({ a: 1, c: 3 })
  })

  it('preserves key order', () => {
    const input: Record<string, unknown> = {}
    input.zebra = 1
    input.apple = 2
    const result = mapRecord(input, identity) as Record<string, unknown>
    expect(Object.keys(result)).toEqual(['zebra', 'apple'])
  })

  it('deep-clones non-object input unchanged without calling the converter', () => {
    const convert = vi.fn(identity)
    const array = [{ nested: true }]
    const result = mapRecord(array, convert)
    expect(result).toEqual(array)
    expect(result).not.toBe(array)
    expect(mapRecord('text', convert)).toBe('text')
    expect(mapRecord(null, convert)).toBe(null)
    expect(convert).not.toHaveBeenCalled()
  })
})

describe('mapArray', () => {
  it('applies the converter to every element', () => {
    const result = mapArray([1, 2, 3], item => (item as number) + 1)
    expect(result).toEqual([2, 3, 4])
  })

  it('leaves out elements whose converter returns DROP', () => {
    const result = mapArray([1, 2, 3], item => (item === 2 ? DROP : item))
    expect(result).toEqual([1, 3])
  })

  it('deep-clones non-array input unchanged without calling the converter', () => {
    const convert = vi.fn(identity)
    const record = { nested: { deep: true } }
    const result = mapArray(record, convert)
    expect(result).toEqual(record)
    expect(result).not.toBe(record)
    expect(mapArray(7, convert)).toBe(7)
    expect(mapArray(undefined, convert)).toBe(undefined)
    expect(convert).not.toHaveBeenCalled()
  })
})

describe('getRef', () => {
  it('returns the $ref string of a reference-shaped object', () => {
    expect(getRef({ $ref: '#/components/schemas/Pet' })).toBe(
      '#/components/schemas/Pet',
    )
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

describe('convertInlined', () => {
  it('drops a conversion still in progress outside the inline and keeps cycles inside it', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    const source = { child: 'x' }
    const result = convertRecord(source, {
      child: () => convertInlined(() => ({ back: convertRecord(source, {}), node: convertNode(node) })),
    })
    expect(dig(result, 'child', 'back')).toBe(DROP)
    expect(dig(result, 'child', 'node', 'self')).toBe(dig(result, 'child', 'node'))
  })

  it('converts again, outside the inline, a result that was cut inside it', () => {
    const node: Record<string, unknown> = { name: 'root' }
    const child = { self: node }
    node.self = child
    const convertChild = (item: unknown): unknown => convertRecord(item, { self: convertNode })
    const result = convertRecord(node, {
      name: () => convertInlined(() => convertChild(child)),
      self: convertChild,
    })
    expect(dig(result, 'name')).toEqual({})
    expect(dig(result, 'self', 'self')).toBe(result)
  })
})

describe('isConverting', () => {
  it('reports only source records whose conversion is still in progress', () => {
    const child = { a: 1 }
    const source = { child }
    const seen: boolean[] = []
    convertRecord(source, {
      child: (item) => {
        seen.push(isConverting(source), isConverting(item))
        return item
      },
    })
    expect(seen).toEqual([true, false])
    expect(isConverting(source)).toBe(false)
    expect(isConverting('text')).toBe(false)
  })
})

describe('parseLocalRef', () => {
  it('splits a local JSON pointer into unescaped tokens', () => {
    expect(parseLocalRef('#/components/schemas/Pet')).toEqual(['components', 'schemas', 'Pet'])
    expect(parseLocalRef('#/paths/~1pets~1{id}/a~0b')).toEqual(['paths', '/pets/{id}', 'a~b'])
    expect(parseLocalRef('#/~01')).toEqual(['~1'])
  })

  it('percent-decodes the fragment before splitting it', () => {
    expect(parseLocalRef('#/paths/~1pets~1%7Bid%7D')).toEqual(['paths', '/pets/{id}'])
    expect(parseLocalRef('#/a%2Fb')).toEqual(['a', 'b'])
  })

  it('returns no tokens for the whole-document pointer', () => {
    expect(parseLocalRef('#')).toEqual([])
    expect(parseLocalRef('#/')).toEqual([''])
  })

  it('returns undefined for external refs, anchors, and malformed percent-encoding', () => {
    expect(parseLocalRef('other.json#/a')).toBeUndefined()
    expect(parseLocalRef('#anchor')).toBeUndefined()
    expect(parseLocalRef('#/%E0%A4%A')).toBeUndefined()
  })
})

describe('getChild', () => {
  it('reads own record keys, including __proto__', () => {
    expect(getChild({ a: 1 }, 'a')).toBe(1)
    expect(getChild(JSON.parse('{"__proto__": 2}'), '__proto__')).toBe(2)
  })

  it('reads canonical array indices only', () => {
    const list = ['a', 'b']
    expect(getChild(list, '1')).toBe('b')
    expect(getChild(list, '2')).toBeUndefined()
    expect(getChild(list, '01')).toBeUndefined()
    expect(getChild(list, '-')).toBeUndefined()
    expect(getChild(list, 'length')).toBeUndefined()
    // eslint-disable-next-line no-sparse-arrays
    expect(getChild([, 'b'], '0')).toBeUndefined()
  })

  it('does not read inherited members or step into primitives', () => {
    expect(getChild({}, 'hasOwnProperty')).toBeUndefined()
    expect(getChild('text', 'length')).toBeUndefined()
    expect(getChild(null, 'a')).toBeUndefined()
  })
})

describe('resolveLocalRef', () => {
  const root = { a: [{ 'b/c': 1 }] }

  it('resolves a local pointer against the root', () => {
    expect(resolveLocalRef(root, '#/a/0/b~1c')).toBe(1)
    expect(resolveLocalRef(root, '#')).toBe(root)
  })

  it('returns undefined for unresolvable or non-local pointers', () => {
    expect(resolveLocalRef(root, '#/a/1')).toBeUndefined()
    expect(resolveLocalRef(root, '#/x/y/z')).toBeUndefined()
    expect(resolveLocalRef(root, 'other.json#/a')).toBeUndefined()
  })
})

describe('setOwn', () => {
  it('defines an enumerable, writable, configurable own property', () => {
    const target: Record<string, unknown> = {}
    setOwn(target, 'name', 'value')
    expect(Object.getOwnPropertyDescriptor(target, 'name')).toEqual({
      configurable: true,
      enumerable: true,
      value: 'value',
      writable: true,
    })
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
