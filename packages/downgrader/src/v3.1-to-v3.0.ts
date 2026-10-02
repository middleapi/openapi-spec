import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'
import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import type { Context } from './shared'
import {
  allOfItems,
  child,
  clone,
  convertMappingRef,
  convertObject,
  convertXml,
  defineFields,
  downgrade,
  DROP,
  enterSchema,
  getRef,
  hasDanglingOperationRef,
  hasType,
  HTTP_METHODS,
  inlineSchema,
  isNotExtension,
  isPath,
  isRecord,
  keepSchemaRef,
  list,
  map,
  mergeRef,
  placeholder,
  rebasedRef,
  refOr,
  removedPrefixes,
  resourceOf,
  setOwn,
} from './shared'

const LOOSENING_KEYWORDS = new Set([
  '$dynamicRef',
  'contains',
  'dependentRequired',
  'dependentSchemas',
  'else',
  'if',
  'maxContains',
  'minContains',
  'patternProperties',
  'prefixItems',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

const ANNOTATION_KEYWORDS = [
  '$anchor',
  '$comment',
  '$defs',
  '$dynamicAnchor',
  '$id',
  '$schema',
  '$vocabulary',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'examples',
]

const FORM_MEDIA_TYPE = /^(?:multipart\/|application\/x-www-form-urlencoded\s*(?:;|$))/i

const CONTENT_TYPE_OVERRIDES = ['allowReserved', 'contentType', 'explode', 'style']

const LOOSE = new WeakSet<object>()

const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertMediaType)
const convertRequestContent = map(convertRequestMediaType)
const convertRequirements = list(convertRequirement)
const finishPathItem = mergeRef(convertPathItem)
const convertCallbackRef = refOr(convertCallback, reference)
const convertExampleRef = refOr(clone, reference)
const convertLinkRef = refOr(convertLink, reference)
const convertParameterRef = refOr(convertParameter, reference)
const convertRequestBodyRef = refOr(convertRequestBody, reference)
const convertResponseRef = refOr(convertResponse, reference)
const convertSecuritySchemeRef = refOr(convertSecurityScheme, reference)

const DISCRIMINATOR_FIELDS = defineFields({
  mapping: map(convertMappingRef),
})

const SCHEMA_FIELDS = defineFields({
  ...Object.fromEntries([...LOOSENING_KEYWORDS, ...ANNOTATION_KEYWORDS].map(key => [key, DROP])),
  $ref: item => (typeof item === 'string' ? DROP : clone(item)),
  additionalProperties: (item, ctx, schema) => {
    if ('patternProperties' in schema) {
      return DROP
    }
    return typeof item === 'boolean' ? item : convertSchema(item, ctx)
  },
  allOf: list(convertSchema),
  anyOf: list(convertSchema),
  const: DROP,
  discriminator: (item, ctx) => convertObject(item, ctx, DISCRIMINATOR_FIELDS),
  enum: item => (Array.isArray(item) && item.length === 0 ? DROP : clone(item)),
  exclusiveMaximum: item => (typeof item === 'number' ? DROP : clone(item)),
  exclusiveMinimum: item => (typeof item === 'number' ? DROP : clone(item)),
  items: (item, ctx, schema) => ('prefixItems' in schema ? DROP : convertSchema(item, ctx)),
  not: convertSchema,
  nullable: DROP,
  oneOf: list(convertSchema),
  properties: map(convertSchema),
  required: (item) => {
    if (!Array.isArray(item)) {
      return clone(item)
    }
    return item.length === 0 ? DROP : clone([...new Set(item)])
  },
  type: DROP,
  xml: convertXml,
})

const PARAMETER_FIELDS = defineFields({
  content: convertContent,
  examples: map(convertExampleRef),
  schema: convertSchema,
})

const MEDIA_TYPE_FIELDS = defineFields({
  encoding: map(convertEncoding),
  examples: map(convertExampleRef),
  schema: convertSchema,
})

const FORM_MEDIA_TYPE_FIELDS = new Map(MEDIA_TYPE_FIELDS)

const ENCODING_FIELDS = defineFields({
  headers: map(convertParameterRef),
})

const REQUEST_BODY_FIELDS = defineFields({
  content: convertRequestContent,
})

const RESPONSE_FIELDS = defineFields({
  content: convertContent,
  headers: map(convertParameterRef),
  links: map(convertLinkRef),
})

const OPERATION_FIELDS = defineFields({
  callbacks: map(convertCallbackRef),
  parameters: list(convertParameterRef),
  requestBody: convertRequestBodyRef,
  responses: map(convertResponseRef, isNotExtension),
  security: convertSecurity,
})

const PATH_ITEM_FIELDS = defineFields({
  ...Object.fromEntries(HTTP_METHODS.map(method => [method, convertOperation])),
  parameters: list(convertParameterRef),
})

const COMPONENTS_FIELDS = defineFields({
  callbacks: map(convertCallbackRef),
  examples: map(convertExampleRef),
  headers: map(convertParameterRef),
  links: map(convertLinkRef),
  parameters: map(convertParameterRef),
  pathItems: DROP,
  requestBodies: map(convertRequestBodyRef),
  responses: map(convertResponseRef),
  schemas: map(convertSchema),
  securitySchemes: map(convertSecuritySchemeRef),
})

const LICENSE_FIELDS = defineFields({
  identifier: DROP,
})

const INFO_FIELDS = defineFields({
  license: (item, ctx) => convertObject(item, ctx, LICENSE_FIELDS),
  summary: DROP,
})

const DOCUMENT_FIELDS = defineFields({
  components: (item, ctx) => convertObject(item, ctx, COMPONENTS_FIELDS),
  info: (item, ctx) => convertObject(item, ctx, INFO_FIELDS),
  jsonSchemaDialect: DROP,
  paths: map(convertPathItem, isPath),
  security: convertSecurity,
  webhooks: DROP,
})

const REMOVED = removedPrefixes({ '': DOCUMENT_FIELDS, '/components': COMPONENTS_FIELDS })

function reference(value: Record<string, unknown>): unknown {
  return { $ref: value.$ref }
}

function isLoose(value: unknown): boolean {
  return LOOSE.has(value as object)
}

function hasLoose(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.values(value).some(isLoose)
}

function loosened(out: object): object {
  LOOSE.add(out)
  return out
}

function isLooseSchema(out: Record<string, unknown>, schema: Record<string, unknown>): boolean {
  return Object.keys(schema).some(key => LOOSENING_KEYWORDS.has(key))
    || (Array.isArray(schema.enum) && schema.enum.length === 0)
    || isLoose(out.items)
    || isLoose(out.additionalProperties)
    || hasLoose(out.properties)
    || hasLoose(out.allOf)
    || hasLoose(out.anyOf)
}

function addAnyOf(out: Record<string, unknown>, variants: unknown): void {
  if (out.anyOf === undefined) {
    out.anyOf = variants
  }
  else {
    out.allOf = [...allOfItems(out.allOf), { anyOf: variants }]
  }
}

function convertSchemaRef(ref: string, ctx: Context): unknown {
  const kept = keepSchemaRef(ref, ctx)
  if (kept !== undefined) {
    return { $ref: kept }
  }
  const out = inlineSchema(ref, ctx, convertSchema)
  return out === DROP ? loosened({}) : out
}

// 3.0 applies `items` and `xml.wrapped` only beside `type: array`, so a type
// union moves them into its array branch. The rest of `xml` names the element
// whatever the type, so it stays.
function takeArrayFields(out: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = { items: out.items ?? {} }
  delete out.items
  if (isRecord(out.xml) && Object.hasOwn(out.xml, 'wrapped')) {
    const { wrapped: _, ...xml } = out.xml
    fields.xml = out.xml
    out.xml = xml
  }
  return fields
}

function convertType(out: Record<string, unknown>, type: unknown): boolean {
  if (typeof type === 'string' && type !== 'null') {
    out.type = type
    return false
  }
  const types = (Array.isArray(type) ? type : [type]).filter(item => typeof item === 'string')
  if (types.length === 0) {
    if (type !== undefined && !(Array.isArray(type) && type.length === 0)) {
      out.type = clone(type)
    }
    return false
  }
  const nullable = types.includes('null')
  const rest = [...new Set(types.filter(item => item !== 'null'))]
  if (rest.length === 1) {
    out.type = rest[0]
    if (nullable) {
      out.nullable = true
    }
  }
  else if (rest.length > 1) {
    const arrayFields = rest.includes('array') && takeArrayFields(out)
    addAnyOf(out, rest.map(item => ({
      type: item,
      ...(item === 'array' && arrayFields),
      ...(nullable && { nullable: true }),
    })))
  }
  else if (out.enum === undefined) {
    out.enum = [null]
  }
  else if (!Array.isArray(out.enum)) {
    return true
  }
  else if (out.enum.includes(null)) {
    out.enum = [null]
  }
  else {
    out.not = {}
  }
  return false
}

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>, ctx: Context): unknown {
  if (typeof schema.$ref === 'string') {
    out.allOf = [convertSchemaRef(schema.$ref, ctx), ...allOfItems(out.allOf)]
  }
  let loose = isLooseSchema(out, schema)
  if (isLoose(out.not)) {
    delete out.not
    loose = true
  }
  if (hasLoose(out.oneOf)) {
    addAnyOf(out, out.oneOf)
    delete out.oneOf
    loose = true
  }
  if ('const' in schema) {
    loose ||= 'enum' in schema && !(Array.isArray(schema.enum) && schema.enum.includes(schema.const))
    out.enum = [clone(schema.const)]
  }
  loose = convertType(out, schema.type) || loose
  const { exclusiveMaximum, exclusiveMinimum, maximum, minimum } = schema
  if (typeof exclusiveMinimum === 'number' && !(typeof minimum === 'number' && minimum > exclusiveMinimum)) {
    out.minimum = exclusiveMinimum
    out.exclusiveMinimum = true
  }
  if (typeof exclusiveMaximum === 'number' && !(typeof maximum === 'number' && maximum < exclusiveMaximum)) {
    out.maximum = exclusiveMaximum
    out.exclusiveMaximum = true
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0 && !('example' in schema)) {
    out.example = clone(schema.examples[0])
  }
  const format = schema.contentEncoding === 'base64'
    ? 'byte'
    : schema.contentEncoding === undefined && typeof schema.contentMediaType === 'string' ? 'binary' : undefined
  if (format !== undefined && (schema.type === undefined || hasType(schema.type, 'string'))) {
    out.format ??= format
    if (schema.type === undefined) {
      out.type = 'string'
    }
  }
  if (out.type === 'array' && out.items === undefined) {
    out.items = placeholder()
  }
  return loose ? loosened(out) : out
}

