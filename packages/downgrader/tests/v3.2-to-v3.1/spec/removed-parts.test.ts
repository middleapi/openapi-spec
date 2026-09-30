// Removing or moving a part of the document would leave every local `$ref`
// into it dangling. Instead, such a reference is replaced by a converted copy
// of its target (inlined). The removed or moved parts in 3.2 → 3.1 are:
// - `components.mediaTypes`, the `query` operation, and `additionalOperations`
// - `itemSchema`, which moves into `schema.items`
// - parameter lists that lost `querystring` entries, since the indices of
//   the entries after a removed one shift

import { dig } from '../../helpers'
import { convertComponent, convertPathItem, convertSpec } from './helpers'

const petRef = { $ref: '#/components/mediaTypes/Pet/schema' }
const pet = { type: 'object', xml: { nodeType: 'element' } }
const convertedPet = { type: 'object', xml: {} }

describe('schema references', () => {
  it('inlines schema $refs at every subschema position', () => {
    const everyPosition = (schema: unknown) => ({
      $defs: { d: schema },
      additionalProperties: schema,
      allOf: [schema],
      anyOf: [schema],
      contains: schema,
      contentSchema: schema,
      dependentSchemas: { d: schema },
      else: schema,
      if: schema,
      items: schema,
      not: schema,
      oneOf: [schema],
      patternProperties: { '^x': schema },
      prefixItems: [schema],
      properties: { p: schema },
      propertyNames: schema,
      then: schema,
      unevaluatedItems: schema,
      unevaluatedProperties: schema,
    })
    expect(convertComponent('schemas', everyPosition(petRef), { mediaTypes: { Pet: { schema: pet } } })).toEqual(everyPosition(convertedPet))
  })

  it('inlines schema $refs in parameter, header, media type, and itemSchema positions', () => {
    expect(convertSpec({
      components: {
        headers: { H: { schema: petRef } },
        mediaTypes: { Pet: { schema: pet } },
        parameters: { P: { in: 'query', name: 'p', schema: petRef } },
        requestBodies: {
          B: { content: { 'application/json': { schema: petRef }, 'application/jsonl': { itemSchema: petRef } } },
        },
      },
    }).components).toEqual({
      headers: { H: { schema: convertedPet } },
      parameters: { P: { in: 'query', name: 'p', schema: convertedPet } },
      requestBodies: {
        B: {
          content: {
            'application/json': { schema: convertedPet },
            'application/jsonl': { schema: { items: convertedPet, type: 'array' } },
          },
        },
      },
    })
  })

  // `const`, `default`, `enum`, and `examples` hold instance data, not
  // schemas, so an object there that looks like a reference is just a value.
  // Only values under schema keywords are schemas:
  // https://json-schema.org/draft/2020-12/json-schema-core#section-9.4.2
  it('keeps data keywords, extensions, and non-string $ref values verbatim', () => {
    const schema = {
      'const': petRef,
      'default': petRef,
      'enum': [petRef],
      'examples': [petRef],
      'properties': { p: { $ref: 42 } },
      'x-data': petRef,
    }
    expect(convertSpec({
      components: { headers: { H: { schema: petRef } }, mediaTypes: { Pet: { schema: pet } }, schemas: { S: schema } },
    }).components).toEqual({ headers: { H: { schema: convertedPet } }, schemas: { S: schema } })
  })

  // In JSON Schema 2020-12, `$ref` applies its target alongside the sibling
  // keywords, exactly like one more `allOf` entry:
  // https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1
  // So the inlined target joins `allOf` instead of being merged key by key,
  // which could let one side's keyword overwrite the other's.
  it.each([
    ['adds allOf beside sibling annotations', { $ref: petRef.$ref, description: 'd' }, { allOf: [convertedPet], description: 'd' }],
    ['appends to an existing allOf, keeping its indices', { $ref: petRef.$ref, allOf: [{ required: ['a'] }] }, { allOf: [{ required: ['a'] }, convertedPet] }],
    ['nests a malformed allOf instead of discarding it', { $ref: petRef.$ref, allOf: 'junk' }, { allOf: [{ allOf: 'junk' }, convertedPet] }],
  ])('merges a $ref with its siblings: %s', (_name, schema, expected) => {
    expect(convertComponent('schemas', schema, { mediaTypes: { Pet: { schema: pet } } })).toEqual(expected)
  })

  // Boolean schemas are valid 3.1 schemas: https://json-schema.org/draft/2020-12/json-schema-core#section-4.3.2
  it('inlines a boolean target schema as is', () => {
    expect(convertComponent('schemas', { $ref: '#/components/mediaTypes/None/schema' }, { mediaTypes: { None: { schema: false } } })).toBe(false)
  })

  it('inlines pointers to an itemSchema that the conversion moves or removes', () => {
    expect(convertSpec({
      components: {
        requestBodies: {
          B: {
            content: {
              'application/json': { itemSchema: { type: 'number' }, schema: { type: 'array' } },
              'application/jsonl': { itemSchema: { type: 'string' } },
            },
          },
        },
        schemas: {
          Moved: { $ref: '#/components/requestBodies/B/content/application~1jsonl/itemSchema' },
          Removed: { $ref: '#/components/requestBodies/B/content/application~1json/itemSchema' },
        },
      },
    }).components?.schemas).toEqual({ Moved: { type: 'string' }, Removed: { type: 'number' } })
  })

  // A schema that is only `{ $ref }` (an alias) adds nothing of its own, so
  // inlining follows it to its target. An alias with siblings is a schema in
  // its own right: it is converted and inlined itself, keeping the siblings.
  it('follows schema alias chains through removed parts, stopping at an alias with siblings', () => {
    expect(dig(convertSpec({
      components: {
        mediaTypes: {
          A: { schema: { $ref: '#/components/mediaTypes/B/schema' } },
          B: { schema: { $ref: '#/components/mediaTypes/C/schema', description: 'b' } },
          C: { schema: { type: 'string' } },
        },
        schemas: { S: { $ref: '#/components/mediaTypes/A/schema' } },
      },
    }), 'components', 'schemas', 'S')).toEqual({ allOf: [{ type: 'string' }], description: 'b' })
  })

  // Pointer fragments are percent-decoded (https://www.rfc-editor.org/rfc/rfc3986#section-2.1)
  // before `~1` and `~0` are unescaped (https://www.rfc-editor.org/rfc/rfc6901#section-4).
  it('decodes escaped and percent-encoded pointer tokens', () => {
    expect(convertSpec({
      components: {
        mediaTypes: {
          'a/b~c': { schema: { type: 'string' } },
          'My Type': { schema: { type: 'number' } },
        },
        schemas: {
          Escaped: { $ref: '#/components/mediaTypes/a~1b~0c/schema' },
          Percent: { $ref: '#/components/mediaTypes/My%20Type/schema' },
          Templated: { $ref: '#/paths/~1pets~1%7Bid%7D/query/requestBody/content/application~1json/schema' },
        },
      },
      paths: {
        '/pets/{id}': { query: { requestBody: { content: { 'application/json': { schema: { type: 'integer' } } } } } },
      },
    }).components).toEqual({
      schemas: { Escaped: { type: 'string' }, Percent: { type: 'number' }, Templated: { type: 'integer' } },
    })
  })
})

