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
// The schema conversion keeps most of these aligned, but not an untyped
// part (`{}` has no 3.0 default) or a `contentEncoding` that `format: byte`
// cannot express (such as base64url, which becomes a plain string and so
// text/plain). For those parts the 3.1 default, application/octet-stream,
// is written into the Encoding Object so the wire format stays the same.
//
// An Encoding Object that sets `style`, `explode`, or `allowReserved`
// switches the part to RFC6570-style serialization, where `contentType`
// does not apply: https://spec.openapis.org/oas/v3.1.2.html#fixed-fields-for-rfc6570-style-serialization
// 3.1 does this in `application/x-www-form-urlencoded` and
// `multipart/form-data` bodies, but 3.0 only in URL-encoded ones
// (https://spec.openapis.org/oas/v3.0.4.html#encoding-style). URL-encoded
// entries that set these fields, and entries that already set
// `contentType`, are left alone. In multipart bodies 3.0 ignores the three
// fields, so they are removed and the part gets the default it would get
// without them. RFC6570-style serialization of multipart parts is lost.

import { dig } from '../../helpers'
import { convertComponent, convertSpec } from './helpers'

const octetStream = { contentType: 'application/octet-stream' }

const schemas = { Form: { allOf: [{ properties: { a: {} } }], properties: { b: {} } }, Pet: { type: 'object' }, Raw: {} }

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

  // A property holding `undefined` is missing, as in JSON, so only the other
  // branch describes the part.
  it('skips a part that one allOf branch holds as undefined', () => {
    const schema = { allOf: [{ properties: { file: undefined } }, { properties: { file: { contentEncoding: 'base64', type: 'string' } } }] }
    expect(dig(convertForm({ schema }), 'encoding')).toStrictEqual({ file: octetStream })
  })

  it('writes a part named like an Object.prototype member as an own key', () => {
    const encoding = dig(convertForm({ schema: { properties: JSON.parse('{"__proto__":{}}') } }), 'encoding') as object
    expect(Object.getPrototypeOf(encoding)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(encoding, '__proto__')?.value).toEqual(octetStream)
  })
})

describe('parts whose 3.0 default already matches', () => {
  it.each([
    ['a string', { format: 'uuid', type: 'string' }],
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
  it('keeps entries that set contentType, and adds contentType beside headers', () => {
    const headers = { 'X-Id': { schema: { type: 'string' } } }
    const schema = { properties: { explicit: {}, headed: {}, junk: {} } }
    expect(convertForm({
      encoding: {
        explicit: { contentType: 'image/png' },
        headed: { headers },
        junk: 'junk',
      },
      schema,
    })).toEqual({
      encoding: {
        explicit: { contentType: 'image/png' },
        headed: { ...octetStream, headers },
        junk: 'junk',
      },
      schema,
    })
  })

  it('keeps URL-encoded entries that set RFC6570-style fields', () => {
    const encoding = { exploded: { explode: true }, reserved: { allowReserved: true }, styled: { style: 'form' } }
    const schema = { properties: { exploded: {}, reserved: {}, styled: {} } }
    expect(convertForm({ encoding, schema }, 'application/x-www-form-urlencoded')).toEqual({ encoding, schema })
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

  it('writes contentType on an entry whose contentType holds undefined', () => {
    const mediaType = { encoding: { part: { contentType: undefined } }, schema: { properties: { part: {} } } }
    expect(dig(convertForm(mediaType), 'encoding')).toStrictEqual({ part: octetStream })
  })

  it('leaves a malformed encoding value alone', () => {
    expect(convertForm({ encoding: 'junk', schema: { properties: { file: {} } } })).toEqual({
      encoding: 'junk',
      schema: { properties: { file: {} } },
    })
  })
})

describe('style, explode, and allowReserved in multipart bodies', () => {
  const untyped = { properties: { part: {} } }

  it.each([
    ['allowReserved', true],
    ['explode', true],
    ['style', 'form'],
  ])('removes %s and writes the default the part gets without it', (key, value) => {
    expect(convertForm({ encoding: { part: { [key]: value } }, schema: untyped })).toEqual({
      encoding: { part: octetStream },
      schema: untyped,
    })
  })

  // 3.1 sends each property of an exploded object as its own part, which
  // 3.0 cannot describe. 3.0 sends the object as one application/json part.
  it('removes them from a typed part, which keeps its 3.0 default', () => {
    const schema = { properties: { part: { properties: { a: { type: 'string' } }, type: 'object' } } }
    expect(convertForm({ encoding: { part: { explode: true, style: 'form' } }, schema })).toEqual({
      encoding: { part: {} },
      schema,
    })
  })

  it('keeps contentType, headers, and extensions beside them', () => {
    const headers = { 'X-Id': { schema: { type: 'string' } } }
    expect(convertForm({
      encoding: { part: { 'allowReserved': true, 'contentType': 'image/png', headers, 'x-note': 'n' } },
      schema: untyped,
    })).toEqual({
      encoding: { part: { 'contentType': 'image/png', headers, 'x-note': 'n' } },
      schema: untyped,
    })
  })

  it('removes them from entries that name no part', () => {
    expect(convertForm({ encoding: { ghost: { style: 'form' } }, schema: untyped })).toEqual({
      encoding: { ghost: {}, part: octetStream },
      schema: untyped,
    })
  })

  // 3.1 applies them only to multipart/form-data, so both versions already
  // ignore them in other multipart types.
  it('removes them in every multipart media type', () => {
    for (const type of ['multipart/mixed', 'Multipart/Form-Data; boundary=x']) {
      expect(convertForm({ encoding: { part: { explode: true } }, schema: untyped }, type)).toEqual({
        encoding: { part: octetStream },
        schema: untyped,
      })
    }
  })

  it('converts a media type shared by a multipart and a URL-encoded body as each', () => {
    const mediaType = { encoding: { part: { explode: true } }, schema: untyped }
    const content = dig(convertComponent('requestBodies', {
      content: { 'application/x-www-form-urlencoded': mediaType, 'multipart/form-data': mediaType },
    }), 'content')
    expect(dig(content, 'multipart/form-data')).toEqual({ ...mediaType, encoding: { part: octetStream } })
    expect(dig(content, 'application/x-www-form-urlencoded')).toEqual(mediaType)
  })

  it('leaves them in responses, where both versions ignore encoding', () => {
    const content = { 'multipart/form-data': { encoding: { part: { explode: true } }, schema: untyped } }
    expect(convertComponent('responses', { content, description: 'd' })).toEqual({ content, description: 'd' })
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
