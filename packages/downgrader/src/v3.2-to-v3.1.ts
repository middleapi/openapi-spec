import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import type { Context, Convert, Fields } from './shared'
import {
  child,
  clone,
  convertObject,
  defineFields,
  downgrade,
  DROP,
  getRef,
  hasType,
  HTTP_METHODS,
  inline,
  isNotExtension,
  isPath,
  isRecord,
  list,
  map,
  pointerKeys,
  resolve,
} from './shared'

const V32_DIALECT_PREFIX = 'https://spec.openapis.org/oas/3.2/dialect/'
const V31_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base'

// Both versions use JSON Schema 2020-12, so a schema only changes in
// `discriminator` and `xml`. These keywords hold the subschemas to look into.
const SUBSCHEMA_KEYWORDS = [
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]
const SUBSCHEMA_MAP_KEYWORDS = ['$defs', 'dependentSchemas', 'patternProperties', 'properties']
const SUBSCHEMA_LIST_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']

// Matches every `$ref` that may point past a removed querystring parameter or
// into a lone `itemSchema`, since a pointer without `%` holds its keys as
// written.
const MAY_MOVE = /%|itemSchema|parameters\/\d/

const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertMediaTypeEntry)
const convertServers = list(convertServer)

const DISCRIMINATOR_FIELDS = defineFields({
  defaultMapping: DROP,
})

const SCHEMA_FIELDS = defineFields({
  ...Object.fromEntries(SUBSCHEMA_KEYWORDS.map((key) => [key, convertSchema])),
  ...Object.fromEntries(SUBSCHEMA_MAP_KEYWORDS.map((key) => [key, map(convertSchema)])),
  ...Object.fromEntries(SUBSCHEMA_LIST_KEYWORDS.map((key) => [key, list(convertSchema)])),
  $ref: (item, ctx, schema) => {
    moveLater(item, ctx, () => ctx.seen.get(SCHEMA_FIELDS)?.get(schema))
    return clone(item)
  },
  discriminator: (item, ctx) => convertObject(item, ctx, DISCRIMINATOR_FIELDS),
  xml: convertXml,
})

const SERVER_FIELDS = defineFields({
  name: DROP,
})

const TAG_FIELDS = defineFields({
  kind: DROP,
  parent: DROP,
  summary: DROP,
})

const EXAMPLE_FIELDS = defineFields({
  dataValue: DROP,
  serializedValue: DROP,
})

const PARAMETER_FIELDS = defineFields({
  allowReserved: (item, _ctx, parameter) => (parameter.in === 'query' ? clone(item) : DROP),
  content: convertContent,
  examples: map(refOr(convertExample)),
  schema: convertSchema,
  style: (item) => (item === 'cookie' ? DROP : clone(item)),
})

const ENCODING_FIELDS = defineFields({
  encoding: DROP,
  headers: map(convertParameterRef),
  itemEncoding: DROP,
  prefixEncoding: DROP,
})

const MEDIA_TYPE_FIELDS = defineFields({
  description: DROP,
  encoding: map(convertEncoding),
  examples: map(refOr(convertExample)),
  itemEncoding: DROP,
  itemSchema: DROP,
  prefixEncoding: DROP,
  schema: convertSchema,
})

const REQUEST_BODY_FIELDS = defineFields({
  content: convertContent,
})

const RESPONSE_FIELDS = defineFields({
  content: convertContent,
  headers: map(convertParameterRef),
  links: map(refOr(convertLink)),
  summary: DROP,
})

const LINK_FIELDS = defineFields({
  server: convertServer,
})

const FLOWS_FIELDS = defineFields({
  deviceAuthorization: DROP,
})

const SECURITY_SCHEME_FIELDS = defineFields({
  deprecated: DROP,
  flows: (item, ctx) => convertObject(item, ctx, FLOWS_FIELDS),
  oauth2MetadataUrl: DROP,
})

const OPERATION_FIELDS = defineFields({
  callbacks: map(refOr(convertCallback)),
  parameters: list(convertParameterRef),
  requestBody: refOr(convertRequestBody),
  responses: map(refOr(convertResponse), isNotExtension),
  servers: convertServers,
})

