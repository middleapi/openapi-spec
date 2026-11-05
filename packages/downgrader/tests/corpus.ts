import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'
import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { doc as exampleQueryExampleV32 } from '../../types/tests/examples/3-2-query-example.ts'
import { doc as exampleTagsExampleV32 } from '../../types/tests/examples/3-2-tags-example.ts'
import { doc as exampleNonOauthScopesV31 } from '../../types/tests/examples/non-oauth-scopes-3-1.ts'
import { doc as exampleTictactoeV31 } from '../../types/tests/examples/tictactoe-3-1.ts'
import { doc as exampleWebhookExampleV31 } from '../../types/tests/examples/webhook-example-3-1.ts'
import { doc as callbackObjectExamplesV31 } from '../../types/tests/schema-tests-3.1/callback-object-examples.ts'
import { doc as compPathitemsV31 } from '../../types/tests/schema-tests-3.1/comp-pathitems.ts'
import { doc as componentsObjectExampleV31 } from '../../types/tests/schema-tests-3.1/components-object-example.ts'
import { doc as exampleObjectExamplesV31 } from '../../types/tests/schema-tests-3.1/example-object-examples.ts'
import { doc as headerObjectExamplesV31 } from '../../types/tests/schema-tests-3.1/header-object-examples.ts'
import { doc as infoObjectExampleV31 } from '../../types/tests/schema-tests-3.1/info-object-example.ts'
import { doc as infoSummaryV31 } from '../../types/tests/schema-tests-3.1/info-summary.ts'
import { doc as jsonSchemaDialectV31 } from '../../types/tests/schema-tests-3.1/json-schema-dialect.ts'
import { doc as licenseIdentifierV31 } from '../../types/tests/schema-tests-3.1/license-identifier.ts'
import { doc as linkObjectExamplesV31 } from '../../types/tests/schema-tests-3.1/link-object-examples.ts'
import { doc as mediaTypeExamplesV31 } from '../../types/tests/schema-tests-3.1/media-type-examples.ts'
import { doc as megaV31 } from '../../types/tests/schema-tests-3.1/mega.ts'
import { doc as minimalCompV31 } from '../../types/tests/schema-tests-3.1/minimal-comp.ts'
import { doc as minimalHooksV31 } from '../../types/tests/schema-tests-3.1/minimal-hooks.ts'
import { doc as minimalPathsV31 } from '../../types/tests/schema-tests-3.1/minimal-paths.ts'
import { doc as nonOauthScopesV31 } from '../../types/tests/schema-tests-3.1/non-oauth-scopes.ts'
import { doc as operationObjectExampleV31 } from '../../types/tests/schema-tests-3.1/operation-object-example.ts'
import { doc as parameterObjectExamplesV31 } from '../../types/tests/schema-tests-3.1/parameter-object-examples.ts'
import { doc as parameterObjectQueryAllowReservedV31 } from '../../types/tests/schema-tests-3.1/parameter-object-query-allow-reserved.ts'
import { doc as pathItemObjectExampleV31 } from '../../types/tests/schema-tests-3.1/path-item-object-example.ts'
import { doc as pathItemServersParametersV31 } from '../../types/tests/schema-tests-3.1/path-item-servers-parameters.ts'
import { doc as pathNoResponseV31 } from '../../types/tests/schema-tests-3.1/path-no-response.ts'
import { doc as pathVarEmptyPathitemV31 } from '../../types/tests/schema-tests-3.1/path-var-empty-pathitem.ts'
import { doc as pathsObjectExampleV31 } from '../../types/tests/schema-tests-3.1/paths-object-example.ts'
import { doc as requestBodyExamplesV31 } from '../../types/tests/schema-tests-3.1/request-body-examples.ts'
import { doc as responseObjectExamplesV31 } from '../../types/tests/schema-tests-3.1/response-object-examples.ts'
import { doc as schemaObjectDeprecatedExampleKeywordV31 } from '../../types/tests/schema-tests-3.1/schema-object-deprecated-example-keyword.ts'
import { doc as schemaV31 } from '../../types/tests/schema-tests-3.1/schema.ts'
import { doc as serversV31 } from '../../types/tests/schema-tests-3.1/servers.ts'
import { doc as specificationExtensionsV31 } from '../../types/tests/schema-tests-3.1/specification-extensions.ts'
import { doc as tagObjectExampleV31 } from '../../types/tests/schema-tests-3.1/tag-object-example.ts'
import { doc as validSchemaTypesV31 } from '../../types/tests/schema-tests-3.1/valid-schema-types.ts'
import { doc as webhookExampleV31 } from '../../types/tests/schema-tests-3.1/webhook-example.ts'
import { doc as callbackObjectExamplesV32 } from '../../types/tests/schema-tests-3.2/callback-object-examples.ts'
import { doc as compPathitemsV32 } from '../../types/tests/schema-tests-3.2/comp-pathitems.ts'
import { doc as componentsObjectExampleV32 } from '../../types/tests/schema-tests-3.2/components-object-example.ts'
import { doc as exampleObjectExamplesV32 } from '../../types/tests/schema-tests-3.2/example-object-examples.ts'
import { doc as headerObjectExamplesV32 } from '../../types/tests/schema-tests-3.2/header-object-examples.ts'
import { doc as infoObjectExampleV32 } from '../../types/tests/schema-tests-3.2/info-object-example.ts'
import { doc as infoSummaryV32 } from '../../types/tests/schema-tests-3.2/info-summary.ts'
import { doc as jsonSchemaDialectV32 } from '../../types/tests/schema-tests-3.2/json-schema-dialect.ts'
import { doc as licenseIdentifierV32 } from '../../types/tests/schema-tests-3.2/license-identifier.ts'
import { doc as linkObjectExamplesV32 } from '../../types/tests/schema-tests-3.2/link-object-examples.ts'
import { doc as mediaTypeExamplesV32 } from '../../types/tests/schema-tests-3.2/media-type-examples.ts'
import { doc as megaV32 } from '../../types/tests/schema-tests-3.2/mega.ts'
import { doc as minimalCompV32 } from '../../types/tests/schema-tests-3.2/minimal-comp.ts'
import { doc as minimalHooksV32 } from '../../types/tests/schema-tests-3.2/minimal-hooks.ts'
import { doc as minimalPathsV32 } from '../../types/tests/schema-tests-3.2/minimal-paths.ts'
import { doc as nonOauthScopesV32 } from '../../types/tests/schema-tests-3.2/non-oauth-scopes.ts'
import { doc as operationObjectExampleV32 } from '../../types/tests/schema-tests-3.2/operation-object-example.ts'
import { doc as parameterObjectCookieFormAllowReservedV32 } from '../../types/tests/schema-tests-3.2/parameter-object-cookie-form-allow-reserved.ts'
import { doc as parameterObjectExamplesV32 } from '../../types/tests/schema-tests-3.2/parameter-object-examples.ts'
import { doc as parameterObjectPathAllowReservedV32 } from '../../types/tests/schema-tests-3.2/parameter-object-path-allow-reserved.ts'
import { doc as parameterObjectQueryAllowReservedV32 } from '../../types/tests/schema-tests-3.2/parameter-object-query-allow-reserved.ts'
import { doc as pathItemObjectExampleV32 } from '../../types/tests/schema-tests-3.2/path-item-object-example.ts'
import { doc as pathItemServersParametersV32 } from '../../types/tests/schema-tests-3.2/path-item-servers-parameters.ts'
import { doc as pathNoResponseV32 } from '../../types/tests/schema-tests-3.2/path-no-response.ts'
import { doc as pathVarEmptyPathitemV32 } from '../../types/tests/schema-tests-3.2/path-var-empty-pathitem.ts'
import { doc as pathsObjectExampleV32 } from '../../types/tests/schema-tests-3.2/paths-object-example.ts'
import { doc as requestBodyExamplesV32 } from '../../types/tests/schema-tests-3.2/request-body-examples.ts'
import { doc as responseObjectExamplesV32 } from '../../types/tests/schema-tests-3.2/response-object-examples.ts'
import { doc as schemaObjectDeprecatedExampleKeywordV32 } from '../../types/tests/schema-tests-3.2/schema-object-deprecated-example-keyword.ts'
import { doc as schemaV32 } from '../../types/tests/schema-tests-3.2/schema.ts'
import { doc as serversV32 } from '../../types/tests/schema-tests-3.2/servers.ts'
import { doc as specificationExtensionsV32 } from '../../types/tests/schema-tests-3.2/specification-extensions.ts'
import { doc as styleDefaultsV32 } from '../../types/tests/schema-tests-3.2/style-defaults.ts'
import { doc as tagObjectExampleV32 } from '../../types/tests/schema-tests-3.2/tag-object-example.ts'
import { doc as validSchemaTypesV32 } from '../../types/tests/schema-tests-3.2/valid-schema-types.ts'
import { doc as webhookExampleV32 } from '../../types/tests/schema-tests-3.2/webhook-example.ts'

