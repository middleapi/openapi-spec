import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

// Small inputs that reach the same objects along exponentially many paths,
// or around cycles. Converting each object once keeps the work linear, so a
// regression here costs orders of magnitude, not percent.

function info(): OpenAPIV3_2.InfoObject {
  return { title: 'Graph', version: '1.0.0' }
}

/**
 * `depth` nested objects whose two properties share one child, as a
 * dereferencing parser leaves them: 2^depth paths reach the leaf.
 */
export function schemaDiamond(depth: number): OpenAPIV3_2.SchemaObject {
  let node: OpenAPIV3_2.SchemaObject = { type: ['string', 'null'] }
  for (let level = 0; level < depth; level++) {
    node = { type: 'object', properties: { left: node, right: node } }
  }
  return node
}

function diamondLevel(
  level: number,
  depth: number,
  pointer: (level: number) => string,
): OpenAPIV3_2.SchemaObject {
  return level === depth
    ? { type: ['string', 'null'] }
    : {
        type: 'object',
        properties: { left: { $ref: pointer(level + 1) }, right: { $ref: pointer(level + 1) } },
      }
}

/**
 * A diamond like `schemaDiamond`, but each level is a schema in the webhooks,
 * which 3.0 lacks, and its two properties reach the next level through
 * `$ref`s. Every level has to be inlined.
 */
export function referenceDiamondV31(depth: number): OpenAPIV3_1.OpenAPIObject {
  const pointer = (level: number): string =>
    `#/webhooks/w${level}/post/requestBody/content/application~1json/schema`
  const webhooks: Record<string, OpenAPIV3_1.PathItemObject> = {}
  for (let level = 0; level <= depth; level++) {
    webhooks[`w${level}`] = {
      post: {
        requestBody: {
          content: { 'application/json': { schema: diamondLevel(level, depth, pointer) } },
        },
      },
    }
  }
  return {
    openapi: '3.1.2',
    info: info(),
    components: { schemas: { Root: { $ref: pointer(0) } } },
    webhooks,
  }
}

/**
 * A diamond like `referenceDiamondV31`, with each level in
 * `components.mediaTypes`, which 3.1 lacks.
 */
export function referenceDiamondV32(depth: number): OpenAPIV3_2.OpenAPIObject {
  const pointer = (level: number): string => `#/components/mediaTypes/M${level}/schema`
  const mediaTypes: Record<string, OpenAPIV3_2.MediaTypeObject> = {}
  for (let level = 0; level <= depth; level++) {
    mediaTypes[`M${level}`] = { schema: diamondLevel(level, depth, pointer) }
  }
  return {
    openapi: '3.2.0',
    info: info(),
    components: { mediaTypes, schemas: { Root: { $ref: pointer(0) } } },
  }
}

/**
 * Path Items `base` and `h0` … `h<k-1>`, where every `h<i>` has a `$ref` to
 * `base` and callbacks to every `h<j>`, itself included, so about k! paths
 * run through them. `pointer` says where they live.
 */
function cyclicCallbackGraph(
  k: number,
  pointer: (name: string) => string,
): Record<string, OpenAPIV3_2.PathItemObject> {
  const items: Record<string, OpenAPIV3_2.PathItemObject> = {
    base: { get: { responses: { 200: { description: 'ok' } } } },
  }
  for (let i = 0; i < k; i++) {
    const callbacks = Object.fromEntries(
      Array.from({ length: k }, (_, j) => [
        `c${j}`,
        { '{$request.body#/url}': { $ref: pointer(`h${j}`) } },
      ]),
    )
    items[`h${i}`] = {
      $ref: pointer('base'),
      post: { callbacks, responses: { 200: { description: 'ok' } } },
    }
  }
  return items
}