const PATH_ITEM_FIELDS = defineFields({
  ...Object.fromEntries(HTTP_METHODS.map((method) => [method, convertOperation])),
  additionalOperations: DROP,
  parameters: list(convertParameterRef),
  query: DROP,
  servers: convertServers,
})

const COMPONENTS_FIELDS = defineFields({
  callbacks: map(refOr(convertCallback)),
  examples: map(refOr(convertExample)),
  headers: map(convertParameterRef),
  links: map(refOr(convertLink)),
  mediaTypes: DROP,
  parameters: map(convertParameterRef),
  pathItems: map(convertPathItem),
  requestBodies: map(refOr(convertRequestBody)),
  responses: map(refOr(convertResponse)),
  schemas: map(convertSchema),
  securitySchemes: map(refOr(convertSecurityScheme)),
})

const DOCUMENT_FIELDS = defineFields({
  $self: DROP,
  components: (item, ctx) => convertObject(item, ctx, COMPONENTS_FIELDS),
  jsonSchemaDialect: (item) =>
    typeof item === 'string' && item.startsWith(V32_DIALECT_PREFIX) ? V31_DIALECT : clone(item),
  paths: map(convertPathItem, isPath),
  servers: convertServers,
  tags: list(convertTag),
  webhooks: map(convertPathItem),
})

// Whether `value` was converted with `fields`, unlike a copy such as an
// extension.
function isConverted(value: unknown, fields: Fields, ctx: Context): boolean {
  return isRecord(value) && ctx.seen.get(fields)?.has(value) === true
}

// Where `ref` points once querystring parameters have left their lists,
// shifting the entries after them, and each lone `itemSchema` has become
// `schema.items`. Only the keys that move are rewritten. A `$ref` into a
// removed parameter gets `-`, which names no array element (RFC 6901), so it
// dangles instead of reaching the next parameter.
function moveRef(ref: string, ctx: Context): string {
  const keys = pointerKeys(ref)
  if (keys === undefined) {
    return ref
  }
  // The keys as written. One holds a `/` only as `~1`, so each `/` or `%2F`
  // separates two.
  const written = ref.slice(1).split(/\/|%2f/i)
  let moved = false
  let inList = false
  let node = ctx.root
  for (const [i, key] of keys.entries()) {
    const next = child(node, key)
    if (next === undefined) {
      return ref
    }
    let to = key
    const index = Number(key)
    if (inList && Array.isArray(node) && Number.isInteger(index)) {
      to = isQuerystring(node[index], ctx)
        ? '-'
        : String(node.slice(0, index).filter((item) => !isQuerystring(item, ctx)).length)
    } else if (
      key === 'itemSchema' &&
      isConverted(node, MEDIA_TYPE_FIELDS, ctx) &&
      hasLoneItemSchema(node as Record<string, unknown>)
    ) {
      to = 'schema/items'
    }
    if (to !== key) {
      written[i + 1] = to
      moved = true
    }
    inList =
      key === 'parameters' &&
      (isConverted(node, PATH_ITEM_FIELDS, ctx) || isConverted(node, OPERATION_FIELDS, ctx))
    node = next
  }
  return moved ? `#${written.join('/')}` : ref
}

// A `$ref` can come before its target, so it moves once the whole input is
// converted, in the output that `holder` then returns.
function moveLater(
  ref: unknown,
  ctx: Context,
  holder: () => Record<string, unknown> | undefined,
): void {
  if (typeof ref === 'string' && MAY_MOVE.test(ref)) {
    ctx.after.push(() => {
      const out = holder()
      if (out !== undefined) {
        out.$ref = moveRef(ref, ctx)
      }
    })
  }
}

/** Reference Objects are the same in 3.1, so they are copied, and only their `$ref` may move. */
function convertReference(value: unknown, ctx: Context): unknown {
  const out = clone(value) as Record<string, unknown>
  moveLater(out.$ref, ctx, () => out)
  return out
}

function refOr(convert: Convert): Convert {
  return (value, ctx) =>
    getRef(value) === undefined ? convert(value, ctx) : convertReference(value, ctx)
}

function convertSchema(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, SCHEMA_FIELDS)
}

function convertXml(value: unknown, _ctx: Context, schema: Record<string, unknown>): unknown {
  if (!isRecord(value)) {
    return clone(value)
  }
  const { nodeType, ...out } = clone(value) as Record<string, unknown>
  if (nodeType === 'attribute') {
    out.attribute = true
  } else if (nodeType === 'element' && hasType(schema.type, 'array')) {
    out.wrapped = true
  }
  return out
}

