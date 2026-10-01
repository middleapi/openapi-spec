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
// 3.1 honors these fields in `application/x-www-form-urlencoded` and
// `multipart/form-data` bodies only, so there such entries are left alone,
// as are ones that already set `contentType`. Other multipart bodies ignore
// the fields, so their parts still get the default. 3.0 honors the fields
// in URL-encoded bodies only
// (https://spec.openapis.org/oas/v3.0.4.html#fixed-fields-for-rfc6570-style-serialization),
// so it cannot express a `multipart/form-data` part serialized this way: the
// entry is kept as written, and the README lists the loss as a known
// limitation.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'
import { expectValidDowngrade } from '../../validate'
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

  it('converts a media type shared between multipart/form-data and multipart/mixed as each', () => {
    const mediaType = { encoding: { file: { style: 'form' } }, schema: { properties: { file: {} } } }
    const result = dig(convertComponent('requestBodies', {
      content: { 'multipart/form-data': mediaType, 'multipart/mixed': mediaType },
    }), 'content')
    expect(dig(result, 'multipart/form-data')).toEqual(mediaType)
    expect(dig(result, 'multipart/mixed', 'encoding')).toEqual({ file: { style: 'form', ...octetStream } })
  })

  it('leaves a malformed encoding value alone', () => {
    expect(convertForm({ encoding: 'junk', schema: { properties: { file: {} } } })).toEqual({
      encoding: 'junk',
      schema: { properties: { file: {} } },
    })
  })
})

describe('style, explode, and allowReserved', () => {
  const encoding = { exploded: { explode: false }, reserved: { allowReserved: true }, styled: { style: 'form' } }
  const schema = { properties: { exploded: {}, reserved: {}, styled: {} } }

  it.each([
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'Multipart/Form-Data; charset=utf-8',
  ])('override the default in %s bodies, where 3.1 serializes the part with them', (type) => {
    expect(convertForm({ encoding, schema }, type)).toEqual({ encoding, schema })
  })

  it.each([
    'multipart/mixed',
    'multipart/related',
    'Multipart/Mixed; boundary=x',
    'multipart/form-data-v2',
  ])('leave the default in place in %s bodies, where 3.1 ignores them', (type) => {
    expect(convertForm({ encoding, schema }, type)).toEqual({
      encoding: {
        exploded: { explode: false, ...octetStream },
        reserved: { allowReserved: true, ...octetStream },
        styled: { style: 'form', ...octetStream },
      },
      schema,
    })
  })

  // In 3.1, `tags` goes out as one `a,b,c` part. 3.0 ignores `explode` in
  // multipart/form-data and sends one text/plain part per item; it has no
  // way to say otherwise, so the entry is kept for tools that honor it.
  it('are kept as written in a valid 3.0 document', async () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      info: { title: 'Forms', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/form': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  encoding: { tags: { explode: false } },
                  schema: { properties: { tags: { items: { type: 'string' }, type: 'array' } }, type: 'object' },
                },
                'multipart/mixed': {
                  encoding: { file: { style: 'form' } },
                  schema: { properties: { file: {} }, type: 'object' },
                },
              },
            },
            responses: { 204: { description: 'saved' } },
          },
        },
      },
    }
    const v30 = await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
    const content = dig(v30, 'paths', '/form', 'post', 'requestBody', 'content')
    expect(dig(content, 'multipart/form-data', 'encoding')).toEqual({ tags: { explode: false } })
    expect(dig(content, 'multipart/mixed', 'encoding')).toEqual({ file: { style: 'form', ...octetStream } })
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
