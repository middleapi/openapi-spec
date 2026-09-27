import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import type { FieldConverter, FieldTable } from './shared'
import {
  convertRecord,
  deepClone,
  DROP,
  getChild,
  getRef,
  isConverting,
  isRecord,
  mapArray,
  mapRecord,
  operationFields,
  parseLocalRef,
  resolveLocalRef,
} from './shared'

const V32_DIALECT_PREFIX = 'https://spec.openapis.org/oas/3.2/dialect/'
const V31_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base'

interface Context {
  convertSchema: (value: unknown) => unknown
  dangles: (ref: string) => boolean
  inlining: Set<string>
  resolve: (ref: string) => unknown
}

export function downgradeSchemaV32ToV31<T = unknown>(schema: OpenAPIV3_2.SchemaObject<T>): OpenAPIV3_1.SchemaObject<T> {
  return deepClone(schema) as OpenAPIV3_1.SchemaObject<T>
}

function inlineRef(ref: string, context: Context, convert: (item: unknown) => unknown): unknown {
  const target = context.resolve(ref)
  if (isConverting(target) || [...context.inlining].some(inlined => inlined === ref || inlined.startsWith(`${ref}/`))) {
    return DROP
  }
  context.inlining.add(ref)
  const result = convert(target)
  context.inlining.delete(ref)
  return result
}

function convertRefOr(value: unknown, context: Context, convert: (item: unknown, context: Context) => unknown): unknown {
  const ref = getRef(value)
  if (ref === undefined) {
    return convert(value, context)
  }
  return context.dangles(ref) ? inlineRef(ref, context, item => convertRefOr(item, context, convert)) : deepClone(value)
}

function refMap(context: Context, convert: (item: unknown, context: Context) => unknown): FieldConverter {
  return item => mapRecord(item, entry => convertRefOr(entry, context, convert))
}

function createSchemaFields(schema: (item: unknown) => unknown, dangles: (ref: string) => boolean): FieldTable {
  const list = (item: unknown): unknown => mapArray(item, schema)
  const map = (item: unknown): unknown => mapRecord(item, schema)
  return {
    $defs: map,
    $ref: item => (typeof item === 'string' && dangles(item) ? DROP : deepClone(item)),
    additionalProperties: schema,
    allOf: list,
    anyOf: list,
    contains: schema,
    contentSchema: schema,
    dependentSchemas: map,
    else: schema,
    if: schema,
    items: schema,
    not: schema,
    oneOf: list,
    patternProperties: map,
    prefixItems: list,
    properties: map,
    propertyNames: schema,
    then: schema,
    unevaluatedItems: schema,
    unevaluatedProperties: schema,
  }
}

function finishSchema(out: Record<string, unknown>, schema: Record<string, unknown>, context: Context): unknown {
  const ref = getRef(schema)
  if (ref === undefined || '$ref' in out) {
    return out
  }
  const target = inlineRef(ref, context, context.convertSchema)
  if (target === DROP) {
    return out
  }
  if (Object.keys(out).length === 0) {
    return target
  }
  const allOf = out.allOf ?? []
  if (!Array.isArray(allOf)) {
    return { allOf: [out, target] }
  }
  out.allOf = [...allOf, target]
  return out
}

function convertServer(value: unknown): unknown {
  return convertRecord(value, { name: DROP })
}

function convertTag(value: unknown): unknown {
  return convertRecord(value, { kind: DROP, parent: DROP, summary: DROP })
}

function convertLink(value: unknown): unknown {
  return convertRecord(value, { server: convertServer })
}

function convertSecurityScheme(value: unknown): unknown {
  return convertRecord(value, {
    deprecated: DROP,
    flows: item => convertRecord(item, { deviceAuthorization: DROP }),
    oauth2MetadataUrl: DROP,
  })
}

function convertExample(value: unknown): unknown {
  return convertRecord(value, { dataValue: DROP, serializedValue: DROP }, (out, example) => {
    if ('value' in example || 'externalValue' in example) {
      return out
    }
    if ('dataValue' in example) {
      out.value = deepClone(example.dataValue)
    }
    else if ('serializedValue' in example) {
      out.value = deepClone(example.serializedValue)
    }
    return out
  })
}

