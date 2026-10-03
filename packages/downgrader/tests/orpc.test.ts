// oRPC generates 3.2 and downgrades it for older versions. This checks both
// steps on a document it generated (see orpc-document.ts).

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc } from './orpc-document'
import { expectValidDowngrade } from './validate'

function downgradeTwice(spec: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(spec))
}

it('converts the oRPC document into a valid 3.1 document', async () => {
  const v31 = await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
  expect(v31.servers).toEqual([{ url: 'https://api.example.com' }])
  expect(v31.tags).toEqual([{ name: 'planets', description: 'Planets' }])
})

it('converts the oRPC document into a valid 3.0 document', async () => {
  const v30 = await expectValidDowngrade(doc, downgradeTwice, '3.2', '3.0')
  const { Category, NotFound, Planet } = v30.components?.schemas ?? {}

  expect(Planet).toMatchObject({
    properties: {
      description: { type: 'string', nullable: true },
      mass: { type: 'number', minimum: 0, exclusiveMinimum: true, example: 5.97e24 },
      position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      aliases: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } },
      attributes: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
      discoveredAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
    },
  })
  expect(Planet).not.toHaveProperty('properties.attributes.propertyNames')
  expect(Category).toMatchObject({ properties: { parent: { anyOf: [{ $ref: '#/components/schemas/Category' }, { enum: [null] }] } } })
  expect(NotFound).toMatchObject({ properties: { defined: { enum: [true] }, code: { enum: ['NOT_FOUND'] } } })

  const upload = v30.paths['/planets/{id}/image']?.put?.requestBody
  expect(upload).toMatchObject({ content: { 'multipart/form-data': { schema: { properties: { image: { type: 'string', format: 'binary' } } } } } })
  expect(v30.paths['/planets/events']?.get?.responses['200']).toMatchObject({
    content: { 'text/event-stream': { schema: { oneOf: [{ properties: { event: { enum: ['message'] } } }, {}, {}] } } },
  })
})

it('matches the 3.0 snapshot', () => {
  expect(downgradeTwice(doc)).toMatchSnapshot()
})
