// There is no direct 3.2 → 3.0 converter: the two steps compose (see the
// package README), and this is what that costs end to end, as oRPC pays it
// for every 3.0 document it generates.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'
import { bench, describe } from 'vitest'
import { corpusV32 } from '../tests/corpus'
import { doc as orpcDocument } from '../tests/orpc-document'
import { createApiV32 } from './__shared__/api'

const API_100_RESOURCES = createApiV32(100)

function downgradeTwice(doc: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(doc))
}

describe('downgradeSpecV32ToV31 + downgradeSpecV31ToV30', () => {
  bench('official corpus', () => {
    for (const [, doc] of corpusV32) {
      downgradeTwice(doc)
    }
  })

  bench('oRPC document', () => {
    downgradeTwice(orpcDocument)
  })

  bench('generated api, 100 resources', () => {
    downgradeTwice(API_100_RESOURCES)
  })
})
