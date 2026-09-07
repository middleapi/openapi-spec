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

function convertRefOr(value: unknown, convert: (item: unknown) => unknown): unknown {
  const ref = getRef(value)
  return ref === undefined ? convert(value) : { $ref: ref }
}

function refMap(convert: (item: unknown) => unknown): FieldConverter {
  return item => mapRecord(item, entry => convertRefOr(entry, convert))
}

function refList(convert: (item: unknown) => unknown): FieldConverter {
  return item => mapArray(item, entry => convertRefOr(entry, convert))
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

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
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
      out.allOf = [{ $ref: schema.$ref }, ...(Array.isArray(out.allOf) ? out.allOf : [])]
    }
    else {
      out.$ref = schema.$ref
    }
  }
  return out
}

function convertSubschemas(item: unknown): unknown {
  return mapArray(item, convertSchema)
}

const SCHEMA_FIELDS: FieldTable = {
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
    return typeof item === 'boolean' ? item : convertSchema(item)
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
  else: DROP,
  enum: item => (Array.isArray(item) && item.length === 0 ? DROP : deepClone(item)),
  examples: DROP,
  exclusiveMaximum: item => (typeof item === 'number' ? DROP : deepClone(item)),
  exclusiveMinimum: item => (typeof item === 'number' ? DROP : deepClone(item)),
  if: DROP,
  items: (item, schema) => ('prefixItems' in schema ? DROP : convertSchema(item)),
  maxContains: DROP,
  minContains: DROP,
  not: convertSchema,
  oneOf: convertSubschemas,
  patternProperties: DROP,
  prefixItems: DROP,
  properties: item => mapRecord(item, convertSchema),
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

function convertSchema(schema: unknown): unknown {
  if (schema === true) {
    return {}
  }
  if (schema === false) {
    return { not: {} }
  }
  if (isRecord(schema) && typeof schema.$ref === 'string' && Object.keys(schema).length === 1) {
    return { $ref: schema.$ref }
  }
  return convertRecord(schema, SCHEMA_FIELDS, finishSchema)
}

export function downgradeSchemaV31ToV30<T = unknown>(schema: OpenAPIV3_1.SchemaObject<T>): OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T> {
  return convertSchema(schema) as OpenAPIV3_0.ReferenceObject | OpenAPIV3_0.SchemaObject<T>
}

const PATH_ITEMS_REF_PREFIX = '#/components/pathItems/'
const SECURITY_SCHEMES_REF_PREFIX = '#/components/securitySchemes/'

interface Context {
  inlining: Set<string>
  pathItems: Record<string, unknown> | undefined
  schemeTypes: ReadonlyMap<string, string>
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
  const components = isRecord(spec) ? spec.components : undefined
  const pathItems = isRecord(components) ? components.pathItems : undefined
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
  return {
    inlining: new Set(),
    pathItems: isRecord(pathItems) ? pathItems : undefined,
    schemeTypes,
  }
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

function convertParameterOrHeader(value: unknown): unknown {
  return convertRecord(
    value,
    {
      content: convertContent,
      examples: refMap(deepClone),
      schema: convertSchema,
    },
    (out, parameter) => {
      if (parameter.in === 'path') {
        out.required = true
      }
      return out
    },
  )
}

function convertEncoding(value: unknown): unknown {
  return convertRecord(value, { headers: refMap(convertParameterOrHeader) })
}

function convertMediaType(value: unknown): unknown {
  return convertRecord(value, {
    encoding: item => mapRecord(item, convertEncoding),
    examples: refMap(deepClone),
    schema: convertSchema,
  })
}

function convertContent(item: unknown): unknown {
  return mapRecord(item, convertMediaType)
}

function convertRequestBody(value: unknown): unknown {
  return convertRecord(value, { content: convertContent })
}

function convertResponse(value: unknown): unknown {
  return convertRecord(value, {
    content: convertContent,
    headers: refMap(convertParameterOrHeader),
    links: refMap(deepClone),
  })
}

function convertResponses(item: unknown): unknown {
  return mapRecord(item, (entry, key) => key.startsWith('x-') ? deepClone(entry) : convertRefOr(entry, convertResponse))
}

function convertOperation(value: unknown, context: Context): unknown {
  return convertRecord(
    value,
    {
      callbacks: refMap(item => convertCallback(item, context)),
      parameters: refList(convertParameterOrHeader),
      requestBody: item => convertRefOr(item, convertRequestBody),
      responses: convertResponses,
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

function resolvePathItemRef(value: Record<string, unknown>, context: Context): [name: string, target: Record<string, unknown>] | undefined {
  const ref = getRef(value)
  if (ref === undefined || !ref.startsWith(PATH_ITEMS_REF_PREFIX)) {
    return undefined
  }
  const name = ref.slice(PATH_ITEMS_REF_PREFIX.length)
  if (name === '' || name.includes('/') || context.inlining.has(name) || context.pathItems === undefined || !Object.hasOwn(context.pathItems, name)) {
    return undefined
  }
  const target = context.pathItems[name]
  return isRecord(target) ? [name, target] : undefined
}

function convertPathItem(value: unknown, context: Context): unknown {
  if (!isRecord(value)) {
    return deepClone(value)
  }
  const resolved = resolvePathItemRef(value, context)
  if (resolved === undefined) {
    return convertRecord(value, {
      ...operationFields(item => convertOperation(item, context)),
      parameters: refList(convertParameterOrHeader),
    })
  }
  const [name, target] = resolved
  const { $ref: _, ...own } = value
  context.inlining.add(name)
  try {
    return convertPathItem({ ...target, ...own }, context)
  }
  finally {
    context.inlining.delete(name)
  }
}

function convertPaths(value: unknown, context: Context): unknown {
  return mapRecord(value, (item, key) => key.startsWith('/') ? convertPathItem(item, context) : deepClone(item))
}

function convertComponents(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    callbacks: refMap(item => convertCallback(item, context)),
    examples: refMap(deepClone),
    headers: refMap(convertParameterOrHeader),
    links: refMap(deepClone),
    parameters: refMap(convertParameterOrHeader),
    pathItems: DROP,
    requestBodies: refMap(convertRequestBody),
    responses: refMap(convertResponse),
    schemas: item => mapRecord(item, convertSchema),
    securitySchemes: item => mapRecord(item, (scheme, name) => isMutualTls(name, context) ? DROP : convertRefOr(scheme, deepClone)),
  })
}

export function downgradeSpecV31ToV30(spec: OpenAPIV3_1.OpenAPIObject): OpenAPIV3_0.OpenAPIObject {
  const context = createContext(spec)
  return convertRecord(
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
  ) as OpenAPIV3_0.OpenAPIObject
}