describe('reference Objects', () => {
  it('inlines references into query, additionalOperations, and components.mediaTypes, converting each target for its position', () => {
    const result = convertSpec({
      components: {
        callbacks: { C: { $ref: '#/paths/~1search/query/callbacks/onDone' } },
        examples: { E: { $ref: '#/components/mediaTypes/Pet/examples/e' } },
        headers: { H: { $ref: '#/components/mediaTypes/Pet/encoding/file/headers/X-Rate' } },
        links: { L: { $ref: '#/paths/~1search/query/responses/200/links/next' } },
        mediaTypes: {
          Pet: {
            encoding: { file: { headers: { 'X-Rate': { examples: { a: { serializedValue: '1' } } } } } },
            examples: { e: { dataValue: 1 } },
          },
        },
      },
      paths: {
        '/search': {
          additionalOperations: { COPY: { responses: { 201: { summary: 'Copied' } } } },
          post: {
            parameters: [{ $ref: '#/paths/~1search/query/parameters/0' }],
            requestBody: { $ref: '#/paths/~1search/query/requestBody' },
            responses: {
              200: { $ref: '#/paths/~1search/query/responses/200' },
              201: { $ref: '#/paths/~1search/additionalOperations/COPY/responses/201' },
            },
          },
          query: {
            callbacks: { onDone: { '{$request.body#/url}': { post: { responses: { 200: { summary: 'ack' } } } } } },
            parameters: [{ in: 'cookie', name: 'c', style: 'cookie' }],
            requestBody: { content: { 'application/jsonl': { itemSchema: { type: 'string' } } } },
            responses: { 200: { links: { next: { operationId: 'x', server: { name: 'n', url: '/' } } }, summary: 'Found' } },
          },
        },
      },
    })
    expect(result.components).toEqual({
      callbacks: { C: { '{$request.body#/url}': { post: { responses: { 200: { description: 'ack' } } } } } },
      examples: { E: { value: 1 } },
      headers: { H: { examples: { a: { value: '1' } } } },
      links: { L: { operationId: 'x', server: { url: '/' } } },
    })
    expect(result.paths).toEqual({
      '/search': {
        post: {
          parameters: [{ in: 'cookie', name: 'c' }],
          requestBody: { content: { 'application/jsonl': { schema: { items: { type: 'string' }, type: 'array' } } } },
          responses: {
            200: { description: 'Found', links: { next: { operationId: 'x', server: { url: '/' } } } },
            201: { description: 'Copied' },
          },
        },
      },
    })
  })

  it('follows chains through removed parts and keeps the reference where a chain reaches a surviving part', () => {
    const result = convertSpec({
      components: {
        responses: {
          Deep: { $ref: '#/paths/~1a/query/responses/200' },
          Kept: { $ref: '#/paths/~1a/query/responses/201' },
          Real: { description: 'real' },
        },
      },
      paths: {
        '/a': { query: { responses: { 200: { $ref: '#/paths/~1b/query/responses/200' }, 201: { $ref: '#/components/responses/Real' } } } },
        '/b': { query: { responses: { 200: { summary: 'deep' } } } },
      },
    })
    expect(result.components).toEqual({
      responses: {
        Deep: { description: 'deep' },
        Kept: { $ref: '#/components/responses/Real' },
        Real: { description: 'real' },
      },
    })
    expect(result.paths).toEqual({ '/a': {}, '/b': {} })
  })

  // Removing a `querystring` parameter shifts the indices of the entries
  // after it, so `#/paths/~1a/get/parameters/2` would silently point at a
  // different parameter, or at nothing. References into such a list are
  // inlined, even though the list itself survives. References to entries
  // that kept their index, and external references, stay as written.
  it('inlines references into a parameter list that lost entries, since its indices shift', () => {
    const result = convertSpec({
      components: {
        parameters: {
          External: { $ref: '#/paths/~1a/get/parameters/1' },
          Kept: { $ref: '#/paths/~1b/get/parameters/0' },
          Shifted: { $ref: '#/paths/~1a/get/parameters/2' },
        },
      },
      paths: {
        '/a': {
          get: {
            parameters: [{ in: 'querystring', name: 'qs' }, { $ref: './parameters/limit.yaml' }, { in: 'query', name: 'b' }],
            responses: {},
          },
        },
        '/b': { get: { parameters: [{ in: 'query', name: 'c' }], responses: {} } },
      },
    })
    expect(result.components).toEqual({
      parameters: {
        External: { $ref: './parameters/limit.yaml' },
        Kept: { $ref: '#/paths/~1b/get/parameters/0' },
        Shifted: { in: 'query', name: 'b' },
      },
    })
    expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([{ $ref: './parameters/limit.yaml' }, { in: 'query', name: 'b' }])
  })
})

