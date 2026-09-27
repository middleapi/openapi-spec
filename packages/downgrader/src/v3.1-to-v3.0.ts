import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'
import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import type { FieldConverter, FieldTable } from './shared'
import {
  convertInlined,
  convertRecord,
  deepClone,
  DROP,
  getRef,
  HTTP_METHODS_UP_TO_V31,
  isConverting,
  isRecord,
  mapArray,
  mapRecord,
  operationFields,
  parseLocalRef,
  resolveLocalRef,
} from './shared'

const HTTP_METHODS = new Set<string>(HTTP_METHODS_UP_TO_V31)
const DESCRIPTION = ['description']
const SUMMARY_AND_DESCRIPTION = ['summary', 'description']

interface Context {
  convertSchema: (value: unknown) => unknown
  document: Record<string, unknown> | undefined
  inlined: Map<Convert, Map<unknown, unknown>>
  inlining: Set<unknown>
  linkChecks: [links: Record<string, unknown>, name: string, operationId: string | typeof DROP][]
  schemeTypes: ReadonlyMap<string, string>
}

type Convert = (item: unknown, context: Context) => unknown

interface Chain {
  fields: Record<string, unknown>
  target: unknown
}

function parseRemovedRef(ref: string, context: Context): string[] | undefined {
  if (context.document === undefined || !(ref.startsWith('#/webhooks') || ref.startsWith('#/components/pathItems') || ref.includes('%'))) {
    return undefined
  }
  const tokens = parseLocalRef(ref)
  const removed = tokens?.[0] === 'webhooks' || (tokens?.[0] === 'components' && tokens[1] === 'pathItems')
  return removed ? tokens : undefined
}

function isPureRef(value: unknown): value is { $ref: string } {
  return isRecord(value) && typeof value.$ref === 'string' && Object.keys(value).length === 1
}

function isPathItemLocation(tokens: readonly string[]): boolean {
  if (tokens.length === (tokens[0] === 'webhooks' ? 2 : 3)) {
    return true
  }
  const [method = '', callbacks, , expression = 'x-'] = tokens.slice(-4)
  return callbacks === 'callbacks'
    && HTTP_METHODS.has(method)
    && !expression.startsWith('x-')
    && isPathItemLocation(tokens.slice(0, -4))
}

function followRefs(value: Record<string, unknown>, context: Context, kind: 'pathItem' | 'reference' | 'schema'): Chain | undefined {
  const seen = new Set<unknown>()
  let fields: Record<string, unknown> = {}
  let target: unknown = value
  while (isRecord(target) && typeof target.$ref === 'string') {
    const tokens = parseRemovedRef(target.$ref, context)
    if (tokens === undefined || (kind === 'schema' && !isPureRef(target))) {
      break
    }
    if (seen.has(target) || (kind === 'pathItem' && !isPathItemLocation(tokens))) {
      return undefined
    }
    seen.add(target)
    const { $ref: ref, ...own } = target
    fields = { ...own, ...fields }
    target = resolveLocalRef(context.document, ref)
  }
  return target === value || target === undefined ? undefined : { fields, target }
}

function resolveRefChain(value: unknown, document: unknown): unknown {
  const seen = new Set<unknown>()
  let target = value
  while (isRecord(target) && typeof target.$ref === 'string' && !seen.has(target)) {
    seen.add(target)
    target = resolveLocalRef(document, target.$ref)
  }
  return target
}

function inline(target: unknown, context: Context, convert: Convert): unknown {
  const cache = context.inlined.get(convert) ?? new Map<unknown, unknown>()
  context.inlined.set(convert, cache)
  if (cache.has(target)) {
    return cache.get(target)
  }
  if (isConverting(target) || context.inlining.has(target)) {
    return DROP
  }
  context.inlining.add(target)
  try {
    const out = convertInlined(() => convert(target, context))
    cache.set(target, out)
    return out
  }
  finally {
    context.inlining.delete(target)
  }
}

