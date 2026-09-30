// `webhooks` and `components.pathItems` have no 3.0 form and are removed,
// which would leave every local `$ref` into them dangling. Instead, such a
// reference is replaced by a converted copy of its target (inlined),
// following the reference chain until it leaves the removed parts.

import { dig } from '../../helpers'
import { convertSpec, item, removedPointer, webhookSchemaPointer } from './helpers'

const hook = {
  post: {
    operationId: 'newPetHook',
    parameters: [{ description: 'orig', in: 'header', name: 'X-Hook', schema: { type: ['string', 'null'] } }],
    requestBody: { content: { 'application/json': { schema: { properties: { name: { type: 'string' } }, type: 'object' } } } },
    responses: { 200: { description: 'ok' } },
  },
}
/** Points into the `full` webhook that several tests below inline from. */
function full(path: string): string {
  return `#/webhooks/full/post/${path}`
}

const hookParameter = { description: 'orig', in: 'header', name: 'X-Hook', schema: { nullable: true, type: 'string' } }

describe('inlining', () => {
  it('inlines references into webhooks and components.pathItems without mutating the input', () => {
    const input = {
      components: { pathItems: { Item: item }, schemas: { Pet: { $ref: webhookSchemaPointer } } },
      paths: {
        '/a': {
          get: {
            parameters: [{ $ref: '#/webhooks/newPet/post/parameters/0' }, { $ref: '#/components/pathItems/Item/parameters/0' }],
            responses: { 200: { $ref: '#/webhooks/newPet/post/responses/200' } },
          },
        },
        '/b': { $ref: '#/webhooks/newPet' },
      },
      webhooks: { newPet: hook },
    }
    const before = structuredClone(input)
    const result = convertSpec(input)
    expect(result.components).toEqual({ schemas: { Pet: { properties: { name: { type: 'string' } }, type: 'object' } } })
    expect(result.paths).toEqual({
      '/a': {
        get: {
          parameters: [hookParameter, { in: 'query', name: 'q', schema: { enum: ['x'] } }],
          responses: { 200: { description: 'ok' } },
        },
      },
      '/b': { post: { ...hook.post, parameters: [hookParameter] } },
    })
    expect(JSON.stringify(result)).not.toMatch(removedPointer)
    expect(input).toEqual(before)
  })

  // The same target converts differently depending on what it is used as:
  // a callback's path items get default responses, a parameter in the path
  // becomes required, schemas lose their 3.1-only keywords, and so on.
  it('converts each inlined target for its position, in every component map', () => {
    const response = {
      content: { 'application/json': { examples: { e: { value: 1 } } } },
      description: 'ok',
      headers: { H: { schema: { const: 1 } } },
    }
    const result = convertSpec({
      components: {
        callbacks: { C: { $ref: full('callbacks/cb') } },
        examples: { E: { $ref: full('responses/200/content/application~1json/examples/e') } },
        headers: { H: { $ref: full('responses/200/headers/H') } },
        parameters: { P: { $ref: full('parameters/0') } },
        requestBodies: { B: { $ref: full('requestBody') } },
        responses: { R: { $ref: full('responses/200') } },
        securitySchemes: { S: { $ref: full('x-scheme') } },
      },
      webhooks: {
        full: {
          post: {
            'callbacks': { cb: { '{$url}': { get: {} } } },
            'parameters': [{ in: 'path', name: 'id' }],
            'requestBody': { content: { 'application/json': { schema: { type: ['string', 'null'] } } } },
            'responses': { 200: response },
            'x-scheme': { in: 'header', name: 'k', type: 'apiKey' },
          },
        },
      },
    })
    expect(result.components).toEqual({
      callbacks: { C: { '{$url}': { get: { responses: { default: { description: '' } } } } } },
      examples: { E: { value: 1 } },
      headers: { H: { schema: { enum: [1] } } },
      parameters: { P: { in: 'path', name: 'id', required: true } },
      requestBodies: { B: { content: { 'application/json': { schema: { nullable: true, type: 'string' } } } } },
      responses: { R: { ...response, headers: { H: { schema: { enum: [1] } } } } },
      securitySchemes: { S: { in: 'header', name: 'k', type: 'apiKey' } },
    })
  })

  it('inlines references in operation, path item, media type, parameter, and encoding positions', () => {
    expect(convertSpec({
      paths: {
        '/a': {
          get: {
            parameters: [{ examples: { e: { $ref: full('x-example') } }, in: 'query', name: 'q' }],
            requestBody: { $ref: full('requestBody') },
            responses: {
              200: {
                content: {
                  'application/json': {
                    encoding: { f: { headers: { H: { $ref: full('x-header') } } } },
                    examples: { e: { $ref: full('x-example') } },
                  },
                },
                description: 'ok',
              },
            },
          },
          parameters: [{ $ref: full('x-parameter') }],
        },
      },
      webhooks: {
        full: {
          post: {
            'requestBody': { content: { 'text/plain': { schema: { const: 'x' } } } },
            'x-example': { value: 1 },
            'x-header': { schema: { type: ['string', 'null'] } },
            'x-parameter': { in: 'path', name: 'id' },
          },
        },
      },
    }).paths).toEqual({
      '/a': {
        get: {
          parameters: [{ examples: { e: { value: 1 } }, in: 'query', name: 'q' }],
          requestBody: { content: { 'text/plain': { schema: { enum: ['x'] } } } },
          responses: {
            200: {
              content: {
                'application/json': {
                  encoding: { f: { headers: { H: { schema: { nullable: true, type: 'string' } } } } },
                  examples: { e: { value: 1 } },
                },
              },
              description: 'ok',
            },
          },
        },
        parameters: [{ in: 'path', name: 'id', required: true }],
      },
    })
  })

  // 3.0 Reference Objects cannot carry overrides (see reference-objects.test.ts),
  // and the inlined object replaces the reference, so the overrides go.
  it('ignores summary and description overrides when it inlines a reference', () => {
    expect(convertSpec({
      components: {
        callbacks: { C: { $ref: '#/webhooks/newPet/x-callback', description: 'ignored' } },
        examples: { E: { $ref: '#/webhooks/newPet/x-example', summary: 'outer' } },
        parameters: { P: { $ref: '#/webhooks/newPet/x-alias', description: 'outer' } },
      },
      webhooks: {
        newPet: {
          ...hook,
          'x-alias': { $ref: '#/webhooks/newPet/post/parameters/0', description: 'inner' },
          'x-callback': { '{$url}': { summary: 's' } },
          'x-example': { description: 'd', summary: 's', value: 1 },
        },
      },
    }).components).toEqual({
      callbacks: { C: { '{$url}': { summary: 's' } } },
      examples: { E: { description: 'd', summary: 's', value: 1 } },
      parameters: { P: hookParameter },
    })
  })
})

