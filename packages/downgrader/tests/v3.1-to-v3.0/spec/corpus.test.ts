// The official 3.1 documents, from OAI/learn.openapis.org and from the
// `tests/schema/pass` folder of OAI/OpenAPI-Specification (see
// packages/types/tests/README.md). Each one must downgrade to a document the
// official 3.0 JSON Schema accepts, without leaving a reference dangling that
// resolved before.

import type * as OpenAPIV3_1 from '@openapi-spec/types/v3.1'

import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { doc as nonOauthScopesExample } from '../../../../types/tests/examples/non-oauth-scopes-3-1'
import { doc as petstore } from '../../../../types/tests/examples/petstore-3-0'
import { doc as tictactoe } from '../../../../types/tests/examples/tictactoe-3-1'
import { doc as webhookExampleDoc } from '../../../../types/tests/examples/webhook-example-3-1'
import { doc as callbackObjectExamples } from '../../../../types/tests/schema-tests-3.1/callback-object-examples'
import { doc as compPathitems } from '../../../../types/tests/schema-tests-3.1/comp-pathitems'
import { doc as componentsObjectExample } from '../../../../types/tests/schema-tests-3.1/components-object-example'
import { doc as exampleObjectExamples } from '../../../../types/tests/schema-tests-3.1/example-object-examples'
import { doc as headerObjectExamples } from '../../../../types/tests/schema-tests-3.1/header-object-examples'
import { doc as infoObjectExample } from '../../../../types/tests/schema-tests-3.1/info-object-example'
import { doc as infoSummary } from '../../../../types/tests/schema-tests-3.1/info-summary'
import { doc as jsonSchemaDialect } from '../../../../types/tests/schema-tests-3.1/json-schema-dialect'
import { doc as licenseIdentifier } from '../../../../types/tests/schema-tests-3.1/license-identifier'
import { doc as linkObjectExamples } from '../../../../types/tests/schema-tests-3.1/link-object-examples'
import { doc as mediaTypeExamples } from '../../../../types/tests/schema-tests-3.1/media-type-examples'
import { doc as mega } from '../../../../types/tests/schema-tests-3.1/mega'
import { doc as minimalComp } from '../../../../types/tests/schema-tests-3.1/minimal-comp'
import { doc as minimalHooks } from '../../../../types/tests/schema-tests-3.1/minimal-hooks'
import { doc as minimalPaths } from '../../../../types/tests/schema-tests-3.1/minimal-paths'
import { doc as nonOauthScopes } from '../../../../types/tests/schema-tests-3.1/non-oauth-scopes'
import { doc as operationObjectExample } from '../../../../types/tests/schema-tests-3.1/operation-object-example'
import { doc as parameterObjectExamples } from '../../../../types/tests/schema-tests-3.1/parameter-object-examples'
import { doc as parameterObjectQueryAllowReserved } from '../../../../types/tests/schema-tests-3.1/parameter-object-query-allow-reserved'
import { doc as pathItemObjectExample } from '../../../../types/tests/schema-tests-3.1/path-item-object-example'
import { doc as pathItemServersParameters } from '../../../../types/tests/schema-tests-3.1/path-item-servers-parameters'
import { doc as pathNoResponse } from '../../../../types/tests/schema-tests-3.1/path-no-response'
import { doc as pathVarEmptyPathitem } from '../../../../types/tests/schema-tests-3.1/path-var-empty-pathitem'
import { doc as pathsObjectExample } from '../../../../types/tests/schema-tests-3.1/paths-object-example'
import { doc as requestBodyExamples } from '../../../../types/tests/schema-tests-3.1/request-body-examples'
import { doc as responseObjectExamples } from '../../../../types/tests/schema-tests-3.1/response-object-examples'
import { doc as schema } from '../../../../types/tests/schema-tests-3.1/schema'
import { doc as schemaObjectDeprecatedExampleKeyword } from '../../../../types/tests/schema-tests-3.1/schema-object-deprecated-example-keyword'
import { doc as servers } from '../../../../types/tests/schema-tests-3.1/servers'
import { doc as specificationExtensions } from '../../../../types/tests/schema-tests-3.1/specification-extensions'
import { doc as tagObjectExample } from '../../../../types/tests/schema-tests-3.1/tag-object-example'
import { doc as validSchemaTypes } from '../../../../types/tests/schema-tests-3.1/valid-schema-types'
import { doc as webhookExample } from '../../../../types/tests/schema-tests-3.1/webhook-example'
import { expectNoNewDanglingRefs, expectValidAs } from '../../helpers'

