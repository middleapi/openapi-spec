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
  // each `$ref` into `$defs` is replaced by the converted definition. So is
  // each `$ref` into `definitions`, the draft-07 spelling that the 2020-12
  // meta-schema still accepts and generators such as Pydantic v1 emit.
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.4
  it.each(['$defs', 'definitions'])('inlines $refs into %s', (key) => {
    expect(convertSchema({ [key]: { a: { type: ['string', 'null'] } }, items: { $ref: `#/${key}/a` }, type: 'array' })).toEqual({
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
