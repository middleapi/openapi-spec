// In `multipart` and `application/x-www-form-urlencoded` bodies, a part
// without an Encoding Object `contentType` gets a default that depends on
// its schema, and the two versions derive it differently.
//
// 3.1 (https://spec.openapis.org/oas/v3.1.2.html#encoding-content-type):
//   no `type` → application/octet-stream
//   `string` with `contentEncoding` → application/octet-stream
//   `string` without it → text/plain, `object` → application/json,
//   `array` → the default of its `items`
// 3.0 (https://spec.openapis.org/oas/v3.0.4.html#encoding-content-type):
//   `string` with `format: binary` or `byte` → application/octet-stream
//   other strings → text/plain, `object` → application/json,
//   `array` → the default of its `items`, and nothing for a missing `type`
//
// The schema conversion keeps most of these aligned, but not:
// - an untyped part (`{}` has no 3.0 default) or a `contentEncoding` that
//   `format: byte` cannot express (such as base64url, which becomes a plain
//   string and so text/plain). 3.1 sends these as application/octet-stream.
// - a string without `contentEncoding` that has `format: binary` or `byte`,
//   or gains `format: binary` from `contentMediaType`. 3.1 sends these as
//   text/plain, 3.0 as application/octet-stream.
// For those parts the 3.1 default is written into the Encoding Object so
// the wire format stays the same. `contentMediaType` does not change the
// 3.1 default, and a contradicting one is ignored
// (https://spec.openapis.org/oas/v3.1.2.html#working-with-binary-data),
// so it does not become the part's `contentType`.
//
// An Encoding Object that sets `style`, `explode`, or `allowReserved`
// switches the part to RFC6570-style serialization, where `contentType`
// does not apply: https://spec.openapis.org/oas/v3.1.2.html#fixed-fields-for-rfc6570-style-serialization
// Such entries, and ones that already set `contentType`, are left alone.

import { dig } from '../../helpers'
import { convertComponent, convertSpec } from './helpers'

const octetStream = { contentType: 'application/octet-stream' }

const textPlain = { contentType: 'text/plain' }

const schemas = {
  Form: { allOf: [{ properties: { a: {} } }], properties: { b: {} } },
  Pet: { type: 'object' },
  Png: { contentMediaType: 'image/png', type: 'string' },
  Raw: {},
}

function convertForm(mediaType: unknown, type = 'multipart/form-data'): unknown {
  return dig(convertComponent('requestBodies', { content: { [type]: mediaType } }, { schemas }), 'content', type)
}