describe('path Item references', () => {
  // A Path Item `$ref` may sit beside the Path Item's own fields. The spec
  // leaves a field on both sides undefined, but says `$ref` will move toward
  // Reference Object behavior, where the referencing side's fields override
  // the target's: https://spec.openapis.org/oas/v3.2.0.html#path-item-ref
  // So when it is inlined, the own fields win.
  it('inlines a path item $ref that points into a removed operation, keeping own fields', () => {
    const callbacks = { c: { '{$url}': { description: 'inlined', summary: 'Inlined' } } }
    expect(dig(convertSpec({
      components: {
        pathItems: {
          copy: { $ref: '#/paths/~1a/additionalOperations/COPY/callbacks/c/{$url}' },
          query: { $ref: '#/paths/~1a/query/callbacks/c/{$url}', summary: 'Own' },
        },
      },
      paths: { '/a': { additionalOperations: { COPY: { callbacks } }, query: { callbacks } } },
    }), 'components', 'pathItems')).toEqual({
      copy: { description: 'inlined', summary: 'Inlined' },
      query: { description: 'inlined', summary: 'Own' },
    })
  })

  // Only pointers that actually land on a Path Item are merged as one. An
  // extension inside a Callback Object is not a Path Item, so a `$ref` to it
  // is left as written.
  it('inlines a path item $ref into a removed operation of a callbacks component', () => {
    expect(dig(convertSpec({
      components: {
        callbacks: {
          C: { '{$url}': { query: { callbacks: { d: { '{$v}': { description: 'inlined' } } } } }, 'x-cb': { query: {} } },
        },
        pathItems: {
          P: { $ref: '#/components/callbacks/C/{$url}/query/callbacks/d/{$v}' },
          X: { $ref: '#/components/callbacks/C/x-cb' },
        },
      },
    }), 'components', 'pathItems')).toEqual({
      P: { description: 'inlined' },
      X: { $ref: '#/components/callbacks/C/x-cb' },
    })
  })
})

