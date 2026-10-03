// Every official document (see corpus.ts) must come out of each step, and of
// both steps chained, as a valid document of the older version.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc as mega } from '../../types/tests/schema-tests-3.2/mega'
import { corpusV31, corpusV32 } from './corpus'
import { expectValidDowngrade } from './validate'

function downgradeTwice(doc: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(doc))
}

it.each(corpusV32)('converts the 3.2 %s to valid 3.1', async (_name, doc) => {
  await expectValidDowngrade(doc, downgradeSpecV32ToV31, '3.2', '3.1')
})

it.each(corpusV31)('converts the 3.1 %s to valid 3.0', async (_name, doc) => {
  await expectValidDowngrade(doc, downgradeSpecV31ToV30, '3.1', '3.0')
})

it.each(corpusV32)('converts the 3.2 %s to valid 3.0 through 3.1', async (_name, doc) => {
  await expectValidDowngrade(doc, downgradeTwice, '3.2', '3.0')
})

it('matches the snapshots of the 3.2 mega document', () => {
  expect(downgradeSpecV32ToV31(mega)).toMatchSnapshot('3.1')
  expect(downgradeTwice(mega)).toMatchSnapshot('3.0')
})