describe('schema references', () => {
  // A lone `$ref` is replaced by the target. Beside other keywords, the
  // target joins `allOf`, which is how 3.0 combines a reference with
  // siblings (see schema/references.test.ts). A boolean target converts
  // like any boolean schema.
  it('inlines Schema $refs with or without siblings and converts boolean targets', () => {
    const pointer = (path: string) => `#/components/pathItems/Schemas/x-schemas/${path}`
    const result = convertSpec({
      components: {
        pathItems: {
          Schemas: {
            'x-schemas': {
              alias: { $ref: pointer('nullable') },
              never: false,
              nullable: { type: ['string', 'null'] },
              withSiblings: { $ref: pointer('nullable'), description: 'wrapped' },
            },
          },
        },
        schemas: {
          Alias: { $ref: pointer('alias') },
          Never: { $ref: pointer('never') },
          NotNever: { not: { $ref: pointer('never') } },
          Siblings: { $ref: pointer('nullable'), description: 'd' },
          WithSiblings: { $ref: pointer('withSiblings') },
        },
      },
    })
    const nullable = { nullable: true, type: 'string' }
    expect(result.components).toEqual({
      schemas: {
        Alias: nullable,
        Never: { not: {} },
        NotNever: { not: { not: {} } },
        Siblings: { allOf: [nullable], description: 'd' },
        WithSiblings: { allOf: [nullable], description: 'wrapped' },
      },
    })
  })

  // A diamond of references (two properties pointing at the same target, 64
  // levels deep) has 2^64 paths. Each target is converted once and shared.
  it('converts a target reached through many references once', () => {
    const pointer = (index: number) => `#/webhooks/w${index}/post/requestBody/content/application~1json/schema`
    const leaf = { content: { 'application/json': { schema: { type: ['string', 'null'] } } } }
    const webhooks: Record<string, unknown> = { w64: { post: { requestBody: leaf } } }
    for (let index = 0; index < 64; index++) {
      const schema = { properties: { a: { $ref: pointer(index + 1) }, b: { $ref: pointer(index + 1) } }, type: 'object' }
      webhooks[`w${index}`] = { post: { requestBody: { content: { 'application/json': { schema } } } } }
    }
    let node = dig(convertSpec({ components: { schemas: { Root: { $ref: pointer(0) } } }, webhooks }), 'components', 'schemas', 'Root')
    for (let index = 0; index < 64; index++) {
      expect(dig(node, 'properties', 'a')).toBe(dig(node, 'properties', 'b'))
      node = dig(node, 'properties', 'a')
    }
    expect(node).toEqual({ nullable: true, type: 'string' })
  })

  it('converts path items and headers reached through many references once', () => {
    const webhooks: Record<string, unknown> = { w30: { 'get': { responses: {} }, 'x-header': { schema: { type: 'string' } } } }
    for (let index = 0; index < 30; index++) {
      const next = { $ref: `#/webhooks/w${index + 1}` }
      const header = { $ref: `#/webhooks/w${index + 1}/x-header` }
      webhooks[`w${index}`] = {
        'get': { callbacks: { a: { expr: next }, b: { expr: next } }, responses: {} },
        'x-header': { content: { 'text/plain': { encoding: { e: { headers: { a: header, b: header } } } } } },
      }
    }
    const result = convertSpec({
      components: { headers: { H: { $ref: '#/webhooks/w0/x-header' } } },
      paths: { '/a': { $ref: '#/webhooks/w0' } },
      webhooks,
    })
    let pathItem = dig(result, 'paths', '/a')
    let header = dig(result, 'components', 'headers', 'H')
    for (let index = 0; index < 30; index++) {
      expect(dig(pathItem, 'get', 'callbacks', 'a', 'expr')).toBe(dig(pathItem, 'get', 'callbacks', 'b', 'expr'))
      pathItem = dig(pathItem, 'get', 'callbacks', 'a', 'expr')
      const headers = dig(header, 'content', 'text/plain', 'encoding', 'e', 'headers')
      expect(dig(headers, 'a')).toBe(dig(headers, 'b'))
      header = dig(headers, 'a')
    }
    expect(pathItem).toEqual({ 'get': { responses: {} }, 'x-header': { schema: { type: 'string' } } })
    expect(header).toEqual({ schema: { type: 'string' } })
  })
})

