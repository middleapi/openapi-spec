import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'
import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import type { Context, Convert } from './shared'
import {
  clone,
  convertObject,
  defineFields,
  downgrade,
  DROP,
  find,
  finishSummary,
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
const IN_PLACE_APPLICATORS = [
  '$dynamicRef',
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'dependentSchemas',
  'else',
  'if',
  'oneOf',
  'patternProperties',
  'then',
]

// Converted schemas that lost a restriction, directly or in a subschema.
const LOOSE = new WeakSet<object>()

// Converted schemas with an `anyOf` or `oneOf` of several branches, for
// `mergeEnums` and `mergeNullable`. They run once the whole input is converted,
// since a cycle can meet a branch before its conversion is done.
const nullableUnions: [schema: Record<string, unknown>, input: object, key: 'anyOf' | 'oneOf'][] =
  []

// Input schemas whose `anyOf` or `oneOf` a `$ref` kept as written points
// into. They keep it, so the `$ref` still resolves.
const unionTargets = new Set<unknown>()

// Input schemas a `$ref` kept as written points to, for `scalarOneOf`.
const refTargets = new Set<unknown>()

// The 3.0 keywords that apply only to objects, which `convertType` moves into
// the `"object"` branch of a `type` list.
const OBJECT_KEYWORDS = [
  'additionalProperties',
  'maxProperties',
  'minProperties',
  'properties',
  'required',
]

// A branch with these stays, since null can still fail them beside `nullable: true`.
const NOT_NULLABLE_KEYWORDS = ['$ref', 'allOf', 'anyOf', 'enum', 'not', 'oneOf']

// 3.0 keywords that describe a value and never reject one.
const ANNOTATION_KEYWORDS = new Set([
  'default',
  'deprecated',
  'description',
  'example',
  'externalDocs',
  'readOnly',
  'title',
  'writeOnly',
  'xml',
])

const convertUnion = list(convertSchema)
const convertTaggedUnion = list(convertTaggedBranch)
const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertMediaType)
const convertReference = refOr(clone)

const SCHEMA_FIELDS = defineFields({
  ...Object.fromEntries(REMOVED_KEYWORDS.map((key) => [key, DROP])),
  // It would reject the properties that `patternProperties` allowed.
  additionalProperties: (item, ctx, schema) =>
    schema.patternProperties === undefined ? convertAdditional(item, ctx) : DROP,
  allOf: list(convertSchema),
  // Zod writes a file with several media types as an `anyOf` of branches
  // that hold only `contentMediaType`, an annotation, so it matches every
  // value. Its branches would each become a binary string in 3.0.
  anyOf: (item, ctx, schema) =>
    Array.isArray(item) && item.some(isMediaTypeOnly) ? DROP : convertBranches(item, ctx, schema),
  // An empty one rejects every value, which `finishSchema` keeps another way.
  enum: (item) => (Array.isArray(item) && item.length === 0 ? DROP : clone(item)),
  // `finishSchema` builds it from `prefixItems`.
  items: (item, ctx, schema) =>
    schema.prefixItems === undefined ? convertSchema(item, ctx) : DROP,
  not: convertSchema,
  oneOf: convertBranches,
  properties: map(convertSchema),
  // 3.0 requires at least one entry.
  required: (item) => (Array.isArray(item) && item.length === 0 ? DROP : clone(item)),
  // Kept in place when it names one type besides `null`. `convertType`
  // rewrites any other.
  type: (item) => singleType(item) ?? DROP,
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
  ...Object.fromEntries(HTTP_METHODS.map((method) => [method, convertOperation])),
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
  securitySchemes: map((item, ctx) =>
    schemeType(item, ctx) === 'mutualTLS' ? DROP : convertReference(item, ctx),
  ),
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
  info: (item, ctx) => convertObject(item, ctx, INFO_FIELDS, finishSummary),
  jsonSchemaDialect: DROP,
  paths: map(convertPathItem, isPath),
  security: convertSecurity,
  webhooks: DROP,
})

// A `$ref` into a removed part, `$defs`, or `definitions`, or into the
// `additionalProperties` of a record keyed by an enum, which becomes `false`,
// is replaced by its target, unless it already dangles.
function isInlined(ref: string, ctx: Context): boolean {
  return (
    (ref.includes('/$defs/') ||
      ref.includes('/definitions/') ||
      // The removed parts, spelled out, as a callback for each `$ref` costs
      // about 3% of the instructions of a conversion.
      ref.startsWith('#/webhooks/') ||
      ref.startsWith('#/components/pathItems/') ||
      isIntoNamedValue(ref, ctx)) &&
    resolvePointer(ref, ctx) !== undefined
  )
}