function convertSchema(value: unknown, ctx: Context): unknown {
  if (typeof value === 'boolean') {
    return value ? {} : { not: {} }
  }
  const ref = getRef(value)
  if (ref !== undefined && Object.keys(value as object).length === 1) {
    return convertSchemaRef(ref, ctx)
  }
  const cyclic = ctx.converting.includes(value)
  const out = convertObject(value, enterSchema(value, ctx, false), SCHEMA_FIELDS, finishSchema)
  return cyclic ? loosened(out === DROP ? {} : out as object) : out
}

function finishParameter(out: Record<string, unknown>, parameter: Record<string, unknown>): unknown {
  if (parameter.in === 'path') {
    out.required = true
  }
  return out
}

function convertParameter(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, PARAMETER_FIELDS, finishParameter)
}

function convertMediaType(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, MEDIA_TYPE_FIELDS)
}

// Adds `schema` to `nodes` with the base its own `$ref`s resolve against: its
// own `$id`, or else `base`, the one around it. The first place found wins.
function place(nodes: Map<unknown, string>, schema: unknown, base: string, ctx: Context): void {
  if (!nodes.has(schema)) {
    nodes.set(schema, resourceOf(schema, ctx) ?? base)
  }
}

// Adds to `nodes` each schema they apply through `$ref`, `allOf`, `anyOf`,
// and `oneOf`.
function addSubschemas(nodes: Map<unknown, string>, ctx: Context): Map<unknown, string> {
  for (const [node, base] of nodes) {
    if (isRecord(node)) {
      const ref = rebasedRef(node, base)
      if (ref !== undefined) {
        const location = ctx.locate(ref)
        place(nodes, location.target, location.base, ctx)
      }
      for (const key of ['allOf', 'anyOf', 'oneOf']) {
        for (const item of Array.isArray(node[key]) ? node[key] : []) {
          place(nodes, item, base, ctx)
        }
      }
    }
  }
  return nodes
}

