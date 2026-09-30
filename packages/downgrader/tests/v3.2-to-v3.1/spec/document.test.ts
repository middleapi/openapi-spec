import { downgradeSpecV32ToV31 } from '@openapi-spec/downgrader'

import { convertSpec } from './helpers'

describe('openapi', () => {
  it('stamps 3.1.2, the latest 3.1 patch release', () => {
    expect(downgradeSpecV32ToV31({ info: { title: 't', version: '1.0.0' }, openapi: '3.2.0' })).toEqual({
      info: { title: 't', version: '1.0.0' },
      openapi: '3.1.2',
    })
  })

  it('adds the version when the input has none', () => {
    expect(downgradeSpecV32ToV31({} as any)).toEqual({ openapi: '3.1.2' })
  })
})

describe('$self', () => {
  // `$self` gives the document its own URI, which then serves as the base URI
  // for its relative references: https://spec.openapis.org/oas/v3.2.0.html#oas-self
  // 3.1 has no such field, so it is removed. References that relied on it
  // are left as written (a known limitation listed in the README).
  it('removes $self', () => {
    expect(convertSpec({ $self: 'https://example.com/api.json' })).toEqual({ openapi: '3.1.2' })
  })
})

describe('jsonSchemaDialect', () => {
  // `jsonSchemaDialect` sets the default `$schema` of every Schema Object:
  // https://spec.openapis.org/oas/v3.1.2.html#oas-json-schema-dialect
  // 3.2 publishes its own OAS dialects under https://spec.openapis.org/oas/3.2/dialect/,
  // whose vocabulary knows 3.2-only keywords such as `xml.nodeType`. A 3.1
  // document instead uses the 3.1 OAS dialect schema id:
  // https://spec.openapis.org/oas/v3.1.2.html#dialect-schema-id
  it.each([
    ['rewrites the dated 3.2 OAS dialect', 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17', 'https://spec.openapis.org/oas/3.1/dialect/base'],
    ['rewrites a draft 3.2 OAS dialect', 'https://spec.openapis.org/oas/3.2/dialect/WORK-IN-PROGRESS', 'https://spec.openapis.org/oas/3.1/dialect/base'],
    ['keeps a 3.1 OAS dialect', 'https://spec.openapis.org/oas/3.1/dialect/base', 'https://spec.openapis.org/oas/3.1/dialect/base'],
    ['keeps a custom dialect', 'https://example.com/my-dialect', 'https://example.com/my-dialect'],
    ['clones a malformed value through', { junk: true }, { junk: true }],
  ])('%s', (_name, dialect, expected) => {
    expect(convertSpec({ jsonSchemaDialect: dialect })).toEqual({ jsonSchemaDialect: expected, openapi: '3.1.2' })
  })
})

describe('document shape', () => {
  it('returns non-object input unchanged', () => {
    expect(downgradeSpecV32ToV31(null as any)).toBeNull()
    expect(downgradeSpecV32ToV31('junk' as any)).toBe('junk')
    expect(downgradeSpecV32ToV31([1, 2] as any)).toEqual([1, 2])
  })

  it('keeps extensions and unknown keys at the document, path item, and operation levels', () => {
    const fields = {
      'futureKey': { anything: [1] },
      'info': { title: 't', version: '1' },
      'jsonSchemaDialect': 'https://spec.openapis.org/oas/3.1/dialect/base',
      'paths': {
        '/a': {
          'get': { 'operationId': 'getA', 'responses': {}, 'unknownOperationKey': 1, 'x-op': true },
          'unknownPathItemKey': 'kept',
          'x-item': [1, 2],
        },
      },
      'security': [{ oauth: ['read'] }],
      'x-root': { deep: { value: 1 } },
    }
    expect(convertSpec(fields)).toEqual({ ...fields, openapi: '3.1.2' })
  })
})
