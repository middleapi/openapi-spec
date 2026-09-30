import type * as OpenAPIV3_0 from '@openapi-spec/types/v3.0'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { dig } from '../../helpers'

export const info = { title: 't', version: '1' }

/** The converted form of a document holding nothing but `info`. */
export const empty = { info, openapi: '3.0.4', paths: {} }

/**
 * Converts a 3.1 document built from `fields`. The input is typed loosely on
 * purpose: many tests feed partial or malformed documents to check that the
 * conversion tolerates them.
 */
export function convertSpec(fields: Record<string, unknown>): OpenAPIV3_0.OpenAPIObject {
  return downgradeSpecV31ToV30({ info, openapi: '3.1.0', paths: {}, ...fields } as any)
}

/** Converts `pathItem` as the only entry of `paths` and returns it. */
export function convertPathItem(pathItem: unknown, components?: Record<string, unknown>): unknown {
  return dig(convertSpec({ ...(components && { components }), paths: { '/a': pathItem } }), 'paths', '/a')
}

/** Converts `value` as the entry `X` of the `kind` component map and returns it. */
export function convertComponent(kind: string, value: unknown, components: Record<string, unknown> = {}): unknown {
  return dig(convertSpec({ components: { ...components, [kind]: { X: value } } }), 'components', kind, 'X')
}
