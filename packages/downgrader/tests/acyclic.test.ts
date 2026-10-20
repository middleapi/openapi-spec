// Acyclic input must give acyclic output, which JSON.stringify can write,
// however its `$ref`s lead back into the targets being inlined. These are
// random documents and schemas whose `$ref`s point at random objects in
// them, ancestors included, and which share some objects as a dereferencing
// parser would.

import {
  downgradeSchemaV31ToV30,
  downgradeSchemaV32ToV31,
  downgradeSpecV31ToV30,
  downgradeSpecV32ToV31,
} from '@openapi-spec/downgrader'

import { expectAcyclic } from './validate'

type Kind =
  | 'callback'
  | 'header'
  | 'mediaType'
  | 'parameter'
  | 'pathItem'
  | 'requestBody'
  | 'response'
  | 'schema'

type Node = Record<string, unknown>

type Build = (pointer: string) => unknown

const LEAF_SCHEMAS: readonly (() => unknown)[] = [
  () => ({ type: 'string' }),
  () => ({ type: ['integer', 'null'] }),
  () => ({ const: 1 }),
  () => ({ propertyNames: { maxLength: 3 } }),
  () => true,
  () => false,
]

class Generator {
  // Where the objects built so far are, and the objects themselves, by kind.
  private readonly pointers = new Map<Kind, string[]>()
  private readonly built = new Map<Kind, Node[]>()
  // The `$ref`s that `link` points at built objects.
  private readonly refs: [Node, Kind][] = []
  private state: number

  constructor(seed: number) {
    this.state = seed
  }

