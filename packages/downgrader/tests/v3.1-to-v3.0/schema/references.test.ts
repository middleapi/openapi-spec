import { convertSchema } from './helpers'

describe('$ref with sibling keywords', () => {
  // A 3.0 Reference Object "cannot be extended with additional properties,
  // and any properties added SHALL be ignored":
  // https://spec.openapis.org/oas/v3.0.4.html#reference-object
  // In 3.1 a `$ref` applies beside its siblings, like one more `allOf` entry:
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1
  // Moving the `$ref` into `allOf` keeps both applying in 3.0. It goes
  // first, so existing `allOf` entries keep their relative order.
  it.each([
    ['moves the $ref into allOf', { $ref: '#/c/s', minLength: 1 }, { allOf: [{ $ref: '#/c/s' }], minLength: 1 }],
    ['prepends the $ref to an existing allOf', { $ref: '#/c/s', allOf: [{ type: 'string' }] }, { allOf: [{ $ref: '#/c/s' }, { type: 'string' }] }],
    ['nests a malformed allOf instead of discarding it', { $ref: '#/c/s', allOf: 'junk' }, { allOf: [{ $ref: '#/c/s' }, { allOf: 'junk' }] }],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })

  it('keeps a lone $ref as a bare Reference Object, wherever it points', () => {
    const input = { $ref: '#/components/schemas/Pet' }
    const result = convertSchema(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(convertSchema({ $ref: 'https://example.com/pet.json' })).toEqual({ $ref: 'https://example.com/pet.json' })
  })

  it('passes a non-string $ref through', () => {
    expect(convertSchema({ $ref: 123, type: 'string' })).toEqual({ $ref: 123, type: 'string' })
    expect(convertSchema({ $ref: 123 })).toEqual({ $ref: 123 })
  })
})

describe('references into removed keywords', () => {
  // `$defs` has no 3.0 form, and 3.0 schemas are reused through
  // `components.schemas` instead. A standalone schema has no components, so
  // each `$ref` into `$defs` is replaced by the converted definition.
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.4
  it('inlines $refs into $defs', () => {
    expect(convertSchema({ $defs: { a: { type: ['string', 'null'] } }, items: { $ref: '#/$defs/a' }, type: 'array' })).toEqual({
      items: { nullable: true, type: 'string' },
      type: 'array',
    })
  })

  // Inlining a recursive definition would never end. The recursion is cut
  // at its first repeat with `{}`, the schema that accepts anything, so the
  // result can only be looser than the original, never stricter.
  it('cuts recursion into {}', () => {
    expect(convertSchema({
      $defs: { node: { properties: { next: { $ref: '#/$defs/node' } }, type: 'object' } },
      $ref: '#/$defs/node',
    })).toEqual({ allOf: [{ properties: { next: {} }, type: 'object' }] })
  })

  it('inlines a definition that is itself an external reference', () => {
    expect(convertSchema({
      $defs: { pet: { $ref: './schemas/pet.yaml' } },
      properties: { pet: { $ref: '#/$defs/pet' } },
    })).toEqual({ properties: { pet: { $ref: './schemas/pet.yaml' } } })
  })

  // The `items` beside `prefixItems` is removed, and an `items: {}`
  // placeholder takes its place so the array stays valid 3.0. A `$ref` to
  // the original `items` must get the original schema, not the placeholder.
  it('inlines a $ref to items removed beside prefixItems instead of the placeholder that replaced them', () => {
    expect(convertSchema({
      properties: {
        cell: { $ref: '#/properties/row/items' },
        notCell: { not: { $ref: '#/properties/row/items' } },
        row: { items: { type: 'integer' }, prefixItems: [{ type: 'string' }], type: 'array' },
      },
    })).toEqual({
      properties: {
        cell: { type: 'integer' },
        notCell: { not: { type: 'integer' } },
        row: { items: {}, type: 'array' },
      },
    })
  })

  // A standalone schema has no document around it, so pointers into
  // `components` or `webhooks` cannot be checked and stay as written.
  it('leaves references and mapping entries that point outside the schema as written', () => {
    const schema = {
      discriminator: { mapping: { a: '#/webhooks/newPet/post/requestBody/content/application~1json/schema' }, propertyName: 'kind' },
      properties: { a: { $ref: '#/webhooks/newPet/post/requestBody/content/application~1json/schema' } },
    }
    expect(convertSchema(schema)).toEqual(schema)
  })
})

describe('references inside an $id resource', () => {
  // A subschema with its own `$id` is an embedded resource, and a fragment
  // `$ref` inside it resolves against that resource, not the schema root:
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.1
  // 3.0 has no `$id`, so each JSON Pointer is rewritten to start from the
  // schema root and then inlined or kept like any other reference.
  it('cuts recursion through # at the resource instead of the root', () => {
    expect(convertSchema({
      $defs: { tree: { $id: 'https://example.com/tree', properties: { child: { $ref: '#' } }, type: 'object' } },
      properties: { t: { $ref: '#/$defs/tree' } },
      required: ['t'],
      type: 'object',
    })).toEqual({
      properties: { t: { properties: { child: {} }, type: 'object' } },
      required: ['t'],
      type: 'object',
    })
  })

  it('resolves pointers within the resource even where the root has the same path', () => {
    expect(convertSchema({
      $defs: {
        name: { type: 'integer' },
        res: {
          $defs: { alias: { $ref: '#/$defs/name' }, name: { type: 'string' } },
          $id: 'https://example.com/res',
          properties: { n: { $ref: '#/$defs/name' } },
        },
      },
      properties: { a: { $ref: '#/$defs/res' }, alias: { $ref: '#/$defs/res/$defs/alias' } },
    })).toEqual({
      properties: { a: { properties: { n: { type: 'string' } } }, alias: { type: 'string' } },
    })
  })

  // Read from the root, `res/$defs/a` would point at the root's `b`, which
  // points back at it, a loop that would be left as a dangling `$ref`.
  it('follows reference chains from each hop\'s own resource', () => {
    expect(convertSchema({
      $defs: {
        b: { $ref: '#/$defs/res/$defs/a' },
        res: { $defs: { a: { $ref: '#/$defs/b' }, b: { type: 'string' } }, $id: 'https://example.com/res' },
      },
      properties: { a: { $ref: '#/$defs/res/$defs/a' } },
    })).toEqual({ properties: { a: { type: 'string' } } })
  })

  it('rewrites a reference into a resource that stays in place as a pointer from the root', () => {
    expect(convertSchema({
      properties: {
        outer: {
          $id: 'https://example.com/outer',
          properties: {
            inner: { $id: 'inner', properties: { self: { $ref: '#' } } },
            sibling: { $ref: '#/properties/inner', description: 'd' },
            up: { $ref: '#' },
          },
        },
      },
    })).toEqual({
      properties: {
        outer: {
          properties: {
            inner: { properties: { self: { $ref: '#/properties/outer/properties/inner' } } },
            sibling: { allOf: [{ $ref: '#/properties/outer/properties/inner' }], description: 'd' },
            up: { $ref: '#/properties/outer' },
          },
        },
      },
    })
  })

  it('applies the resource to its own $ref', () => {
    expect(convertSchema({
      properties: { r: { $defs: { s: { type: 'string' } }, $id: 'https://example.com/r', $ref: '#/$defs/s', minLength: 1 } },
    })).toEqual({ properties: { r: { allOf: [{ type: 'string' }], minLength: 1 } } })
  })

  // https://www.rfc-editor.org/rfc/rfc6901#section-3 and section-6
  it('escapes the resource location in the rewritten pointer', () => {
    expect(convertSchema({
      properties: { 'a/b~c%': { $id: 'https://example.com/r', properties: { self: { $ref: '#' }, x: { $ref: '#/properties/self' } } } },
    })).toEqual({
      properties: {
        'a/b~c%': { properties: { self: { $ref: '#/properties/a~1b~0c%25' }, x: { $ref: '#/properties/a~1b~0c%25/properties/self' } } },
      },
    })
  })

  it('leaves anchors, URIs, and references outside an embedded resource as written', () => {
    const schema = {
      $id: 'https://example.com/root',
      properties: {
        $id: { $ref: '#' },
        res: {
          $id: 'https://example.com/res',
          properties: { anchor: { $ref: '#node' }, external: { $ref: 'https://example.com/other' }, relative: { $ref: 'other#/$defs/a' } },
        },
        self: { $ref: '#' },
      },
    }
    expect(convertSchema(schema)).toEqual({
      properties: {
        $id: { $ref: '#' },
        res: { properties: { anchor: { $ref: '#node' }, external: { $ref: 'https://example.com/other' }, relative: { $ref: 'other#/$defs/a' } } },
        self: { $ref: '#' },
      },
    })
  })
})
