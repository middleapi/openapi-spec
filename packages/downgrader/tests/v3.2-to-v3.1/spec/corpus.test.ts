// The official 3.2 documents, from OAI/learn.openapis.org and from the
// `tests/schema/pass` folder of OAI/OpenAPI-Specification (see
// packages/types/tests/README.md). Each one must downgrade to a document the
// official 3.1 JSON Schema accepts, without leaving a reference dangling that
// resolved before.

import type * as OpenAPIV3_2 from '@openapi-spec/types/v3.2'

import { downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { doc as queryExample } from '../../../../types/tests/examples/3-2-query-example'
import { doc as tagsExample } from '../../../../types/tests/examples/3-2-tags-example'
import { doc as callbackObjectExamples } from '../../../../types/tests/schema-tests-3.2/callback-object-examples'
import { doc as compPathitems } from '../../../../types/tests/schema-tests-3.2/comp-pathitems'
import { doc as componentsObjectExample } from '../../../../types/tests/schema-tests-3.2/components-object-example'
import { doc as exampleObjectExamples } from '../../../../types/tests/schema-tests-3.2/example-object-examples'
import { doc as headerObjectExamples } from '../../../../types/tests/schema-tests-3.2/header-object-examples'
import { doc as infoObjectExample } from '../../../../types/tests/schema-tests-3.2/info-object-example'
import { doc as infoSummary } from '../../../../types/tests/schema-tests-3.2/info-summary'
import { doc as jsonSchemaDialect } from '../../../../types/tests/schema-tests-3.2/json-schema-dialect'
import { doc as licenseIdentifier } from '../../../../types/tests/schema-tests-3.2/license-identifier'
import { doc as linkObjectExamples } from '../../../../types/tests/schema-tests-3.2/link-object-examples'
import { doc as mediaTypeExamples } from '../../../../types/tests/schema-tests-3.2/media-type-examples'
import { doc as mega } from '../../../../types/tests/schema-tests-3.2/mega'
import { doc as minimalComp } from '../../../../types/tests/schema-tests-3.2/minimal-comp'
import { doc as minimalHooks } from '../../../../types/tests/schema-tests-3.2/minimal-hooks'
import { doc as minimalPaths } from '../../../../types/tests/schema-tests-3.2/minimal-paths'
import { doc as nonOauthScopes } from '../../../../types/tests/schema-tests-3.2/non-oauth-scopes'
import { doc as operationObjectExample } from '../../../../types/tests/schema-tests-3.2/operation-object-example'
import { doc as parameterObjectCookieFormAllowReserved } from '../../../../types/tests/schema-tests-3.2/parameter-object-cookie-form-allow-reserved'
import { doc as parameterObjectExamples } from '../../../../types/tests/schema-tests-3.2/parameter-object-examples'
import { doc as parameterObjectPathAllowReserved } from '../../../../types/tests/schema-tests-3.2/parameter-object-path-allow-reserved'
import { doc as parameterObjectQueryAllowReserved } from '../../../../types/tests/schema-tests-3.2/parameter-object-query-allow-reserved'
import { doc as pathItemObjectExample } from '../../../../types/tests/schema-tests-3.2/path-item-object-example'
import { doc as pathItemServersParameters } from '../../../../types/tests/schema-tests-3.2/path-item-servers-parameters'
import { doc as pathNoResponse } from '../../../../types/tests/schema-tests-3.2/path-no-response'
import { doc as pathVarEmptyPathitem } from '../../../../types/tests/schema-tests-3.2/path-var-empty-pathitem'
import { doc as pathsObjectExample } from '../../../../types/tests/schema-tests-3.2/paths-object-example'
import { doc as requestBodyExamples } from '../../../../types/tests/schema-tests-3.2/request-body-examples'
import { doc as responseObjectExamples } from '../../../../types/tests/schema-tests-3.2/response-object-examples'
import { doc as schema } from '../../../../types/tests/schema-tests-3.2/schema'
import { doc as schemaObjectDeprecatedExampleKeyword } from '../../../../types/tests/schema-tests-3.2/schema-object-deprecated-example-keyword'
import { doc as servers } from '../../../../types/tests/schema-tests-3.2/servers'
import { doc as specificationExtensions } from '../../../../types/tests/schema-tests-3.2/specification-extensions'
import { doc as styleDefaults } from '../../../../types/tests/schema-tests-3.2/style-defaults'
import { doc as tagObjectExample } from '../../../../types/tests/schema-tests-3.2/tag-object-example'
import { doc as validSchemaTypes } from '../../../../types/tests/schema-tests-3.2/valid-schema-types'
import { doc as webhookExample } from '../../../../types/tests/schema-tests-3.2/webhook-example'
import { expectNoNewDanglingRefs, expectValidAs } from '../../helpers'

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

describe('official corpus', () => {
  it.each(corpus)('converts %s to a valid 3.1 document without new dangling references or mutating the input', async (_name, doc) => {
    await expectValidAs(doc, '3.2')
    const before = structuredClone(doc)
    const v31 = downgradeSpecV32ToV31(doc)
    expect(v31.openapi).toBe('3.1.2')
    await expectValidAs(v31, '3.1')
    expectNoNewDanglingRefs(doc, v31)
    expect(doc).toEqual(before)
  })
})

describe('official examples', () => {
  it('removes the QUERY operation of the query example, leaving an empty path item', () => {
    const v31 = downgradeSpecV32ToV31(queryExample)
    expect(v31.paths?.['/flights/search']).toEqual({})
    expect(v31).toMatchSnapshot()
  })

  it('flattens the tag hierarchy of the tags example', () => {
    const v31 = downgradeSpecV32ToV31(tagsExample)
    expect(v31.tags).toEqual([
      { description: 'Core flight operations', name: 'flights' },
      { description: 'Flights that cross country borders', name: 'international' },
      { description: 'Flights within a single country', name: 'domestic' },
      {
        description: 'Information about flight delays',
        externalDocs: { description: 'Delay compensation policies', url: 'https://docs.example.com/delay-policies' },
        name: 'delays',
      },
    ])
    expect(v31).toMatchSnapshot()
  })

  it('removes the discriminator defaultMapping of the mega document', () => {
    const v31 = downgradeSpecV32ToV31(mega)
    const discriminator = ['components', 'pathItems', 'myPathItem', 'post', 'requestBody', 'content', 'application/json', 'schema', 'discriminator']
    expect(v31).not.toHaveProperty([...discriminator, 'defaultMapping'])
    expect(v31).toHaveProperty([...discriminator, 'propertyName'], 'type')
    expect(v31).toMatchSnapshot()
  })
})

describe('kitchen sink', () => {
  it('converts every 3.2-only construct into a valid 3.1 document', async () => {
    const kitchenSink: OpenAPIV3_2.OpenAPIObject = {
      $self: 'https://api.example.com/openapi.json',
      components: {
        mediaTypes: { JsonPayload: { schema: { items: { type: 'string' }, type: 'array' } } },
        parameters: {
          filter: {
            content: { 'application/json': { schema: { properties: { term: { type: 'string' } }, type: 'object' } } },
            in: 'querystring',
            name: 'filter',
          },
          page: { in: 'query', name: 'page', schema: { type: 'integer' } },
        },
        securitySchemes: {
          deviceAuth: {
            deprecated: true,
            flows: {
              deviceAuthorization: {
                deviceAuthorizationUrl: 'https://auth.example.com/device',
                scopes: { 'events:read': 'Read events' },
                tokenUrl: 'https://auth.example.com/token',
              },
            },
            oauth2MetadataUrl: 'https://auth.example.com/.well-known/oauth',
            type: 'oauth2',
          },
        },
      },
      info: { title: 'Kitchen Sink', version: '1.0.0' },
      openapi: '3.2.0',
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              200: {
                content: {
                  'application/json': { itemSchema: { type: 'object' }, schema: { items: { type: 'object' }, type: 'array' } },
                  'application/jsonl': { itemSchema: { properties: { kind: { type: 'string' } }, type: 'object' } },
                },
                summary: 'Event stream',
              },
              204: {},
            },
          },
        },
        '/search': {
          get: {
            operationId: 'searchEvents',
            parameters: [
              {
                content: { 'application/json': { schema: { properties: { term: { type: 'string' } }, type: 'object' } } },
                in: 'querystring',
                name: 'filter',
              },
              {
                examples: {
                  kept: { serializedValue: 'sid=1', value: 'sid=1' },
                  linked: { dataValue: { sid: 2 }, externalValue: 'https://example.com/session.json' },
                  promoted: { dataValue: 'sid=3' },
                },
                in: 'cookie',
                name: 'session',
                schema: { type: 'string' },
                style: 'cookie',
              },
            ],
            responses: {
              200: {
                content: { 'application/json': { $ref: '#/components/mediaTypes/JsonPayload' } },
                description: 'Search results',
                summary: 'Results',
              },
            },
          },
        },
      },
      security: [{ deviceAuth: ['events:read'] }],
      servers: [{ name: 'production', url: 'https://api.example.com' }],
    }
    const before = structuredClone(kitchenSink)
    const v31 = downgradeSpecV32ToV31(kitchenSink)
    expect(v31).toEqual({
      components: {
        parameters: { page: { in: 'query', name: 'page', schema: { type: 'integer' } } },
        securitySchemes: { deviceAuth: { flows: {}, type: 'oauth2' } },
      },
      info: { title: 'Kitchen Sink', version: '1.0.0' },
      openapi: '3.1.2',
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              200: {
                content: {
                  'application/json': { schema: { items: { type: 'object' }, type: 'array' } },
                  'application/jsonl': { schema: { items: { properties: { kind: { type: 'string' } }, type: 'object' }, type: 'array' } },
                },
                description: 'Event stream',
              },
              204: { description: '' },
            },
          },
        },
        '/search': {
          get: {
            operationId: 'searchEvents',
            parameters: [
              {
                examples: {
                  kept: { value: 'sid=1' },
                  linked: { externalValue: 'https://example.com/session.json' },
                  promoted: { value: 'sid=3' },
                },
                in: 'cookie',
                name: 'session',
                schema: { type: 'string' },
              },
            ],
            responses: {
              200: {
                content: { 'application/json': { schema: { items: { type: 'string' }, type: 'array' } } },
                description: 'Search results',
              },
            },
          },
        },
      },
      security: [{ deviceAuth: ['events:read'] }],
      servers: [{ url: 'https://api.example.com' }],
    })
    await expectValidAs(v31, '3.1')
    expect(kitchenSink).toEqual(before)
  })
})
