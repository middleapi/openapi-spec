// There is no direct 3.2 → 3.0 converter on purpose: the two steps compose
// (see the package README). Every official 3.2 document must survive both
// steps as a valid document at each version.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV31ToV30, downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc as queryExample } from '../../types/tests/examples/3-2-query-example'
import { doc as tagsExample } from '../../types/tests/examples/3-2-tags-example'
import { doc as callbackObjectExamples } from '../../types/tests/schema-tests-3.2/callback-object-examples'
import { doc as compPathitems } from '../../types/tests/schema-tests-3.2/comp-pathitems'
import { doc as componentsObjectExample } from '../../types/tests/schema-tests-3.2/components-object-example'
import { doc as exampleObjectExamples } from '../../types/tests/schema-tests-3.2/example-object-examples'
import { doc as headerObjectExamples } from '../../types/tests/schema-tests-3.2/header-object-examples'
import { doc as infoObjectExample } from '../../types/tests/schema-tests-3.2/info-object-example'
import { doc as infoSummary } from '../../types/tests/schema-tests-3.2/info-summary'
import { doc as jsonSchemaDialect } from '../../types/tests/schema-tests-3.2/json-schema-dialect'
import { doc as licenseIdentifier } from '../../types/tests/schema-tests-3.2/license-identifier'
import { doc as linkObjectExamples } from '../../types/tests/schema-tests-3.2/link-object-examples'
import { doc as mediaTypeExamples } from '../../types/tests/schema-tests-3.2/media-type-examples'
import { doc as mega } from '../../types/tests/schema-tests-3.2/mega'
import { doc as minimalComp } from '../../types/tests/schema-tests-3.2/minimal-comp'
import { doc as minimalHooks } from '../../types/tests/schema-tests-3.2/minimal-hooks'
import { doc as minimalPaths } from '../../types/tests/schema-tests-3.2/minimal-paths'
import { doc as nonOauthScopes } from '../../types/tests/schema-tests-3.2/non-oauth-scopes'
import { doc as operationObjectExample } from '../../types/tests/schema-tests-3.2/operation-object-example'
import { doc as parameterObjectCookieFormAllowReserved } from '../../types/tests/schema-tests-3.2/parameter-object-cookie-form-allow-reserved'
import { doc as parameterObjectExamples } from '../../types/tests/schema-tests-3.2/parameter-object-examples'
import { doc as parameterObjectPathAllowReserved } from '../../types/tests/schema-tests-3.2/parameter-object-path-allow-reserved'
import { doc as parameterObjectQueryAllowReserved } from '../../types/tests/schema-tests-3.2/parameter-object-query-allow-reserved'
import { doc as pathItemObjectExample } from '../../types/tests/schema-tests-3.2/path-item-object-example'
import { doc as pathItemServersParameters } from '../../types/tests/schema-tests-3.2/path-item-servers-parameters'
import { doc as pathNoResponse } from '../../types/tests/schema-tests-3.2/path-no-response'
import { doc as pathVarEmptyPathitem } from '../../types/tests/schema-tests-3.2/path-var-empty-pathitem'
import { doc as pathsObjectExample } from '../../types/tests/schema-tests-3.2/paths-object-example'
import { doc as requestBodyExamples } from '../../types/tests/schema-tests-3.2/request-body-examples'
import { doc as responseObjectExamples } from '../../types/tests/schema-tests-3.2/response-object-examples'
import { doc as schema } from '../../types/tests/schema-tests-3.2/schema'
import { doc as schemaObjectDeprecatedExampleKeyword } from '../../types/tests/schema-tests-3.2/schema-object-deprecated-example-keyword'
import { doc as servers } from '../../types/tests/schema-tests-3.2/servers'
import { doc as specificationExtensions } from '../../types/tests/schema-tests-3.2/specification-extensions'
import { doc as styleDefaults } from '../../types/tests/schema-tests-3.2/style-defaults'
import { doc as tagObjectExample } from '../../types/tests/schema-tests-3.2/tag-object-example'
import { doc as validSchemaTypes } from '../../types/tests/schema-tests-3.2/valid-schema-types'
import { doc as webhookExample } from '../../types/tests/schema-tests-3.2/webhook-example'
import { expectNoNewDanglingRefs, expectValidAs } from './helpers'

// Left out: security-scheme-object-examples, whose external `$ref` the
// validator cannot resolve.
const corpus: readonly (readonly [name: string, doc: OpenAPIV3_2.OpenAPIObject])[] = [
  ['examples/3-2-query-example', queryExample],
  ['examples/3-2-tags-example', tagsExample],
  ['callback-object-examples', callbackObjectExamples],
  ['comp-pathitems', compPathitems],
  ['components-object-example', componentsObjectExample],
  ['example-object-examples', exampleObjectExamples],
  ['header-object-examples', headerObjectExamples],
  ['info-object-example', infoObjectExample],
  ['info-summary', infoSummary],
  ['json-schema-dialect', jsonSchemaDialect],
  ['license-identifier', licenseIdentifier],
  ['link-object-examples', linkObjectExamples],
  ['media-type-examples', mediaTypeExamples],
  ['mega', mega],
  ['minimal-comp', minimalComp],
  ['minimal-hooks', minimalHooks],
  ['minimal-paths', minimalPaths],
  ['non-oauth-scopes', nonOauthScopes],
  ['operation-object-example', operationObjectExample],
  ['parameter-object-cookie-form-allow-reserved', parameterObjectCookieFormAllowReserved],
  ['parameter-object-examples', parameterObjectExamples],
  ['parameter-object-path-allow-reserved', parameterObjectPathAllowReserved],
  ['parameter-object-query-allow-reserved', parameterObjectQueryAllowReserved],
  ['path-item-object-example', pathItemObjectExample],
  ['path-item-servers-parameters', pathItemServersParameters],
  ['path-no-response', pathNoResponse],
  ['path-var-empty-pathitem', pathVarEmptyPathitem],
  ['paths-object-example', pathsObjectExample],
  ['request-body-examples', requestBodyExamples],
  ['response-object-examples', responseObjectExamples],
  ['schema', schema],
  ['schema-object-deprecated-example-keyword', schemaObjectDeprecatedExampleKeyword],
  ['servers', servers],
  ['specification-extensions', specificationExtensions],
  ['style-defaults', styleDefaults],
  ['tag-object-example', tagObjectExample],
  ['valid-schema-types', validSchemaTypes],
  ['webhook-example', webhookExample],
]

function downgradeTwice(doc: OpenAPIV3_2.OpenAPIObject) {
  return downgradeSpecV31ToV30(downgradeSpecV32ToV31(doc))
}

describe('official corpus', () => {
  it.each(corpus)('converts %s to valid 3.1 and 3.0 documents without new dangling references', async (_name, doc) => {
    const v31 = downgradeSpecV32ToV31(doc)
    await expectValidAs(v31, '3.1')
    const v30 = downgradeSpecV31ToV30(v31)
    expect(v30.openapi).toBe('3.0.4')
    await expectValidAs(v30, '3.0')
    expectNoNewDanglingRefs(v31, v30)
  })
})

describe('official examples', () => {
  it('converts the query example', () => {
    expect(downgradeTwice(queryExample)).toMatchSnapshot()
  })

  it('converts the tags example', () => {
    expect(downgradeTwice(tagsExample)).toMatchSnapshot()
  })

  it('converts the mega document', () => {
    const v30 = downgradeTwice(mega)
    expect(v30.components).not.toHaveProperty('pathItems')
    expect(v30).not.toHaveProperty('webhooks')
    expect(v30).toMatchSnapshot()
  })
})