describe('links and discriminator mappings', () => {
  // A Link's `operationRef` and a discriminator `mapping` value are
  // references too: https://spec.openapis.org/oas/v3.1.2.html#link-operation-ref
  // https://spec.openapis.org/oas/v3.1.2.html#discriminator-mapping
  // One that points into a removed part cannot be inlined (a Link needs an
  // operation to point at), so it is removed.
  it('removes links and discriminator mappings that point into removed parts', () => {
    const result = convertSpec({
      components: {
        links: { gone: { operationRef: '#/paths/~1a/query' }, kept: { operationRef: '#/paths/~1a/get' } },
        mediaTypes: { M: { schema: {} } },
        schemas: {
          Pet: {
            discriminator: { mapping: { cat: '#/components/schemas/Cat', item: '#/components/mediaTypes/M/schema' }, propertyName: 'kind' },
          },
        },
      },
      paths: { '/a': { get: {}, query: {} } },
    })
    expect(dig(result, 'components', 'links')).toEqual({ kept: { operationRef: '#/paths/~1a/get' } })
    expect(dig(result, 'components', 'schemas', 'Pet', 'discriminator')).toEqual({ mapping: { cat: '#/components/schemas/Cat' }, propertyName: 'kind' })
  })
})

describe('references left as written', () => {
  // A chain that loops never reaches an object to inline, and tools cannot
  // resolve it either, so rewriting it would not fix anything.
  it('leaves a Reference Object whose chain loops through removed parts as written', () => {
    const result = convertSpec({
      components: {
        responses: { Keep: { description: 'k' }, Loop: { $ref: '#/paths/~1a/query/responses/200' } },
      },
      paths: {
        '/a': { query: { responses: { 200: { $ref: '#/paths/~1b/query/responses/200' } } } },
        '/b': { query: { responses: { 200: { $ref: '#/paths/~1a/query/responses/200' } } } },
        '/c': { get: { responses: { 200: { $ref: '#/components/responses/Loop' } } } },
      },
    })
    expect(result.components).toEqual({
      responses: { Keep: { description: 'k' }, Loop: { $ref: '#/paths/~1a/query/responses/200' } },
    })
    expect(result.paths).toEqual({
      '/a': {},
      '/b': {},
      '/c': { get: { responses: { 200: { $ref: '#/components/responses/Loop' } } } },
    })
  })

  it('leaves references whose alias chain loops as written', () => {
    const parameters = {
      A: { $ref: '#/components/parameters/B' },
      B: { $ref: '#/components/parameters/A' },
    }
    expect(convertSpec({ components: { parameters } }).components).toEqual({ parameters })
  })

  // The looping entry stays in the list, so it keeps its index, and the
  // reference to the entry after it still points at the right parameter.
  it('leaves a looping entry in a parameter list, so later indices stay correct', () => {
    const result = convertSpec({
      components: { parameters: { P: { $ref: '#/paths/~1a/get/parameters/1' } } },
      paths: {
        '/a': { get: { parameters: [{ $ref: '#/paths/~1b/query/parameters/0' }, { in: 'query', name: 'b' }], responses: {} } },
        '/b': { query: { parameters: [{ $ref: '#/paths/~1c/query/parameters/0' }] } },
        '/c': { query: { parameters: [{ $ref: '#/paths/~1b/query/parameters/0' }] } },
      },
    })
    expect(dig(result, 'paths', '/a', 'get', 'parameters')).toEqual([{ $ref: '#/paths/~1b/query/parameters/0' }, { in: 'query', name: 'b' }])
    expect(result.components).toEqual({ parameters: { P: { $ref: '#/paths/~1a/get/parameters/1' } } })
  })

  // `#pet` names a plain-name `$anchor`, not a JSON Pointer
  // (https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.2),
  // and `#` points at the whole document, which survives the conversion.
  it('leaves external, anchor, root, unparseable, and already dangling references untouched', () => {
    const schemas = {
      Anchor: { $ref: '#pet' },
      BadEscape: { $ref: '#/components/mediaTypes/%E0%A4%A' },
      External: { $ref: 'https://example.com/api.json#/components/mediaTypes/Pet/schema' },
      Missing: { $ref: '#/components/mediaTypes/Nope/schema' },
      Root: { $ref: '#' },
    }
    expect(convertSpec({
      components: { headers: { H: { schema: petRef } }, mediaTypes: { Pet: { schema: pet } }, schemas },
    }).components).toEqual({ headers: { H: { schema: convertedPet } }, schemas })
  })
})