function isIntoNamedValue(ref: string, ctx: Context): boolean {
  for (
    let at = ref.indexOf('/additionalProperties');
    at !== -1;
    at = ref.indexOf('/additionalProperties', at + 1)
  ) {
    const holder = resolvePointer(ref.slice(0, at), ctx)
    if (isRecord(holder) && enumNames(holder, ctx) !== undefined) {
      return true
    }
  }
  return false
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

// A discriminator picks only among named components, not the targets that
// replace `$ref`s into `$defs`, as Pydantic and msgspec write a tagged union.
// Its `mapping` into them would dangle, which validators that follow it reject.
function keepsDiscriminator(schema: Record<string, unknown>, ctx: Context): boolean {
  return (
    schema.discriminator !== undefined &&
    ![schema.oneOf, schema.anyOf].some(
      (branches) =>
        Array.isArray(branches) &&
        branches.some((branch) => {
          const ref = getRef(branch)
          return ref !== undefined && isInlined(ref, ctx)
        }),
    )
  )
}

// 3.0 maps a discriminator only to the `$ref`s among its branches, not to
// inline schemas, so a branch that is a `$ref` beside only annotations, as
// Anthropic and ElevenLabs describe each one, stays the bare `$ref`, whose
// siblings 3.0 ignores, rather than becoming an `allOf`, which oapi-codegen
// stops on there.
function convertBranches(item: unknown, ctx: Context, schema: Record<string, unknown>): unknown {
  return keepsDiscriminator(schema, ctx) ? convertTaggedUnion(item, ctx) : convertUnion(item, ctx)
}

function convertTaggedBranch(value: unknown, ctx: Context): unknown {
  const ref = getRef(value)
  return ref !== undefined && isAnnotatedRef(value as Record<string, unknown>)
    ? convertSchemaRef(ref, ctx)
    : convertSchema(value, ctx)
}

// Whether each key of `value` that holds a value passes `test`, since a key
// holding `undefined` counts as missing.
function hasOnly(value: Record<string, unknown>, test: (key: string) => boolean): boolean {
  for (const key in value) {
    if (Object.hasOwn(value, key) && value[key] !== undefined && !test(key)) {
      return false
    }
  }
  return true
}

// The 3.1 annotations `examples` and `$comment` count too, as the Anthropic
// API writes `examples` beside a `$ref` to a tagged union.
function isAnnotatedRef(value: Record<string, unknown>): boolean {
  return hasOnly(value, (key) => key === '$ref' || isInputAnnotation(key))
}

// 3.0 reads an `allOf` that holds a `$ref` to a schema with a `discriminator`
// as one of the schemas the discriminator picks among, so openapi-typescript
// leaves out the tag, and Hey API pins it to the name of the schema around it
// when the target has no `oneOf`. So a `$ref` to one beside only annotations,
// as OpenAI and Adyen describe a property holding a tagged union, stays the
// bare `$ref`, as a branch does.
function isTaggedRef(ref: string, ctx: Context): boolean {
  const target = resolvePointer(ref, ctx)
  return isRecord(target) && keepsDiscriminator(target, ctx) && !isInlined(ref, ctx)
}

function convertSchemaRef(ref: string, ctx: Context): unknown {
  if (!isInlined(ref, ctx)) {
    for (const key of ['/anyOf/', '/oneOf/']) {
      for (let at = ref.indexOf(key); at !== -1; at = ref.indexOf(key, at + 1)) {
        unionTargets.add(resolvePointer(ref.slice(0, at), ctx))
      }
    }
    refTargets.add(resolvePointer(ref, ctx))
    // A `$ref` kept as written loses what its target loses. Converting the
    // target here reuses the copy the components get, and stops at a cycle.
    const out = { $ref: ref }
    return isLoose(inline(ref, ctx, convertSchema, true)) ? loosened(out) : out
  }
  const out = inline(ref, ctx, convertSchema)
  return out === DROP ? loosened({}) : out
}

// 3.0 `items` applies one schema to every item, so a tuple becomes an array
// whose items match any of its item schemas, and those of the items after
// them, unless `items: false` or `maxItems` allows none. `items: false`
// becomes `maxItems`. Returns whether the result means exactly the same,
// as when every item schema is the same and none lost a restriction.
function convertTuple(
  out: Record<string, unknown>,
  prefixItems: unknown[],
  schema: Record<string, unknown>,
  ctx: Context,
): boolean {
  const { items, maxItems } = schema
  if (items === false && !(typeof maxItems === 'number' && maxItems <= prefixItems.length)) {
    out.maxItems = prefixItems.length
  }
  const closed = typeof out.maxItems === 'number' && out.maxItems <= prefixItems.length
  const all = closed ? prefixItems : [...prefixItems, items]
  // An item schema that accepts every value, as Zod and ArkType write a rest
  // of any items, makes the others redundant, and code generators would read
  // the `anyOf` of them as a union.
  if (all.some(acceptsAll)) {
    out.items = {}
    return closed && all.every(acceptsAll)
  }
  // Equal item schemas convert alike, which their outputs, compared while a
  // cycle is still being converted, need not show.
  const variants = new Map<unknown, unknown>()
  for (const item of all) {
    const key = jsonKey(item)
    if (!variants.has(key)) {
      variants.set(key, convertSchema(item, ctx))
    }
  }
  const [first, ...rest] = variants.values()
  if (rest.length === 0) {
    out.items = first
  } else {
    // Merged like any other `anyOf` once the whole input is converted.
    const union = { anyOf: [first, ...rest] }
    nullableUnions.push([union, prefixItems, 'anyOf'])
    out.items = union
  }
  return closed && rest.length === 0 && !isLoose(first)
}

function acceptsAll(schema: unknown): boolean {
  return (
    schema === undefined ||
    schema === true ||
    (isRecord(schema) && Object.values(schema).every((value) => value === undefined))
  )
}

// Equal JSON values get the same key. A cyclic value is only equal to itself.
function jsonKey(value: unknown): unknown {
  try {
    return JSON.stringify(value)
  } catch {
    return value
  }
}

// Serializes `value` once, not once per item, so a large `value` beside many
// items costs their sizes added, not multiplied. With no items, not at all: a
// value that shares objects is written out once per path to them.
function includesJson(items: unknown[], value: unknown): boolean {
  if (items.length === 0) {
    return false
  }
  const key = jsonKey(value)
  return items.some((item) => jsonKey(item) === key)
}

// After the members the `allOf` already holds.
function addAllOf(out: Record<string, unknown>, member: unknown): void {
  out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), member]
}

function addAnyOf(out: Record<string, unknown>, variants: unknown[]): void {
  if (out.anyOf === undefined) {
    out.anyOf = variants
  } else {
    addAllOf(out, { anyOf: variants })
  }
}

// 3.0 allows a boolean `additionalProperties`, unlike other subschemas.
function convertAdditional(value: unknown, ctx: Context): unknown {
  return typeof value === 'boolean' ? value : convertSchema(value, ctx)
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
  return (
    schema.unevaluatedProperties !== undefined &&
    IN_PLACE_APPLICATORS.every((key) => schema[key] === undefined)
  )
}