  // mulberry32, so every run sees the same inputs.
  private random(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), this.state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }

  private chance(probability: number): boolean {
    return this.random() < probability
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)] as T
  }

  private ref(kind: Kind, out: Node = {}): Node {
    out.$ref = ''
    this.refs.push([out, kind])
    return out
  }

  /** An object of `kind` at `pointer`: one built before, a `$ref`, or a new one. */
  private node(kind: Kind, pointer: string, depth: number, build: () => Node): Node {
    const built = this.built.get(kind) ?? []
    if (built.length > 0 && this.chance(0.1)) {
      return this.pick(built)
    }
    if (depth <= 0 || this.chance(0.25)) {
      return this.ref(kind)
    }
    const out = build()
    this.pointers.set(kind, [...(this.pointers.get(kind) ?? []), pointer])
    this.built.set(kind, [...built, out])
    return out
  }

  /** An object with each of `fields` kept with `probability`. */
  private object(pointer: string, fields: Record<string, Build>, probability = 1): Node {
    const out: Node = {}
    for (const [key, build] of Object.entries(fields)) {
      if (this.chance(probability)) {
        out[key] = build(`${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
      }
    }
    return out
  }

  schema(pointer: string, depth: number): unknown {
    if (depth <= 0 || this.chance(0.2)) {
      return this.chance(0.3) ? this.ref('schema') : this.pick(LEAF_SCHEMAS)()
    }
    return this.node('schema', pointer, depth, () => {
      const sub: Build = (p) => this.schema(p, depth - 1)
      const pair: Build = (p) => [sub(`${p}/0`), sub(`${p}/1`)]
      const out = this.object(
        pointer,
        {
          type: () => this.pick(['object', 'array', ['object', 'null']]),
          $defs: (p) => this.object(p, { A: sub, B: sub }),
          properties: (p) => this.object(p, { a: sub, b: sub }),
          additionalProperties: sub,
          items: sub,
          prefixItems: pair,
          allOf: pair,
          anyOf: pair,
          oneOf: pair,
          not: sub,
          propertyNames: sub,
          unevaluatedProperties: sub,
        },
        0.3,
      )
      return this.chance(0.3) ? this.ref('schema', out) : out
    })
  }

  private content(pointer: string, depth: number): Node {
    return this.object(pointer, { 'application/json': (p) => this.mediaType(p, depth) })
  }

  mediaType(pointer: string, depth: number): Node {
    return this.node('mediaType', pointer, depth, () =>
      this.object(
        pointer,
        {
          schema: (p) => this.schema(p, depth - 1),
          encoding: (p) =>
            this.object(p, {
              part: (q) =>
                this.object(q, {
                  headers: (r) => this.object(r, { 'X-H': (s) => this.header(s, depth - 1) }),
                }),
            }),
        },
        0.6,
      ),
    )
  }

  private schemaOrContent(pointer: string, depth: number): Node {
    return this.chance(0.5)
      ? this.object(pointer, { schema: (p) => this.schema(p, depth - 1) })
      : this.object(pointer, { content: (p) => this.content(p, depth - 1) })
  }

  private header(pointer: string, depth: number): Node {
    return this.node('header', pointer, depth, () => this.schemaOrContent(pointer, depth))
  }

  private parameter(pointer: string, depth: number): Node {
    return this.node('parameter', pointer, depth, () => ({
      name: 'q',
      in: 'query',
      ...this.schemaOrContent(pointer, depth),
    }))
  }

  private response(pointer: string, depth: number): Node {
    return this.node('response', pointer, depth, () => ({
      description: 'ok',
      ...this.object(
        pointer,
        {
          content: (p) => this.content(p, depth - 1),
          headers: (p) => this.object(p, { 'X-R': (q) => this.header(q, depth - 1) }),
        },
        0.6,
      ),
    }))
  }

  private operation(pointer: string, depth: number): Node {
    return {
      ...this.object(
        pointer,
        {
          parameters: (p) => [this.parameter(`${p}/0`, depth - 1)],
          requestBody: (p) =>
            this.node('requestBody', p, depth - 1, () =>
              this.object(p, { content: (q) => this.content(q, depth - 2) }),
            ),
          callbacks: (p) =>
            this.object(p, {
              cb: (q) =>
                this.node('callback', q, depth - 1, () =>
                  this.object(q, { '{$request.query.cb}': (r) => this.pathItem(r, depth - 2) }),
                ),
            }),
        },
        0.5,
      ),
      ...this.object(pointer, {
        responses: (p) => this.object(p, { 200: (q) => this.response(q, depth - 1) }),
      }),
    }
  }

  pathItem(pointer: string, depth: number): Node {
    return this.node('pathItem', pointer, depth, () => {
      const operation: Build = (p) => this.operation(p, depth - 1)
      const out = this.object(pointer, { get: operation, post: operation }, 0.6)
      return this.chance(0.3) ? this.ref('pathItem', out) : out
    })
  }

  /** Points each `$ref` at a built object, mostly of its own kind. */
  link<T>(root: T): T {
    const all = [...this.pointers.values()].flat()
    for (const [ref, kind] of this.refs) {
      const own = this.pointers.get(kind) ?? []
      ref.$ref = own.length > 0 && this.chance(0.9) ? this.pick(own) : this.pick(['#', ...all])
    }
    return root
  }
}

// Each level multiplies the size of an input, so deeper ones would slow the test down.
const DEPTH = 4

function randomSchema(seed: number): any {
  const g = new Generator(seed)
  return g.link({
    allOf: [g.schema('#/allOf/0', DEPTH)],
    $defs: { D: g.schema('#/$defs/D', DEPTH) },
  })
}

function randomDocument(seed: number): any {
  const g = new Generator(seed)
  return g.link({
    openapi: '3.2.0',
    info: { title: 'API', version: '1.0.0' },
    paths: { '/a': g.pathItem('#/paths/~1a', DEPTH), '/b': g.pathItem('#/paths/~1b', DEPTH) },
    webhooks: { W: g.pathItem('#/webhooks/W', DEPTH), V: g.pathItem('#/webhooks/V', DEPTH) },
    components: {
      mediaTypes: { M: g.mediaType('#/components/mediaTypes/M', DEPTH) },
      pathItems: { P: g.pathItem('#/components/pathItems/P', DEPTH) },
      schemas: { S: g.schema('#/components/schemas/S', DEPTH) },
    },
  })
}

const SEEDS = Array.from({ length: 300 }, (_, index) => index)

it.each([
  ['downgradeSchemaV31ToV30', downgradeSchemaV31ToV30],
  ['downgradeSchemaV32ToV31', downgradeSchemaV32ToV31],
])('%s keeps random acyclic schemas acyclic', (_name, downgrade) => {
  for (const seed of SEEDS) {
    const schema = randomSchema(seed)
    expectAcyclic(schema)
    expectAcyclic(downgrade(schema), `seed ${seed}`)
  }
})

it.each([
  ['downgradeSpecV31ToV30', downgradeSpecV31ToV30],
  ['downgradeSpecV32ToV31', downgradeSpecV32ToV31],
  ['both steps', (doc: any) => downgradeSpecV31ToV30(downgradeSpecV32ToV31(doc))],
])('%s keeps random acyclic documents acyclic', (_name, downgrade) => {
  for (const seed of SEEDS) {
    const doc = randomDocument(seed)
    expectAcyclic(doc)
    expectAcyclic(downgrade(doc), `seed ${seed}`)
  }
})
