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

describe('references inside a schema with an $id', () => {
  // An `$id` starts a new schema resource, and a `$ref` inside it resolves
  // against that resource rather than the document root:
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.1
  // 3.0 has no `$id`, so the output resolves every `$ref` against the root.
  // A JSON pointer inside such a schema is rebased onto the root, and its
  // target inlined where the rebased pointer dangles.
  it('inlines the definition of the enclosing resource, not the root definition of the same name', () => {
    expect(convertSchema({
      $defs: { A: { type: 'string' } },
      properties: {
        x: { $defs: { A: { type: 'number' } }, $id: 'https://example.com/x', properties: { y: { $ref: '#/$defs/A' } } },
      },
    })).toEqual({ properties: { x: { properties: { y: { type: 'number' } } } } })
  })

  it('reads # as the enclosing resource and cuts its recursion into {}', () => {
    expect(convertSchema({
      $defs: {
        Tree: { $id: 'https://example.com/tree', properties: { kids: { items: { $ref: '#' }, type: 'array' } }, type: 'object' },
      },
      properties: { t: { $ref: '#/$defs/Tree' } },
      required: ['must'],
    })).toEqual({
      properties: { t: { properties: { kids: { items: {}, type: 'array' } }, type: 'object' } },
      required: ['must'],
    })
  })

  it.each([
    ['x', '#/properties/x/properties/a'],
    ['a b/c~%', '#/properties/a%20b~1c~0%25/properties/a'],
  ])('rebases a pointer whose target survives onto the root, under the key %j', (key, pointer) => {
    expect(convertSchema({
      properties: { [key]: { $id: 'https://example.com/x', properties: { a: { type: 'string' }, b: { $ref: '#/properties/a' } } } },
    })).toEqual({
      properties: { [key]: { properties: { a: { type: 'string' }, b: { $ref: pointer } } } },
    })
  })

  it('resolves a $ref beside an $id against that $id', () => {
    expect(convertSchema({
      $defs: { A: { type: 'string' } },
      properties: { x: { $defs: { A: { type: 'number' } }, $id: 'https://example.com/x', $ref: '#/$defs/A', minimum: 1 } },
    })).toEqual({ properties: { x: { allOf: [{ type: 'number' }], minimum: 1 } } })
  })

  it('resolves the references inside an inlined target and along an alias chain against the resource holding them', () => {
    expect(convertSchema({
      $defs: {
        A: { type: 'string' },
        X: {
          $defs: { A: { type: 'number' }, B: { $ref: '#/$defs/A' } },
          $id: 'https://example.com/x',
          properties: { p: { $ref: '#/$defs/A' } },
        },
      },
      properties: { alias: { $ref: '#/$defs/X/$defs/B' }, nested: { $ref: '#/$defs/X/properties/p' } },
    })).toEqual({ properties: { alias: { type: 'number' }, nested: { type: 'number' } } })
  })

  // A pointer that dangles inside its resource dangles in the source too.
  // Rebased, it keeps dangling rather than reaching the root target of the
  // same name.
  it('rebases a pointer that dangles inside its resource instead of binding it to the root', () => {
    expect(convertSchema({
      $defs: { A: { type: 'string' } },
      properties: { x: { $id: 'https://example.com/x', properties: { y: { $ref: '#/$defs/A' } } } },
    })).toEqual({ properties: { x: { properties: { y: { $ref: '#/properties/x/$defs/A' } } } } })
  })

  // A `mapping` value that is a URI reference resolves against the nearest
  // `$id` too: https://spec.openapis.org/oas/v3.1.2.html#relative-references-in-api-description-uris
  // It cannot be inlined, so one whose target is removed is dropped.
  it('rebases discriminator mapping pointers onto the root, dropping those whose target is removed', () => {
    expect(convertSchema({
      properties: {
        x: {
          $defs: { Dog: { type: 'object' } },
          $id: 'https://example.com/x',
          discriminator: { mapping: { cat: '#/properties/cat', dog: '#/$defs/Dog', fish: 'Fish' }, propertyName: 'kind' },
          properties: { cat: { type: 'object' } },
        },
      },
    })).toEqual({
      properties: {
        x: {
          discriminator: { mapping: { cat: '#/properties/x/properties/cat', fish: 'Fish' }, propertyName: 'kind' },
          properties: { cat: { type: 'object' } },
        },
      },
    })
  })

  // Only JSON pointers can be rebased. `$anchor` and `$id` are removed, so
  // references through them are left as written and dangle.
  it('leaves references to an $anchor or a URI as written', () => {
    expect(convertSchema({
      properties: {
        x: { $id: 'https://example.com/x', properties: { a: { $ref: '#node' }, b: { $ref: 'node.json' }, c: { $ref: 'https://example.com/x' } } },
      },
    })).toEqual({
      properties: { x: { properties: { a: { $ref: '#node' }, b: { $ref: 'node.json' }, c: { $ref: 'https://example.com/x' } } } },
    })
  })

  // `$id: "#name"` is a draft-07 plain-name fragment, and an empty `$id`
  // repeats the current base. Neither starts a new resource.
  it('resolves against the root through an $id that starts no new resource', () => {
    expect(convertSchema({
      $defs: { A: { type: 'string' } },
      properties: { x: { $id: '#x', properties: { y: { $ref: '#/$defs/A' } } }, z: { $id: '', $ref: '#/$defs/A' } },
    })).toEqual({ properties: { x: { properties: { y: { type: 'string' } } }, z: { allOf: [{ type: 'string' }] } } })
  })
})

describe('references to a boolean additionalProperties', () => {
  // `additionalProperties` is the one place 3.0 still takes a boolean, so it
  // stays one (see subschemas.test.ts). But a 3.0 `$ref` never resolves to a
  // boolean: a Schema Object is always an object.
  // https://spec.openapis.org/oas/v3.0.4.html#schema-object
  // Such a `$ref` is replaced by the converted boolean schema instead. A
  // boolean schema converted in place becomes a Schema Object, so a `$ref`
  // to it stays as written.
  it.each([
    [
      'inlines a $ref to a false additionalProperties',
      { additionalProperties: false, properties: { a: { $ref: '#/additionalProperties' } } },
      { additionalProperties: false, properties: { a: { not: {} } } },
    ],
    [
      'inlines a $ref to a true additionalProperties under not',
      { additionalProperties: true, properties: { a: { not: { $ref: '#/additionalProperties' } } } },
      { additionalProperties: true, properties: { a: { not: {} } } },
    ],
    [
      'inlines a $ref with siblings into allOf',
      { $ref: '#/additionalProperties', additionalProperties: false },
      { additionalProperties: false, allOf: [{ not: {} }] },
    ],
    [
      'keeps a $ref to the location that now holds the inlined schema',
      {
        properties: {
          a: { $ref: '#/properties/m/additionalProperties' },
          b: { $ref: '#/properties/a' },
          m: { additionalProperties: false, type: 'object' },
        },
      },
      {
        properties: {
          a: { not: {} },
          b: { $ref: '#/properties/a' },
          m: { additionalProperties: false, type: 'object' },
        },
      },
    ],
    [
      'keeps a $ref to a boolean schema converted in place',
      { items: false, properties: { a: { $ref: '#/items' } } },
      { items: { not: {} }, properties: { a: { $ref: '#/items' } } },
    ],
  ])('%s', (_name, input, expected) => {
    expect(convertSchema(input)).toEqual(expected)
  })
})