// Left out:
// - security-scheme-object-examples, whose external `$ref` the validator
//   cannot resolve
// - style-defaults, which puts an `x-comment` in an Encoding Object; the
//   official 3.0 schema rejects extensions there
const corpus: readonly (readonly [name: string, doc: OpenAPIV3_1.OpenAPIObject])[] = [
  ['examples/non-oauth-scopes-3-1', nonOauthScopesExample],
  ['examples/tictactoe-3-1', tictactoe],
  ['examples/webhook-example-3-1', webhookExampleDoc],
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
  ['parameter-object-examples', parameterObjectExamples],
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
  ['tag-object-example', tagObjectExample],
  ['valid-schema-types', validSchemaTypes],
  ['webhook-example', webhookExample],
]

describe('official corpus', () => {
  it.each(corpus)('converts %s to a valid 3.0 document without new dangling references or mutating the input', async (_name, doc) => {
    await expectValidAs(doc, '3.1')
    const before = structuredClone(doc)
    const v30 = downgradeSpecV31ToV30(doc)
    expect(v30.openapi).toBe('3.0.4')
    await expectValidAs(v30, '3.0')
    expectNoNewDanglingRefs(doc, v30)
    expect(doc).toEqual(before)
  })
})

describe('official examples', () => {
  it('converts the tictactoe example', () => {
    expect(downgradeSpecV31ToV30(tictactoe)).toMatchSnapshot()
  })

  it('removes the webhooks of the webhook example, leaving empty paths', () => {
    const v30 = downgradeSpecV31ToV30(webhookExampleDoc)
    expect(v30).not.toHaveProperty('webhooks')
    expect(v30.paths).toEqual({})
    expect(v30.components).toHaveProperty(['schemas', 'Pet'])
    expect(v30).toMatchSnapshot()
  })

  it('empties the roles on the non-OAuth scheme of the non-OAuth-scopes example', () => {
    const v30 = downgradeSpecV31ToV30(nonOauthScopesExample)
    expect(v30.paths['/users']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(v30.paths['/users']?.get?.responses).toEqual({ default: { description: '' } })
    expect(v30).toMatchSnapshot()
  })

  it('removes the 3.1-only constructs and the mutualTLS scheme of the mega document', () => {
    const v30 = downgradeSpecV31ToV30(mega)
    expect(v30.info).toEqual({ license: { name: 'Apache 2.0' }, title: 'My API', version: '1.0.0' })
    expect(v30.components).not.toHaveProperty('pathItems')
    expect(v30.components?.securitySchemes).toEqual({})
    expect(JSON.stringify(v30)).not.toContain('#/components/pathItems/')
    expect(v30).toMatchSnapshot()
  })

  // A document that only uses what 3.0 already had comes out unchanged,
  // apart from the version.
  it('passes the 3.0 petstore example through apart from the version', () => {
    expect(downgradeSpecV31ToV30(petstore as any)).toEqual({ ...structuredClone(petstore), openapi: '3.0.4' })
  })
})

describe('hand-written documents', () => {
  it('inlines references into webhooks and components.pathItems into a valid 3.0 document', async () => {
    const petSchema = '#/webhooks/newPet/post/requestBody/content/application~1json/schema'
    const doc: OpenAPIV3_1.OpenAPIObject = {
      components: {
        pathItems: {
          item: {
            get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
            parameters: [{ in: 'query', name: 'q', schema: { type: ['string', 'null'] } }],
          },
        },
        schemas: { Pet: { $ref: petSchema } },
      },
      info: { title: 'Webhook references', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/items': { $ref: '#/components/pathItems/item' },
        '/pets': {
          get: {
            parameters: [
              { $ref: '#/webhooks/newPet/post/parameters/0' },
              { $ref: '#/components/pathItems/item/parameters/0', description: 'Filter' },
            ],
            responses: {
              200: {
                content: { 'application/json': { schema: { items: { $ref: petSchema }, type: 'array' } } },
                description: 'ok',
                links: {
                  hook: { operationRef: '#/webhooks/newPet/post' },
                  item: { operationRef: '#/components/pathItems/item/get' },
                },
              },
              201: { $ref: '#/webhooks/newPet/post/responses/200' },
            },
          },
        },
      },
      webhooks: {
        newPet: {
          post: {
            operationId: 'newPetHook',
            parameters: [{ in: 'header', name: 'X-Signature', schema: { type: 'string' } }],
            requestBody: {
              content: {
                'application/json': {
                  schema: { properties: { name: { type: 'string' }, parent: { $ref: petSchema } }, type: 'object' },
                },
              },
            },
            responses: { 200: { description: 'received' } },
          },
        },
      },
    }
    await expectValidAs(doc, '3.1')
    const v30 = downgradeSpecV31ToV30(doc)
    const pet = { properties: { name: { type: 'string' }, parent: {} }, type: 'object' }
    expect(v30.components).toEqual({ schemas: { Pet: pet } })
    expect(v30.paths).toEqual({
      '/items': {
        get: { operationId: 'getItem', responses: { 200: { description: 'item' } } },
        parameters: [{ in: 'query', name: 'q', schema: { nullable: true, type: 'string' } }],
      },
      '/pets': {
        get: {
          parameters: [
            { in: 'header', name: 'X-Signature', schema: { type: 'string' } },
            { in: 'query', name: 'q', schema: { nullable: true, type: 'string' } },
          ],
          responses: {
            200: { content: { 'application/json': { schema: { items: pet, type: 'array' } } }, description: 'ok', links: {} },
            201: { description: 'received' },
          },
        },
      },
    })
    await expectValidAs(v30, '3.0')
  })

  it('converts raw and encoded binary bodies into a valid 3.0 document', async () => {
    const doc: OpenAPIV3_1.OpenAPIObject = {
      info: { title: 'Uploads', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/avatar': {
          put: {
            requestBody: {
              content: {
                'image/png': { schema: { contentMediaType: 'image/png' } },
                'text/plain': { schema: { contentEncoding: 'base64', contentMediaType: 'image/png', type: 'string' } },
              },
            },
            responses: { 204: { description: 'saved' } },
          },
        },
      },
    }
    const v30 = downgradeSpecV31ToV30(doc)
    expect(v30.paths['/avatar']?.put?.requestBody).toEqual({
      content: {
        'image/png': { schema: { format: 'binary', type: 'string' } },
        'text/plain': { schema: { format: 'byte', type: 'string' } },
      },
    })
    await expectValidAs(v30, '3.0')
  })

  it('keeps untyped multipart parts sent as application/octet-stream in a valid 3.0 document', async () => {
    const schema: OpenAPIV3_1.SchemaObject = {
      properties: {
        addresses: { items: { type: 'object' }, type: 'array' },
        file: { items: {}, type: 'array' },
        id: { format: 'uuid', type: 'string' },
        profileImage: {},
      },
      type: 'object',
    }
    const headers = { 'X-Rate-Limit-Limit': { schema: { type: 'integer' } } } as const
    const doc: OpenAPIV3_1.OpenAPIObject = {
      info: { title: 'Uploads', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/profile': {
          post: {
            requestBody: { content: { 'multipart/form-data': { encoding: { profileImage: { headers } }, schema } } },
            responses: { 204: { description: 'saved' } },
          },
        },
      },
    }
    const v30 = downgradeSpecV31ToV30(doc)
    expect(v30.paths['/profile']?.post?.requestBody).toEqual({
      content: {
        'multipart/form-data': {
          encoding: {
            file: { contentType: 'application/octet-stream' },
            profileImage: { contentType: 'application/octet-stream', headers },
          },
          schema,
        },
      },
    })
    await expectValidAs(v30, '3.0')
  })

  // `defaultMapping` is a 3.2 field that can reach a 3.1 document written by
  // hand or by a lenient tool. The 3.0 schema tolerates unknown
  // discriminator fields, so it is kept.
  it('keeps a discriminator defaultMapping, which the 3.0 schema tolerates', async () => {
    const doc = {
      components: {
        schemas: {
          Cat: { properties: { kind: { type: 'string' } }, required: ['kind'], type: 'object' },
          Pet: {
            discriminator: { defaultMapping: 'Cat', mapping: { cat: '#/components/schemas/Cat' }, propertyName: 'kind' },
            oneOf: [{ $ref: '#/components/schemas/Cat' }],
          },
        },
      },
      info: { title: 'Discriminated', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {},
    }
    const v30 = downgradeSpecV31ToV30(doc as any)
    expect(v30).toHaveProperty(['components', 'schemas', 'Pet', 'discriminator'], doc.components.schemas.Pet.discriminator)
    await expectValidAs(v30, '3.0')
  })
})
