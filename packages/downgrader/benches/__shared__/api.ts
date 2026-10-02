import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

// A CRUD API the way a framework would emit it: one tag, three schemas, and
// a few paths and a webhook per resource, around shared schemas, parameters,
// responses, and security schemes. It uses what each step has to rewrite:
// 3.1 schemas with `null` in `type`, `const`, numeric exclusive bounds,
// `examples`, and `$defs`; Path Items reused from
// `components.pathItems`; webhooks; mutual TLS; and, in 3.2 only, `$self`,
// the `query` method, streamed `itemSchema`s, reusable Media Type Objects,
// Server `name`, Tag `summary`, `parent`, and `kind`, Response `summary`,
// `dataValue` examples, and the device authorization flow.
//
// Every call builds a fresh tree that shares no objects, like a document
// parsed from JSON, so a conversion walks every node.

type Document = Omit<OpenAPIV3_2.OpenAPIObject, 'openapi'>

function ref(pointer: string): OpenAPIV3_2.ReferenceObject {
  return { $ref: pointer }
}

function schemaRef(name: string): OpenAPIV3_2.SchemaObject {
  return { $ref: `#/components/schemas/${name}` }
}

function json(schema: OpenAPIV3_2.SchemaObject): Record<string, OpenAPIV3_2.MediaTypeObject> {
  return { 'application/json': { schema } }
}

function errorResponse(v32: boolean): OpenAPIV3_2.ReferenceObject | OpenAPIV3_2.ResponseObject {
  return ref(`#/components/responses/${v32 ? 'Problem' : 'Error'}`)
}

