// oRPC generates 3.2 and downgrades it for older versions. This checks both
// steps on a document it generated (see orpc-document.ts).

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { doc } from './orpc-document'
import { expectValidDowngrade } from './validate'

function downgradeTwice(spec: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(spec))
}

// Rebuilds every object in `value` from its entries with `object`.
function rebuild(value: unknown, object: (entries: [string, unknown][]) => object): any {
  if (Array.isArray(value)) {
    return value.map((item) => rebuild(item, object))
  }
  return typeof value === 'object' && value !== null
    ? object(Object.entries(value).map(([key, item]) => [key, rebuild(item, object)]))
    : value
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
      parent: {
        anyOf: [
          { $ref: '#/components/schemas/Category' },
          { type: 'string', nullable: true, enum: [null] },
        ],
      },
    },
  })
  expect(NotFound).toMatchObject({
    properties: {
      defined: { type: 'boolean', enum: [true] },
      code: { type: 'string', enum: ['NOT_FOUND'] },
    },
  })

  const upload = v30.paths['/planets/{id}/image']?.put?.requestBody
  expect(upload).toMatchObject({
    content: {
      'multipart/form-data': {
        schema: {
          properties: {
            image: { type: 'string', format: 'binary' },
            thumbnail: { type: 'string', format: 'binary' },
          },
        },
      },
    },
  })
  expect(upload).not.toHaveProperty('content.multipart/form-data.schema.properties.thumbnail.anyOf')
  expect(v30.paths['/planets/events']?.get?.responses['200']).toMatchObject({
    content: {
      'text/event-stream': {
        schema: {
          oneOf: [{ properties: { event: { type: 'string', enum: ['message'] } } }, {}, {}],
        },
      },
    },
  })
})

it('matches the 3.0 snapshot', () => {
  expect(downgradeTwice(doc)).toMatchSnapshot()
})

const nullPrototype = (entries: [string, unknown][]) =>
  Object.assign(Object.create(null), Object.fromEntries(entries))
const withUndefined = (entries: [string, unknown][]) => ({
  ...Object.fromEntries(entries),
  missing: undefined,
})

it.each([
  ['built from null-prototype objects', nullPrototype],
  ['with a key holding undefined in every object', withUndefined],
])('converts the oRPC document %s to 3.1 as it converts the plain one', (_name, object) => {
  expect(downgradeSpecV32ToV31(rebuild(doc, object))).toStrictEqual(downgradeSpecV32ToV31(doc))
})

it('converts the 3.1 oRPC document built from null-prototype objects to 3.0 as it converts the plain one', () => {
  const v31 = downgradeSpecV32ToV31(doc)
  expect(downgradeSpecV31ToV30(rebuild(v31, nullPrototype))).toStrictEqual(
    downgradeSpecV31ToV30(v31),
  )
})