// The names allowed by a `propertyNames` holding only an `enum`, or a `const`
// for a single name, and annotations, as Zod and Valibot write a record with
// enum or literal keys, when no other keyword names properties. Each becomes a
// property of its own, which 3.0 can express. A reusable enum is a `$ref` to it.
function enumNames(schema: Record<string, unknown>, ctx: Context): string[] | undefined {
  const ref = getRef(schema.propertyNames)
  // Followed alone or beside annotations, such as the `description` Zod writes
  // for a described use, since other keywords beside it narrow the names further.
  const names =
    ref !== undefined && isAnnotatedRef(schema.propertyNames as Record<string, unknown>)
      ? resolve(ref, ctx)
      : schema.propertyNames
  if (!isRecord(names)) {
    return undefined
  }
  // An `enum` beside a `const` allows only the names in both, so both stay as before.
  const values =
    names.const === undefined ? names.enum : names.enum === undefined ? [names.const] : undefined
  if (
    !Array.isArray(values) ||
    schema.properties !== undefined ||
    schema.patternProperties !== undefined ||
    schema.unevaluatedProperties !== undefined ||
    schema.additionalProperties === false ||
    !(names.type === undefined || names.type === 'string') ||
    !hasOnly(
      names,
      (name) => name === 'enum' || name === 'const' || name === 'type' || isInputAnnotation(name),
    )
  ) {
    return undefined
  }
  return values.filter((name) => typeof name === 'string')
}

// Whether removing `key` from `schema` lets it accept more values. Property
// names are strings anyway, and `unevaluatedProperties` does nothing beside
// `additionalProperties`.
function losesRestriction(
  key: string,
  schema: Record<string, unknown>,
  exactTuple: boolean,
  ctx: Context,
): boolean {
  switch (key) {
    case 'prefixItems':
      return !exactTuple
    case 'propertyNames': {
      const names = schema.propertyNames
      return !(
        names === true ||
        enumNames(schema, ctx) !== undefined ||
        (isRecord(names) &&
          (names.type === undefined || names.type === 'string') &&
          hasOnly(names, (name) => name === 'type'))
      )
    }
    case 'unevaluatedProperties':
      return !(schema.additionalProperties !== undefined || isUnevaluatedAdditional(schema))
    default:
      return true
  }
}

// What 3.0 keeps of a schema however loose the rest of it becomes: its type,
// and the values, each a string, number, boolean or null, of a `const` or an
// `enum` that it holds a property to, also through a `$ref` beside only
// annotations, as Zod writes a literal with its own id, and whether an object
// requires it. Null matches a `nullable` schema, even with an `enum`, as some
// read it, so such a schema or property keeps nothing, nor does a property
// whose `type` names null, which becomes `nullable`.
interface Tags {
  readonly type: unknown
  readonly values: Map<string, { readonly values: unknown[]; readonly required: boolean }>
}

function tagsOf(schema: Record<string, unknown>, ctx: Context): Tags {
  const values: Tags['values'] = new Map()
  if (schema.nullable === true) {
    return { type: undefined, values }
  }
  const required = schema.type === 'object' && Array.isArray(schema.required) ? schema.required : []
  const properties = isRecord(schema.properties) ? schema.properties : {}
  for (const name of Object.keys(properties)) {
    const value = properties[name]
    const property =
      getRef(value) !== undefined && isAnnotatedRef(value as Record<string, unknown>)
        ? follow(value, ctx)
        : value
    const held =
      isRecord(property) && property.nullable !== true && !hasType(property.type, 'null')
        ? property.const === undefined
          ? property.enum
          : [property.const]
        : undefined
    if (Array.isArray(held) && held.every((value) => typeof value !== 'object' || value === null)) {
      values.set(name, { values: held, required: required.includes(name) })
    }
  }
  return { type: schema.type, values }
}

// Whether no value matches both: they have different types, other than an
// integer and a number, or one requires a property that the other holds to
// other values, as OpenAI, Zod and oRPC write a tagged union.
function isApart(a: Tags, b: Tags): boolean {
  if (typeof a.type === 'string' && typeof b.type === 'string' && a.type !== b.type) {
    return ![a.type, b.type].every((type) => type === 'integer' || type === 'number')
  }
  for (const [name, tag] of a.values) {
    const other = b.values.get(name)
    if (
      other !== undefined &&
      (tag.required || other.required) &&
      tag.values.every((value) => !other.values.includes(value))
    ) {
      return true
    }
  }
  return false
}

// The schema that a chain of `$ref`s from `value` ends at. A `$ref` back into
// a target being inlined is cut to `{}`, which keeps nothing, and so is a
// `$ref` whose chain of `$ref`s reaches one.
function follow(value: unknown, ctx: Context): unknown {
  const visited = new Set<string>()
  let target = value
  for (let ref = getRef(target); ref !== undefined; ref = getRef(target)) {
    if (visited.has(ref) || (isInlined(ref, ctx) && ctx.inlining.has(resolvePointer(ref, ctx)))) {
      return undefined
    }
    visited.add(ref)
    target = resolvePointer(ref, ctx)
  }
  return target
}

// The tags of a schema and of the members of its `allOf`, which take every
// value it takes, as OpenAI writes a resource as an `allOf` of an item and its ID.
function partTags(schema: unknown, ctx: Context): Tags[] {
  const target = follow(schema, ctx)
  const parts =
    isRecord(target) && Array.isArray(target.allOf)
      ? [target, ...target.allOf.map((member) => follow(member, ctx))]
      : [target]
  return parts.filter(isRecord).map((part) => tagsOf(part, ctx))
}

// Whether no value matches two of the branches, however loose they become.
function isDisjoint(branches: unknown[], ctx: Context): boolean {
  const tags = branches.map((branch) => partTags(branch, ctx))
  return tags.every((parts, index) =>
    tags
      .slice(index + 1)
      .every((others) => parts.some((part) => others.some((other) => isApart(part, other)))),
  )
}