/** A cyclic callback graph in the webhooks, which 3.0 lacks, entered from a path. */
export function callbackGraphV31(k: number): OpenAPIV3_1.OpenAPIObject {
  const webhooks = cyclicCallbackGraph(k, (name) => `#/webhooks/${name}`) as Record<
    string,
    OpenAPIV3_1.PathItemObject
  >
  return { openapi: '3.1.2', info: info(), paths: { '/a': { $ref: '#/webhooks/h0' } }, webhooks }
}

/** A cyclic callback graph in a `query` operation, which 3.1 lacks, entered from a path. */
export function callbackGraphV32(k: number): OpenAPIV3_2.OpenAPIObject {
  const graph = cyclicCallbackGraph(k, (name) => `#/paths/~1q/query/callbacks/cb/${name}`)
  return {
    openapi: '3.2.0',
    info: info(),
    paths: {
      '/a': { $ref: '#/paths/~1q/query/callbacks/cb/h0' },
      '/q': { query: { callbacks: { cb: graph }, responses: { 200: { description: 'ok' } } } },
    },
  }
}

/**
 * The components `<name>0` … `<name><length>` of one kind, each a `$ref` to
 * the next but the last, which is `end`.
 */
function refChain<T>(
  kind: string,
  name: string,
  length: number,
  end: T,
): Record<string, T | { $ref: string }> {
  const chain: Record<string, T | { $ref: string }> = { [`${name}${length}`]: end }
  for (let index = 0; index < length; index++) {
    chain[`${name}${index}`] = { $ref: `#/components/${kind}/${name}${index + 1}` }
  }
  return chain
}

/**
 * `length` Path Items in `components.pathItems`, which 3.0 lacks, each a
 * `$ref` to the next, with a path entering the chain at every one of them.
 */
export function pathItemChainV31(length: number): OpenAPIV3_1.OpenAPIObject {
  const pathItems = refChain('pathItems', 'P', length, {
    get: { responses: { 200: { description: 'ok' } } },
  })
  const paths: OpenAPIV3_1.PathsObject = {}
  for (let index = 0; index < length; index++) {
    paths[`/p${index}`] = { $ref: `#/components/pathItems/P${index}` }
  }
  return { openapi: '3.1.2', info: info(), components: { pathItems }, paths }
}

/**
 * `length` Security Schemes, each a `$ref` to the next, ending at an HTTP
 * scheme, with `length` operations requiring the first. The chain is entered
 * at every scheme too, when the schemes themselves are converted.
 *
 * Every requirement names the same scheme: requirements naming `length`
 * different ones would each give the empty object's hidden class its own
 * transition, and growing that list slows every other bench in this file.
 */
export function securitySchemeChainV31(length: number): OpenAPIV3_1.OpenAPIObject {
  const securitySchemes = refChain<OpenAPIV3_1.SecuritySchemeObject>(
    'securitySchemes',
    'S',
    length,
    {
      type: 'http',
      scheme: 'bearer',
    },
  )
  const paths: OpenAPIV3_1.PathsObject = {}
  for (let index = 0; index < length; index++) {
    paths[`/p${index}`] = {
      get: { security: [{ S0: [] }], responses: { 200: { description: 'ok' } } },
    }
  }
  return { openapi: '3.1.2', info: info(), components: { securitySchemes }, paths }
}

/**
 * `length` Parameters, each a `$ref` to the next, ending at a query
 * parameter, with an operation using every one of them.
 */
export function parameterChainV32(length: number): OpenAPIV3_2.OpenAPIObject {
  const parameters = refChain<OpenAPIV3_2.ParameterObject>('parameters', 'P', length, {
    name: 'q',
    in: 'query',
    schema: { type: 'string' },
  })
  const paths: OpenAPIV3_2.PathsObject = {}
  for (let index = 0; index < length; index++) {
    paths[`/p${index}`] = {
      get: {
        parameters: [{ $ref: `#/components/parameters/P${index}` }],
        responses: { 200: { description: 'ok' } },
      },
    }
  }
  return { openapi: '3.2.0', info: info(), components: { parameters }, paths }
}
