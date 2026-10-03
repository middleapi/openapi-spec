import { downgradeSchemaV31ToV30, downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'
import { bench, describe } from 'vitest'

import { corpusV31 } from '../tests/corpus'
import { createApiV31 } from './__shared__/api'
import {
  callbackGraphV31,
  pathItemChainV31,
  referenceDiamondV31,
  schemaDiamond,
} from './__shared__/graphs'
import { ORDER_SCHEMA, PROPERTY_SCHEMA } from './__shared__/schemas'

const API_10_RESOURCES = createApiV31(10)
const API_100_RESOURCES = createApiV31(100)
const REFERENCE_DIAMOND = referenceDiamondV31(64)
const CALLBACK_GRAPH = callbackGraphV31(8)
const PATH_ITEM_CHAIN = pathItemChainV31(200)
const SCHEMA_DIAMOND = schemaDiamond(64)

describe('downgradeSpecV31ToV30', () => {
  bench('official corpus', () => {
    for (const [, doc] of corpusV31) {
      downgradeSpecV31ToV30(doc)
    }
  })

  bench('generated api, 10 resources', () => {
    downgradeSpecV31ToV30(API_10_RESOURCES)
  })

  bench('generated api, 100 resources', () => {
    downgradeSpecV31ToV30(API_100_RESOURCES)
  })

  bench('reference diamond into removed webhooks, 64 levels', () => {
    downgradeSpecV31ToV30(REFERENCE_DIAMOND)
  })

  bench('cyclic callback graph in removed webhooks, 8 path items', () => {
    downgradeSpecV31ToV30(CALLBACK_GRAPH)
  })

  bench('path item $ref chain in removed components, 200 hops', () => {
    downgradeSpecV31ToV30(PATH_ITEM_CHAIN)
  })
})

describe('downgradeSchemaV31ToV30', () => {
  bench('property schema', () => {
    downgradeSchemaV31ToV30(PROPERTY_SCHEMA)
  })

  bench('order schema with $defs', () => {
    downgradeSchemaV31ToV30(ORDER_SCHEMA)
  })

  bench('dereferenced diamond, 64 levels', () => {
    downgradeSchemaV31ToV30(SCHEMA_DIAMOND)
  })
})
