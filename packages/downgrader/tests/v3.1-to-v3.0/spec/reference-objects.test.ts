// 3.1 Reference Objects may carry `summary` and `description` overrides:
// https://spec.openapis.org/oas/v3.1.2.html#reference-object
// A 3.0 Reference Object "cannot be extended with additional properties,
// and any properties added SHALL be ignored":
// https://spec.openapis.org/oas/v3.0.4.html#reference-object
// Since 3.0 tools would ignore them anyway, they are removed, together with
// any other field beside `$ref`.

import { convertComponent, convertPathItem, convertSpec } from './helpers'

it('strips reference overrides across components maps', () => {
  expect(convertSpec({
    components: {
      callbacks: { C: { $ref: '#/c/cb', summary: 's' } },
      examples: { E: { $ref: '#/c/e', description: 'd' } },
      headers: { H: { $ref: '#/c/h', summary: 's' } },
      links: { L: { '$ref': '#/c/l', 'description': 'd', 'x-note': 'n' } },
      parameters: { P: { $ref: '#/c/p', description: 'd', summary: 's' } },
      requestBodies: { B: { $ref: '#/c/b', summary: 's' } },
      responses: { R: { $ref: '#/c/r', description: 'd' } },
      securitySchemes: { S: { $ref: '#/c/s', description: 'd' } },
    },
  }).components).toEqual({
    callbacks: { C: { $ref: '#/c/cb' } },
    examples: { E: { $ref: '#/c/e' } },
    headers: { H: { $ref: '#/c/h' } },
    links: { L: { $ref: '#/c/l' } },
    parameters: { P: { $ref: '#/c/p' } },
    requestBodies: { B: { $ref: '#/c/b' } },
    responses: { R: { $ref: '#/c/r' } },
    securitySchemes: { S: { $ref: '#/c/s' } },
  })
})

it('strips reference overrides inside operations and path items', () => {
  expect(convertPathItem({
    get: {
      callbacks: { cb: { $ref: '#/c/cb', summary: 's' } },
      parameters: [{ $ref: '#/c/p', description: 'd' }],
      requestBody: { $ref: '#/c/b', summary: 's' },
      responses: { 200: { $ref: '#/c/r', summary: 's' } },
    },
    parameters: [{ $ref: '#/c/pp', summary: 's' }],
  })).toEqual({
    get: {
      callbacks: { cb: { $ref: '#/c/cb' } },
      parameters: [{ $ref: '#/c/p' }],
      requestBody: { $ref: '#/c/b' },
      responses: { 200: { $ref: '#/c/r' } },
    },
    parameters: [{ $ref: '#/c/pp' }],
  })
})

it('strips reference overrides in response headers, links, and media type examples', () => {
  expect(convertComponent('responses', {
    content: { 'application/json': { examples: { e: { $ref: '#/c/e', summary: 's' } }, schema: { type: ['string', 'null'] } } },
    description: 'ok',
    headers: { H: { $ref: '#/c/h', summary: 's' } },
    links: { l: { $ref: '#/c/l', description: 'd' } },
  })).toEqual({
    content: { 'application/json': { examples: { e: { $ref: '#/c/e' } }, schema: { nullable: true, type: 'string' } } },
    description: 'ok',
    headers: { H: { $ref: '#/c/h' } },
    links: { l: { $ref: '#/c/l' } },
  })
})

// A Path Item `$ref` is not a Reference Object: its sibling fields are part
// of the Path Item in both versions (https://spec.openapis.org/oas/v3.0.4.html#path-item-ref).
it('keeps the fields beside a Path Item $ref that it leaves as written, whatever the $ref value', () => {
  expect(convertPathItem({ $ref: '#/paths/~1other', summary: 's' })).toEqual({ $ref: '#/paths/~1other', summary: 's' })
  expect(convertPathItem({ $ref: 'https://example.com/paths.json#/a' })).toEqual({ $ref: 'https://example.com/paths.json#/a' })
  expect(convertPathItem({ $ref: 42 })).toEqual({ $ref: 42 })
})
