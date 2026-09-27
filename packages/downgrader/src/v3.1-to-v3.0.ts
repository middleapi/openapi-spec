import type { OpenAPIV3_0, OpenAPIV3_1 } from '@openapi-spec/types'

import type { FieldConverter, FieldTable } from './shared'
import {
  convertRecord,
  deepClone,
  DROP,
  getRef,
  isRecord,
  mapArray,
  mapRecord,
  operationFields,
} from './shared'

const INLINE_LIMIT = 100_000
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/
const DESCRIPTION = ['description']
const SUMMARY_AND_DESCRIPTION = ['summary', 'description']
const SECURITY_SCHEMES_REF_PREFIX = '#/components/securitySchemes/'

interface Context {
  document: Record<string, unknown> | undefined
  inlined: number
  inlining: Set<unknown>
  linkChecks: [links: Record<string, unknown>, name: string, operationId: string | typeof DROP][]
  operationIds: Set<string>
  schemaFields: FieldTable
  schemeTypes: ReadonlyMap<string, string>
}

type Convert = (item: unknown, context: Context) => unknown

interface Chain {
  fields: Record<string, unknown>
  target: unknown
}

function decodeFragment(ref: string): string | undefined {
  try {
    return decodeURIComponent(ref.slice(1))
  }
  catch {
    return undefined
  }
}

function parsePointer(ref: string): string[] | undefined {
  const pointer = ref.startsWith('#') ? decodeFragment(ref) : undefined
  if (!pointer?.startsWith('/')) {
    return undefined
  }
  return pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function parseRemovedPointer(ref: string, context: Context): string[] | undefined {
  const tokens = context.document === undefined ? undefined : parsePointer(ref)
  const removed = tokens?.[0] === 'webhooks' || (tokens?.[0] === 'components' && tokens[1] === 'pathItems')
  return removed ? tokens : undefined
}

function resolvePointer(tokens: readonly string[], document: unknown): unknown {
  let current = document
  for (const token of tokens) {
    if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token]
    }
    else if (Array.isArray(current) && ARRAY_INDEX.test(token) && Number(token) < current.length) {
      current = current[Number(token)]
    }
    else {
      return undefined
    }
  }
  return current
}

function isPureRef(value: unknown): value is { $ref: string } {
  return isRecord(value) && typeof value.$ref === 'string' && Object.keys(value).length === 1
}

function isPathItemLocation(tokens: readonly string[]): boolean {
  return tokens.length === (tokens[0] === 'webhooks' ? 2 : 3) || tokens.at(-3) === 'callbacks'
}

function followRefs(
  value: Record<string, unknown>,
  context: Context,
  isHop: (item: Record<string, unknown>) => boolean = () => true,
  isLocation: (tokens: readonly string[]) => boolean = () => true,
): Chain | undefined {
  const seen = new Set<unknown>()
  let fields: Record<string, unknown> = {}
  let target: unknown = value
  while (isRecord(target) && typeof target.$ref === 'string' && isHop(target)) {
    const tokens = parseRemovedPointer(target.$ref, context)
    if (tokens === undefined) {
      break
    }
    if (seen.has(target) || !isLocation(tokens)) {
      return undefined
    }
    seen.add(target)
    const { $ref: _, ...own } = target
    fields = { ...own, ...fields }
    target = resolvePointer(tokens, context.document)
  }
  return target === undefined ? undefined : { fields, target }
}

function inline(target: Record<string, unknown>, fields: Record<string, unknown>, context: Context, convert: (copy: Record<string, unknown>) => unknown): unknown {
  if (context.inlining.has(target) || context.inlined >= INLINE_LIMIT) {
    return DROP
  }
  context.inlined += 1
  context.inlining.add(target)
  try {
    return convert(deepClone({ ...target, ...fields }))
  }
  finally {
    context.inlining.delete(target)
  }
}

function pickFields(fields: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(fields, key)).map(key => [key, fields[key]]))
}

function convertRefOr(value: unknown, context: Context, convert: Convert, overrides: readonly string[] = DESCRIPTION): unknown {
  if (!isRecord(value) || typeof value.$ref !== 'string') {
    return convert(value, context)
  }
  const chain = followRefs(value, context)
  if (chain === undefined || !isRecord(chain.target)) {
    return { $ref: value.$ref }
  }
  const ref = getRef(chain.target)
  if (ref !== undefined) {
    return { $ref: ref }
  }
  return inline(chain.target, pickFields(chain.fields, overrides), context, copy => convert(copy, context))
}

