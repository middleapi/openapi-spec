// A schema with its own `$id` is a resource, and a fragment `$ref` inside it
// resolves against that resource, not the OpenAPI document:
// https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.1
// 3.0 has no `$id`, so where a 3.0 tool would read such a `$ref` from the
// document root, it is rewritten as a pointer from the root to the same
// target, then inlined or kept like any other reference.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'
import { expectValidAs, expectValidDowngrade } from '../../validate'
import { convertSpec, info } from './helpers'

const json = (schema: OpenAPIV3_1.SchemaObject) => ({ content: { 'application/json': { schema } } })

it('rewrites references inside a resource as pointers from the document root', async () => {
  const tree = (name: string): OpenAPIV3_1.SchemaObject => ({ $id: `https://example.com/${name}`, properties: { child: { $ref: '#' } }, type: 'object' })
  const doc: OpenAPIV3_1.OpenAPIObject = {
    components: { schemas: { Tree: tree('tree') } },
    info,
    openapi: '3.1.1',
    paths: {
      '/trees/{id}': {
        get: {
          responses: {
            200: { ...json({ $id: 'https://example.com/node', properties: { next: { $ref: '#' } } }), description: 'ok' },
            201: { ...json({ $ref: '#/webhooks/tree/post/requestBody/content/application~1json/schema' }), description: 'ok' },
          },
        },
      },
    },
    webhooks: { tree: { post: { requestBody: json(tree('hook')) } } },
  }
  const result = await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
  expect(dig(result, 'components', 'schemas', 'Tree')).toEqual({ properties: { child: { $ref: '#/components/schemas/Tree' } }, type: 'object' })
  const responses = dig(result, 'paths', '/trees/{id}', 'get', 'responses')
  expect(dig(responses, '200', 'content', 'application/json', 'schema')).toEqual({
    properties: { next: { $ref: '#/paths/~1trees~1%7Bid%7D/get/responses/200/content/application~1json/schema' } },
  })
  // The webhook is removed, so its copy of the resource is inlined and its
  // recursion cut into `{}`, as for any other inlined schema.
  expect(dig(responses, '201', 'content', 'application/json', 'schema')).toEqual({ properties: { child: {} }, type: 'object' })
})

// The official 3.1 schema validator resolves `$ref`s from the document root
// too, so it rejects this input, and only the output is checked.
it('resolves other pointers within the resource, not the document', async () => {
  const result = convertSpec({
    components: {
      schemas: {
        Pet: { $defs: { name: { type: 'string' } }, $id: 'https://example.com/pet', properties: { name: { $ref: '#/$defs/name' } } },
      },
    },
  })
  await expectValidAs(result, '3.0')
  expect(dig(result, 'components', 'schemas', 'Pet')).toEqual({ properties: { name: { type: 'string' } } })
})
