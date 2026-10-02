import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'
import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

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
  resolvePointer,
} from './shared'

// 3.0 has no place for these, so `$ref`s into them are replaced by their targets.
const REMOVED_PARTS = ['#/webhooks/', '#/components/pathItems/']

const REMOVED_KEYWORDS = [
  '$anchor',
  '$comment',
  '$defs',
  '$dynamicAnchor',
  '$dynamicRef',
  '$id',
  '$schema',
  '$vocabulary',
  'contains',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
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
  // A 3.0 keyword that 3.1 ignores, which would admit null in 3.0.
  'nullable',
  // Rewritten by `finishSchema`.
  '$ref',
  'const',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'type',
]

const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertMediaType)
const convertReference = refOr(clone)

const SCHEMA_FIELDS = defineFields({
  ...Object.fromEntries(REMOVED_KEYWORDS.map(key => [key, DROP])),
  // It would reject the properties that `patternProperties` allowed.
  additionalProperties: (item, ctx, schema) => {
    if (schema.patternProperties !== undefined) {
      return DROP
    }
    return typeof item === 'boolean' ? item : convertSchema(item, ctx)
  },
  allOf: list(convertSchema),
  anyOf: list(convertSchema),
  // `finishSchema` builds it from `prefixItems`.
  items: (item, ctx, schema) => (schema.prefixItems === undefined ? convertSchema(item, ctx) : DROP),
  not: convertSchema,
  oneOf: list(convertSchema),
  properties: map(convertSchema),
  // 3.0 requires at least one entry.
  required: item => (Array.isArray(item) && item.length === 0 ? DROP : clone(item)),
})

const PARAMETER_FIELDS = defineFields({
  content: convertContent,
  examples: map(convertReference),
  schema: convertSchema,
})

const ENCODING_FIELDS = defineFields({
  headers: map(refOr(convertParameter)),
})

const MEDIA_TYPE_FIELDS = defineFields({
  encoding: map((item, ctx) => convertObject(item, ctx, ENCODING_FIELDS)),
  examples: map(convertReference),
  schema: convertSchema,
})

const REQUEST_BODY_FIELDS = defineFields({
  content: convertContent,
})

const RESPONSE_FIELDS = defineFields({
  content: convertContent,
  headers: map(refOr(convertParameter)),
  links: map(convertReference),
})

const OPERATION_FIELDS = defineFields({
  callbacks: map(refOr(convertCallback)),
  parameters: list(refOr(convertParameter)),
  requestBody: refOr(convertRequestBody),
  responses: map(refOr(convertResponse), isNotExtension),
  security: convertSecurity,
})

const PATH_ITEM_FIELDS = defineFields({
  ...Object.fromEntries(HTTP_METHODS.map(method => [method, convertOperation])),
  parameters: list(refOr(convertParameter)),
})

// For a Path Item whose `$ref` `finishMergedPathItem` replaces.
const MERGED_PATH_ITEM_FIELDS = new Map(PATH_ITEM_FIELDS).set('$ref', DROP)