function refMap(context: Context, convert: Convert, overrides?: readonly string[]): FieldConverter {
  return item => mapRecord(item, entry => convertRefOr(entry, context, convert, overrides))
}

function refList(context: Context, convert: Convert): FieldConverter {
  return item => mapArray(item, entry => convertRefOr(entry, context, convert))
}

function applyTypes(types: string[], schema: Record<string, unknown>, out: Record<string, unknown>): void {
  const nullable = types.includes('null')
  const rest = types.filter(item => item !== 'null')
  if (rest.length === 1) {
    out.type = rest[0]
    if (nullable) {
      out.nullable = true
    }
    return
  }
  if (rest.length === 0) {
    if (!nullable) {
      return
    }
    out.nullable = true
    if ('const' in schema) {
      if (schema.const !== null) {
        out.not = {}
      }
    }
    else if (Array.isArray(schema.enum)) {
      if (schema.enum.includes(null)) {
        out.enum = [null]
      }
      else {
        out.not = {}
      }
    }
    else if (!('enum' in schema)) {
      out.enum = [null]
    }
    return
  }
  const variants = rest.map((item) => {
    const variant: Record<string, unknown> = { type: item }
    if (item === 'array') {
      variant.items = out.items === undefined ? {} : deepClone(out.items)
    }
    if (nullable) {
      variant.nullable = true
    }
    return variant
  })
  if (out.anyOf === undefined) {
    out.anyOf = variants
  }
  else if (out.allOf === undefined || Array.isArray(out.allOf)) {
    out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), { anyOf: variants }]
  }
}

function convertType(schema: Record<string, unknown>, out: Record<string, unknown>): void {
  const { type } = schema
  if (type === undefined) {
    return
  }
  if (typeof type === 'string') {
    applyTypes([type], schema, out)
    return
  }
  if (Array.isArray(type)) {
    const types = [...new Set(type.filter(item => typeof item === 'string'))]
    if (types.length > 0 || type.length === 0) {
      applyTypes(types, schema, out)
      return
    }
  }
  out.type = deepClone(type)
}

function convertConst(schema: Record<string, unknown>, out: Record<string, unknown>): void {
  if (!('const' in schema)) {
    return
  }
  out.enum = [deepClone(schema.const)]
  if (schema.const === null) {
    out.nullable = true
  }
}

function convertExamples(schema: Record<string, unknown>, out: Record<string, unknown>): void {
  if (Array.isArray(schema.examples) && schema.examples.length > 0 && !('example' in schema)) {
    out.example = deepClone(schema.examples[0])
  }
}

function convertExclusiveBounds(schema: Record<string, unknown>, out: Record<string, unknown>): void {
  const { exclusiveMaximum, exclusiveMinimum, maximum, minimum } = schema
  if (typeof exclusiveMinimum === 'number' && !(typeof minimum === 'number' && minimum > exclusiveMinimum)) {
    out.minimum = exclusiveMinimum
    out.exclusiveMinimum = true
  }
  if (typeof exclusiveMaximum === 'number' && !(typeof maximum === 'number' && maximum < exclusiveMaximum)) {
    out.maximum = exclusiveMaximum
    out.exclusiveMaximum = true
  }
}

function convertContentKeywords(schema: Record<string, unknown>, out: Record<string, unknown>): void {
  if (out.format !== undefined) {
    return
  }
  if (schema.contentEncoding === 'base64') {
    out.format = 'byte'
  }
  else if (schema.contentEncoding === undefined && schema.contentMediaType === 'application/octet-stream') {
    out.format = 'binary'
  }
}