describe('parts that need the 3.1 default written out', () => {
  it.each([
    ['a schema without type', {}],
    ['a true schema', true],
    ['raw binary', { contentMediaType: 'image/png' }],
    ['a base64 string', { contentEncoding: 'base64', type: 'string' }],
    ['a string with a contentEncoding that no 3.0 format expresses', { contentEncoding: 'base64url', type: 'string' }],
    ['a nullable string with a contentEncoding', { contentEncoding: 'base64url', type: ['string', 'null'] }],
    ['an array of untyped items', { items: {}, type: 'array' }],
    ['an array of raw binary', { items: { contentMediaType: 'image/png' }, type: 'array' }],
    ['an array without items', { type: 'array' }],
    ['untyped anyOf branches', { anyOf: [{ contentMediaType: 'image/png' }, { contentMediaType: 'image/jpeg' }] }],
    ['a reference to an untyped schema', { $ref: '#/components/schemas/Raw' }],
    ['an untyped schema reached twice', { anyOf: [{ $ref: '#/components/schemas/Raw' }, { $ref: '#/components/schemas/Raw' }] }],
  ])('sets contentType: application/octet-stream on %s', (_name, part) => {
    expect(convertForm({ schema: { properties: { part } } })).toEqual({
      encoding: { part: octetStream },
      schema: { properties: { part: expect.anything() } },
    })
  })

  it('writes the same Encoding Object whether the body schema is inline or a reference', () => {
    const result = convertSpec({
      components: {
        requestBodies: {
          Inline: { content: { 'multipart/form-data': { schema: { properties: { img: { contentMediaType: 'image/png' } } } } } },
          Referenced: { content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/Upload' } } } },
        },
        schemas: { Upload: { properties: { img: { contentMediaType: 'image/png' } } } },
      },
    })
    for (const name of ['Inline', 'Referenced']) {
      expect(dig(result, 'components', 'requestBodies', name, 'content', 'multipart/form-data', 'encoding')).toEqual({ img: octetStream })
    }
  })

  // The parts of a form are the properties of its schema, including ones
  // reached through `allOf`, `anyOf`, `oneOf`, and local `$ref`s.
  it('finds parts through references and allOf in the body schema', () => {
    expect(convertForm({ schema: { $ref: '#/components/schemas/Form' } })).toEqual({
      encoding: { a: octetStream, b: octetStream },
      schema: { $ref: '#/components/schemas/Form' },
    })
  })

  it('finds a part through a $ref inside a body schema with an $id', () => {
    const schema = {
      $defs: { File: { contentEncoding: 'base64url', type: 'string' } },
      $id: 'https://example.com/upload',
      properties: { file: { $ref: '#/$defs/File' } },
    }
    expect(dig(convertForm({ schema }), 'encoding')).toEqual({ file: octetStream })
  })

  // A part declared in several subschemas takes all its declarations: here
  // the string type from one and the contentEncoding from the other.
  it('combines a part declared in several subschemas', () => {
    expect(convertForm({
      schema: { allOf: [{ properties: { part: { contentEncoding: 'base64url' } } }], properties: { part: { type: 'string' } } },
    })).toEqual({
      encoding: { part: octetStream },
      schema: { allOf: [{ properties: { part: {} } }], properties: { part: { type: 'string' } } },
    })
  })

  it('writes a part named like an Object.prototype member as an own key', () => {
    const encoding = dig(convertForm({ schema: { properties: JSON.parse('{"__proto__":{}}') } }), 'encoding') as object
    expect(Object.getPrototypeOf(encoding)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(encoding, '__proto__')?.value).toEqual(octetStream)
  })

  it.each([
    ['a string with contentMediaType', { contentMediaType: 'image/png', type: 'string' }],
    ['a binary string', { format: 'binary', type: 'string' }],
    ['a byte string', { format: 'byte', type: 'string' }],
    ['a nullable string with contentMediaType', { contentMediaType: 'text/csv', type: ['string', 'null'] }],
    ['an array of strings with contentMediaType', { items: { contentMediaType: 'image/png', type: 'string' }, type: 'array' }],
    ['a string with a binary format found through allOf', { allOf: [{ format: 'binary' }], type: 'string' }],
    ['string anyOf branches, one of them binary', { anyOf: [{ format: 'byte', type: 'string' }, { type: 'string' }] }],
    ['a reference to a string with contentMediaType', { $ref: '#/components/schemas/Png' }],
  ])('sets contentType: text/plain on %s', (_name, part) => {
    expect(convertForm({ schema: { properties: { part } } })).toEqual({
      encoding: { part: textPlain },
      schema: { properties: { part: expect.anything() } },
    })
  })
})

describe('parts whose 3.0 default already matches', () => {
  it.each([
    ['a string', { format: 'uuid', type: 'string' }],
    ['a string whose format wins over contentMediaType', { contentMediaType: 'text/csv', format: 'uuid', type: 'string' }],
    ['a binary format on a non-string type', { format: 'binary', type: 'integer' }],
    ['an object', { type: 'object' }],
    ['a type found through allOf', { allOf: [{ $ref: '#/components/schemas/Pet' }] }],
    ['a null type', { type: 'null' }],
    ['several types', { type: ['string', 'integer'] }],
    ['branches of different types', { anyOf: [{ type: 'string' }, { type: 'integer' }] }],
    ['typed prefixItems', { prefixItems: [{ type: 'string' }], type: 'array' }],
    ['nested arrays, which have no multipart form', { items: { items: {}, type: 'array' }, type: 'array' }],
    ['an external reference', { $ref: 'other.yaml#/File' }],
    ['a missing reference', { $ref: '#/components/schemas/Missing' }],
    ['a false schema', false],
  ])('adds no Encoding Object for %s', (_name, part) => {
    expect(convertForm({ schema: { properties: { part } } })).not.toHaveProperty('encoding')
  })

  it('adds no Encoding Object for an array whose items loop back to it', () => {
    const part: Record<string, unknown> = { type: 'array' }
    part.items = part
    expect(convertForm({ schema: { properties: { part } } })).not.toHaveProperty('encoding')
  })
})

describe('existing Encoding Objects', () => {
  it('keeps entries that set contentType or RFC6570-style fields, and adds contentType beside headers', () => {
    const headers = { 'X-Id': { schema: { type: 'string' } } }
    const schema = { properties: { exploded: {}, explicit: {}, headed: {}, junk: {}, reserved: {}, styled: {} } }
    expect(convertForm({
      encoding: {
        exploded: { explode: true },
        explicit: { contentType: 'image/png' },
        headed: { headers },
        junk: 'junk',
        reserved: { allowReserved: true },
        styled: { style: 'form' },
      },
      schema,
    })).toEqual({
      encoding: {
        exploded: { explode: true },
        explicit: { contentType: 'image/png' },
        headed: { ...octetStream, headers },
        junk: 'junk',
        reserved: { allowReserved: true },
        styled: { style: 'form' },
      },
      schema,
    })
  })

  it('treats a text/plain default like an application/octet-stream one', () => {
    const headers = { 'X-Id': { schema: { type: 'string' } } }
    const binary = { format: 'binary', type: 'string' }
    const schema = { properties: { explicit: binary, headed: binary, styled: binary } }
    expect(convertForm({
      encoding: { explicit: { contentType: 'image/png' }, headed: { headers }, styled: { style: 'form' } },
      schema,
    })).toEqual({
      encoding: { explicit: { contentType: 'image/png' }, headed: { ...textPlain, headers }, styled: { style: 'form' } },
      schema,
    })
  })

  it('leaves an Encoding Object shared with another part unchanged', () => {
    const entry = { headers: { 'X-Id': { schema: { type: 'string' } } } }
    const result = dig(convertComponent('requestBodies', {
      content: {
        'multipart/form-data': { encoding: { part: entry }, schema: { properties: { part: {} } } },
        'multipart/mixed': { encoding: { part: entry }, schema: { properties: { part: { type: 'string' } } } },
      },
    }), 'content')
    expect(dig(result, 'multipart/form-data', 'encoding', 'part')).toEqual({ ...entry, ...octetStream })
    expect(dig(result, 'multipart/mixed', 'encoding', 'part')).toEqual(entry)
  })

  it('leaves a malformed encoding value alone', () => {
    expect(convertForm({ encoding: 'junk', schema: { properties: { file: {} } } })).toEqual({
      encoding: 'junk',
      schema: { properties: { file: {} } },
    })
  })
})

describe('where it applies', () => {
  // Encoding Objects only apply to request bodies of these media types
  // (https://spec.openapis.org/oas/v3.1.2.html#media-type-encoding); media
  // type names are case-insensitive and may carry parameters.
  it('applies to multipart and URL-encoded request bodies only', () => {
    const mediaType = { schema: { properties: { file: {} } } }
    for (const type of ['multipart/mixed', 'Application/X-WWW-Form-Urlencoded; charset=utf-8']) {
      expect(convertForm(mediaType, type)).toEqual({ ...mediaType, encoding: { file: octetStream } })
    }
    for (const type of ['application/json', 'application/x-www-form-urlencoded-v2']) {
      expect(convertForm(mediaType, type)).toEqual(mediaType)
    }
    const content = { 'multipart/form-data': mediaType }
    expect(convertComponent('responses', { content, description: 'd' })).toEqual({ content, description: 'd' })
    expect(convertComponent('parameters', { content, in: 'query', name: 'q' })).toEqual({ content, in: 'query', name: 'q' })
  })

  it('converts a media type shared between a form body and a response as each', () => {
    const mediaType = { schema: { properties: { file: {} } } }
    const result = convertSpec({
      components: {
        requestBodies: { B: { content: { 'multipart/form-data': mediaType } } },
        responses: { R: { content: { 'multipart/form-data': mediaType }, description: 'd' } },
      },
    })
    expect(dig(result, 'components', 'requestBodies', 'B', 'content', 'multipart/form-data')).toEqual({ ...mediaType, encoding: { file: octetStream } })
    expect(dig(result, 'components', 'responses', 'R', 'content', 'multipart/form-data')).toEqual(mediaType)
  })
})
