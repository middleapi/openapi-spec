import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import type { Context } from './shared'
import {
  allOfItems,
  clone,
  convertMappingRef,
  convertObject,
  convertXml,
  defineFields,
  downgrade,
  DROP,
  getRef,
  hasDanglingOperationRef,
  HTTP_METHODS,
  inline,
  inlineSchema,
  isNotExtension,
  isPath,
  isRecord,
  list,
  map,
  mergeRef,
  refOr,
  removedPrefixes,
  skipAliases,
} from './shared'

const V32_DIALECT_PREFIX = 'https://spec.openapis.org/oas/3.2/dialect/'
const V31_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base'

const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertContentEntry)
const convertServers = list(convertServer)
const finishPathItem = mergeRef(convertPathItem)
const convertCallbackRef = refOr(convertCallback)
const convertExampleRef = refOr(convertExample)
const convertLinkRef = refOr(convertLink)
const convertParameterRef = refOr(convertParameter)
const convertRequestBodyRef = refOr(convertRequestBody)
const convertResponseRef = refOr(convertResponse)
const convertSecuritySchemeRef = refOr(convertSecurityScheme)

const SERVER_FIELDS = defineFields({
  name: DROP,
})

const TAG_FIELDS = defineFields({
  kind: DROP,
  parent: DROP,
  summary: DROP,
})

const DISCRIMINATOR_FIELDS = defineFields({
  defaultMapping: DROP,
  mapping: map(convertMappingRef),
})

const SCHEMA_FIELDS = defineFields({
  $defs: map(convertSchema),
  $ref: (item, ctx) => (typeof item === 'string' && ctx.dangles(item) ? DROP : clone(item)),
  additionalProperties: convertSchema,
  allOf: list(convertSchema),
  anyOf: list(convertSchema),
  contains: convertSchema,
  contentSchema: convertSchema,
  dependentSchemas: map(convertSchema),
  discriminator: (item, ctx) => convertObject(item, ctx, DISCRIMINATOR_FIELDS),
  else: convertSchema,
  if: convertSchema,
  items: convertSchema,
  not: convertSchema,
  oneOf: list(convertSchema),
  patternProperties: map(convertSchema),
  prefixItems: list(convertSchema),
  properties: map(convertSchema),
  propertyNames: convertSchema,
  then: convertSchema,
  unevaluatedItems: convertSchema,
  unevaluatedProperties: convertSchema,
  xml: convertXml,
})

const EXAMPLE_FIELDS = defineFields({
  dataValue: DROP,
  serializedValue: DROP,
})

const PARAMETER_FIELDS = defineFields({
  allowReserved: (item, _ctx, parameter) => (!('in' in parameter) || parameter.in === 'query' ? clone(item) : DROP),
  content: convertContent,
  examples: map(convertExampleRef),
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
  examples: map(convertExampleRef),
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
  links: map(convertLinkRef),
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
  callbacks: map(convertCallbackRef),
  parameters: list(convertParameterRef),
  requestBody: convertRequestBodyRef,
  responses: map(convertResponseRef, isNotExtension),
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
  callbacks: map(convertCallbackRef),
  examples: map(convertExampleRef),
  headers: map(convertParameterRef),
  links: map(convertLinkRef),
  mediaTypes: DROP,
  parameters: map(convertParameterRef),
  pathItems: map(convertPathItem),
  requestBodies: map(convertRequestBodyRef),
  responses: map(convertResponseRef),
  schemas: map(convertSchema),
  securitySchemes: map(convertSecuritySchemeRef),
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

const REMOVED = removedPrefixes({ '': DOCUMENT_FIELDS, '/components': COMPONENTS_FIELDS })

function convertServer(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, SERVER_FIELDS)
}

function convertTag(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, TAG_FIELDS)
}

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>, ctx: Context): unknown {
  if (ctx.identified.has(schema)) {
    delete out.$id
    delete out.$anchor
    delete out.$dynamicAnchor
  }
  else if ('$id' in schema || '$anchor' in schema || '$dynamicAnchor' in schema) {
    ctx.identified.add(schema)
  }
  if (typeof schema.$ref === 'string' && !('$ref' in out)) {
    const target = inlineSchema(schema.$ref, ctx, convertSchema)
    if (target !== DROP) {
      out.allOf = [...allOfItems(out.allOf), target]
    }
  }
  return out
}