function isQuerystringParameter(value: unknown): boolean {
  return isRecord(value) && value.in === 'querystring'
}

function memoize<T>(compute: (ref: string) => T): (ref: string) => T {
  const cache = new Map<string, T>()
  return (ref) => {
    if (!cache.has(ref)) {
      cache.set(ref, compute(ref))
    }
    return cache.get(ref) as T
  }
}

function resolveRefChain(value: unknown, context: Context): unknown {
  const seen = new Set<string>()
  let target = value
  let ref = getRef(target)
  while (ref !== undefined) {
    if (seen.has(ref)) {
      return undefined
    }
    seen.add(ref)
    target = context.resolve(ref)
    ref = getRef(target)
  }
  return target
}

function isRemovedHeader(value: unknown, context: Context): boolean {
  return losesEntireContent(resolveRefChain(value, context), context)
}

function isRemovedParameter(value: unknown, context: Context): boolean {
  const target = resolveRefChain(value, context)
  return isQuerystringParameter(target) || losesEntireContent(target, context)
}

function convertParameterOrHeader(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    allowReserved: (item, parameter) => (!('in' in parameter) || parameter.in === 'query' ? deepClone(item) : DROP),
    content: item => convertContentMap(item, context),
    examples: refMap(context, convertExample),
    schema: context.convertSchema,
    style: item => (item === 'cookie' ? DROP : deepClone(item)),
  })
}

function convertParameterEntry(value: unknown, context: Context): unknown {
  return isRemovedParameter(value, context) ? DROP : convertRefOr(value, context, convertParameterOrHeader)
}

function convertHeaderMap(value: unknown, context: Context): unknown {
  return mapRecord(value, item => isRemovedHeader(item, context) ? DROP : convertRefOr(item, context, convertParameterOrHeader))
}

function convertEncoding(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    encoding: DROP,
    headers: item => convertHeaderMap(item, context),
    itemEncoding: DROP,
    prefixEncoding: DROP,
  })
}

function convertMediaType(value: unknown, context: Context): unknown {
  return convertRecord(
    value,
    {
      description: DROP,
      encoding: item => mapRecord(item, entry => convertEncoding(entry, context)),
      examples: refMap(context, convertExample),
      itemEncoding: DROP,
      itemSchema: DROP,
      prefixEncoding: DROP,
      schema: context.convertSchema,
    },
    (out, mediaType) => {
      if ('itemSchema' in mediaType && out.schema === undefined) {
        out.schema = { items: context.convertSchema(mediaType.itemSchema), type: 'array' }
      }
      return out
    },
  )
}

function convertContentMap(value: unknown, context: Context): unknown {
  return mapRecord(value, (item) => {
    const target = resolveRefChain(item, context)
    return target === undefined ? DROP : convertMediaType(target, context)
  })
}

function convertRequestBody(value: unknown, context: Context): unknown {
  return convertRecord(value, { content: item => convertContentMap(item, context) })
}

function convertResponse(value: unknown, context: Context): unknown {
  return convertRecord(
    value,
    {
      content: item => convertContentMap(item, context),
      headers: item => convertHeaderMap(item, context),
      links: refMap(context, convertLink),
      summary: DROP,
    },
    (out, response) => {
      if (out.description === undefined) {
        out.description = typeof response.summary === 'string' ? response.summary : ''
      }
      return out
    },
  )
}

function convertResponses(value: unknown, context: Context): unknown {
  return mapRecord(value, (item, key) => key.startsWith('x-') ? deepClone(item) : convertRefOr(item, context, convertResponse))
}

function convertOperation(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    callbacks: refMap(context, convertCallback),
    parameters: item => mapArray(item, entry => convertParameterEntry(entry, context)),
    requestBody: item => convertRefOr(item, context, convertRequestBody),
    responses: item => convertResponses(item, context),
    servers: item => mapArray(item, convertServer),
  })
}