describe('recursion', () => {
  // Inlining a recursive schema would never end. The recursion is cut at its
  // first repeat by removing only the inner `$ref` keyword: a bare `$ref`
  // becomes `{}`, which accepts anything, and one with siblings keeps them.
  // Cutting can only loosen validation, never reject a value the original
  // accepted (apart from under `not` and friends, a known limitation).
  it('cuts a recursive schema at its first repeat by removing only the $ref keyword', () => {
    expect(convertComponent('schemas', { $ref: '#/components/mediaTypes/Tree/schema' }, {
      mediaTypes: {
        Tree: {
          schema: {
            properties: {
              children: { items: { $ref: '#/components/mediaTypes/Tree/schema' }, type: 'array' },
              parent: { $ref: '#/components/mediaTypes/Tree/schema', description: 'up' },
            },
            type: 'object',
          },
        },
      },
    })).toEqual({
      properties: { children: { items: {}, type: 'array' }, parent: { description: 'up' } },
      type: 'object',
    })
  })

  // `%54ree` percent-decodes to `Tree`, so the inner reference is the same
  // target as the outer one and the recursion is still detected.
  it('detects recursion however the pointer is spelled', () => {
    expect(convertComponent('schemas', { $ref: '#/components/mediaTypes/Tree/schema' }, {
      mediaTypes: { Tree: { schema: { items: { $ref: '#/components/mediaTypes/%54ree/schema' }, type: 'array' } } },
    })).toEqual({ items: {}, type: 'array' })
  })

  it('cuts a cycle entered through a pointer into a recursive schema', () => {
    const result = convertComponent('schemas', { $ref: '#/components/mediaTypes/Tree/schema/properties/children' }, {
      mediaTypes: {
        Tree: {
          schema: {
            properties: { children: { items: { $ref: '#/components/mediaTypes/Tree/schema' }, type: 'array' } },
            type: 'object',
          },
        },
      },
    })
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(result).toEqual({ items: { properties: { children: {} }, type: 'object' }, type: 'array' })
  })

  // Outside schemas there is no "accept anything" value to cut with, so a
  // Reference Object that leads back into the object being inlined is
  // removed instead.
  it('removes a Reference Object that comes back to the object being inlined', () => {
    expect(convertPathItem({
      post: { callbacks: { copy: { $ref: '#/paths/~1a/query/callbacks/cb' } } },
      query: {
        callbacks: {
          cb: { '{$url}': { get: { callbacks: { back: { $ref: '#/paths/~1a/query/callbacks/cb' } } } } },
        },
      },
    })).toEqual({
      post: { callbacks: { copy: { '{$url}': { get: { callbacks: {} } } } } },
    })
  })
})