describe('reference chains', () => {
  it('follows chains through the removed parts and keeps the reference where a chain leaves them', () => {
    const result = convertSpec({
      components: {
        parameters: { Shared: { in: 'query', name: 'shared' } },
        pathItems: { Deep: { parameters: [{ in: 'query', name: 'deep' }] } },
        schemas: {
          Exit: { $ref: '#/webhooks/chain/post/requestBody/content/application~1json/schema' },
          Name: { type: 'string' },
        },
      },
      paths: {
        '/a': {
          post: {
            parameters: [
              { $ref: '#/webhooks/chain/post/parameters/0' },
              { $ref: '#/webhooks/chain/post/parameters/1', description: 'dropped' },
            ],
            responses: {},
          },
        },
        '/b': { $ref: '#/webhooks/alias', description: 'own' },
      },
      webhooks: {
        alias: { $ref: '#/paths/~1a', summary: 'alias' },
        chain: {
          post: {
            parameters: [{ $ref: '#/components/pathItems/Deep/parameters/0' }, { $ref: '#/components/parameters/Shared' }],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Name' } } } },
          },
        },
      },
    })
    expect(result.components?.schemas?.Exit).toEqual({ $ref: '#/components/schemas/Name' })
    expect(result.paths).toEqual({
      '/a': { post: { parameters: [{ in: 'query', name: 'deep' }, { $ref: '#/components/parameters/Shared' }], responses: {} } },
      '/b': { $ref: '#/paths/~1a', description: 'own', summary: 'alias' },
    })
  })

  // Chains are followed with loops rather than recursion, so their length is
  // not bounded by the call stack.
  it('follows long chains without growing the stack', () => {
    const webhooks: Record<string, unknown> = { w10000: { get: { responses: {} } } }
    for (let index = 0; index < 10_000; index++) {
      webhooks[`w${index}`] = { $ref: `#/webhooks/w${index + 1}` }
    }
    expect(convertSpec({ paths: { '/a': { $ref: '#/webhooks/w0' } }, webhooks }).paths).toEqual({ '/a': { get: { responses: {} } } })
  })

  it('removes thousands of aliases chained to a removed security scheme', () => {
    const securitySchemes: Record<string, unknown> = { s0: { type: 'mutualTLS' } }
    for (let index = 1; index <= 5000; index++) {
      securitySchemes[`s${index}`] = { $ref: `#/components/securitySchemes/s${index - 1}` }
    }
    const result = convertSpec({ components: { securitySchemes }, security: [{ s5000: [] }] })
    expect(result.components).toEqual({ securitySchemes: {} })
    expect(result).not.toHaveProperty('security')
  })
})

