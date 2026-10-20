// oRPC generates 3.2 and downgrades it for older versions. This checks both
// steps on a document it generated (see orpc-document.ts). The document keeps
// the oRPC bugs it was generated with, so the downgrades are checked without
// validating it, and the first test validates it once the bug the 3.2 schema
// rejects is removed.

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { doc } from './orpc-document'
import { expectValidAs, expectValidOutput } from './validate'

function downgradeTwice(spec: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(spec))
}

it('is a valid 3.2 document apart from allowReserved beside content', async () => {
  const fixed = structuredClone(doc)
  const sort = fixed.paths?.['/planets/search']?.get?.parameters?.[1] as OpenAPIV3_2.ParameterObject
  expect(sort).toMatchObject({ name: 'sort', allowReserved: true, content: {} })
  delete sort.allowReserved
  await expectValidAs(fixed, '3.2')
})

it('converts the oRPC document into a valid 3.1 document', async () => {
  const v31 = await expectValidOutput(doc, downgradeSpecV32ToV31, '3.1')
  expect(v31.servers).toEqual([{ url: 'https://api.example.com' }])
  expect(v31.tags).toEqual([{ name: 'planets', description: 'Planets' }])

  const sort = v31.paths?.['/planets/search']?.get?.parameters?.[1]
  expect(sort).toMatchObject({ name: 'sort', content: { 'application/json': {} } })
  expect(sort).not.toHaveProperty('allowReserved')
})

it('converts the oRPC document into a valid 3.0 document', async () => {
  const v30 = await expectValidOutput(doc, downgradeTwice, '3.0')
  const { Category, NotFound, Planet } = v30.components?.schemas ?? {}

  expect(Planet).toMatchObject({
    properties: {
      description: { type: 'string', nullable: true },
      mass: { type: 'number', minimum: 0, exclusiveMinimum: true, example: 5.97e24 },
      position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      aliases: {
        type: 'array',
        items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
      },
      attributes: {
        type: 'object',
        additionalProperties: {
          anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        },
      },
      discoveredAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
    },
  })
  expect(Planet).not.toHaveProperty('properties.attributes.propertyNames')
  expect(Category).toMatchObject({
    properties: {
      parent: { anyOf: [{ $ref: '#/components/schemas/Category' }, { enum: [null] }] },
    },
  })
  expect(NotFound).toMatchObject({
    properties: { defined: { enum: [true] }, code: { enum: ['NOT_FOUND'] } },
  })

  const upload = v30.paths['/planets/{id}/image']?.put?.requestBody
  expect(upload).toMatchObject({
    content: {
      'multipart/form-data': {
        schema: { properties: { image: { type: 'string', format: 'binary' } } },
      },
    },
  })
  const gallery = v30.paths['/planets/{id}/gallery']?.post?.requestBody
  expect(gallery).toMatchObject({
    content: {
      'multipart/form-data': {
        schema: {
          properties: { images: { type: 'array', items: { type: 'string', format: 'binary' } } },
        },
      },
    },
  })
  expect(v30.paths['/planets/{id}/data']?.put?.requestBody).toMatchObject({
    content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
  })
  expect(v30.paths['/planets/events']?.get?.responses['200']).toMatchObject({
    content: {
      'text/event-stream': {
        schema: { oneOf: [{ properties: { event: { enum: ['message'] } } }, {}, {}] },
      },
    },
  })

  const removed = v30.paths['/planets/{id}']?.delete?.responses['204']
  expect(removed).toMatchObject({
    description: 'Deleted',
    headers: { 'x-request-id': { required: true, schema: { type: 'string' } } },
  })
  expect(removed).not.toHaveProperty('content')

  // oRPC writes the empty tuple with `prefixItems: []`.
  expect(v30.paths['/planets/import']?.post?.responses['200']).toHaveProperty(
    ['content', 'application/json', 'schema', 'properties', 'skipped'],
    { type: 'array', items: {}, maxItems: 0 },
  )
})

it('matches the 3.0 snapshot', () => {
  expect(downgradeTwice(doc)).toMatchSnapshot()
})
