import { dig } from '../../helpers'
import { convertContent } from './helpers'

describe('itemSchema', () => {
  // 3.2 adds `itemSchema` to describe each item of a sequential media type
  // such as `application/jsonl` or `text/event-stream`:
  // https://spec.openapis.org/oas/v3.2.0.html#media-type-item-schema
  // https://spec.openapis.org/oas/v3.2.0.html#sequential-media-types
  // 3.1 can only describe the complete content, and the closest description
  // of a sequence of items is an array of them.
  it('turns itemSchema into a deep-cloned array schema when no schema exists', () => {
    const itemSchema = { type: 'object', xml: { nodeType: 'text' } }
    const result = convertContent({ 'application/jsonl': { itemSchema } })
    expect(result).toEqual({
      'application/jsonl': { schema: { items: { type: 'object', xml: {} }, type: 'array' } },
    })
    const promoted = dig(result, 'application/jsonl', 'schema', 'items')
    expect(promoted).not.toBe(itemSchema)
    expect(dig(promoted, 'xml')).not.toBe(itemSchema.xml)
  })

  it('removes itemSchema when a schema already describes the complete content', () => {
    expect(convertContent({ 'application/json': { itemSchema: { type: 'string' }, schema: { type: 'array' } } })).toEqual({
      'application/json': { schema: { type: 'array' } },
    })
  })
})

describe('media type fields 3.1 lacks', () => {
  // `prefixEncoding` and `itemEncoding` encode multipart parts by position:
  // https://spec.openapis.org/oas/v3.2.0.html#encoding-by-position
  // 3.1 only encodes parts by property name, through `encoding`.
  //
  // `description` is missing from the 3.2.0 Fixed Fields table but is defined
  // by the official 3.2 JSON Schema (`$defs/media-type`): https://github.com/OAI/OpenAPI-Specification/pull/4728
  it.each([
    ['removes prefixEncoding and itemEncoding', { example: 1, itemEncoding: { contentType: 'text/plain' }, prefixEncoding: [{ contentType: 'application/json' }] }, { example: 1 }],
    ['removes description and keeps the other fields', { description: 'a JSON payload', example: 5, schema: { type: 'integer' } }, { example: 5, schema: { type: 'integer' } }],
  ])('%s', (_name, mediaType, expected) => {
    expect(convertContent({ 'application/json': mediaType })).toEqual({ 'application/json': expected })
  })

  it('converts the example map', () => {
    expect(convertContent({
      'application/json': { examples: { inline: { serializedValue: 'raw' }, referenced: { $ref: '#/components/examples/E' } } },
    })).toEqual({
      'application/json': { examples: { inline: { value: 'raw' }, referenced: { $ref: '#/components/examples/E' } } },
    })
  })
})

describe('encoding objects', () => {
  // 3.2 Encoding Objects can nest `encoding`, `prefixEncoding`, and
  // `itemEncoding` for multipart parts that are themselves multipart:
  // https://spec.openapis.org/oas/v3.2.0.html#nested-encoding
  it('removes nested and positional encodings while still converting headers', () => {
    expect(convertContent({
      'multipart/form-data': {
        encoding: {
          part: {
            contentType: 'application/json',
            encoding: { inner: { headers: { 'X-C': { style: 'cookie' } } } },
            headers: {
              'Referenced': { $ref: '#/components/headers/H' },
              'X-H': { description: 'h', style: 'cookie' },
            },
            itemEncoding: { contentType: 'text/plain' },
            prefixEncoding: [{ contentType: 'text/csv' }],
          },
        },
      },
    })).toEqual({
      'multipart/form-data': {
        encoding: {
          part: {
            contentType: 'application/json',
            headers: {
              'Referenced': { $ref: '#/components/headers/H' },
              'X-H': { description: 'h' },
            },
          },
        },
      },
    })
  })
})
