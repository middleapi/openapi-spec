import { downgradeSchemaV32ToV31 } from '@openapi-spec/downgrader'

/**
 * Converts `schema`. The input is typed loosely on purpose: many tests feed
 * malformed schemas to check that the conversion tolerates them.
 */
export function convertSchema(schema: unknown): unknown {
  return downgradeSchemaV32ToV31(schema as any)
}