function convertCallback(value: unknown, context: Context): unknown {
  return mapRecord(value, (item, key) => key.startsWith('x-') ? deepClone(item) : convertPathItem(item, context))
}

function convertPathItem(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    ...operationFields(item => convertOperation(item, context)),
    additionalOperations: DROP,
    parameters: item => mapArray(item, entry => convertParameterEntry(entry, context)),
    query: DROP,
    servers: item => mapArray(item, convertServer),
  })
}

function convertPaths(value: unknown, context: Context): unknown {
  return mapRecord(value, (item, key) => key.startsWith('/') ? convertPathItem(item, context) : deepClone(item))
}

function convertComponents(value: unknown, context: Context): unknown {
  return convertRecord(value, {
    callbacks: refMap(context, convertCallback),
    examples: refMap(context, convertExample),
    headers: item => convertHeaderMap(item, context),
    links: refMap(context, convertLink),
    mediaTypes: DROP,
    parameters: item => mapRecord(item, entry => convertParameterEntry(entry, context)),
    pathItems: item => mapRecord(item, entry => convertPathItem(entry, context)),
    requestBodies: refMap(context, convertRequestBody),
    responses: refMap(context, convertResponse),
    schemas: item => mapRecord(item, context.convertSchema),
    securitySchemes: refMap(context, convertSecurityScheme),
  })
}

function losesEntireContent(value: unknown, context: Context): boolean {
  if (!(isRecord(value) && isRecord(value.content))) {
    return false
  }
  const entries = Object.values(value.content)
  return entries.length > 0 && entries.every(item => resolveRefChain(item, context) === undefined)
}

function convertJsonSchemaDialect(value: unknown): unknown {
  return typeof value === 'string' && value.startsWith(V32_DIALECT_PREFIX) ? V31_DIALECT : deepClone(value)
}

function convertSpec(spec: unknown, context: Context): unknown {
  return convertRecord(
    spec,
    {
      $self: DROP,
      components: item => convertComponents(item, context),
      jsonSchemaDialect: convertJsonSchemaDialect,
      paths: item => convertPaths(item, context),
      servers: item => mapArray(item, convertServer),
      tags: item => mapArray(item, convertTag),
      webhooks: item => mapRecord(item, entry => convertPathItem(entry, context)),
    },
    (out) => {
      out.openapi = '3.1.2'
      return out
    },
  )
}

function createContext(resolve: (ref: string) => unknown, dangles: (ref: string) => boolean): Context {
  const context: Context = { convertSchema, dangles, inlining: new Set(), resolve }
  const fields = createSchemaFields(convertSchema, dangles)
  const finish = (out: Record<string, unknown>, schema: Record<string, unknown>): unknown => finishSchema(out, schema, context)
  function convertSchema(value: unknown): unknown {
    return convertRecord(value, fields, finish)
  }
  return context
}

function danglesIn(output: unknown, source: unknown, ref: string): boolean {
  const tokens = parseLocalRef(ref)
  if (tokens === undefined) {
    return false
  }
  let from = source
  let to = output
  for (const token of tokens) {
    if (Array.isArray(from) && !(Array.isArray(to) && to.length === from.length)) {
      to = undefined
    }
    from = getChild(from, token)
    to = getChild(to, token)
    if (from === undefined) {
      return false
    }
  }
  return to === undefined
}

export function downgradeSpecV32ToV31(spec: OpenAPIV3_2.OpenAPIObject): OpenAPIV3_1.OpenAPIObject {
  const resolve = memoize(ref => resolveLocalRef(spec, ref))
  const refs = new Set<string>()
  const draft = convertSpec(spec, createContext(resolve, (ref) => {
    refs.add(ref)
    return false
  }))
  const dangles = memoize(ref => danglesIn(draft, spec, ref))
  return ([...refs].some(dangles) ? convertSpec(spec, createContext(resolve, dangles)) : draft) as OpenAPIV3_1.OpenAPIObject
}