function pickFields(fields: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(fields, key)).map(key => [key, deepClone(fields[key])]))
}

function convertRefOr(value: unknown, context: Context, convert: Convert, overrides: readonly string[] = DESCRIPTION): unknown {
  if (!isRecord(value) || typeof value.$ref !== 'string') {
    return convert(value, context)
  }
  const chain = followRefs(value, context, 'reference')
  if (chain === undefined || !isRecord(chain.target)) {
    return { $ref: value.$ref }
  }
  const ref = getRef(chain.target)
  if (ref !== undefined) {
    return { $ref: ref }
  }
  const out = inline(chain.target, context, convert)
  const own = pickFields(chain.fields, overrides)
  return out === DROP || Object.keys(own).length === 0 ? out : { ...out as Record<string, unknown>, ...own }
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
  if (out.anyOf !== undefined && out.allOf !== undefined && !Array.isArray(out.allOf)) {
    return
  }
  const variants = rest.map((item) => {
    const variant: Record<string, unknown> = { type: item }
    if (item === 'array') {
      variant.items = out.items === undefined ? {} : out.items
      delete out.items
    }
    if (nullable) {
      variant.nullable = true
    }
    return variant
  })
  if (out.anyOf === undefined) {
    out.anyOf = variants
  }
  else {
    out.allOf = [...(Array.isArray(out.allOf) ? out.allOf : []), { anyOf: variants }]
  }
}