// A schema that lost a restriction accepts more values. A `not` over it would
// then reject values the original accepts, and so would a `oneOf` whose
// branches may now overlap, so the `not` is removed and the `oneOf` becomes
// an `anyOf`, unless no two branches can match the same value. Returns
// whether the schema is loosened itself.
function loosen(
  out: Record<string, unknown>,
  schema: Record<string, unknown>,
  exactTuple: boolean,
  ctx: Context,
): boolean {
  let loose = false
  for (const key in schema) {
    if (
      RESTRICTING_KEYWORDS.has(key) &&
      schema[key] !== undefined &&
      losesRestriction(key, schema, exactTuple, ctx)
    ) {
      loose = true
    }
  }
  if (isLoose(out.not)) {
    delete out.not
    loose = true
  }
  if (Array.isArray(out.oneOf) && out.oneOf.some(isLoose)) {
    if (!isDisjoint(schema.oneOf as unknown[], ctx)) {
      addAnyOf(out, out.oneOf)
      delete out.oneOf
    }
    loose = true
  }
  return (
    loose ||
    isLoose(out.items) ||
    isLoose(out.additionalProperties) ||
    (isRecord(out.properties) && Object.values(out.properties).some(isLoose)) ||
    (Array.isArray(out.allOf) && out.allOf.some(isLoose)) ||
    (Array.isArray(out.anyOf) && out.anyOf.some(isLoose))
  )
}

// The one type besides `null` that `type` names, which 3.0 keeps as it is.
function singleType(type: unknown): string | undefined {
  if (!Array.isArray(type)) {
    return typeof type === 'string' && type !== 'null' ? type : undefined
  }
  const rest = type.filter((item) => typeof item === 'string' && item !== 'null')
  return rest.length === 1 ? rest[0] : undefined
}

// 3.0 takes one type, which `SCHEMA_FIELDS` keeps, and marks null with
// `nullable` instead.
function convertType(out: Record<string, unknown>, type: unknown): void {
  if (typeof type === 'string' && type !== 'null') {
    return
  }
  const types = (Array.isArray(type) ? type : [type]).filter((item) => typeof item === 'string')
  const nullable = types.includes('null')
  const rest = types.filter((item) => item !== 'null')
  if (rest.length === 1) {
    if (nullable) {
      out.nullable = true
    }
  } else if (rest.length > 1) {
    // Code generators ignore `nullable` inside an `anyOf` branch, so null gets its own.
    // hey-api reads the object keywords beside the `anyOf` as part of every branch.
    const object = Object.fromEntries(
      OBJECT_KEYWORDS.filter((key) => out[key] !== undefined).map((key) => [key, out[key]]),
    )
    addAnyOf(out, [
      ...rest.map((item) => ({
        type: item,
        ...(item === 'array' && { items: out.items ?? {} }),
        ...(item === 'object' && object),
      })),
      ...(nullable ? [onlyNull()] : []),
    ])
    delete out.items
    for (const key of OBJECT_KEYWORDS) {
      delete out[key]
    }
  } else if (nullable) {
    // 3.0 has no null type, so only null may match, and an `enum` without it matches nothing.
    if (out.enum === undefined || (Array.isArray(out.enum) && out.enum.includes(null))) {
      out.enum = [null]
    } else {
      addAllOf(out, { not: {} })
    }
  }
}

// Only null matches it. 3.0 admits null only through `nullable`, which
// needs a `type` beside it, and code generators drop a bare `enum: [null]`.
function onlyNull(): Record<string, unknown> {
  return { type: 'string', nullable: true, enum: [null] }
}

function isOnlyNull(values: unknown): boolean {
  return Array.isArray(values) && values.length === 1 && values[0] === null
}

function isAnnotation(name: string): boolean {
  return ANNOTATION_KEYWORDS.has(name) || name.startsWith('x-')
}

// An annotation in a 3.1 schema, which can also be `examples` or `$comment`.
function isInputAnnotation(name: string): boolean {
  return name === 'examples' || name === '$comment' || isAnnotation(name)
}

// The schema around a branch holds `name` with the same value, as ArkType
// writes the description of a described union into every branch too.
function repeats(
  out: Record<string, unknown>,
  branch: Record<string, unknown>,
  name: string,
): boolean {
  return Object.hasOwn(out, name) && jsonKey(out[name]) === jsonKey(branch[name])
}

// Only null matches the branch, as `{ type: "null" }` becomes, and its other
// keywords repeat the schema around it, or only document null, as Lithic and
// Mailgun write a `description` of the null case.
function isNullBranch(value: unknown, out: Record<string, unknown>): boolean {
  return (
    isRecord(value) &&
    value.type === 'string' &&
    value.nullable === true &&
    isOnlyNull(value.enum) &&
    Object.keys(value).every(
      (name) =>
        name === 'type' ||
        name === 'nullable' ||
        name === 'enum' ||
        name === 'title' ||
        name === 'description' ||
        name === 'example' ||
        name.startsWith('x-') ||
        repeats(out, value, name),
    )
  )
}

// A 3.1 `type` that names `"null"`, with nothing beside it that null could fail.
function acceptsNull(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    hasType(schema.type, 'null') &&
    schema.const === undefined &&
    !NOT_NULLABLE_KEYWORDS.some((name) => schema[name] !== undefined)
  )
}

// A 3.1 schema that null passes: one that `acceptsNull`, or only annotations
// beside an `anyOf` with such a branch, as Zod and Pydantic write a nullable
// schema, or beside nothing at all.
function admitsNull(schema: unknown): boolean {
  return (
    acceptsNull(schema) ||
    (isRecord(schema) &&
      hasOnly(
        schema,
        (name) =>
          isInputAnnotation(name) ||
          (name === 'anyOf' && Array.isArray(schema.anyOf) && schema.anyOf.some(acceptsNull)),
      ))
  )
}

// A `type` with no `nullable: true` beside it, in 3.1 or 3.0, rejects null.
function rejectsNull(schema: unknown): boolean {
  if (!isRecord(schema) || schema.nullable === true) {
    return false
  }
  const { type } = schema
  return Array.isArray(type)
    ? type.length > 0 && type.every((item) => typeof item === 'string' && item !== 'null')
    : typeof type === 'string' && type !== 'null'
}

// The schema that `schema` stands for, read through one `$ref`.
function throughRef(schema: unknown, root: unknown): unknown {
  const ref = getRef(schema)
  return ref === undefined ? schema : find(root, ref)
}

// A schema that rejects null by its `type`, read through one `$ref`.
function refRejectsNull(schema: unknown, root: unknown): boolean {
  return rejectsNull(throughRef(schema, root))
}

// A schema that rejects null by its `type`, or a `$ref` to one that rejects
// null with or without a `type`.
function keptRejectsNull(schema: unknown, root: unknown): boolean {
  return (
    refRejectsNull(schema, root) ||
    (getRef(schema) !== undefined && untypedRejectsNull(throughRef(schema, root), root))
  )
}

