import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'
import { convertSchema } from './helpers'

// Converting a standalone schema removes nothing a `$ref` could point at:
// `$defs`, `$id`, and `$anchor` all exist in 3.1. So every reference stays as
// written, wherever it points.
it('leaves every $ref as written', () => {
  const schema: OpenAPIV3_2.SchemaObject = {
    $defs: { node: { properties: { next: { $ref: '#/$defs/node' } }, type: 'object' } },
    $ref: '#/$defs/node',
    properties: {
      anchor: { $ref: '#node' },
      external: { $ref: 'https://example.com/pet.json' },
      missing: { $ref: '#/$defs/missing' },
      sibling: { $ref: '#/$defs/node', description: 'with a sibling' },
    },
  }
  expect(downgradeSchemaV32ToV31(schema)).toEqual(schema)
})

// References into the parts the conversion changes: the `xml` object
// survives, so a `$ref` to it stays valid. A discriminator with a
// `defaultMapping` is removed, but that value is a string rather than a
// schema, so there is nothing to inline and the reference is left as
// written, like any other dangling one.
it('leaves references into converted keywords as written', () => {
  const schema = {
    discriminator: { defaultMapping: 'Dog', propertyName: 'kind' },
    properties: { a: { $ref: '#/xml' }, b: { $ref: '#/discriminator/defaultMapping' } },
    xml: { nodeType: 'attribute' },
  }
  const { discriminator: _, ...rest } = schema
  expect(convertSchema(schema)).toEqual({
    ...rest,
    xml: { attribute: true },
  })
})