type Corpus<T> = readonly (readonly [name: string, doc: T])[]

// The official documents, from OAI/learn.openapis.org and from the
// `tests/schema/pass` folder of OAI/OpenAPI-Specification (see
// packages/types/tests/README.md).

// Left out:
// - security-scheme-object-examples, whose external `$ref` the validator
//   cannot resolve
// - style-defaults, which puts an `x-comment` in an Encoding Object; the
//   official 3.0 schema rejects extensions there
export const corpusV31: Corpus<OpenAPIV3_1.OpenAPIObject> = [
  ['examples/non-oauth-scopes-3-1', exampleNonOauthScopesV31],
  ['examples/tictactoe-3-1', exampleTictactoeV31],
  ['examples/webhook-example-3-1', exampleWebhookExampleV31],
  ['callback-object-examples', callbackObjectExamplesV31],
  ['comp-pathitems', compPathitemsV31],
  ['components-object-example', componentsObjectExampleV31],
  ['example-object-examples', exampleObjectExamplesV31],
  ['header-object-examples', headerObjectExamplesV31],
  ['info-object-example', infoObjectExampleV31],
  ['info-summary', infoSummaryV31],
  ['json-schema-dialect', jsonSchemaDialectV31],
  ['license-identifier', licenseIdentifierV31],
  ['link-object-examples', linkObjectExamplesV31],
  ['media-type-examples', mediaTypeExamplesV31],
  ['mega', megaV31],
  ['minimal-comp', minimalCompV31],
  ['minimal-hooks', minimalHooksV31],
  ['minimal-paths', minimalPathsV31],
  ['non-oauth-scopes', nonOauthScopesV31],
  ['operation-object-example', operationObjectExampleV31],
  ['parameter-object-examples', parameterObjectExamplesV31],
  ['parameter-object-query-allow-reserved', parameterObjectQueryAllowReservedV31],
  ['path-item-object-example', pathItemObjectExampleV31],
  ['path-item-servers-parameters', pathItemServersParametersV31],
  ['path-no-response', pathNoResponseV31],
  ['path-var-empty-pathitem', pathVarEmptyPathitemV31],
  ['paths-object-example', pathsObjectExampleV31],
  ['request-body-examples', requestBodyExamplesV31],
  ['response-object-examples', responseObjectExamplesV31],
  ['schema-object-deprecated-example-keyword', schemaObjectDeprecatedExampleKeywordV31],
  ['schema', schemaV31],
  ['servers', serversV31],
  ['specification-extensions', specificationExtensionsV31],
  ['tag-object-example', tagObjectExampleV31],
  ['valid-schema-types', validSchemaTypesV31],
  ['webhook-example', webhookExampleV31],
]