// A schema with no `type` that rejects null all the same: an `enum` or
// `const` without null, as msgspec writes an `Enum`, an `allOf` with a member
// that rejects null, as OData writes a derived object, or a union whose
// branches each do, as Zod writes a registered union. Unless `inline`, a
// `oneOf` with an object branch, as Zod writes a discriminated union, and
// GitHub and Notion a tagged one, does not count, since NSwag writes a type it
// never defines for a nullable `$ref` to one, where the `anyOf` pair gives an
// empty class, though it reads an inline one as its first branch.
function untypedRejectsNull(schema: unknown, root: unknown, inline = false): boolean {
  if (!isRecord(schema) || schema.type !== undefined) {
    return false
  }
  // A `const` takes the place of any `enum` in 3.0, so it decides alone.
  if (schema.const !== undefined) {
    return schema.const !== null
  }
  const branches = schema.anyOf ?? schema.oneOf
  return (
    (Array.isArray(schema.enum) && !schema.enum.includes(null)) ||
    (Array.isArray(schema.allOf) && schema.allOf.some((member) => refRejectsNull(member, root))) ||
    (Array.isArray(branches) &&
      branches.length > 0 &&
      branches.every((branch) => refRejectsNull(branch, root)) &&
      (inline ||
        !(branches === schema.oneOf && branches.some((branch) => isObjectBranch(branch, root)))))
  )
}

// A schema with an `"object"` `type`, read through one `$ref`.
function isObjectBranch(schema: unknown, root: unknown): boolean {
  const target = throughRef(schema, root)
  return isRecord(target) && hasType(target.type, 'object')
}

// An inline union whose branches each reject null, as Pydantic writes an
// `Optional` tagged union, and Valibot and Zod a nullable union, with a branch
// that `scalarOneOf` does not take, which then makes a nullable union of
// scalars one flat `oneOf` instead, as Effect writes a nullable number.
function unionRejectsNull(schema: Record<string, unknown>, root: unknown): boolean {
  const branches = schema.anyOf ?? schema.oneOf
  return (
    Array.isArray(branches) &&
    untypedRejectsNull(schema, root, true) &&
    branches.some((branch) => !isRecord(branch) || !ONE_OF_TYPES.has(branch.type as string))
  )
}

// Whether two branches hold the same keys with the same values. An object
// value matches only itself, since comparing objects in full would cost an
// object that a dereferenced document shares once for each path to it.
function isSameBranch(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (!isRecord(a) || !isRecord(b)) {
    return false
  }
  for (const name in a) {
    if (
      !Object.hasOwn(b, name) ||
      // Each `{ type: "null" }` becomes its own `enum: [null]`, as Effect
      // writes null twice for a nullish union.
      (a[name] !== b[name] && !(name === 'enum' && isOnlyNull(a[name]) && isOnlyNull(b[name])))
    ) {
      return false
    }
  }
  for (const name in b) {
    if (!Object.hasOwn(a, name)) {
      return false
    }
  }
  return true
}

// oRPC 1.x writes a file with several media types as an `anyOf` of strings
// with one media type each, which all become the same binary string. A
// branch equal to the one before it matches the same values, so it goes.
// Comparing only neighbors, as oRPC writes them, keeps the cost linear. A
// lone branch left takes the place of the `anyOf` when the schema around it
// holds only annotations that the branch lacks or repeats, or nothing at all
// beside a `$ref`, whose siblings 3.0 ignores. NSwag and oapi-codegen then
// read a file upload, and `mergeNullable` a nullable one as a pair. A `oneOf`
// rejects a value that two branches match, so it keeps them. Returns whether
// several branches are left.
function dropEqualBranches(out: Record<string, unknown>): boolean {
  const branches = out.anyOf as unknown[]
  const kept = branches.filter(
    (branch, index) => index === 0 || !isSameBranch(branches[index - 1], branch),
  )
  if (kept.length === branches.length) {
    return true
  }
  out.anyOf = kept
  if (kept.length > 1) {
    return true
  }
  const [branch] = kept
  const names = Object.keys(out)
  if (
    isRecord(branch) &&
    (getRef(branch) === undefined || names.length === 1) &&
    names.every(
      (name) =>
        name === 'anyOf' ||
        (isAnnotation(name) && (!Object.hasOwn(branch, name) || repeats(out, branch, name))),
    )
  ) {
    delete out.anyOf
    Object.assign(out, branch)
  }
  return false
}