const COMPONENTS_FIELDS = defineFields({
  callbacks: map(refOr(convertCallback)),
  examples: map(convertReference),
  headers: map(refOr(convertParameter)),
  links: map(convertReference),
  parameters: map(refOr(convertParameter)),
  pathItems: DROP,
  requestBodies: map(refOr(convertRequestBody)),
  responses: map(refOr(convertResponse)),
  schemas: map(convertSchema),
  securitySchemes: map((item, ctx) => (isMutualTLS(item, ctx) ? DROP : convertReference(item, ctx))),
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

// A `$ref` into a removed part is replaced by its target, unless it already dangles.
function isInlined(ref: string, ctx: Context): boolean {
  return (ref.includes('/$defs/') || REMOVED_PARTS.some(prefix => ref.startsWith(prefix))) && resolvePointer(ref, ctx) !== undefined
}

/** A 3.0 Reference Object holds only `$ref`. */
function refOr(convert: Convert): Convert {
  const self: Convert = (value, ctx) => {
    const ref = getRef(value)
    if (ref === undefined) {
      return convert(value, ctx)
    }
    return isInlined(ref, ctx) ? inline(ref, ctx, self) : { $ref: ref }
  }
  return self
}

function convertSchemaRef(ref: string, ctx: Context): unknown {
  if (!isInlined(ref, ctx)) {
    return { $ref: ref }
  }
  const out = inline(ref, ctx, convertSchema)
  return out === DROP ? {} : out
}

// 3.0 `items` applies one schema to every item, so a tuple becomes an array
// whose items match any of its item schemas, and those of the items after
// them, unless `items` or `maxItems` allows none.
function convertTuple(prefixItems: unknown[], schema: Record<string, unknown>, ctx: Context): unknown {
  const { items, maxItems } = schema
  const closed = items === false || (typeof maxItems === 'number' && maxItems <= prefixItems.length)
  if (!closed && (items === undefined || items === true)) {
    return {}
  }
  const variants = new Map<unknown, unknown>()
  for (const item of closed ? prefixItems : [...prefixItems, items]) {
    const variant = convertSchema(item, ctx)
    variants.set(jsonKey(variant), variant)
  }
  return variants.size === 1 ? [...variants.values()][0] : { anyOf: [...variants.values()] }
}

// Equal JSON values get the same key. A cyclic value is only equal to itself.
function jsonKey(value: unknown): unknown {
  try {
    return JSON.stringify(value)
  }
  catch {
    return value
  }
}

function addAnyOf(out: Record<string, unknown>, variants: unknown[]): void {
  if (out.anyOf === undefined) {
    out.anyOf = variants
  }
  else {
    out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), { anyOf: variants }]
  }
}

// 3.0 takes one type, and marks null with `nullable` instead.
function convertType(out: Record<string, unknown>, type: unknown): void {
  if (typeof type === 'string' && type !== 'null') {
    out.type = type
    return
  }
  const types = (Array.isArray(type) ? type : [type]).filter(item => typeof item === 'string')
  const nullable = types.includes('null')
  const rest = types.filter(item => item !== 'null')
  if (rest.length === 1) {
    out.type = rest[0]
    if (nullable) {
      out.nullable = true
    }
  }
  else if (rest.length > 1) {
    addAnyOf(out, rest.map(item => ({
      type: item,
      ...(item === 'array' && { items: out.items ?? {} }),
      ...(nullable && { nullable: true }),
    })))
    delete out.items
  }
  else if (nullable) {
    out.enum ??= [null]
  }
}

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>, ctx: Context): void {
  // 3.0 ignores the siblings of a `$ref`, but not the members of an `allOf`.
  if (typeof schema.$ref === 'string') {
    out.allOf = [convertSchemaRef(schema.$ref, ctx), ...(Array.isArray(out.allOf) ? out.allOf : [])]
  }
  if (schema.const !== undefined) {
    out.enum = [clone(schema.const)]
  }
  if (Array.isArray(schema.prefixItems)) {
    out.items = convertTuple(schema.prefixItems, schema, ctx)
  }
  convertType(out, schema.type)
  if (out.type === 'array' && out.items === undefined) {
    out.items = {}
  }
  const { exclusiveMaximum, exclusiveMinimum, maximum, minimum } = schema
  if (typeof exclusiveMinimum === 'number' && !(typeof minimum === 'number' && minimum > exclusiveMinimum)) {
    out.minimum = exclusiveMinimum
    out.exclusiveMinimum = true
  }
  if (typeof exclusiveMaximum === 'number' && !(typeof maximum === 'number' && maximum < exclusiveMaximum)) {
    out.maximum = exclusiveMaximum
    out.exclusiveMaximum = true
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0 && out.example === undefined) {
    out.example = clone(schema.examples[0])
  }
  // 3.0 marks encoded and raw binary strings with `format` instead.
  const format = schema.contentEncoding === 'base64'
    ? 'byte'
    : schema.contentEncoding === 'binary' || (schema.contentEncoding === undefined && schema.contentMediaType !== undefined) ? 'binary' : undefined
  if (format !== undefined && (schema.type === undefined || hasType(schema.type, 'string'))) {
    out.format ??= format
    if (schema.type === undefined) {
      out.type = 'string'
    }
  }
}

