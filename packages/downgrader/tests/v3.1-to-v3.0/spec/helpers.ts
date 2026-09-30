import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'

export const info = { title: 't', version: '1' }

/** Matches a pointer into `webhooks` or `components.pathItems`, which 3.0 removes. */
export const removedPointer = /#\/(?:webhooks|components\/pathItems)/

/** The request body schema of the `newPet` webhook. */
export const webhookSchemaPointer = '#/webhooks/newPet/post/requestBody/content/application~1json/schema'

/** A Path Item to put in `components.pathItems`. */
export const item = {
  get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
  parameters: [{ in: 'query', name: 'q', schema: { const: 'x' } }],
}

/**
 * Converts a 3.1 document built from `fields`. The input is typed loosely on
 * purpose: many tests feed partial or malformed documents to check that the
 * conversion tolerates them.
 */
export function convertSpec(fields: Record<string, unknown>): OpenAPIV3_0.OpenAPIObject {
  return downgradeSpecV31ToV30({ info, openapi: '3.1.0', paths: {}, ...fields } as any)
}

/** Converts `pathItem` as the only entry of `paths` and returns it. */
export function convertPathItem(pathItem: unknown): unknown {
  return dig(convertSpec({ paths: { '/a': pathItem } }), 'paths', '/a')
}

/** Converts `value` as the entry `X` of the `kind` component map and returns it. */
export function convertComponent(kind: string, value: unknown, components: Record<string, unknown> = {}): unknown {
  return dig(convertSpec({ components: { ...components, [kind]: { X: value } } }), 'components', kind, 'X')
}