function convertXml(value: unknown, schemaType: unknown): unknown {
  return convertRecord(value, { nodeType: DROP }, (out, xml) => {
    if (xml.nodeType === 'attribute') {
      out.attribute = true
    }
    else if (xml.nodeType === 'element' && (schemaType === 'array' || (Array.isArray(schemaType) && schemaType.includes('array')))) {
      out.wrapped = true
    }
    return out
  })
}

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>, context: Context): Record<string, unknown> {
  convertType(schema, out)
  convertConst(schema, out)
  convertExamples(schema, out)
  convertExclusiveBounds(schema, out)
  convertContentKeywords(schema, out)
  if (out.type === 'array' && out.items === undefined) {
    out.items = {}
  }
  if (typeof schema.$ref === 'string') {
    if (out.allOf === undefined || Array.isArray(out.allOf)) {
      out.allOf = [convertSchemaRef({ $ref: schema.$ref }, context), ...(Array.isArray(out.allOf) ? out.allOf : [])]
    }
    else {
      out.$ref = schema.$ref
    }
  }
  return out
}

function createSchemaFields(context: Context): FieldTable {
  const convert = (item: unknown): unknown => convertSchema(item, context)
  const convertSubschemas = (item: unknown): unknown => mapArray(item, convert)
  return {
    $anchor: DROP,
    $comment: DROP,
    $defs: DROP,
    $dynamicAnchor: DROP,
    $dynamicRef: DROP,
    $id: DROP,
    $ref: item => (typeof item === 'string' ? DROP : deepClone(item)),
    $schema: DROP,
    $vocabulary: DROP,
    additionalProperties: (item, schema) => {
      if ('patternProperties' in schema) {
        return DROP
      }
      return typeof item === 'boolean' ? item : convert(item)
    },
    allOf: convertSubschemas,
    anyOf: convertSubschemas,
    const: DROP,
    contains: DROP,
    contentEncoding: DROP,
    contentMediaType: DROP,
    contentSchema: DROP,
    dependentRequired: DROP,
    dependentSchemas: DROP,
    discriminator: item => convertRecord(item, {
      mapping: mapping => mapRecord(mapping, value => (typeof value === 'string' && parseRemovedPointer(value, context) !== undefined ? DROP : deepClone(value))),
    }),
    else: DROP,
    enum: item => (Array.isArray(item) && item.length === 0 ? DROP : deepClone(item)),
    examples: DROP,
    exclusiveMaximum: item => (typeof item === 'number' ? DROP : deepClone(item)),
    exclusiveMinimum: item => (typeof item === 'number' ? DROP : deepClone(item)),
    if: DROP,
    items: (item, schema) => ('prefixItems' in schema ? DROP : convert(item)),
    maxContains: DROP,
    minContains: DROP,
    not: convert,
    oneOf: convertSubschemas,
    patternProperties: DROP,
    prefixItems: DROP,
    properties: item => mapRecord(item, convert),
    propertyNames: DROP,
    required: (item) => {
      if (!Array.isArray(item)) {
        return deepClone(item)
      }
      return item.length === 0 ? DROP : deepClone([...new Set(item)])
    },
    then: DROP,
    type: DROP,
    unevaluatedItems: DROP,
    unevaluatedProperties: DROP,
    xml: (item, schema) => convertXml(item, schema.type),
  }
}

function convertSchemaRef(value: { $ref: string }, context: Context): unknown {
  const target = followRefs(value, context, isPureRef)?.target
  if (typeof target === 'boolean') {
    return convertSchema(target, context)
  }
  if (isPureRef(target)) {
    return { $ref: target.$ref }
  }
  if (!isRecord(target)) {
    return { $ref: value.$ref }
  }
  const inlined = inline(target, {}, context, copy => convertSchema(copy, context))
  return inlined === DROP ? {} : inlined
}

function convertSchema(schema: unknown, context: Context): unknown {
  if (schema === true) {
    return {}
  }
  if (schema === false) {
    return { not: {} }
  }
  if (isPureRef(schema)) {
    return convertSchemaRef(schema, context)
  }
  return convertRecord(schema, context.schemaFields, (out, source) => finishSchema(out, source, context))
}

export function downgradeSchemaV31ToV30<T = unknown>(schema: OpenAPIV3_1.SchemaObject<T>): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return convertSchema(schema, createContext(undefined)) as OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T>
}

