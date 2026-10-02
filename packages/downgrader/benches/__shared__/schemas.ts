import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

// Standalone Schema Objects, in the shape a schema library emits them. The
// 3.1 and 3.2 dialects share these keywords, so both steps take the same
// inputs.

/** One nullable property, the smallest common call. */
export const PROPERTY_SCHEMA: OpenAPIV3_2.SchemaObject = {
  type: ['string', 'null'],
  format: 'email',
  maxLength: 254,
  examples: ['ada@example.com'],
}

/**
 * An order with its definitions in `$defs`, reached through `$ref`s from
 * many places, including a recursive category tree, and the keywords 3.0
 * lacks: `const`, numeric exclusive bounds, `prefixItems`, `if`/`then`/`else`,
 * `patternProperties`, `dependentRequired`, and `contentEncoding`.
 */
export const ORDER_SCHEMA: OpenAPIV3_2.SchemaObject = {
  type: 'object',
  required: ['id', 'status', 'customer', 'lines', 'total'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { enum: ['pending', 'paid', 'shipped', 'cancelled'] },
    customer: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: ['string', 'null'] },
        billing: { $ref: '#/$defs/Address' },
        shipping: { anyOf: [{ $ref: '#/$defs/Address' }, { type: 'null' }] },
      },
    },
    lines: { type: 'array', minItems: 1, items: { $ref: '#/$defs/Line' } },
    discounts: {
      type: 'array',
      items: {
        oneOf: [
          { type: 'object', required: ['kind', 'percent'], properties: { kind: { const: 'percent' }, percent: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } },
          { type: 'object', required: ['kind', 'amount'], properties: { kind: { const: 'fixed' }, amount: { $ref: '#/$defs/Money' } } },
        ],
        discriminator: { propertyName: 'kind' },
      },
    },
    total: { $ref: '#/$defs/Money' },
    location: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false },
    giftWrap: { type: 'boolean' },
    giftMessage: { type: ['string', 'null'], maxLength: 500 },
    invoice: { type: 'string', contentEncoding: 'base64', contentMediaType: 'application/pdf' },
    metadata: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
    createdAt: { type: 'string', format: 'date-time', examples: ['2026-01-01T00:00:00Z'] },
  },
  dependentRequired: { giftMessage: ['giftWrap'] },
  if: { properties: { status: { const: 'shipped' } } },
  then: { required: ['shippedAt'], properties: { shippedAt: { type: 'string', format: 'date-time' } } },
  else: { properties: { shippedAt: { type: 'null' } } },
  $defs: {
    Money: {
      type: 'object',
      required: ['amount', 'currency'],
      properties: {
        amount: { type: 'number', minimum: 0 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$', examples: ['USD'] },
      },
    },
    Address: {
      type: 'object',
      required: ['line1', 'country'],
      properties: {
        line1: { type: 'string' },
        line2: { type: ['string', 'null'] },
        postalCode: { type: ['string', 'null'] },
        country: { type: 'string', minLength: 2, maxLength: 2 },
      },
    },
    Line: {
      type: 'object',
      required: ['sku', 'quantity', 'price'],
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'integer', exclusiveMinimum: 0 },
        price: { $ref: '#/$defs/Money' },
        category: { $ref: '#/$defs/Category' },
      },
    },
    Category: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        parent: { anyOf: [{ $ref: '#/$defs/Category' }, { type: 'null' }] },
        children: { type: 'array', items: { $ref: '#/$defs/Category' } },
      },
    },
  },
}