function convertServer(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, SERVER_FIELDS)
}

// A summary stands in for the description it lacks.
function finishTag(out: Record<string, unknown>, tag: Record<string, unknown>): void {
  if (out.description === undefined && typeof tag.summary === 'string') {
    out.description = tag.summary
  }
}

function convertTag(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, TAG_FIELDS, finishTag)
}

function finishExample(out: Record<string, unknown>, example: Record<string, unknown>): void {
  if (example.value === undefined && example.externalValue === undefined) {
    const value = example.dataValue !== undefined ? example.dataValue : example.serializedValue
    if (value !== undefined) {
      out.value = clone(value)
    }
  }
}

function convertExample(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, EXAMPLE_FIELDS, finishExample)
}

// Whether the parameter, or the one its `$ref` resolves to, is in the
// querystring, which 3.1 lacks.
function isQuerystring(parameter: unknown, ctx: Context): boolean {
  const ref = getRef(parameter)
  const target = ref === undefined ? parameter : resolve(ref, ctx)
  return isRecord(target) && target.in === 'querystring'
}

// 3.1 allows these only beside `schema`. The media type in `content`
// carries its own examples and serialization.
function finishParameter(out: Record<string, unknown>, parameter: Record<string, unknown>): void {
  if (parameter.content !== undefined) {
    delete out.allowReserved
    delete out.example
    delete out.examples
    delete out.explode
    delete out.style
  }
}

function convertParameter(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, PARAMETER_FIELDS, finishParameter)
}

function convertParameterRef(value: unknown, ctx: Context): unknown {
  if (isQuerystring(value, ctx)) {
    return DROP
  }
  return getRef(value) === undefined ? convertParameter(value, ctx) : convertReference(value, ctx)
}

function convertEncoding(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, ENCODING_FIELDS)
}

function hasLoneItemSchema(mediaType: Record<string, unknown>): boolean {
  return mediaType.itemSchema !== undefined && mediaType.schema === undefined
}

function finishMediaType(
  out: Record<string, unknown>,
  mediaType: Record<string, unknown>,
  ctx: Context,
): void {
  if (hasLoneItemSchema(mediaType)) {
    out.schema = { items: convertSchema(mediaType.itemSchema, ctx), type: 'array' }
  }
}

function convertMediaType(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, MEDIA_TYPE_FIELDS, finishMediaType)
}

// A 3.1 content map cannot hold a `$ref`, such as one to `components.mediaTypes`.
function convertMediaTypeEntry(value: unknown, ctx: Context): unknown {
  const ref = getRef(value)
  return ref === undefined ? convertMediaType(value, ctx) : inline(ref, ctx, convertMediaTypeEntry)
}

function convertRequestBody(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, REQUEST_BODY_FIELDS)
}

// 3.1 requires a description, which a summary can stand in for.
function finishResponse(out: Record<string, unknown>, response: Record<string, unknown>): void {
  if (out.description === undefined) {
    out.description = typeof response.summary === 'string' ? response.summary : ''
  }
}

function convertResponse(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, RESPONSE_FIELDS, finishResponse)
}

function convertLink(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, LINK_FIELDS)
}

function convertSecurityScheme(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, SECURITY_SCHEME_FIELDS)
}

function convertOperation(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, OPERATION_FIELDS)
}

function convertPathItem(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, PATH_ITEM_FIELDS)
}

function finishDocument(out: Record<string, unknown>): void {
  out.openapi = '3.1.2'
}

function convertDocument(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, DOCUMENT_FIELDS, finishDocument)
}

export function downgradeSpecV32ToV31(spec: OpenAPIV3_2.OpenAPIObject): OpenAPIV3_1.OpenAPIObject {
  return downgrade(spec, convertDocument) as OpenAPIV3_1.OpenAPIObject
}

export function downgradeSchemaV32ToV31<T = unknown>(
  schema: OpenAPIV3_2.SchemaObject<T>,
): OpenAPIV3_1.SchemaObject<T> {
  return downgrade(schema, convertSchema) as OpenAPIV3_1.SchemaObject<T>
}
