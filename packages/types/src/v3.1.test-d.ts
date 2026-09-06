import type {
  ExampleObject,
  MediaTypeObject,
  OpenAPIObject,
  ParameterObject,
  PathItemObject,
  ResponseObject,
  SchemaObject,
} from './v3.1'

export const webhooksOnly = {
  components: {
    pathItems: {
      petWebhook: {
        post: { responses: { 200: { description: 'OK' } } },
      },
    },
    schemas: {
      Animal: {
        discriminator: {
          'mapping': { pet: 'Pet' },
          'propertyName': 'petType',
          'x-extension': 'allowed in 3.1',
        },
        oneOf: [
          {
            $ref: '#/components/schemas/Pet',
            description: 'sibling keywords allowed',
          },
          { type: 'string' },
        ],
      },
      Pet: {
        '$defs': {
          item: {
            $dynamicAnchor: 'item',
            type: 'string',
          },
        },
        '$id': 'https://example.com/schemas/pet',
        '$schema': 'https://spec.openapis.org/oas/3.1/dialect/base',
        'deprecated': false,
        'example': { id: 1, name: 'Rex' },
        'examples': [{ id: 1, name: 'Rex' }],
        'properties': {
          anything: true,
          avatar: {
            contentEncoding: 'base64',
            contentMediaType: 'image/png',
            type: 'string',
          },
          conditional: {
            else: { required: ['bField'] },
            if: { properties: { kind: { const: 'a' } } },
            then: { required: ['aField'] },
          },
          config: {
            additionalProperties: { type: 'string' },
            dependentRequired: { credit: ['billing'] },
            dependentSchemas: {
              credit: { required: ['billing'] },
            },
            propertyNames: { pattern: '^[a-z]+$' },
            type: 'object',
            unevaluatedProperties: false,
          },
          coordinates: {
            contains: { type: 'number' },
            items: false,
            minContains: 1,
            prefixItems: [{ type: 'number' }, { type: 'number' }],
            type: 'array',
          },
          dynamic: { $dynamicRef: '#item' },
          id: { format: 'int64', type: 'integer' },
          name: { type: 'string' },
          nothing: false,
          nullable: { type: 'null' },
          score: {
            exclusiveMaximum: 10,
            exclusiveMinimum: 0,
            type: 'number',
          },
          status: { const: 'available' },
          tag: { type: ['string', 'null'] },
        },
        'required': ['id', 'name'],
        'type': 'object',
        'unprefixed-extension': { anything: 'goes' },
        'x-prefixed-extension': true,
      },
    },
    securitySchemes: {
      mtls: { description: 'Client certificate', type: 'mutualTLS' },
    },
  },
  info: {
    license: { identifier: 'MIT', name: 'MIT' },
    summary: 'A webhook-only API description',
    title: 'Webhook Example',
    version: '1.0.0',
  },
  jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
  openapi: '3.1.2',
  security: [{ mtls: ['admin-role'] }],
  webhooks: {
    newPet: {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
            },
          },
          description: 'Information about a new pet',
        },
        responses: {
          200: { description: 'Webhook processed' },
        },
      },
    },
    referenced: { $ref: '#/components/pathItems/petWebhook' },
  },
} satisfies OpenAPIObject

export const referenceOverrides = {
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.0',
  paths: {
    '/pets': {
      get: {
        // `responses` is no longer REQUIRED in 3.1.
        parameters: [
          {
            $ref: '#/components/parameters/limit',
            description: 'Overridden description',
            summary: 'Overridden summary',
          },
        ],
      },
    },
  },
} satisfies OpenAPIObject

export const wrongVersion = {
  info: { title: 'API', version: '1.0.0' },
  // @ts-expect-error: The `openapi` version string must be within the 3.1 line.
  openapi: '3.0.4',
  paths: {},
} satisfies OpenAPIObject

// Boolean schemas are valid Schema Objects in OpenAPI 3.1.
export const booleanSchema = true satisfies SchemaObject

export const numericExclusiveBounds = {
  // @ts-expect-error: `exclusiveMaximum` is a number in OpenAPI 3.1, not a 3.0-style boolean.
  exclusiveMaximum: true,
  type: 'number',
} satisfies SchemaObject