// Zod writes a nullable object, array, or integer as an `anyOf` of it and
// `{ type: "null" }`. Code generators read that pair in 3.0 as a union or an
// empty class, so the branch takes its place with `nullable: true`, as 3.0
// writes it, when the schema around it has none of its keywords with another
// value. A branch that stays, such as a `$ref` or an `enum`, makes the pair a
// `oneOf` when it rejects null, as null then matches one branch only. NSwag
// reads that `oneOf` as nullable, and the `anyOf` as an empty class. typia
// and Litestar write the pair as a `oneOf`, which means the same when the
// other branch takes `nullable`, and oapi-codegen reads it as a union.
function mergeNullable(
  out: Record<string, unknown>,
  root: unknown,
  key: 'anyOf' | 'oneOf',
  isTarget: boolean,
): void {
  const branches = out[key] as unknown[]
  // Effect writes null twice for a nullish value, once for `undefined`.
  const others = branches.filter((branch) => !isNullBranch(branch, out))
  const [other] = others
  if (others.length !== 1 || !isRecord(other)) {
    return
  }
  // A branch that accepts every value, as Zod writes for a nullable unknown and
  // Pydantic for `Optional[Any]`, makes the `anyOf` accept every value too.
  // Code generators read the pair as a union with a string, or as a type they
  // never define. Zod writes the description of such a value in the branch.
  const names = Object.keys(other)
  if (
    key === 'anyOf' &&
    names.every(
      (name) => isAnnotation(name) && (!Object.hasOwn(out, name) || repeats(out, other, name)),
    )
  ) {
    delete out.anyOf
    Object.assign(out, other)
    return
  }
  if (
    typeof other.type === 'string' &&
    // Zod writes a nullable nullish value as a nullable branch beside null.
    // Null matches both, which a `oneOf` rejects.
    !(key === 'oneOf' && other.nullable === true) &&
    !NOT_NULLABLE_KEYWORDS.some((name) => Object.hasOwn(other, name)) &&
    // A `type` beside the pair rejects the null that `nullable` would admit.
    names.every(
      (name) => !Object.hasOwn(out, name) || (name !== 'type' && repeats(out, other, name)),
    ) &&
    // `additionalProperties` reads the `properties` beside it.
    !(Object.hasOwn(other, 'additionalProperties') && Object.hasOwn(out, 'properties')) &&
    !(Object.hasOwn(other, 'properties') && Object.hasOwn(out, 'additionalProperties'))
  ) {
    delete out[key]
    Object.assign(out, other, { nullable: true })
  } else if (key === 'anyOf' && out.oneOf === undefined) {
    // A `$ref` kept as written rejects null when its target does, with or
    // without a `type`, an inline union when each of its branches does, and an
    // `allOf` when any of its members does, such as the `$ref` with siblings
    // that Zod writes for a described reference, or either side of an
    // intersection.
    const ref = getRef(other)
    if (
      keptRejectsNull(other, root) ||
      // A pair a `$ref` points to keeps an inline union, since NSwag gives each
      // `$ref` to a `oneOf` with null a type it never defines.
      (!isTarget && unionRejectsNull(other, root)) ||
      (Array.isArray(other.allOf) && other.allOf.some((member) => keptRejectsNull(member, root)))
    ) {
      // Null once, since `oneOf` rejects a value that matches two branches.
      const nullBranch = branches.find((branch) => isNullBranch(branch, out))
      out.oneOf = branches[0] === other ? [other, nullBranch] : [nullBranch, other]
      delete out.anyOf
    } else if (ref !== undefined && Object.keys(out).length === 1 && admitsNull(find(root, ref))) {
      // GitHub writes a nullable reference this way to a schema that already
      // admits null, and Zod and Pydantic to a nullable one, which 3.0 writes as
      // the `$ref` alone. NSwag reads the pair as an empty class, and
      // oapi-codegen as a union.
      delete out.anyOf
      out.$ref = ref
    }
  }
}

// The type of a JSON value other than null.
function valueType(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return 'array'
  }
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return typeof value
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number'
    default:
      return isRecord(value) ? 'object' : undefined
  }
}

// The `type` of a union whose branches are all enums of that one `type`, or
// such unions, as a union of `const`s becomes, and as Zod nests one for each
// `.or()`. A branch with `nullable` lets null through.
function enumUnionType(branches: unknown): string | undefined {
  if (!Array.isArray(branches) || branches.length < 2) {
    return undefined
  }
  const [first] = branches
  const type = isRecord(first) ? first.type : undefined
  return typeof type === 'string' &&
    branches.every(
      (branch) =>
        isRecord(branch) &&
        branch.type === type &&
        branch.nullable !== true &&
        (Array.isArray(branch.enum) || enumUnionType(branch.anyOf ?? branch.oneOf) === type),
    )
    ? type
    : undefined
}

// Zod, Valibot, TypeBox and GrowthBook write a union of literals as an `anyOf`
// of `const`s, GitHub as a `oneOf`, and ArkType and TypeBox a nullable one
// with null beside them. Code generators read the union of one-value enums
// this becomes as a string or as a union of one-value types, so the enums
// become one, which they read as an enum. A `oneOf` rejects a value that two
// branches share.
function mergeEnums(out: Record<string, unknown>, key: 'anyOf' | 'oneOf'): void {
  const branches = out[key] as unknown[]
  const enums = branches.filter((branch) => !isNullBranch(branch, out))
  const type = enumUnionType(enums)
  if ((out.type !== undefined && out.type !== type) || out.enum !== undefined) {
    return
  }
  if (type === undefined) {
    mergeEnumsByType(out, key)
    return
  }
  const values: unknown[] = []
  const seen = new Set<unknown>()
  for (const branch of enums as Record<string, unknown>[]) {
    if (
      !Array.isArray(branch.enum) ||
      !Object.keys(branch).every(
        (name) => name === 'type' || name === 'enum' || repeats(out, branch, name),
      )
    ) {
      return
    }
    for (const value of branch.enum) {
      const valueKey = jsonKey(value)
      if (!seen.has(valueKey)) {
        seen.add(valueKey)
        values.push(value)
      } else if (key === 'oneOf') {
        return
      }
    }
  }
  const merged = { type, enum: values }
  if (enums.length < branches.length) {
    const nulls = branches.filter((branch) => isNullBranch(branch, out))
    out[key] = isNullBranch(branches[0], out) ? [...nulls, merged] : [merged, ...nulls]
  } else {
    delete out[key]
    Object.assign(out, merged)
  }
}

// Zod, ArkType and Valibot write a union of literals of several types, or of
// literals and other types, as `'a' | 'b' | number`, with a branch for each
// literal, and utoipa so writes the unit variants of a Rust enum beside its
// other variants. The enums of each type become one, so `scalarOneOf` can then
// make a `oneOf` of a union of scalars.
function mergeEnumsByType(out: Record<string, unknown>, key: 'anyOf' | 'oneOf'): void {
  const branches = out[key] as unknown[]
  const merged = new Map<unknown, { enum: unknown[]; seen: Set<unknown> }>()
  const result: unknown[] = []
  for (const branch of branches) {
    if (
      !isRecord(branch) ||
      typeof branch.type !== 'string' ||
      !Array.isArray(branch.enum) ||
      branch.nullable === true ||
      !Object.keys(branch).every(
        (name) => name === 'type' || name === 'enum' || repeats(out, branch, name),
      )
    ) {
      result.push(branch)
      continue
    }
    let group = merged.get(branch.type)
    if (group === undefined) {
      group = { enum: [], seen: new Set() }
      merged.set(branch.type, group)
      result.push({ type: branch.type, enum: group.enum })
    }
    for (const value of branch.enum) {
      const valueKey = jsonKey(value)
      if (!group.seen.has(valueKey)) {
        group.seen.add(valueKey)
        group.enum.push(value)
      } else if (key === 'oneOf') {
        return
      }
    }
  }
  if (result.length < branches.length) {
    out[key] = result
  }
}

