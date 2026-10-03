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

// Keywords 3.0 lacks that restrict values, so removing one loosens a schema.
const RESTRICTING_KEYWORDS = new Set([
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

const REMOVED_KEYWORDS = [
  ...RESTRICTING_KEYWORDS,
  // Annotations and identifiers 3.0 lacks.
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
  // The draft-07 name of `$defs`, which 2020-12 still reads.
  'definitions',
  // Rewritten by `finishSchema`.
  '$ref',
  'const',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'nullable',
  'type',
]

// The only keywords a 3.0 Schema Object allows, besides extensions.
const V30_SCHEMA_KEYWORDS = new Set([
  'additionalProperties',
  'allOf',
  'anyOf',
  'default',
  'deprecated',
  'description',
  'discriminator',
  'enum',
  'example',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'externalDocs',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'not',
  'nullable',
  'oneOf',
  'pattern',
  'properties',
  'readOnly',
  'required',
  'title',
  'type',
  'uniqueItems',
  'writeOnly',
  'xml',
])

// Keywords that let `unevaluatedProperties` see more than `properties`.
const IN_PLACE_APPLICATORS = ['$dynamicRef', '$ref', 'additionalProperties', 'allOf', 'anyOf', 'dependentSchemas', 'else', 'if', 'oneOf', 'patternProperties', 'then']

// Converted schemas that lost a restriction, directly or in a subschema.
const LOOSE = new WeakSet<object>()

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
  // An empty one rejects every value, which `finishSchema` keeps another way.
  enum: item => (Array.isArray(item) && item.length === 0 ? DROP : clone(item)),
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
  securitySchemes: map((item, ctx) => (schemeType(item, ctx) === 'mutualTLS' ? DROP : convertReference(item, ctx))),
})

const LICENSE_FIELDS = defineFields({
  identifier: DROP,
})

const INFO_FIELDS = defineFields({
  license: (item, ctx) => convertObject(item, ctx, LICENSE_FIELDS),
  summary: DROP,
})

// A summary stands in for the description it lacks.
function finishInfo(out: Record<string, unknown>, info: Record<string, unknown>): void {
  if (out.description === undefined && typeof info.summary === 'string') {
    out.description = info.summary
  }
}

const DOCUMENT_FIELDS = defineFields({
  components: (item, ctx) => convertObject(item, ctx, COMPONENTS_FIELDS),
  info: (item, ctx) => convertObject(item, ctx, INFO_FIELDS, finishInfo),
  jsonSchemaDialect: DROP,
  paths: map(convertPathItem, isPath),
  security: convertSecurity,
  webhooks: DROP,
})

// A `$ref` into a removed part, `$defs`, or `definitions` is replaced by its
// target, unless it already dangles.
function isInlined(ref: string, ctx: Context): boolean {
  return (ref.includes('/$defs/') || ref.includes('/definitions/') || REMOVED_PARTS.some(prefix => ref.startsWith(prefix))) && resolvePointer(ref, ctx) !== undefined
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
  return out === DROP ? loosened({}) : out
}

// 3.0 `items` applies one schema to every item, so a tuple becomes an array
// whose items match any of its item schemas, and those of the items after
// them, unless `items: false` or `maxItems` allows none. `items: false`
// becomes `maxItems`. Returns whether the result means exactly the same,
// as when every item schema is the same and none lost a restriction.
function convertTuple(out: Record<string, unknown>, prefixItems: unknown[], schema: Record<string, unknown>, ctx: Context): boolean {
  const { items, maxItems } = schema
  if (items === false && !(typeof maxItems === 'number' && maxItems <= prefixItems.length)) {
    out.maxItems = prefixItems.length
  }
  const closed = typeof out.maxItems === 'number' && out.maxItems <= prefixItems.length
  if (!closed && (items === undefined || items === true)) {
    out.items = {}
    return false
  }
  // Equal item schemas convert alike, which their outputs, compared while a
  // cycle is still being converted, need not show.
  const variants = new Map<unknown, unknown>()
  for (const item of closed ? prefixItems : [...prefixItems, items]) {
    const key = jsonKey(item)
    if (!variants.has(key)) {
      variants.set(key, convertSchema(item, ctx))
    }
  }
  const [first, ...rest] = variants.values()
  out.items = rest.length === 0 ? first : { anyOf: [first, ...rest] }
  return closed && rest.length === 0 && !isLoose(first)
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

function loosened(out: object): object {
  LOOSE.add(out)
  return out
}

function isLoose(value: unknown): boolean {
  return typeof value === 'object' && value !== null && LOOSE.has(value)
}

// With no in-place applicator beside it, it means exactly `additionalProperties`.
function isUnevaluatedAdditional(schema: Record<string, unknown>): boolean {
  return schema.unevaluatedProperties !== undefined && IN_PLACE_APPLICATORS.every(key => schema[key] === undefined)
}

// Whether removing `key` from `schema` lets it accept more values. Property
// names are strings anyway, and `unevaluatedProperties` does nothing beside
// `additionalProperties`.
function losesRestriction(key: string, schema: Record<string, unknown>, exactTuple: boolean): boolean {
  switch (key) {
    case 'prefixItems':
      return !exactTuple
    case 'propertyNames': {
      const names = schema.propertyNames
      return !(names === true || (isRecord(names) && Object.entries(names).every(([name, item]) => name === 'type' && item === 'string')))
    }
    case 'unevaluatedProperties':
      return !(schema.additionalProperties !== undefined || isUnevaluatedAdditional(schema))
    default:
      return true
  }
}

// A schema that lost a restriction accepts more values. A `not` over it would
// then reject values the original accepts, and so would a `oneOf` whose
// branches may now overlap, so the `not` is removed and the `oneOf` becomes
// an `anyOf`. Returns whether the schema is loosened itself.
function loosen(out: Record<string, unknown>, schema: Record<string, unknown>, exactTuple: boolean): boolean {
  let loose = false
  for (const key in schema) {
    if (RESTRICTING_KEYWORDS.has(key) && schema[key] !== undefined && losesRestriction(key, schema, exactTuple)) {
      loose = true
    }
  }
  if (isLoose(out.not)) {
    delete out.not
    loose = true
  }
  if (Array.isArray(out.oneOf) && out.oneOf.some(isLoose)) {
    addAnyOf(out, out.oneOf)
    delete out.oneOf
    loose = true
  }
  return loose
    || isLoose(out.items)
    || isLoose(out.additionalProperties)
    || (isRecord(out.properties) && Object.values(out.properties).some(isLoose))
    || (Array.isArray(out.allOf) && out.allOf.some(isLoose))
    || (Array.isArray(out.anyOf) && out.anyOf.some(isLoose))
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
    // 3.0 has no null type, so only null may match, and an `enum` without it matches nothing.
    if (out.enum === undefined || (Array.isArray(out.enum) && out.enum.includes(null))) {
      out.enum = [null]
    }
    else {
      out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), { not: {} }]
    }
  }
}