function isBareRef(value: Record<string, unknown>): boolean {
  for (const key in value) {
    if (key !== '$ref' && Object.hasOwn(value, key) && value[key] !== undefined) {
      return false
    }
  }
  return true
}

function convertSchema(value: unknown, ctx: Context): unknown {
  if (typeof value === 'boolean') {
    return value ? {} : { not: {} }
  }
  const ref = getRef(value)
  if (ref !== undefined && isBareRef(value as Record<string, unknown>)) {
    return convertSchemaRef(ref, ctx)
  }
  return convertObject(value, ctx, SCHEMA_FIELDS, finishSchema)
}

function convertParameter(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, PARAMETER_FIELDS)
}

function convertMediaType(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, MEDIA_TYPE_FIELDS)
}

function convertRequestBody(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, REQUEST_BODY_FIELDS)
}

function convertResponse(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, RESPONSE_FIELDS)
}

// 3.0 requires `responses`.
function finishOperation(out: Record<string, unknown>): void {
  out.responses ??= { default: { description: '' } }
}

function convertOperation(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, OPERATION_FIELDS, finishOperation)
}

// The target's fields fill in for those the referencing Path Item lacks.
function finishMergedPathItem(out: Record<string, unknown>, pathItem: Record<string, unknown>, ctx: Context): void {
  const target = inline(pathItem.$ref as string, ctx, convertPathItem)
  if (isRecord(target)) {
    for (const [key, item] of Object.entries(target)) {
      out[key] ??= item
    }
  }
}

function convertPathItem(value: unknown, ctx: Context): unknown {
  const ref = getRef(value)
  return ref !== undefined && isInlined(ref, ctx)
    ? convertObject(value, ctx, MERGED_PATH_ITEM_FIELDS, finishMergedPathItem)
    : convertObject(value, ctx, PATH_ITEM_FIELDS)
}

function isMutualTLS(scheme: unknown, ctx: Context): boolean {
  const ref = getRef(scheme)
  const target = ref === undefined ? scheme : resolve(ref, ctx)
  return isRecord(target) && target.type === 'mutualTLS'
}

// 3.0 has no mutual TLS, so security requirements lose the schemes that use
// it. A requirement left empty is removed, and so is a list left empty,
// because an empty one would mean that no security is needed.
function convertSecurity(value: unknown, ctx: Context): unknown {
  if (!Array.isArray(value)) {
    return clone(value)
  }
  const schemes = resolvePointer('#/components/securitySchemes', ctx)
  const out: unknown[] = []
  for (const requirement of value) {
    if (!isRecord(requirement)) {
      out.push(clone(requirement))
      continue
    }
    const names = Object.keys(requirement).filter(name => requirement[name] !== undefined)
    const kept = names.filter(name => !(isRecord(schemes) && Object.hasOwn(schemes, name) && isMutualTLS(schemes[name], ctx)))
    if (kept.length > 0 || names.length === 0) {
      out.push(Object.fromEntries(kept.map(name => [name, clone(requirement[name])])))
    }
  }
  return out.length === 0 && value.length > 0 ? DROP : out
}

function finishDocument(out: Record<string, unknown>): void {
  out.openapi = '3.0.4'
  out.paths ??= {}
}

function convertDocument(value: unknown, ctx: Context): unknown {
  return convertObject(value, ctx, DOCUMENT_FIELDS, finishDocument)
}

export function downgradeSpecV31ToV30(spec: OpenAPIV3_1.OpenAPIObject): OpenAPIV3_0.OpenAPIObject {
  return downgrade(spec, convertDocument) as OpenAPIV3_0.OpenAPIObject
}

export function downgradeSchemaV31ToV30<T = unknown>(schema: OpenAPIV3_1.SchemaObject<T>): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return downgrade(schema, convertSchema) as OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T>
}