const ONE_OF_TYPES = new Set(['array', 'boolean', 'integer', 'number', 'string'])

// Zod writes a union of scalars as a `type` list, which becomes an `anyOf`,
// ArkType, Valibot and Pydantic as an `anyOf` of them, also with an array, as
// for `string | string[]`, and Effect a number as an `anyOf` of it and the
// strings it writes for NaN and the infinities. No value has two of these types
// but an integer, which is a number too, so a `oneOf` of branches of different
// types, which only a null branch lets null match, means the same. NSwag reads
// it as the first branch and the OpenAPI Generator TypeScript client as a
// union, but the `anyOf` as an empty class. NSwag reads an `enum` beside the
// `anyOf` only, and gives a property a type it never defines when an `allOf`
// holds a `$ref` to the `oneOf`, as a `$ref` with siblings becomes, so a schema
// a `$ref` points to keeps it.
function scalarOneOf(out: Record<string, unknown>): void {
  const branches = out.anyOf
  if (!Array.isArray(branches) || out.oneOf !== undefined || out.enum !== undefined) {
    return
  }
  // Such a `oneOf` as a branch, as a nullable union of them or an Effect
  // number in a union becomes, joins this one. Zod writes the description of
  // a described union in that branch, which then moves here. One with null
  // twice rejects null, so it stays.
  const members: unknown[] = []
  const notes: Record<string, unknown> = {}
  for (const branch of branches) {
    if (
      isRecord(branch) &&
      Array.isArray(branch.oneOf) &&
      Object.keys(branch).every(
        (name) =>
          name === 'oneOf' ||
          (isAnnotation(name) &&
            (!Object.hasOwn(out, name) || repeats(out, branch, name)) &&
            (!Object.hasOwn(notes, name) || repeats(notes, branch, name))),
      ) &&
      branch.oneOf.filter((member) => isNullBranch(member, out)).length <= 1
    ) {
      members.push(...branch.oneOf)
      Object.assign(notes, branch)
    } else {
      members.push(branch)
    }
  }
  // Effect writes null twice for a nullish value, which the `oneOf` takes
  // once, since null would match both.
  const oneOf: unknown[] = []
  const types = new Set<unknown>()
  let nullable = false
  for (const member of members) {
    if (isNullBranch(member, out)) {
      if (nullable) {
        continue
      }
      nullable = true
    } else if (
      isRecord(member) &&
      ONE_OF_TYPES.has(member.type as string) &&
      !types.has(member.type) &&
      member.nullable !== true
    ) {
      types.add(member.type)
    } else {
      return
    }
    oneOf.push(member)
  }
  if (!(types.has('integer') && types.has('number'))) {
    delete out.anyOf
    Object.assign(out, notes, { oneOf })
  }
}

// The type of every value in a list, when they all have the same one.
function sharedType(values: unknown): string | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }
  const type = valueType(values[0])
  return values.every((value) => valueType(value) === type) ? type : undefined
}

function isMediaTypeOnly(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.contentMediaType === 'string' &&
    hasOnly(value, (key) => key === 'contentMediaType')
  )
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
  return schema.contentEncoding === undefined &&
    schema.contentMediaType !== undefined &&
    schema.contentSchema === undefined
    ? 'binary'
    : undefined
}

// An untyped schema with these holds what they hold, such as the object of a
// JSON body marked with its media type, not a binary string.
function hasSubschemas(schema: Record<string, unknown>): boolean {
  return (
    schema.$ref !== undefined ||
    schema.allOf !== undefined ||
    schema.anyOf !== undefined ||
    schema.oneOf !== undefined ||
    schema.properties !== undefined ||
    schema.items !== undefined ||
    schema.prefixItems !== undefined
  )
}