function formParts(schema: unknown, ctx: Context): Map<string, Map<unknown, string>> {
  const parts = new Map<string, Map<unknown, string>>()
  const body = new Map<unknown, string>()
  place(body, schema, ctx.base, ctx)
  for (const [node, base] of addSubschemas(body, ctx)) {
    if (isRecord(node) && isRecord(node.properties)) {
      for (const [name, property] of Object.entries(node.properties)) {
        let part = parts.get(name)
        if (part === undefined) {
          part = new Map()
          parts.set(name, part)
        }
        place(part, property, base, ctx)
      }
    }
  }
  return parts
}

function defaultsToOctetStream(schemas: Map<unknown, string>, ctx: Context, isItem = false): boolean {
  const bases = addSubschemas(schemas, ctx)
  const nodes = [...bases.keys()]
  if (!nodes.every(node => isRecord(node) || node === true)) {
    return false
  }
  const records = nodes.filter(isRecord)
  const types = records.flatMap(node => [node.type ?? []].flat())
  const kinds = new Set(types.filter(type => type !== 'null'))
  if (types.length === 0) {
    return true
  }
  if (kinds.size !== 1) {
    return false
  }
  if (kinds.has('string')) {
    return records.some(node => node.contentEncoding !== undefined)
  }
  if (isItem || !kinds.has('array')) {
    return false
  }
  const items = new Map<unknown, string>()
  for (const [node, base] of bases) {
    for (const item of [child(node, 'prefixItems') ?? [], child(node, 'items') ?? []].flat()) {
      place(items, item, base, ctx)
    }
  }
  return items.size === 0 || defaultsToOctetStream(items, ctx, true)
}

