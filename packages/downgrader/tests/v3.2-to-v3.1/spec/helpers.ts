import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'

/**
 * Converts a 3.2 document built from `fields`. The input is typed loosely on
 * purpose: many tests feed partial or malformed documents to check that the
 * conversion tolerates them.
 */
export function convertSpec(fields: Record<string, unknown>): OpenAPIV3_1.OpenAPIObject {
  return downgradeSpecV32ToV31({ openapi: '3.2.0', ...fields } as any)
}

/** Converts `pathItem` as the only entry of `paths` and returns it. */
export function convertPathItem(pathItem: unknown, components?: Record<string, unknown>): unknown {
  return dig(convertSpec({ ...(components && { components }), paths: { '/a': pathItem } }), 'paths', '/a')
}

/** Converts `value` as the entry `X` of the `kind` component map and returns it. */
export function convertComponent(kind: string, value: unknown, components: Record<string, unknown> = {}): unknown {
  return dig(convertSpec({ components: { ...components, [kind]: { X: value } } }), 'components', kind, 'X')
}

/** Converts `content` as the content map of a request body and returns it. */
export function convertContent(content: unknown, components?: Record<string, unknown>): unknown {
  return dig(
    convertPathItem({ post: { requestBody: { content }, responses: {} } }, components),
    'post',
    'requestBody',
    'content',
  )
}