function finishSchema(
  out: Record<string, unknown>,
  schema: Record<string, unknown>,
  ctx: Context,
): void {
  // 3.0 ignores the siblings of a `$ref`, but not the members of an `allOf`.
  if (typeof schema.$ref === 'string') {
    out.allOf = [convertSchemaRef(schema.$ref, ctx), ...(Array.isArray(out.allOf) ? out.allOf : [])]
  }
  if (out.discriminator !== undefined && !keepsDiscriminator(schema, ctx)) {
    delete out.discriminator
  }
  if (schema.const !== undefined) {
    out.enum = [clone(schema.const)]
  }
  if (Array.isArray(schema.enum) && schema.enum.length === 0) {
    addAllOf(out, { not: {} })
  }
  const exactTuple =
    Array.isArray(schema.prefixItems) && convertTuple(out, schema.prefixItems, schema, ctx)
  if (isUnevaluatedAdditional(schema)) {
    out.additionalProperties = convertAdditional(schema.unevaluatedProperties, ctx)
  }
  const names = enumNames(schema, ctx)
  if (names !== undefined) {
    const value = isRecord(out.additionalProperties) ? out.additionalProperties : {}
    out.properties = Object.fromEntries(names.map((name) => [name, value]))
    out.additionalProperties = false
  }
  // Before `convertType` moves `items` and the object keywords into `anyOf` branches.
  // A `const` outside the `enum` beside it matched nothing, and now matches itself.
  const constOutsideEnum =
    schema.const !== undefined &&
    Array.isArray(schema.enum) &&
    !includesJson(schema.enum, schema.const)
  let loose = loosen(out, schema, exactTuple, ctx) || constOutsideEnum
  // 3.0 lacks `patternProperties`, and `additionalProperties` beside it is
  // dropped, as it would reject the properties `patternProperties` allowed.
  // Code generators read a missing one as allowing no other properties.
  if (schema.patternProperties !== undefined) {
    out.additionalProperties = true
  }
  convertType(out, schema.type)
  // Written 3.0-style in a 3.1 document, it can only mean what it means in 3.0.
  if (schema.nullable === true && typeof out.type === 'string' && out.nullable !== true) {
    out.nullable = true
    loose = true
  }
  // Only null matches it. `enum` is set again to follow `type` and `nullable`.
  if (out.type === undefined && isOnlyNull(out.enum)) {
    delete out.enum
    Object.assign(out, onlyNull())
  }
  // Code generators drop or leave untyped an `enum` with no `type`, as a
  // `const` becomes and ArkType writes a union of literals, so it gets the
  // type its values share.
  const enumType = out.type === undefined ? sharedType(out.enum) : undefined
  if (enumType !== undefined) {
    const values = out.enum
    delete out.enum
    out.type = enumType
    out.enum = values
  }
  // NSwag reads a union of enums with no `type` beside it, as Zod writes a
  // union of literals and OpenSearch a documented enum, as an empty class or
  // as a type it never defines. Every branch already has that `type`.
  const unionType = out.type === undefined ? enumUnionType(out.anyOf ?? out.oneOf) : undefined
  if (unionType !== undefined) {
    out.type = unionType
  }
  if (out.type === 'array' && out.items === undefined) {
    out.items = {}
  }
  const { exclusiveMaximum, exclusiveMinimum, maximum, minimum } = schema
  if (
    typeof exclusiveMinimum === 'number' &&
    !(typeof minimum === 'number' && minimum > exclusiveMinimum)
  ) {
    out.minimum = exclusiveMinimum
    out.exclusiveMinimum = true
  }
  if (
    typeof exclusiveMaximum === 'number' &&
    !(typeof maximum === 'number' && maximum < exclusiveMaximum)
  ) {
    out.maximum = exclusiveMaximum
    out.exclusiveMaximum = true
  }
  // The 3.0 boolean form, as NestJS writes it in 3.1, means in 3.0 what its
  // author meant beside a numeric bound.
  if (exclusiveMinimum === true && typeof minimum === 'number') {
    out.exclusiveMinimum = true
  }
  if (exclusiveMaximum === true && typeof maximum === 'number') {
    out.exclusiveMaximum = true
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0 && out.example === undefined) {
    out.example = clone(schema.examples[0])
  }
  const format = binaryFormat(schema)
  if (
    format !== undefined &&
    (schema.type === undefined ? !hasSubschemas(schema) : hasType(schema.type, 'string'))
  ) {
    // A `format` that only repeats the encoding, as Zod writes, gives way.
    if (out.format === undefined || out.format === schema.contentEncoding) {
      out.format = format
    }
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
  // Two named reads, as reading `out[key]` in a loop here costs a few percent of a conversion.
  if (Array.isArray(out.anyOf) && out.anyOf.length > 1) {
    nullableUnions.push([out, schema, 'anyOf'])
  }
  if (Array.isArray(out.oneOf) && out.oneOf.length > 1) {
    nullableUnions.push([out, schema, 'oneOf'])
  }
  if (loose) {
    LOOSE.add(out)
  }
}

// Spelled out, not through `hasOnly`, since it runs for every `$ref`.
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
  if (
    ref !== undefined &&
    (isBareRef(value as Record<string, unknown>) ||
      (isAnnotatedRef(value as Record<string, unknown>) && isTaggedRef(ref, ctx)))
  ) {
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
function finishMergedPathItem(
  out: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  ctx: Context,
): void {
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
// it. A requirement left empty is removed, because an empty one would mean
// that no security is needed. A list left empty is removed too, so an
// operation falls back to the document's `security`, though the document's
// own list then needs no security either way. 3.0 also allows scopes only for
// OAuth2 and OpenID Connect.
function convertSecurity(value: unknown, ctx: Context): unknown {
  if (!Array.isArray(value)) {
    return clone(value)
  }
  const schemes = resolvePointer('#/components/securitySchemes', ctx)
  const typeOf = (name: string): unknown =>
    isRecord(schemes) && Object.hasOwn(schemes, name) ? schemeType(schemes[name], ctx) : undefined
  const out: unknown[] = []
  for (const requirement of value) {
    if (!isRecord(requirement)) {
      out.push(clone(requirement))
      continue
    }
    const entries = Object.keys(requirement)
      .filter((name) => requirement[name] !== undefined)
      .map((name) => [name, typeOf(name)] as const)
    const kept = entries.filter(([, type]) => type !== 'mutualTLS')
    if (kept.length > 0 || entries.length === 0) {
      out.push(
        Object.fromEntries(
          kept.map(([name, type]) => [
            name,
            type === 'apiKey' || type === 'http' ? [] : clone(requirement[name]),
          ]),
        ),
      )
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

function downgradeV30(root: unknown, convert: Convert): unknown {
  try {
    const out = downgrade(root, convert)
    for (const [schema, input, key] of nullableUnions) {
      if (!unionTargets.has(input) && (key === 'oneOf' || dropEqualBranches(schema))) {
        const isTarget = refTargets.has(input)
        mergeEnums(schema, key)
        const branches = schema[key]
        // A `oneOf` with null twice rejects null, so only a pair can merge.
        if (Array.isArray(branches) && (key === 'anyOf' || branches.length === 2)) {
          mergeNullable(schema, root, key, isTarget)
        }
        if (!isTarget) {
          scalarOneOf(schema)
        }
      }
    }
    return out
  } finally {
    // Cleared even when conversion throws, so nothing keeps the input alive.
    nullableUnions.length = 0
    unionTargets.clear()
    refTargets.clear()
  }
}

/** Downgrades an OpenAPI 3.1 document to 3.0, setting `openapi` to `3.0.4`. The input is never changed. */
export function downgradeSpecV31ToV30(spec: OpenAPIV3_1.OpenAPIObject): OpenAPIV3_0.OpenAPIObject {
  return downgradeV30(spec, convertDocument) as OpenAPIV3_0.OpenAPIObject
}

/** Downgrades a 3.1 Schema Object to 3.0. Local `$ref`s resolve against the schema itself. The input is never changed. */
export function downgradeSchemaV31ToV30<T = unknown>(
  schema: OpenAPIV3_1.SchemaObject<T>,
): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return downgradeV30(schema, convertSchema) as
    | OpenAPIV3_0.ReferenceObject
    | OpenAPIV3_0.SchemaObject<T>
}