export const noQueryMethod = {
  // @ts-expect-error: The QUERY method does not exist before OpenAPI 3.2.
  query: { responses: { 200: { description: 'OK' } } },
} satisfies PathItemObject

export const noAdditionalOperations = {
  // @ts-expect-error: `additionalOperations` does not exist before OpenAPI 3.2.
  additionalOperations: {},
} satisfies PathItemObject

export const typedSchema = {
  const: 'fixed',
  default: 'fixed',
  examples: ['fixed'],
  type: 'string',
} satisfies SchemaObject<string>

export const typedSchemaMismatch = {
  // @ts-expect-error: `examples` entries must match the schema's data type parameter.
  examples: [1],
  type: 'string',
} satisfies SchemaObject<string>

export const noResponseSummary = {
  description: 'OK',
  // @ts-expect-error: The Response Object's `summary` field was added in OpenAPI 3.2.
  summary: 'Success',
} satisfies ResponseObject

export const noQuerystringLocation = {
  content: {
    'application/x-www-form-urlencoded': { schema: { type: 'object' } },
  },
  // @ts-expect-error: The `querystring` parameter location was added in OpenAPI 3.2.
  in: 'querystring',
  name: 'filter',
} satisfies ParameterObject

export const noCookieStyle = {
  in: 'cookie',
  name: 'session',
  schema: { type: 'string' },
  // @ts-expect-error: The `cookie` parameter style was added in OpenAPI 3.2.
  style: 'cookie',
} satisfies ParameterObject

export const noSelfUri = {
  // @ts-expect-error: The `$self` field was added in OpenAPI 3.2.
  $self: 'https://example.com/openapi',
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.2',
  paths: {},
} satisfies OpenAPIObject

export const noMediaTypesComponent = {
  components: {
    // @ts-expect-error: The Components Object's `mediaTypes` field was added in OpenAPI 3.2.
    mediaTypes: {},
  },
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.2',
} satisfies OpenAPIObject

export const noServerName = {
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.2',
  paths: {},
  servers: [
    {
      // @ts-expect-error: The Server Object's `name` field was added in OpenAPI 3.2.
      name: 'production',
      url: 'https://api.example.com',
    },
  ],
} satisfies OpenAPIObject

export const noTagHierarchy = {
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.2',
  paths: {},
  tags: [
    {
      name: 'pets',
      // @ts-expect-error: The Tag Object's `parent` and `kind` fields were added in OpenAPI 3.2.
      parent: 'animals',
    },
  ],
} satisfies OpenAPIObject

export const noItemSchema = {
  // @ts-expect-error: The Media Type Object's `itemSchema` field was added in OpenAPI 3.2.
  itemSchema: { type: 'object' },
} satisfies MediaTypeObject

export const noDataValue = {
  // @ts-expect-error: The Example Object's `dataValue` field was added in OpenAPI 3.2.
  dataValue: { id: 1 },
} satisfies ExampleObject

export const noDefaultMapping = {
  discriminator: {
    // @ts-expect-error: The Discriminator Object's `defaultMapping` field was added in OpenAPI 3.2.
    defaultMapping: 'Cat',
    propertyName: 'kind',
  },
  oneOf: [{ type: 'object' }],
} satisfies SchemaObject

export const noXmlNodeType = {
  type: 'string',
  // @ts-expect-error: The XML Object's `nodeType` field was added in OpenAPI 3.2.
  xml: { nodeType: 'attribute' },
} satisfies SchemaObject

export const noDeprecatedSecurityScheme = {
  components: {
    securitySchemes: {
      basic: {
        // @ts-expect-error: The Security Scheme Object's `deprecated` field was added in OpenAPI 3.2.
        deprecated: true,
        scheme: 'basic',
        type: 'http',
      },
    },
  },
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.2',
} satisfies OpenAPIObject

export const noDeviceAuthorizationFlow = {
  components: {
    securitySchemes: {
      oauth: {
        flows: {
          // @ts-expect-error: The OAuth Device Authorization flow was added in OpenAPI 3.2.
          deviceAuthorization: {
            deviceAuthorizationUrl: 'https://auth.example.com/device',
            scopes: {},
            tokenUrl: 'https://auth.example.com/token',
          },
        },
        type: 'oauth2',
      },
    },
  },
  info: { title: 'API', version: '1.0.0' },
  openapi: '3.1.2',
} satisfies OpenAPIObject