describe('pointers', () => {
  // Pointer fragments are percent-decoded (https://www.rfc-editor.org/rfc/rfc3986#section-2.1)
  // before `~1` and `~0` are unescaped (https://www.rfc-editor.org/rfc/rfc6901#section-4).
  it('resolves percent-encoded and tilde-escaped pointers', () => {
    expect(convertSpec({
      paths: {
        '/a': {
          get: {
            parameters: [
              { $ref: '#/webhooks/new%20pet/post/parameters/0' },
              { $ref: '#/webhooks/a~0b~1c/post/parameters/0' },
              { $ref: '#%2Fwebhooks%2Fnew%20pet%2Fpost%2Fparameters%2F1' },
            ],
            responses: {},
          },
        },
        '/b': { $ref: '#/webhooks/new%20pet/post/callbacks/cb/%7B$request.body%23~1url%7D' },
      },
      webhooks: {
        'a~b/c': { post: { parameters: [{ in: 'query', name: 'tilde' }] } },
        'new pet': {
          post: {
            callbacks: { cb: { '{$request.body#/url}': { summary: 'callback' } } },
            parameters: [{ in: 'query', name: 'space' }, { in: 'query', name: 'encoded' }],
          },
        },
      },
    }).paths).toEqual({
      '/a': {
        get: {
          parameters: [{ in: 'query', name: 'space' }, { in: 'query', name: 'tilde' }, { in: 'query', name: 'encoded' }],
          responses: {},
        },
      },
      '/b': { summary: 'callback' },
    })
  })

  // Array tokens must be canonical indices ("0", not "00", "-", or
  // "length"), and object tokens must be own keys, never inherited members
  // such as `constructor`: https://www.rfc-editor.org/rfc/rfc6901#section-4
  it('resolves pointer tokens only against keys and indices the document owns', () => {
    const refs = [
      '#/webhooks/__proto__/post/parameters/0',
      '#/webhooks/__proto__/post/parameters/length',
      '#/webhooks/__proto__/post/parameters/00',
      '#/webhooks/__proto__/post/parameters/-',
      '#/webhooks/constructor',
      '#/webhooks/hasOwnProperty',
    ]
    const result = convertSpec({
      paths: { '/a': { get: { parameters: refs.map($ref => ({ $ref })), responses: {} } } },
      webhooks: JSON.parse('{"__proto__":{"post":{"parameters":[{"in":"query","name":"own"}]}}}'),
    })
    expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([{ in: 'query', name: 'own' }, ...refs.slice(1).map($ref => ({ $ref }))])
  })
})