// Left out: security-scheme-object-examples, whose external `$ref` the
// validator cannot resolve.
export const corpusV32: Corpus<OpenAPIV3_2.OpenAPIObject> = [
  ['examples/3-2-query-example', exampleQueryExampleV32],
  ['examples/3-2-tags-example', exampleTagsExampleV32],
  ['callback-object-examples', callbackObjectExamplesV32],
  ['comp-pathitems', compPathitemsV32],
  ['components-object-example', componentsObjectExampleV32],
  ['example-object-examples', exampleObjectExamplesV32],
  ['header-object-examples', headerObjectExamplesV32],
  ['info-object-example', infoObjectExampleV32],
  ['info-summary', infoSummaryV32],
  ['json-schema-dialect', jsonSchemaDialectV32],
  ['license-identifier', licenseIdentifierV32],
  ['link-object-examples', linkObjectExamplesV32],
  ['media-type-examples', mediaTypeExamplesV32],
  ['mega', megaV32],
  ['minimal-comp', minimalCompV32],
  ['minimal-hooks', minimalHooksV32],
  ['minimal-paths', minimalPathsV32],
  ['non-oauth-scopes', nonOauthScopesV32],
  ['operation-object-example', operationObjectExampleV32],
  ['parameter-object-cookie-form-allow-reserved', parameterObjectCookieFormAllowReservedV32],
  ['parameter-object-examples', parameterObjectExamplesV32],
  ['parameter-object-path-allow-reserved', parameterObjectPathAllowReservedV32],
  ['parameter-object-query-allow-reserved', parameterObjectQueryAllowReservedV32],
  ['path-item-object-example', pathItemObjectExampleV32],
  ['path-item-servers-parameters', pathItemServersParametersV32],
  ['path-no-response', pathNoResponseV32],
  ['path-var-empty-pathitem', pathVarEmptyPathitemV32],
  ['paths-object-example', pathsObjectExampleV32],
  ['request-body-examples', requestBodyExamplesV32],
  ['response-object-examples', responseObjectExamplesV32],
  ['schema-object-deprecated-example-keyword', schemaObjectDeprecatedExampleKeywordV32],
  ['schema', schemaV32],
  ['servers', serversV32],
  ['specification-extensions', specificationExtensionsV32],
  ['style-defaults', styleDefaultsV32],
  ['tag-object-example', tagObjectExampleV32],
  ['valid-schema-types', validSchemaTypesV32],
  ['webhook-example', webhookExampleV32],
]