function resolveSchemeType(name: string, schemes: Record<string, unknown>, seen: Set<string>): string | undefined {
  if (seen.has(name) || !Object.hasOwn(schemes, name)) {
    return undefined
  }
  const scheme = schemes[name]
  if (!isRecord(scheme)) {
    return undefined
  }
  if (typeof scheme.type === 'string') {
    return scheme.type
  }
  const ref = getRef(scheme)
  if (ref !== undefined && ref.startsWith(SECURITY_SCHEMES_REF_PREFIX)) {
    const target = ref.slice(SECURITY_SCHEMES_REF_PREFIX.length)
    if (target !== '' && !target.includes('/')) {
      seen.add(name)
      return resolveSchemeType(target, schemes, seen)
    }
  }
  return undefined
}

function createContext(spec: unknown): Context {
  const document = isRecord(spec) ? spec : undefined
  const components = document?.components
  const schemes = isRecord(components) ? components.securitySchemes : undefined
  const schemeTypes = new Map<string, string>()
  if (isRecord(schemes)) {
    for (const name of Object.keys(schemes)) {
      const type = resolveSchemeType(name, schemes, new Set())
      if (type !== undefined) {
        schemeTypes.set(name, type)
      }
    }
  }
  const context: Context = {
    document,
    inlined: 0,
    inlining: new Set(),
    linkChecks: [],
    operationIds: new Set(),
    schemaFields: {},
    schemeTypes,
  }
  context.schemaFields = createSchemaFields(context)
  return context
}

function isMutualTls(name: string, context: Context): boolean {
  return context.schemeTypes.get(name) === 'mutualTLS'
}

function convertRequirement(value: unknown, context: Context): unknown {
  if (!isRecord(value)) {
    return deepClone(value)
  }
  const entries = Object.entries(value)
  const kept = entries.filter(([name]) => !isMutualTls(name, context))
  if (kept.length === 0 && entries.length > 0) {
    return DROP
  }
  return Object.fromEntries(kept.map(([name, scopes]) => {
    const type = context.schemeTypes.get(name)
    const scoped = type === undefined || type === 'oauth2' || type === 'openIdConnect'
    return [name, Array.isArray(scopes) && !scoped ? [] : deepClone(scopes)]
  }))
}

function convertSecurity(value: unknown, context: Context): unknown {
  if (!Array.isArray(value)) {
    return deepClone(value)
  }
  const out = value.map(item => convertRequirement(item, context)).filter(item => item !== DROP)
  return value.length > 0 && out.length === 0 ? DROP : out
}

function convertInfo(value: unknown): unknown {
  return convertRecord(value, {
    license: item => convertRecord(item, { identifier: DROP }),
    summary: DROP,
  })
}

function convertParameterOrHeader(value: unknown, context: Context): unknown {
  return convertRecord(
    value,
    {
      content: item => convertContent(item, context),
      examples: refMap(context, deepClone, SUMMARY_AND_DESCRIPTION),
      schema: item => convertSchema(item, context),
    },
    (out, parameter) => {
      if (parameter.in === 'path') {
        out.required = true
      }
      return out
    },
  )
}

function convertEncoding(value: unknown, context: Context): unknown {
  return convertRecord(value, { headers: refMap(context, convertParameterOrHeader) })
}

function convertMediaType(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    encoding: item => mapRecord(item, entry => convertEncoding(entry, context)),
    examples: refMap(context, deepClone, SUMMARY_AND_DESCRIPTION),
    schema: item => convertSchema(item, context),
  })
}

function convertContent(item: unknown, context: Context): unknown {
  return mapRecord(item, entry => convertMediaType(entry, context))
}

function convertRequestBody(value: unknown, context: Context): unknown {
  return convertRecord(value, { content: item => convertContent(item, context) })
}

function linkedOperationId(link: unknown, context: Context): string | typeof DROP | undefined {
  const seen = new Set<unknown>()
  let target = link
  while (isRecord(target) && typeof target.$ref === 'string' && !seen.has(target)) {
    seen.add(target)
    const tokens = parsePointer(target.$ref)
    target = tokens === undefined ? undefined : resolvePointer(tokens, context.document)
  }
  const tokens = isRecord(target) && typeof target.operationRef === 'string' ? parseRemovedPointer(target.operationRef, context) : undefined
  if (tokens === undefined) {
    return undefined
  }
  const operation = resolvePointer(tokens, context.document)
  return isRecord(operation) && typeof operation.operationId === 'string' ? operation.operationId : DROP
}