function finishFormMediaType(out: Record<string, unknown>, mediaType: Record<string, unknown>, ctx: Context): unknown {
  const encoding = out.encoding ?? {}
  if (!isRecord(encoding)) {
    return out
  }
  for (const [name, schemas] of formParts(mediaType.schema, ctx)) {
    const entry = child(encoding, name) ?? {}
    if (
      isRecord(entry)
      && !CONTENT_TYPE_OVERRIDES.some(key => Object.hasOwn(entry, key))
      && defaultsToOctetStream(schemas, ctx)
    ) {
      setOwn(encoding, name, { ...entry, contentType: 'application/octet-stream' })
      out.encoding = encoding
    }
  }
  return out
}

function convertRequestMediaType(value: unknown, ctx: Context, type: string): unknown {
  return FORM_MEDIA_TYPE.test(type)
    ? convertObject(value, ctx, FORM_MEDIA_TYPE_FIELDS, finishFormMediaType)
    : convertMediaType(value, ctx)
}

function convertEncoding(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, ENCODING_FIELDS)
}

function convertRequestBody(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, REQUEST_BODY_FIELDS)
}

function convertResponse(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, RESPONSE_FIELDS)
}

function convertLink(value: unknown, ctx: Context): unknown {
  return hasDanglingOperationRef(value, ctx) ? DROP : clone(value)
}

function finishOperation(out: Record<string, unknown>): unknown {
  out.responses ??= { default: { description: '' } }
  return out
}

function convertOperation(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, OPERATION_FIELDS, finishOperation)
}

function convertPathItem(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, PATH_ITEM_FIELDS, finishPathItem)
}

function schemeType(name: string, ctx: Context): unknown {
  let scheme = child(ctx.resolve('#/components/securitySchemes'), name)
  const ref = getRef(scheme)
  if (ref !== undefined) {
    const end = ctx.aliasEnd(ref)
    scheme = end === undefined ? undefined : ctx.resolve(end)
  }
  return isRecord(scheme) ? scheme.type : undefined
}

function convertSecurityScheme(value: unknown): unknown {
  return isRecord(value) && value.type === 'mutualTLS' ? DROP : clone(value)
}

function convertRequirement(value: unknown, ctx: Context): unknown {
  if (!isRecord(value)) {
    return clone(value)
  }
  const out: Record<string, unknown> = {}
  let removed = false
  for (const [name, scopes] of Object.entries(value)) {
    const type = schemeType(name, ctx)
    if (type === 'mutualTLS') {
      removed = true
    }
    else {
      setOwn(out, name, Array.isArray(scopes) && (type === 'apiKey' || type === 'http') ? [] : clone(scopes))
    }
  }
  return removed && Object.keys(out).length === 0 ? DROP : out
}

function convertSecurity(value: unknown, ctx: Context): unknown {
  const out = convertRequirements(value, ctx)
  return Array.isArray(value) && value.length > 0 && (out as unknown[]).length === 0 ? DROP : out
}

function finishDocument(out: Record<string, unknown>): unknown {
  out.openapi = '3.0.4'
  out.paths ??= {}
  return out
}

function convertDocument(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, DOCUMENT_FIELDS, finishDocument)
}

export function downgradeSpecV31ToV30(spec: OpenAPIV3_1.OpenAPIObject): OpenAPIV3_0.OpenAPIObject {
  return downgrade(spec, convertDocument, REMOVED) as OpenAPIV3_0.OpenAPIObject
}

export function downgradeSchemaV31ToV30<T = unknown>(schema: OpenAPIV3_1.SchemaObject<T>): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return downgrade(schema, convertSchema) as OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T>
}
