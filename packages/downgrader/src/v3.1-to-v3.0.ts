import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'
import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import type { FieldConverter, FieldTable } from './shared'
import {
  convertRecord,
  deepClone,
  DROP,
  getRef,
  isConverting,
  isRecord,
  mapArray,
  mapRecord,
  operationFields,
  parseLocalRef,
  resolveLocalRef,
} from './shared'

const DESCRIPTION = ['description']
const SUMMARY_AND_DESCRIPTION = ['summary', 'description']
const SECURITY_SCHEMES_REF_PREFIX = '#/components/securitySchemes/'

interface Context {
  convertSchema: (value: unknown) => unknown
  document: Record<string, unknown> | undefined
  inlining: string[][]
  linkChecks: [links: Record<string, unknown>, name: string, operationId: string | typeof DROP][]
  operationIds: Set<string>
  schemeTypes: ReadonlyMap<string, string>
}

type Convert = (item: unknown, context: Context) => unknown

interface Chain {
  fields: Record<string, unknown>
  target: unknown
  tokens: string[]
}

function parseRemovedRef(ref: string, context: Context): string[] | undefined {
  const tokens = context.document === undefined ? undefined : parseLocalRef(ref)
  const removed = tokens?.[0] === 'webhooks' || (tokens?.[0] === 'components' && tokens[1] === 'pathItems')
  return removed ? tokens : undefined
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
  let tokens: string[] | undefined
  while (isRecord(target) && typeof target.$ref === 'string' && isHop(target)) {
    const next = parseRemovedRef(target.$ref, context)
    if (next === undefined) {
      break
    }
    if (seen.has(target) || !isLocation(next)) {
      return undefined
    }
    seen.add(target)
    const { $ref: ref, ...own } = target
    fields = { ...own, ...fields }
    tokens = next
    target = resolveLocalRef(context.document, ref)
  }
  return tokens === undefined || target === undefined ? undefined : { fields, target, tokens }
}

function inline(target: unknown, tokens: string[], context: Context, convert: () => unknown): unknown {
  if (isConverting(target) || context.inlining.some(inlined => tokens.every((token, index) => inlined[index] === token))) {
    return DROP
  }
  context.inlining.push(tokens)
  try {
    return convert()
  }
  finally {
    context.inlining.pop()
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
  const { fields, target, tokens } = chain
  const ref = getRef(target)
  if (ref !== undefined) {
    return { $ref: ref }
  }
  return inline(target, tokens, context, () => convert({ ...target, ...pickFields(fields, overrides) }, context))
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
  const convert = (item: unknown): unknown => context.convertSchema(item)
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
  const chain = followRefs(value, context, isPureRef)
  if (chain === undefined) {
    return { $ref: value.$ref }
  }
  const { target, tokens } = chain
  if (isPureRef(target)) {
    return { $ref: target.$ref }
  }
  if (!isRecord(target) && typeof target !== 'boolean') {
    return { $ref: value.$ref }
  }
  const inlined = inline(target, tokens, context, () => context.convertSchema(target))
  return inlined === DROP ? {} : inlined
}

export function downgradeSchemaV31ToV30<T = unknown>(schema: OpenAPIV3_1.SchemaObject<T>): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return createContext(undefined).convertSchema(schema) as OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T>
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
    convertSchema,
    document,
    inlining: [],
    linkChecks: [],
    operationIds: new Set(),
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
    return convertRecord(value, fields, finish)
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
  const seen = new Set<unknown>()
  let target = link
  while (isRecord(target) && typeof target.$ref === 'string' && !seen.has(target)) {
    seen.add(target)
    target = resolveLocalRef(context.document, target.$ref)
  }
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
  const chain = isRecord(value) ? followRefs(value, context, undefined, isPathItemLocation) : undefined
  if (!isRecord(value) || chain === undefined || !isRecord(chain.target)) {
    return convertPathItemFields(value, context)
  }
  const { fields, target, tokens } = chain
  const inlined = inline(target, tokens, context, () => convertPathItem({ ...target, ...fields }, context))
  if (inlined !== DROP) {
    return inlined
  }
  const { $ref: _, ...own } = value
  return convertPathItemFields(own, context)
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