function convertLink(value: unknown, context: Context): unknown {
  const operationId = linkedOperationId(value, context)
  if (typeof operationId !== 'string') {
    return deepClone(value)
  }
  return convertRecord(value, { operationRef: DROP }, (out) => {
    out.operationId = operationId
    return out
  })
}

function convertLinks(value: unknown, context: Context): unknown {
  const out = mapRecord(value, item => convertRefOr(item, context, convertLink))
  if (isRecord(value) && isRecord(out)) {
    for (const [name, item] of Object.entries(value)) {
      const operationId = linkedOperationId(item, context)
      if (operationId !== undefined) {
        context.linkChecks.push([out, name, operationId])
      }
    }
  }
  return out
}

function convertResponse(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    content: item => convertContent(item, context),
    headers: refMap(context, convertParameterOrHeader),
    links: item => convertLinks(item, context),
  })
}

function convertResponses(item: unknown, context: Context): unknown {
  return mapRecord(item, (entry, key) => key.startsWith('x-') ? deepClone(entry) : convertRefOr(entry, context, convertResponse))
}

function convertOperation(value: unknown, context: Context): unknown {
  return convertRecord(
    value,
    {
      callbacks: refMap(context, convertCallback, []),
      parameters: refList(context, convertParameterOrHeader),
      requestBody: item => convertRefOr(item, context, convertRequestBody),
      responses: item => convertResponses(item, context),
      security: item => convertSecurity(item, context),
    },
    (out) => {
      if (typeof out.operationId === 'string') {
        context.operationIds.add(out.operationId)
      }
      if (out.responses === undefined) {
        out.responses = { default: { description: '' } }
      }
      return out
    },
  )
}

function convertCallback(value: unknown, context: Context): unknown {
  return mapRecord(value, (item, key) => key.startsWith('x-') ? deepClone(item) : convertPathItem(item, context))
}

function convertPathItemFields(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    ...operationFields(item => convertOperation(item, context)),
    parameters: refList(context, convertParameterOrHeader),
  })
}

function convertPathItem(value: unknown, context: Context): unknown {
  if (!isRecord(value) || typeof value.$ref !== 'string') {
    return convertPathItemFields(value, context)
  }
  const chain = followRefs(value, context, undefined, isPathItemLocation)
  if (chain === undefined || !isRecord(chain.target) || chain.target === value) {
    return convertPathItemFields(value, context)
  }
  const { $ref: _, ...own } = value
  const inlined = inline(chain.target, chain.fields, context, copy => convertPathItem(copy, context))
  return inlined === DROP ? convertPathItemFields(own, context) : inlined
}

function convertPaths(value: unknown, context: Context): unknown {
  return mapRecord(value, (item, key) => key.startsWith('/') ? convertPathItem(item, context) : deepClone(item))
}

function convertComponents(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    callbacks: refMap(context, convertCallback, []),
    examples: refMap(context, deepClone, SUMMARY_AND_DESCRIPTION),
    headers: refMap(context, convertParameterOrHeader),
    links: item => convertLinks(item, context),
    parameters: refMap(context, convertParameterOrHeader),
    pathItems: DROP,
    requestBodies: refMap(context, convertRequestBody),
    responses: refMap(context, convertResponse),
    schemas: item => mapRecord(item, entry => convertSchema(entry, context)),
    securitySchemes: item => mapRecord(item, (scheme, name) => isMutualTls(name, context) ? DROP : convertRefOr(scheme, context, deepClone)),
  })
}

export function downgradeSpecV31ToV30(spec: OpenAPIV3_1.OpenAPIObject): OpenAPIV3_0.OpenAPIObject {
  const context = createContext(spec)
  const converted = convertRecord(
    spec,
    {
      components: item => convertComponents(item, context),
      info: convertInfo,
      jsonSchemaDialect: DROP,
      paths: item => convertPaths(item, context),
      security: item => convertSecurity(item, context),
      webhooks: DROP,
    },
    (out) => {
      out.openapi = '3.0.4'
      if (out.paths === undefined) {
        out.paths = {}
      }
      return out
    },
  )
  for (const [links, name, operationId] of context.linkChecks) {
    if (operationId === DROP || !context.operationIds.has(operationId)) {
      delete links[name]
    }
  }
  return converted as OpenAPIV3_0.OpenAPIObject
}
