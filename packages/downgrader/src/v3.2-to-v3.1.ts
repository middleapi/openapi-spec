import type { OpenAPIV3_1, OpenAPIV3_2 } from '@openapi-spec/types'

import type { FieldConverter } from './shared'
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

const HEADERS_REF_PREFIX = '#/components/headers/'
const MEDIA_TYPES_REF_PREFIX = '#/components/mediaTypes/'
const PARAMETERS_REF_PREFIX = '#/components/parameters/'

const V32_DIALECT_PREFIX = 'https://spec.openapis.org/oas/3.2/dialect/'
const V31_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base'

interface Context {
  mediaTypes: Record<string, unknown> | undefined
  removedHeaderRefs: ReadonlySet<string>
  removedParameterRefs: ReadonlySet<string>
}

export function downgradeSchemaV32ToV31<T = unknown>(schema: OpenAPIV3_2.SchemaObject<T>): OpenAPIV3_1.SchemaObject<T> {
  return deepClone(schema) as OpenAPIV3_1.SchemaObject<T>
}

function convertRefOr(value: unknown, context: Context, convert: (item: unknown, context: Context) => unknown): unknown {
  return getRef(value) === undefined ? convert(value, context) : deepClone(value)
}

function refMap(context: Context, convert: (item: unknown, context: Context) => unknown): FieldConverter {
  return item => mapRecord(item, entry => convertRefOr(entry, context, convert))
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

function isRemovedRef(value: unknown, removed: ReadonlySet<string>): boolean {
  const ref = getRef(value)
  return ref !== undefined && removed.has(ref)
}

function convertParameterOrHeader(value: unknown, context: Context): unknown {
  return convertRecord(
    value,
    {
      allowReserved: (item, parameter) => (!('in' in parameter) || parameter.in === 'query' ? deepClone(item) : DROP),
      content: item => convertContentMap(item, context),
      examples: refMap(context, convertExample),
      style: item => (item === 'cookie' ? DROP : deepClone(item)),
    },
    (out, parameter) => {
      const lostContent = isRecord(parameter.content)
        && Object.keys(parameter.content).length > 0
        && isRecord(out.content)
        && Object.keys(out.content).length === 0
      return lostContent ? DROP : out
    },
  )
}

function convertParameterEntry(value: unknown, context: Context): unknown {
  return isQuerystringParameter(value) || isRemovedRef(value, context.removedParameterRefs)
    ? DROP
    : convertRefOr(value, context, convertParameterOrHeader)
}

function convertHeaderMap(value: unknown, context: Context): unknown {
  return mapRecord(value, item => isRemovedRef(item, context.removedHeaderRefs) ? DROP : convertRefOr(item, context, convertParameterOrHeader))
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
    },
    (out, mediaType) => {
      if ('itemSchema' in mediaType && out.schema === undefined) {
        out.schema = { items: deepClone(mediaType.itemSchema), type: 'array' }
      }
      return out
    },
  )
}

function resolveMediaType(value: unknown, mediaTypes: Record<string, unknown> | undefined, seen: Set<string>): unknown {
  const ref = getRef(value)
  if (ref === undefined) {
    return value
  }
  if (!ref.startsWith(MEDIA_TYPES_REF_PREFIX)) {
    return DROP
  }
  const name = ref.slice(MEDIA_TYPES_REF_PREFIX.length)
  if (name === '' || name.includes('/') || mediaTypes === undefined || !Object.hasOwn(mediaTypes, name) || seen.has(name)) {
    return DROP
  }
  seen.add(name)
  return resolveMediaType(mediaTypes[name], mediaTypes, seen)
}

function convertContentMap(value: unknown, context: Context): unknown {
  return mapRecord(value, (item) => {
    const target = resolveMediaType(item, context.mediaTypes, new Set())
    return target === DROP ? DROP : convertMediaType(target, context)
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
    securitySchemes: refMap(context, convertSecurityScheme),
  })
}

function losesEntireContent(value: unknown, mediaTypes: Record<string, unknown> | undefined): boolean {
  if (!(isRecord(value) && isRecord(value.content))) {
    return false
  }
  const entries = Object.values(value.content)
  return entries.length > 0 && entries.every(item => resolveMediaType(item, mediaTypes, new Set()) === DROP)
}

function indexRemovedComponentRefs(map: unknown, prefix: string, mediaTypes: Record<string, unknown> | undefined, isDirectlyRemoved: (item: unknown) => boolean): Set<string> {
  const removed = new Set<string>()
  if (!isRecord(map)) {
    return removed
  }
  const entries = Object.entries(map)
  let changed = true
  while (changed) {
    changed = false
    for (const [name, item] of entries) {
      const selfRef = prefix + name
      if (removed.has(selfRef)) {
        continue
      }
      const target = getRef(item)
      if (isDirectlyRemoved(item) || losesEntireContent(item, mediaTypes) || (target !== undefined && removed.has(target))) {
        removed.add(selfRef)
        changed = true
      }
    }
  }
  return removed
}

function createContext(spec: unknown): Context {
  const components = isRecord(spec) ? spec.components : undefined
  const mediaTypes = isRecord(components) && isRecord(components.mediaTypes) ? components.mediaTypes : undefined
  return {
    mediaTypes,
    removedHeaderRefs: indexRemovedComponentRefs(isRecord(components) ? components.headers : undefined, HEADERS_REF_PREFIX, mediaTypes, () => false),
    removedParameterRefs: indexRemovedComponentRefs(isRecord(components) ? components.parameters : undefined, PARAMETERS_REF_PREFIX, mediaTypes, isQuerystringParameter),
  }
}

function convertJsonSchemaDialect(value: unknown): unknown {
  return typeof value === 'string' && value.startsWith(V32_DIALECT_PREFIX) ? V31_DIALECT : deepClone(value)
}

export function downgradeSpecV32ToV31(spec: OpenAPIV3_2.OpenAPIObject): OpenAPIV3_1.OpenAPIObject {
  const context = createContext(spec)
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
  ) as OpenAPIV3_1.OpenAPIObject
}
