import { downgradeSchemaV32ToV31, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'
import { bench, describe } from 'vitest'
import { corpusV32 } from '../tests/corpus'
import { createApiV32 } from './__shared__/api'
import { callbackGraphV32, referenceDiamondV32, schemaDiamond } from './__shared__/graphs'
import { ORDER_SCHEMA, PROPERTY_SCHEMA } from './__shared__/schemas'

const API_10_RESOURCES = createApiV32(10)
const API_100_RESOURCES = createApiV32(100)
const REFERENCE_DIAMOND = referenceDiamondV32(64)
const CALLBACK_GRAPH = callbackGraphV32(8)
const SCHEMA_DIAMOND = schemaDiamond(64)

describe('downgradeSpecV32ToV31', () => {
  bench('official corpus', () => {
    for (const [, doc] of corpusV32) {
      downgradeSpecV32ToV31(doc)
    }
  })

  bench('generated api, 10 resources', () => {
    downgradeSpecV32ToV31(API_10_RESOURCES)
  })

  bench('generated api, 100 resources', () => {
    downgradeSpecV32ToV31(API_100_RESOURCES)
  })

  bench('reference diamond into removed media types, 64 levels', () => {
    downgradeSpecV32ToV31(REFERENCE_DIAMOND)
  })

  bench('cyclic callback graph in a removed operation, 8 path items', () => {
    downgradeSpecV32ToV31(CALLBACK_GRAPH)
  })
})

describe('downgradeSchemaV32ToV31', () => {
  bench('property schema', () => {
    downgradeSchemaV32ToV31(PROPERTY_SCHEMA)
  })

  bench('order schema with $defs', () => {
    downgradeSchemaV32ToV31(ORDER_SCHEMA)
  })

  bench('dereferenced diamond, 64 levels', () => {
    downgradeSchemaV32ToV31(SCHEMA_DIAMOND)
  })
})
