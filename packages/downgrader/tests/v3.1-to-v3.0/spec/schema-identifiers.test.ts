// `$id` starts a new schema resource, and a `$ref` inside it resolves
// against that resource rather than the document:
// https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.1
// 3.0 has no `$id`, so the output resolves every `$ref` against the
// document. A JSON pointer inside such a schema is rebased onto the
// document, and its target inlined where the rebased pointer dangles.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'
import { expectValidDowngrade } from '../../validate'
import { convertSpec, info, webhookSchemaPointer } from './helpers'

it('rebases a recursive $ref onto the component that holds the $id', async () => {
  const doc: OpenAPIV3_1.OpenAPIObject = {
    components: {
      schemas: {
        Tree: { $id: 'https://example.com/tree', properties: { kids: { items: { $ref: '#' }, type: 'array' } }, type: 'object' },
      },
    },
    info,
    openapi: '3.1.0',
    paths: {},
  }
  const v30 = await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
  expect(dig(v30, 'components', 'schemas', 'Tree')).toEqual({
    properties: { kids: { items: { $ref: '#/components/schemas/Tree' }, type: 'array' } },
    type: 'object',
  })
})

it('inlines a $ref inside a removed schema from that schema, not from the document', () => {
  const result = convertSpec({
    components: { schemas: { Pet: { $ref: webhookSchemaPointer } } },
    webhooks: {
      newPet: {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  $defs: { Name: { type: 'string' } },
                  $id: 'https://example.com/pet',
                  properties: { name: { $ref: '#/$defs/Name' } },
                  type: 'object',
                },
              },
            },
          },
          responses: {},
        },
      },
    },
  })
  expect(dig(result, 'components', 'schemas', 'Pet')).toEqual({ properties: { name: { type: 'string' } }, type: 'object' })
})