function convertSchema(value: unknown, ctx: Context): unknown {
  const ref = getRef(value)
  const out = ref !== undefined && Object.keys(value as object).length === 1 && ctx.dangles(ref)
    ? inlineSchema(ref, ctx, convertSchema)
    : convertObject(value, ctx, SCHEMA_FIELDS, finishSchema)
  return out === DROP ? {} : out
}

function finishExample(out: Record<string, unknown>, example: Record<string, unknown>): unknown {
  if (!('value' in example || 'externalValue' in example)) {
    if ('dataValue' in example) {
      out.value = clone(example.dataValue)
    }
    else if ('serializedValue' in example) {
      out.value = clone(example.serializedValue)
    }
  }
  return out
}

function convertExample(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, EXAMPLE_FIELDS, finishExample)
}

function finishParameter(out: Record<string, unknown>, parameter: Record<string, unknown>): unknown {
  if (!isRecord(parameter.content)) {
    return out
  }
  if (Object.keys(out.content as object).length === 0) {
    return Object.keys(parameter.content).length > 0 ? DROP : out
  }
  delete out.example
  delete out.examples
  return out
}

function convertParameter(value: unknown, ctx: Context): unknown {
  if (isRecord(value) && value.in === 'querystring') {
    return DROP
  }
  return convertObject(value, ctx, PARAMETER_FIELDS, finishParameter)
}

function convertEncoding(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, ENCODING_FIELDS)
}

function finishMediaType(out: Record<string, unknown>, mediaType: Record<string, unknown>, ctx: Context): unknown {
  if ('itemSchema' in mediaType && !('schema' in mediaType)) {
    out.schema = { items: convertSchema(mediaType.itemSchema, ctx), type: 'array' }
  }
  return out
}

function convertMediaType(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, MEDIA_TYPE_FIELDS, finishMediaType)
}

function convertContentEntry(value: unknown, ctx: Context): unknown {
  const ref = getRef(value)
  return ref === undefined ? convertMediaType(value, ctx) : inline(skipAliases(ref, ctx, () => true), ctx, convertContentEntry)
}

function convertRequestBody(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, REQUEST_BODY_FIELDS)
}

function finishResponse(out: Record<string, unknown>, response: Record<string, unknown>): unknown {
  if (!('description' in out)) {
    out.description = typeof response.summary === 'string' ? response.summary : ''
  }
  return out
}

function convertResponse(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, RESPONSE_FIELDS, finishResponse)
}

function convertLink(value: unknown, ctx: Context): unknown {
  return hasDanglingOperationRef(value, ctx) ? DROP : convertObject(value, ctx, LINK_FIELDS)
}

function convertSecurityScheme(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, SECURITY_SCHEME_FIELDS)
}

function convertOperation(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, OPERATION_FIELDS)
}

function convertPathItem(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, PATH_ITEM_FIELDS, finishPathItem)
}

function finishDocument(out: Record<string, unknown>): unknown {
  out.openapi = '3.1.2'
  return out
}

function convertDocument(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, DOCUMENT_FIELDS, finishDocument)
}

export function downgradeSpecV32ToV31(spec: OpenAPIV3_2.OpenAPIObject): OpenAPIV3_1.OpenAPIObject {
  return downgrade(spec, convertDocument, REMOVED) as OpenAPIV3_1.OpenAPIObject
}

export function downgradeSchemaV32ToV31<T = unknown>(schema: OpenAPIV3_2.SchemaObject<T>): OpenAPIV3_1.SchemaObject<T> {
  return downgrade(schema, convertSchema) as OpenAPIV3_1.SchemaObject<T>
}
