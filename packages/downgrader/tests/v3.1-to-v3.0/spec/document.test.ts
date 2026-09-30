import { downgradeSpecV31ToV30 } from '@openapi-spec/downgrader'

import { convertSpec, empty, info } from './helpers'

describe('openapi and paths', () => {
  it('stamps 3.0.4, the latest 3.0 patch release', () => {
    expect(downgradeSpecV31ToV30({ info, openapi: '3.1.1', paths: {} })).toEqual(empty)
  })

  // 3.1 made `paths` optional (a document may hold only webhooks or
  // components): https://spec.openapis.org/oas/v3.1.2.html#oas-paths
  // In 3.0 it is REQUIRED: https://spec.openapis.org/oas/v3.0.4.html#oas-paths
  // An empty Paths Object is valid and describes no operations.
  it('adds the version and an empty paths object when they are missing', () => {
    expect(downgradeSpecV31ToV30({ info } as any)).toEqual(empty)
  })

  it('clones non-object input unchanged', () => {
    expect(downgradeSpecV31ToV30(null as any)).toBeNull()
    expect(downgradeSpecV31ToV30(42 as any)).toBe(42)
    expect(downgradeSpecV31ToV30('spec' as any)).toBe('spec')
    const list = [1, { a: 1 }]
    const result = downgradeSpecV31ToV30(list as any)
    expect(result).toEqual(list)
    expect(result).not.toBe(list)
  })

  it('keeps unknown top-level keys and extensions', () => {
    expect(convertSpec({ 'future': { a: 1 }, 'x-root': true })).toEqual({ ...empty, 'future': { a: 1 }, 'x-root': true })
  })
})

describe('3.1-only root fields', () => {
  // `jsonSchemaDialect` and `webhooks` are new in 3.1:
  // https://spec.openapis.org/oas/v3.1.2.html#oas-json-schema-dialect
  // https://spec.openapis.org/oas/v3.1.2.html#oas-webhooks
  // 3.0 can only describe requests the API sends as callbacks of one of its
  // operations, not as standalone webhooks, and an `x-` extension would
  // only hide them from tools, so webhooks are removed.
  // References into them are inlined (see removed-parts.test.ts).
  it('removes jsonSchemaDialect and webhooks without leaving extensions behind', () => {
    const result = convertSpec({
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
      webhooks: { newPet: { post: { summary: 's' } } },
    })
    expect(result).toEqual(empty)
    expect(result).not.toHaveProperty('x-webhooks')
  })
})

describe('info', () => {
  // `info.summary` and `license.identifier` (an SPDX expression) are new in
  // 3.1: https://spec.openapis.org/oas/v3.1.2.html#info-summary
  // https://spec.openapis.org/oas/v3.1.2.html#license-identifier
  it('removes summary and license.identifier and keeps the other fields', () => {
    expect(convertSpec({
      info: {
        license: { identifier: 'MIT', name: 'MIT', url: 'https://opensource.org/license/mit' },
        summary: 'short',
        title: 't',
        version: '1',
      },
    }).info).toEqual({
      license: { name: 'MIT', url: 'https://opensource.org/license/mit' },
      title: 't',
      version: '1',
    })
  })

  it('clones malformed info and license values unchanged', () => {
    expect(convertSpec({ info: 42 }).info).toBe(42)
    expect(convertSpec({ info: { license: 'MIT', title: 't', version: '1' } }).info).toEqual({ license: 'MIT', title: 't', version: '1' })
  })
})

describe('paths', () => {
  // Paths Object keys are templates that start with a slash; any other key
  // can only be a specification extension: https://spec.openapis.org/oas/v3.0.4.html#paths-object
  it('converts path items and clones non-path keys', () => {
    expect(convertSpec({
      paths: {
        '/a': { get: { summary: 's' } },
        'x-note': { get: { summary: 's' } },
      },
    }).paths).toEqual({
      '/a': { get: { responses: { default: { description: '' } }, summary: 's' } },
      'x-note': { get: { summary: 's' } },
    })
  })

  it('clones malformed paths, path items, operations, and nested objects unchanged', () => {
    expect(convertSpec({ paths: 'junk' }).paths).toBe('junk')
    const paths = {
      '/a': {
        get: { requestBody: 42, responses: { 200: 'junk', 201: { description: 'ok', links: 'junk' } } },
        parameters: [42],
      },
      '/b': {
        post: {
          requestBody: { content: { 'application/json': 'junk', 'multipart/form-data': { encoding: { field: 'junk' } } } },
          responses: {},
        },
      },
      '/c': { get: 'junk' },
      '/junk': 'junk',
    }
    expect(convertSpec({ paths }).paths).toEqual(paths)
  })
})
