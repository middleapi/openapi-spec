import { dig } from '../../helpers'
import { convertSpec } from './helpers'

const apiKey = { in: 'header', name: 'k', type: 'apiKey' }

describe('mutualTLS', () => {
  // The `mutualTLS` scheme type is new in 3.1: https://spec.openapis.org/oas/v3.1.2.html#security-scheme-type
  // 3.0 cannot describe it, so the scheme is removed together with its name
  // in every Security Requirement. A requirement left empty is removed too:
  // an empty requirement `{}` means "no security needed"
  // (https://spec.openapis.org/oas/v3.0.4.html#security-requirement-object),
  // which would open up an endpoint that required a client certificate.
  it('removes mutualTLS schemes and requirements that become empty', () => {
    const result = convertSpec({
      components: { securitySchemes: { api: apiKey, mtls: { type: 'mutualTLS' } } },
      security: [{ mtls: [] }, { api: [], mtls: [] }, {}],
    })
    expect(result.components).toEqual({ securitySchemes: { api: apiKey } })
    expect(result.security).toEqual([{ api: [] }, {}])
  })

  // An empty operation `security` list would remove all security from the
  // operation (https://spec.openapis.org/oas/v3.0.4.html#operation-security),
  // so an emptied list is removed instead. The operation then falls back to
  // the root `security`.
  it('removes a security list that became empty instead of making it public', () => {
    const result = convertSpec({
      components: { securitySchemes: { mtls: { type: 'mutualTLS' } } },
      paths: { '/admin': { get: { responses: {}, security: [{ mtls: [] }] } } },
      security: [{ mtls: [] }],
    })
    expect(result.paths).toEqual({ '/admin': { get: { responses: {} } } })
    expect(result).not.toHaveProperty('security')
  })

  it('keeps a security list that was empty in the input', () => {
    const result = convertSpec({ paths: { '/a': { get: { responses: {}, security: [] } } }, security: [] })
    expect(result.paths).toEqual({ '/a': { get: { responses: {}, security: [] } } })
    expect(result.security).toEqual([])
  })

  it('converts operation-level security lists', () => {
    expect(convertSpec({
      components: { securitySchemes: { api: apiKey, mtls: { type: 'mutualTLS' } } },
      paths: { '/a': { get: { responses: {}, security: [{ mtls: [] }, { api: ['read'] }] } } },
    }).paths).toEqual({ '/a': { get: { responses: {}, security: [{ api: [] }] } } })
  })

  // A scheme can be a Reference Object. It is judged by the scheme at the
  // end of its reference chain.
  it('removes reference aliases of mutualTLS schemes and their requirements', () => {
    const result = convertSpec({
      components: {
        securitySchemes: {
          api: apiKey,
          clientCert: { $ref: '#/components/securitySchemes/mtlsBase' },
          mtlsBase: { type: 'mutualTLS' },
        },
      },
      security: [{ clientCert: [] }, { api: [] }],
    })
    expect(result.components).toEqual({ securitySchemes: { api: apiKey } })
    expect(result.security).toEqual([{ api: [] }])
  })

  it('removes schemes aliased into the removed parts by the type of their target', () => {
    const result = convertSpec({
      components: {
        securitySchemes: {
          'Escaped': { $ref: '#/components/securitySchemes/m~1tls' },
          'Http': { $ref: '#/webhooks/w/x-http' },
          'm/tls': { type: 'mutualTLS' },
          'Tls': { $ref: '#/webhooks/w/x-tls' },
        },
      },
      paths: { '/a': { get: { responses: {}, security: [{ Tls: [] }, { Escaped: [] }, { Http: ['read'] }] } } },
      security: [{ Tls: [] }],
      webhooks: { w: { 'x-http': { scheme: 'bearer', type: 'http' }, 'x-tls': { type: 'mutualTLS' } } },
    })
    expect(result.components).toEqual({ securitySchemes: { Http: { scheme: 'bearer', type: 'http' } } })
    expect(result.security).toBeUndefined()
    expect(dig(result, 'paths', '/a', 'get', 'security')).toEqual([{ Http: [] }])
  })

  it('survives cyclic, dangling, external, and malformed scheme aliases', () => {
    const securitySchemes = {
      dangling: { $ref: '#/components/securitySchemes/missing' },
      external: { $ref: 'https://example.com/s.json#/schemes/a' },
      junk: 42,
      nested: { $ref: '#/components/securitySchemes/a/b' },
      ping: { $ref: '#/components/securitySchemes/pong' },
      pong: { $ref: '#/components/securitySchemes/ping' },
    }
    const security = [{ dangling: ['a'], external: ['b'], junk: ['c'], nested: ['d'], ping: ['e'] }]
    expect(convertSpec({ components: { securitySchemes }, security })).toMatchObject({ components: { securitySchemes }, security })
  })
})

describe('scopes of non-OAuth schemes', () => {
  // 3.1 lets a requirement list role names for any scheme type:
  // https://spec.openapis.org/oas/v3.1.2.html#security-requirements-name
  // In 3.0, "for other security scheme types, the array MUST be empty":
  // https://spec.openapis.org/oas/v3.0.4.html#security-requirements-name
  // The roles are not exchanged in-band, so dropping them does not change
  // what a client sends.
  it('empties the list on apiKey and http schemes and keeps it elsewhere', () => {
    expect(convertSpec({
      components: {
        securitySchemes: {
          api: apiKey,
          basic: { scheme: 'basic', type: 'http' },
          oauth: { flows: {}, type: 'oauth2' },
          oidc: { openIdConnectUrl: 'https://x', type: 'openIdConnect' },
        },
      },
      security: [
        { api: ['read'], basic: ['admin'] },
        { oauth: ['read'], oidc: ['a'], unknownScheme: ['s'] },
      ],
    }).security).toEqual([
      { api: [], basic: [] },
      { oauth: ['read'], oidc: ['a'], unknownScheme: ['s'] },
    ])
  })
})

describe('malformed input', () => {
  it('clones malformed security values and scheme maps unchanged', () => {
    expect(convertSpec({ security: [{ api: [] }, 'junk', 42] }).security).toEqual([{ api: [] }, 'junk', 42])
    expect(convertSpec({ security: { api: [] } }).security).toEqual({ api: [] })
    expect(convertSpec({ components: { securitySchemes: 'junk' } }).components).toEqual({ securitySchemes: 'junk' })
  })

  it('keeps non-array scopes as they are', () => {
    expect(convertSpec({
      components: { securitySchemes: { api: apiKey } },
      security: [{ api: 'read' }],
    }).security).toEqual([{ api: 'read' }])
  })
})
