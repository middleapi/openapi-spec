import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import type { Context, Convert } from './shared'
import {
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
  resolve,
} from './shared'

const V32_DIALECT_PREFIX = 'https://spec.openapis.org/oas/3.2/dialect/'
const V31_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base'

// Both versions use JSON Schema 2020-12, so a schema only changes in
// `discriminator` and `xml`. These keywords hold the subschemas to look into.
const SUBSCHEMA_KEYWORDS = ['additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'items', 'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties']
const SUBSCHEMA_MAP_KEYWORDS = ['$defs', 'dependentSchemas', 'patternProperties', 'properties']
const SUBSCHEMA_LIST_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']

const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertMediaTypeEntry)
const convertServers = list(convertServer)

const DISCRIMINATOR_FIELDS = defineFields({
  defaultMapping: DROP,
})

const SCHEMA_FIELDS = defineFields({
  ...Object.fromEntries(SUBSCHEMA_KEYWORDS.map(key => [key, convertSchema])),
  ...Object.fromEntries(SUBSCHEMA_MAP_KEYWORDS.map(key => [key, map(convertSchema)])),
  ...Object.fromEntries(SUBSCHEMA_LIST_KEYWORDS.map(key => [key, list(convertSchema)])),
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
  style: item => (item === 'cookie' ? DROP : clone(item)),
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
  ...Object.fromEntries(HTTP_METHODS.map(method => [method, convertOperation])),
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
  jsonSchemaDialect: item => (typeof item === 'string' && item.startsWith(V32_DIALECT_PREFIX) ? V31_DIALECT : clone(item)),
  paths: map(convertPathItem, isPath),
  servers: convertServers,
  tags: list(convertTag),
  webhooks: map(convertPathItem),
})

/** Reference Objects are the same in 3.1, so they are copied as they are. */
function refOr(convert: Convert): Convert {
  return (value, ctx) => (getRef(value) === undefined ? convert(value, ctx) : clone(value))
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
  }
  else if (nodeType === 'element' && hasType(schema.type, 'array')) {
    out.wrapped = true
  }
  return out
}

function convertServer(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, SERVER_FIELDS)
}

function convertTag(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, TAG_FIELDS)
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

function isQuerystring(parameter: unknown): boolean {
  return isRecord(parameter) && parameter.in === 'querystring'
}

// 3.1 allows examples only beside `schema`.
function finishParameter(out: Record<string, unknown>, parameter: Record<string, unknown>): void {
  if (parameter.content !== undefined) {
    delete out.example
    delete out.examples
  }
}

function convertParameter(value: unknown, ctx: Context): unknown {
  return isQuerystring(value) ? DROP : convertObject(value, ctx, PARAMETER_FIELDS, finishParameter)
}

function convertParameterRef(value: unknown, ctx: Context): unknown {
  const ref = getRef(value)
  if (ref === undefined) {
    return convertParameter(value, ctx)
  }
  return isQuerystring(resolve(ref, ctx)) ? DROP : clone(value)
}

function convertEncoding(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, ENCODING_FIELDS)
}

function finishMediaType(out: Record<string, unknown>, mediaType: Record<string, unknown>, ctx: Context): void {
  if (mediaType.itemSchema !== undefined && mediaType.schema === undefined) {
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

export function downgradeSchemaV32ToV31<T = unknown>(schema: OpenAPIV3_2.SchemaObject<T>): OpenAPIV3_1.SchemaObject<T> {
  return downgrade(schema, convertSchema) as OpenAPIV3_1.SchemaObject<T>
}