function sharedSchemas(): Record<string, OpenAPIV3_2.SchemaObject> {
  return {
    Status: {
      type: 'string',
      enum: ['active', 'archived', 'deleted'],
      default: 'active',
    },
    Address: {
      type: 'object',
      required: ['line1', 'country'],
      properties: {
        line1: { type: 'string' },
        line2: { type: ['string', 'null'] },
        postalCode: { type: 'string', pattern: '^[0-9A-Z -]{3,10}$' },
        country: schemaRef('Address/$defs/Country'),
      },
      $defs: {
        Country: { type: 'string', minLength: 2, maxLength: 2, examples: ['US'] },
      },
    },
    User: {
      type: 'object',
      required: ['id', 'email'],
      properties: {
        id: { type: 'string', format: 'uuid', readOnly: true },
        email: { type: 'string', format: 'email' },
        name: { type: ['string', 'null'] },
        address: schemaRef('Address'),
      },
    },
    Error: {
      type: 'object',
      required: ['type', 'title', 'status'],
      properties: {
        type: { type: 'string', format: 'uri' },
        title: { type: 'string' },
        status: { type: 'integer', minimum: 400, exclusiveMaximum: 600 },
        detail: { type: ['string', 'null'] },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'message'],
            properties: { path: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  }
}

function resourceSchemas(name: string, parent: string | undefined): Record<string, OpenAPIV3_2.SchemaObject> {
  const fields = (): Record<string, OpenAPIV3_2.SchemaObject> => ({
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    price: { type: 'number', exclusiveMinimum: 0, examples: [9.99] },
    quantity: { type: 'integer', minimum: 0, default: 0 },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 20 },
    metadata: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
    dimensions: schemaRef(`${name}/$defs/Dimensions`),
  })
  return {
    [name]: {
      type: 'object',
      description: `A ${name} as the API returns it.`,
      required: ['id', 'kind', 'name', 'status', 'createdAt'],
      properties: {
        id: { type: 'string', format: 'uuid', readOnly: true },
        kind: { const: name },
        status: schemaRef('Status'),
        ...fields(),
        owner: schemaRef('User'),
        parent: parent === undefined ? { type: 'null' } : { anyOf: [schemaRef(parent), { type: 'null' }] },
        createdAt: { type: 'string', format: 'date-time', readOnly: true },
        updatedAt: { type: ['string', 'null'], format: 'date-time', readOnly: true },
      },
      $defs: {
        Dimensions: {
          type: 'object',
          required: ['width', 'height'],
          properties: {
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
            unit: { type: 'string', enum: ['cm', 'in'], default: 'cm' },
          },
        },
      },
    },
    [`${name}Input`]: {
      type: 'object',
      required: ['name'],
      properties: fields(),
      additionalProperties: false,
    },
    [`${name}Page`]: {
      type: 'object',
      required: ['items'],
      properties: {
        items: { type: 'array', items: schemaRef(name) },
        nextCursor: { type: ['string', 'null'] },
      },
    },
  }
}

function build(resources: number, v32: boolean): Document {
  const tags: OpenAPIV3_2.TagObject[] = v32 ? [{ name: 'resources', summary: 'Resources', kind: 'nav' }] : []
  const paths: OpenAPIV3_2.PathsObject = {}
  const webhooks: Record<string, OpenAPIV3_2.PathItemObject> = {}
  const schemas = sharedSchemas()
  const examples: Record<string, OpenAPIV3_2.ExampleObject> = {}
  const pathItems: Record<string, OpenAPIV3_2.PathItemObject> = {}

  for (let index = 0; index < resources; index++) {
    const name = `Resource${index}`
    const path = `/resources-${index}` as const
    const tag = `resource-${index}`
    const success = (status: string, schema: OpenAPIV3_2.SchemaObject): OpenAPIV3_2.ResponsesObject => ({
      [status]: { description: `The ${name}.`, ...(v32 && { summary: name }), content: json(schema) },
      default: errorResponse(v32),
    })

    tags.push({ name: tag, description: `Operations on ${name}.`, ...(v32 && { summary: name, parent: 'resources', kind: 'nav' }) })
    Object.assign(schemas, resourceSchemas(name, index === 0 ? undefined : `Resource${index - 1}`))
    examples[name] = {
      summary: `A sample ${name}.`,
      [v32 ? 'dataValue' : 'value']: { id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', kind: name, name: 'Sample', status: 'active', createdAt: '2026-01-01T00:00:00Z' },
    }

    paths[path] = {
      get: {
        operationId: `list${name}`,
        tags: [tag],
        parameters: [ref('#/components/parameters/Cursor'), ref('#/components/parameters/Limit'), { name: 'status', in: 'query', schema: schemaRef('Status') }],
        responses: success('200', schemaRef(`${name}Page`)),
      },
      post: {
        operationId: `create${name}`,
        tags: [tag],
        requestBody: { required: true, content: json(schemaRef(`${name}Input`)) },
        responses: success('201', schemaRef(name)),
        callbacks: {
          created: {
            '{$request.header.X-Callback-Url}': {
              post: { requestBody: { content: json(schemaRef(name)) }, responses: { 204: { description: 'Received.' } } },
            },
          },
        },
      },
      ...(v32 && {
        query: {
          operationId: `search${name}`,
          tags: [tag],
          requestBody: { content: json({ type: 'object', properties: { text: { type: 'string' }, status: schemaRef('Status') } }) },
          responses: success('200', schemaRef(`${name}Page`)),
        },
      }),
    }
    paths[`${path}/{id}`] = { $ref: `#/components/pathItems/${name}` }
    paths[`${path}/{id}/attachments`] = {
      post: {
        operationId: `attach${name}`,
        tags: [tag],
        parameters: [ref('#/components/parameters/Id')],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', contentMediaType: 'application/octet-stream' },
                  caption: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        responses: { 204: { description: 'Attached.' }, default: errorResponse(v32) },
      },
    }
    if (v32) {
      paths[`${path}/events`] = {
        get: {
          operationId: `stream${name}`,
          tags: [tag],
          responses: {
            200: { description: `A stream of ${name} changes.`, content: { 'application/jsonl': { itemSchema: schemaRef(name) } } },
            default: errorResponse(v32),
          },
        },
      }
    }

    pathItems[name] = {
      parameters: [ref('#/components/parameters/Id')],
      get: {
        operationId: `get${name}`,
        tags: [tag],
        responses: {
          200: { description: `The ${name}.`, content: { 'application/json': { schema: schemaRef(name), examples: { sample: ref(`#/components/examples/${name}`) } } } },
          404: ref('#/components/responses/NotFound'),
          default: errorResponse(v32),
        },
      },
      patch: {
        operationId: `update${name}`,
        tags: [tag],
        requestBody: { content: { 'application/merge-patch+json': { schema: schemaRef(`${name}Input`) } } },
        responses: success('200', schemaRef(name)),
      },
      delete: {
        operationId: `delete${name}`,
        tags: [tag],
        security: [{ oauth2: ['write'] }, { mtls: [] }],
        responses: { 204: { description: 'Deleted.' }, default: errorResponse(v32) },
      },
    }
    webhooks[`${tag}.updated`] = {
      post: {
        requestBody: { content: json(schemaRef(name)) },
        responses: { 200: { description: 'Received.' } },
      },
    }
  }

  return {
    ...(v32 && { $self: 'https://api.example.com/openapi.json' }),
    info: {
      title: 'Example API',
      summary: 'A CRUD API to benchmark conversions with.',
      version: '1.0.0',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    jsonSchemaDialect: v32 ? 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17' : 'https://spec.openapis.org/oas/3.1/dialect/base',
    servers: [
      { url: 'https://api.example.com/v1', description: 'Production', ...(v32 && { name: 'production' }) },
      {
        url: 'https://{region}.api.example.com/v1',
        description: 'Regional',
        variables: { region: { default: 'us', enum: ['us', 'eu'] } },
        ...(v32 && { name: 'regional' }),
      },
    ],
    security: [{ bearer: [] }, { oauth2: ['read'] }],
    tags,
    paths,
    webhooks,
    components: {
      schemas,
      parameters: {
        Id: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        Cursor: { name: 'cursor', in: 'query', schema: { type: ['string', 'null'] } },
        Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      },
      responses: {
        NotFound: { description: 'Not found.', content: { 'application/problem+json': { schema: schemaRef('Error') } } },
        ...(v32
          ? { Problem: { summary: 'Problem', description: 'A problem.', content: { 'application/problem+json': ref('#/components/mediaTypes/Problem') } } }
          : { Error: { description: 'A problem.', content: { 'application/problem+json': { schema: schemaRef('Error') } } } }),
      },
      examples,
      pathItems,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        mtls: { type: 'mutualTLS' },
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://auth.example.com/authorize',
              tokenUrl: 'https://auth.example.com/token',
              scopes: { read: 'Read resources.', write: 'Change resources.' },
            },
            ...(v32 && {
              deviceAuthorization: {
                deviceAuthorizationUrl: 'https://auth.example.com/device',
                tokenUrl: 'https://auth.example.com/token',
                scopes: { read: 'Read resources.', write: 'Change resources.' },
              },
            }),
          },
        },
      },
      ...(v32 && { mediaTypes: { Problem: { description: 'A problem.', schema: schemaRef('Error') } } }),
    },
  }
}

/** A 3.1 API with `resources` resources. */
export function createApiV31(resources: number): OpenAPIV3_1.OpenAPIObject {
  return { openapi: '3.1.2', ...build(resources, false) } as OpenAPIV3_1.OpenAPIObject
}

/** A 3.2 API with `resources` resources. */
export function createApiV32(resources: number): OpenAPIV3_2.OpenAPIObject {
  return { openapi: '3.2.0', ...build(resources, true) }
}