describe('path Item references', () => {
  // A Path Item `$ref` is merged only when its pointer names a Path Item:
  // an entry of `paths`, `webhooks`, `components.pathItems`, or a Callback
  // Object. A schema property or an extension that happens to be called
  // `callbacks` does not count, and neither does an `x-` key.
  it.each([
    ['a schema property named callbacks', '#/webhooks/w/post/requestBody/content/a~1b/schema/properties/callbacks/properties/x'],
    ['a webhook named callbacks', '#/webhooks/callbacks/get/responses'],
    ['a callback extension', '#/webhooks/w/post/callbacks/c/x-note'],
  ])('leaves a Path Item $ref to %s as written', (_name, ref) => {
    expect(convertSpec({
      paths: { '/a': { $ref: ref } },
      webhooks: {
        callbacks: { get: { responses: { 200: { description: 'ok' } } } },
        w: {
          post: {
            callbacks: { c: { 'x-note': { get: {} } } },
            requestBody: { content: { 'a/b': { schema: { properties: { callbacks: { properties: { x: { get: 'prop', type: 'string' } } } } } } } },
          },
        },
      },
    }).paths).toEqual({ '/a': { $ref: ref } })
  })

  it('inlines a Path Item $ref to a callback nested in another callback', () => {
    expect(convertSpec({
      paths: { '/a': { $ref: '#/webhooks/w/post/callbacks/c/{$url}/get/callbacks/d/{$url}' } },
      webhooks: { w: { post: { callbacks: { c: { '{$url}': { get: { callbacks: { d: { '{$url}': { summary: 'nested' } } } } } } } } } },
    }).paths).toEqual({ '/a': { summary: 'nested' } })
  })
})

describe('references left as written', () => {
  // Nothing can be inlined for a target that is missing, is not an object,
  // or never ends. These references already dangle or loop in the input,
  // and are left as written wherever they appear (only stripped of the
  // overrides 3.0 ignores).
  it.each([
    ['a missing target', '#/webhooks/newPet/post/parameters/9'],
    ['a non-object target', '#/webhooks/newPet/post/operationId'],
    ['a looping chain', '#/components/pathItems/Loop/parameters/0'],
    ['a malformed percent escape', '#/webhooks/%E0%A4%A'],
  ])('leaves a reference to %s as written, in every position', (_name, ref) => {
    const reference = { $ref: ref, description: 'd' }
    const bare = { $ref: ref }
    const result = convertSpec({
      components: {
        callbacks: { C: reference },
        examples: { E: reference },
        headers: { H: reference },
        links: { L: reference },
        parameters: { P: reference },
        pathItems: {
          Loop: { parameters: [{ $ref: '#/components/pathItems/Loop/parameters/1' }, { $ref: '#/components/pathItems/Loop/parameters/0' }] },
        },
        requestBodies: { B: reference },
        responses: { R: reference },
        schemas: { S: bare, T: { $ref: ref, type: 'string' } },
        securitySchemes: { S: reference },
      },
      paths: {
        '/a': {
          get: {
            callbacks: { cb: reference },
            parameters: [reference, { in: 'query', name: 'kept' }],
            requestBody: reference,
            responses: {
              200: {
                content: {
                  'application/json': {
                    encoding: { f: { headers: { H: reference } } },
                    examples: { e: reference },
                    schema: bare,
                  },
                },
                description: 'ok',
                headers: { H: reference },
                links: { l: reference },
              },
              201: reference,
            },
          },
          parameters: [reference],
        },
        '/b': reference,
      },
      webhooks: { newPet: hook },
    })
    expect(result.components).toEqual({
      callbacks: { C: bare },
      examples: { E: bare },
      headers: { H: bare },
      links: { L: bare },
      parameters: { P: bare },
      requestBodies: { B: bare },
      responses: { R: bare },
      schemas: { S: bare, T: { allOf: [bare], type: 'string' } },
      securitySchemes: { S: bare },
    })
    expect(result.paths).toEqual({
      '/a': {
        get: {
          callbacks: { cb: bare },
          parameters: [bare, { in: 'query', name: 'kept' }],
          requestBody: bare,
          responses: {
            200: {
              content: { 'application/json': { encoding: { f: { headers: { H: bare } } }, examples: { e: bare }, schema: bare } },
              description: 'ok',
              headers: { H: bare },
              links: { l: bare },
            },
            201: bare,
          },
        },
        parameters: [bare],
      },
      '/b': reference,
    })
  })
})