function hasType(type: unknown, name: string): boolean {
  return type === name || (Array.isArray(type) && type.includes(name))
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
  if ('const' in schema) {
    out.enum = [deepClone(schema.const)]
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

function getContentFormat(schema: Record<string, unknown>): string | undefined {
  if (schema.contentEncoding === 'base64') {
    return 'byte'
  }
  if (schema.contentEncoding === undefined && typeof schema.contentMediaType === 'string') {
    return 'binary'
  }
  return undefined
}

function convertContentKeywords(schema: Record<string, unknown>, out: Record<string, unknown>): void {
  const format = getContentFormat(schema)
  const { type } = schema
  if (format === undefined || (type !== undefined && !hasType(type, 'string'))) {
    return
  }
  if (type === undefined) {
    out.type = 'string'
  }
  if (out.format === undefined) {
    out.format = format
  }
}

function convertXml(value: unknown, schemaType: unknown): unknown {
  return convertRecord(value, { nodeType: DROP }, (out, xml) => {
    if (xml.nodeType === 'attribute') {
      out.attribute = true
    }
    else if (xml.nodeType === 'element' && hasType(schemaType, 'array')) {
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
  const convert = context.convertSchema
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
      mapping: mapping => mapRecord(mapping, value => (typeof value === 'string' && parseRemovedRef(value, context) !== undefined ? DROP : deepClone(value))),
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
  const target = followRefs(value, context, 'schema')?.target
  if (isPureRef(target)) {
    return { $ref: target.$ref }
  }
  if (!isRecord(target) && typeof target !== 'boolean') {
    return { $ref: value.$ref }
  }
  const out = inline(target, context, context.convertSchema)
  return out === DROP ? {} : out
}

const STANDALONE_CONTEXT = createContext(undefined)

export function downgradeSchemaV31ToV30<T = unknown>(schema: OpenAPIV3_1.SchemaObject<T>): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return STANDALONE_CONTEXT.convertSchema(schema) as OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T>
}

function createContext(spec: unknown): Context {
  const document = isRecord(spec) ? spec : undefined
  const components = document?.components
  const schemes = isRecord(components) ? components.securitySchemes : undefined
  const schemeTypes = new Map<string, string>()
  if (isRecord(schemes)) {
    for (const [name, scheme] of Object.entries(schemes)) {
      const target = resolveRefChain(scheme, document)
      if (isRecord(target) && typeof target.type === 'string') {
        schemeTypes.set(name, target.type)
      }
    }
  }
  const context: Context = {
    convertSchema,
    document,
    inlined: new Map(),
    inlining: new Set(),
    linkChecks: [],
    schemeTypes,
  }
  const fields = createSchemaFields(context)
  const finish = (out: Record<string, unknown>, schema: Record<string, unknown>): unknown => finishSchema(out, schema, context)
  function convertSchema(value: unknown): unknown {
    if (value === true) {
      return {}
    }
    if (value === false) {
      return { not: {} }
    }
    if (isPureRef(value)) {
      return convertSchemaRef(value, context)
    }
    const out = convertRecord(value, fields, finish)
    return out === DROP ? {} : out
  }
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
      schema: context.convertSchema,
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
    schema: context.convertSchema,
  })
}

function convertContent(item: unknown, context: Context): unknown {
  return mapRecord(item, entry => convertMediaType(entry, context))
}

function convertRequestBody(value: unknown, context: Context): unknown {
  return convertRecord(value, { content: item => convertContent(item, context) })
}

function linkedOperationId(link: unknown, context: Context): string | typeof DROP | undefined {
  const target = resolveRefChain(link, context.document)
  const operationRef = isRecord(target) ? target.operationRef : undefined
  if (typeof operationRef !== 'string' || parseRemovedRef(operationRef, context) === undefined) {
    return undefined
  }
  const operation = resolveLocalRef(context.document, operationRef)
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
  if (isRecord(value)) {
    for (const [name, item] of Object.entries(value)) {
      const operationId = linkedOperationId(item, context)
      if (operationId !== undefined) {
        context.linkChecks.push([out as Record<string, unknown>, name, operationId])
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
  const chain = isRecord(value) ? followRefs(value, context, 'pathItem') : undefined
  if (!isRecord(value) || chain === undefined || !isRecord(chain.target)) {
    return convertPathItemFields(value, context)
  }
  const out = inline(chain.target, context, convertPathItem)
  if (Object.keys(chain.fields).length === 0) {
    return out === DROP ? {} : out
  }
  const { $ref: _, ...own } = value
  const inherited = Object.fromEntries(Object.entries(chain.fields).filter(([key]) => !Object.hasOwn(own, key)))
  return {
    ...(out === DROP ? {} : out) as Record<string, unknown>,
    ...convertInlined(() => convertPathItemFields(inherited, context)) as Record<string, unknown>,
    ...convertPathItemFields(own, context) as Record<string, unknown>,
  }
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
    schemas: item => mapRecord(item, context.convertSchema),
    securitySchemes: item => mapRecord(item, (scheme, name) => isMutualTls(name, context) ? DROP : convertRefOr(scheme, context, deepClone)),
  })
}

function collectOperationIds(pathItems: unknown, ids: Set<string>, seen: WeakSet<object>): void {
  for (const [key, pathItem] of isRecord(pathItems) ? Object.entries(pathItems) : []) {
    if (key.startsWith('x-') || !isRecord(pathItem) || seen.has(pathItem)) {
      continue
    }
    seen.add(pathItem)
    for (const method of HTTP_METHODS_UP_TO_V31) {
      const operation = pathItem[method]
      if (isRecord(operation) && typeof operation.operationId === 'string') {
        ids.add(operation.operationId)
      }
      for (const callback of isRecord(operation) && isRecord(operation.callbacks) ? Object.values(operation.callbacks) : []) {
        collectOperationIds(callback, ids, seen)
      }
    }
  }
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
  if (context.linkChecks.length > 0) {
    const { components, paths } = converted as Record<string, unknown>
    const operationIds = new Set<string>()
    const seen = new WeakSet<object>()
    collectOperationIds(paths, operationIds, seen)
    const callbacks = isRecord(components) ? components.callbacks : undefined
    for (const callback of isRecord(callbacks) ? Object.values(callbacks) : []) {
      collectOperationIds(callback, operationIds, seen)
    }
    for (const [links, name, operationId] of context.linkChecks) {
      if (operationId === DROP || !operationIds.has(operationId)) {
        delete links[name]
      }
    }
  }
  return converted as OpenAPIV3_0.OpenAPIObject
}