// 3.0 marks encoded and raw binary strings with `format` instead. A string
// with a `contentSchema` holds structured text, not bytes.
function binaryFormat(schema: Record<string, unknown>): string | undefined {
  if (schema.contentEncoding === 'base64') {
    return 'byte'
  }
  if (schema.contentEncoding === 'binary') {
    return 'binary'
  }
  return schema.contentEncoding === undefined && schema.contentMediaType !== undefined && schema.contentSchema === undefined ? 'binary' : undefined
}

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>, ctx: Context): void {
  // 3.0 ignores the siblings of a `$ref`, but not the members of an `allOf`.
  if (typeof schema.$ref === 'string') {
    out.allOf = [convertSchemaRef(schema.$ref, ctx), ...(Array.isArray(out.allOf) ? out.allOf : [])]
  }
  if (schema.const !== undefined) {
    out.enum = [clone(schema.const)]
  }
  if (Array.isArray(schema.enum) && schema.enum.length === 0) {
    out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), { not: {} }]
  }
  const exactTuple = Array.isArray(schema.prefixItems) && convertTuple(out, schema.prefixItems, schema, ctx)
  if (isUnevaluatedAdditional(schema)) {
    const additional = schema.unevaluatedProperties
    out.additionalProperties = typeof additional === 'boolean' ? additional : convertSchema(additional, ctx)
  }
  // Before `convertType` moves `items` into an `anyOf` branch.
  // A `const` outside the `enum` beside it matched nothing, and now matches itself.
  const constOutsideEnum = schema.const !== undefined && Array.isArray(schema.enum) && !schema.enum.some(item => jsonKey(item) === jsonKey(schema.const))
  let loose = loosen(out, schema, exactTuple) || constOutsideEnum
  convertType(out, schema.type)
  // Written 3.0-style in a 3.1 document, it can only mean what it means in 3.0.
  if (schema.nullable === true && typeof out.type === 'string' && out.nullable !== true) {
    out.nullable = true
    loose = true
  }
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
  const format = binaryFormat(schema)
  if (format !== undefined && (schema.type === undefined || hasType(schema.type, 'string'))) {
    out.format ??= format
    if (schema.type === undefined) {
      out.type = 'string'
    }
  }
  // 3.0 allows no other keywords, so unknown ones become extensions.
  for (const key of Object.keys(out)) {
    if (!V30_SCHEMA_KEYWORDS.has(key) && !key.startsWith('x-')) {
      if (!Object.hasOwn(out, `x-${key}`)) {
        out[`x-${key}`] = out[key]
      }
      delete out[key]
    }
  }
  if (loose) {
    LOOSE.add(out)
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

function schemeType(scheme: unknown, ctx: Context): unknown {
  const ref = getRef(scheme)
  const target = ref === undefined ? scheme : resolve(ref, ctx)
  return isRecord(target) ? target.type : undefined
}

// 3.0 has no mutual TLS, so security requirements lose the schemes that use
// it. A requirement left empty is removed, and so is a list left empty,
// because an empty one would mean that no security is needed. 3.0 also
// allows scopes only for OAuth2 and OpenID Connect.
function convertSecurity(value: unknown, ctx: Context): unknown {
  if (!Array.isArray(value)) {
    return clone(value)
  }
  const schemes = resolvePointer('#/components/securitySchemes', ctx)
  const typeOf = (name: string): unknown => (isRecord(schemes) && Object.hasOwn(schemes, name) ? schemeType(schemes[name], ctx) : undefined)
  const out: unknown[] = []
  for (const requirement of value) {
    if (!isRecord(requirement)) {
      out.push(clone(requirement))
      continue
    }
    const entries = Object.keys(requirement).filter(name => requirement[name] !== undefined).map(name => [name, typeOf(name)] as const)
    const kept = entries.filter(([, type]) => type !== 'mutualTLS')
    if (kept.length > 0 || entries.length === 0) {
      out.push(Object.fromEntries(kept.map(([name, type]) => [name, type === 'apiKey' || type === 'http' ? [] : clone(requirement[name])])))
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
