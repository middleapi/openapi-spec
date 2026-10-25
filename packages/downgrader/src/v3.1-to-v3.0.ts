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

const convertAnyOf = list(convertSchema)
const convertCallback = map(convertPathItem, isNotExtension)
const convertContent = map(convertMediaType)
const convertReference = refOr(clone)

const SCHEMA_FIELDS = defineFields({
  ...Object.fromEntries(REMOVED_KEYWORDS.map((key) => [key, DROP])),
  // It would reject the properties that `patternProperties` allowed.
  additionalProperties: (item, ctx, schema) => {
    if (schema.patternProperties !== undefined) {
      return DROP
    }
    return typeof item === 'boolean' ? item : convertSchema(item, ctx)
  },
  allOf: list(convertSchema),
  // Zod writes a file with several media types as an `anyOf` of branches
  // that hold only `contentMediaType`, an annotation, so it matches every
  // value. Its branches would each become a binary string in 3.0.
  anyOf: (item, ctx) =>
    Array.isArray(item) && item.some(isMediaTypeOnly) ? DROP : convertAnyOf(item, ctx),
  // An empty one rejects every value, which `finishSchema` keeps another way.
  enum: (item) => (Array.isArray(item) && item.length === 0 ? DROP : clone(item)),
  // `finishSchema` builds it from `prefixItems`.
  items: (item, ctx, schema) =>
    schema.prefixItems === undefined ? convertSchema(item, ctx) : DROP,
  not: convertSchema,
  oneOf: list(convertSchema),
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

// A `$ref` into a removed part, `$defs`, or `definitions`, or into the
// `additionalProperties` of a record keyed by an enum, which becomes `false`,
// is replaced by its target, unless it already dangles.
function isInlined(ref: string, ctx: Context): boolean {
  return (
    (ref.includes('/$defs/') ||
      ref.includes('/definitions/') ||
      REMOVED_PARTS.some((prefix) => ref.startsWith(prefix)) ||
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

function convertSchemaRef(ref: string, ctx: Context): unknown {
  if (!isInlined(ref, ctx)) {
    for (const key of ['/anyOf/', '/oneOf/']) {
      for (let at = ref.indexOf(key); at !== -1; at = ref.indexOf(key, at + 1)) {
        unionTargets.add(resolvePointer(ref.slice(0, at), ctx))
      }
    }
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
  out.items = rest.length === 0 ? first : { anyOf: [first, ...rest] }
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

function addAnyOf(out: Record<string, unknown>, variants: unknown[]): void {
  if (out.anyOf === undefined) {
    out.anyOf = variants
  } else {
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
  return (
    schema.unevaluatedProperties !== undefined &&
    IN_PLACE_APPLICATORS.every((key) => schema[key] === undefined)
  )
}

// The names allowed by a `propertyNames` holding only an `enum`, or a `const`
// for a single name, as Zod and Valibot write a record with enum or literal
// keys, when no other keyword names properties. Each becomes a property of its
// own, which 3.0 can express. A reusable enum is a `$ref` to it.
function enumNames(schema: Record<string, unknown>, ctx: Context): string[] | undefined {
  const ref = getRef(schema.propertyNames)
  // Followed alone or beside a `title` or `description`, as Zod writes a
  // described use, since other keywords beside it narrow the names further.
  const names =
    ref !== undefined &&
    Object.entries(schema.propertyNames as Record<string, unknown>).every(
      ([name, item]) => item === undefined || ['$ref', 'title', 'description'].includes(name),
    )
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
    !Object.entries(names).every(
      ([name, item]) =>
        item === undefined ||
        ['enum', 'const', 'title', 'description'].includes(name) ||
        (name === 'type' && item === 'string'),
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
          Object.entries(names).every(
            ([name, item]) => item === undefined || (name === 'type' && item === 'string'),
          ))
      )
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
    addAnyOf(out, out.oneOf)
    delete out.oneOf
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
    addAnyOf(out, [
      ...rest.map((item) => ({ type: item, ...(item === 'array' && { items: out.items ?? {} }) })),
      ...(nullable ? [onlyNull()] : []),
    ])
    delete out.items
  } else if (nullable) {
    // 3.0 has no null type, so only null may match, and an `enum` without it matches nothing.
    if (out.enum === undefined || (Array.isArray(out.enum) && out.enum.includes(null))) {
      out.enum = [null]
    } else {
      out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), { not: {} }]
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
// keywords repeat the schema around it.
function isNullBranch(value: unknown, out: Record<string, unknown>): boolean {
  return (
    isRecord(value) &&
    value.type === 'string' &&
    value.nullable === true &&
    isOnlyNull(value.enum) &&
    Object.keys(value).every(
      (name) =>
        name === 'type' || name === 'nullable' || name === 'enum' || repeats(out, value, name),
    )
  )
}

// A 3.1 `type` that names `"null"`, with nothing beside it that null could fail.
function acceptsNull(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    hasType(schema.type, 'null') &&
    schema.const === undefined &&
    !NOT_NULLABLE_KEYWORDS.some((name) => Object.hasOwn(schema, name))
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

// Zod writes a nullable object, array, or integer as an `anyOf` of it and
// `{ type: "null" }`. Code generators read that pair in 3.0 as a union or an
// empty class, so the branch takes its place with `nullable: true`, as 3.0
// writes it, when the schema around it has none of its keywords with another
// value. A branch that stays, such as a `$ref` or an `enum`, makes the pair a
// `oneOf` when it rejects null, as null then matches one branch only. NSwag
// reads that `oneOf` as nullable, and the `anyOf` as an empty class. typia
// and Litestar write the pair as a `oneOf`, which means the same when the
// other branch takes `nullable`, and oapi-codegen reads it as a union.
function mergeNullable(out: Record<string, unknown>, root: unknown, key: 'anyOf' | 'oneOf'): void {
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
      (name) =>
        (ANNOTATION_KEYWORDS.has(name) || name.startsWith('x-')) &&
        (!Object.hasOwn(out, name) || repeats(out, other, name)),
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
    // A `$ref` kept as written rejects null when its target does.
    const ref = getRef(other)
    const target = ref === undefined ? other : find(root, ref)
    if (rejectsNull(target)) {
      // Null once, since `oneOf` rejects a value that matches two branches.
      const nullBranch = branches.find((branch) => isNullBranch(branch, out))
      out.oneOf = branches[0] === other ? [other, nullBranch] : [nullBranch, other]
      delete out.anyOf
    } else if (ref !== undefined && Object.keys(out).length === 1 && acceptsNull(target)) {
      // GitHub writes a nullable reference this way to a schema that already
      // admits null, which 3.0 writes as the `$ref` alone. NSwag reads the pair
      // as an empty class, and oapi-codegen as a union.
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
  if (
    type === undefined ||
    (out.type !== undefined && out.type !== type) ||
    out.enum !== undefined
  ) {
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
    Object.entries(value).every(([key, item]) => key === 'contentMediaType' || item === undefined)
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

function finishSchema(
  out: Record<string, unknown>,
  schema: Record<string, unknown>,
  ctx: Context,
): void {
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
  const exactTuple =
    Array.isArray(schema.prefixItems) && convertTuple(out, schema.prefixItems, schema, ctx)
  if (isUnevaluatedAdditional(schema)) {
    const additional = schema.unevaluatedProperties
    out.additionalProperties =
      typeof additional === 'boolean' ? additional : convertSchema(additional, ctx)
  }
  const names = enumNames(schema, ctx)
  if (names !== undefined) {
    const value = isRecord(out.additionalProperties) ? out.additionalProperties : {}
    out.properties = Object.fromEntries(names.map((name) => [name, value]))
    out.additionalProperties = false
  }
  // Before `convertType` moves `items` into an `anyOf` branch.
  // A `const` outside the `enum` beside it matched nothing, and now matches itself.
  const constOutsideEnum =
    schema.const !== undefined &&
    Array.isArray(schema.enum) &&
    !includesJson(schema.enum, schema.const)
  let loose = loosen(out, schema, exactTuple, ctx) || constOutsideEnum
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
  // 3.0 lacks `patternProperties`, and `additionalProperties` beside it is
  // dropped, as it would reject the properties `patternProperties` allowed.
  // Code generators read a missing one as allowing no other properties.
  if (schema.patternProperties !== undefined) {
    out.additionalProperties = true
  }
  const format = binaryFormat(schema)
  if (format !== undefined && (schema.type === undefined || hasType(schema.type, 'string'))) {
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
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = out[key]
    if (Array.isArray(branches) && branches.length > 1) {
      nullableUnions.push([out, schema, key])
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
      if (!unionTargets.has(input)) {
        mergeEnums(schema, key)
        const branches = schema[key]
        // A `oneOf` with null twice rejects null, so only a pair can merge.
        if (Array.isArray(branches) && (key === 'anyOf' || branches.length === 2)) {
          mergeNullable(schema, root, key)
        }
      }
    }
    return out
  } finally {
    // Cleared even when conversion throws, so nothing keeps the input alive.
    nullableUnions.length = 0
    unionTargets.clear()
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
