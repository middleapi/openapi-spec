import { convertComponent, convertSpec } from './helpers'

const flow = {
  authorizationUrl: 'https://example.com/auth',
  scopes: {},
  tokenUrl: 'https://example.com/token',
}

// 3.2 adds three security fields that 3.1 cannot express:
// - `deprecated`: https://spec.openapis.org/oas/v3.2.0.html#security-scheme-deprecated
// - `oauth2MetadataUrl` (RFC 8414 discovery): https://spec.openapis.org/oas/v3.2.0.html#security-scheme-oauth2-metadata-url
// - the OAuth device authorization flow (RFC 8628): https://spec.openapis.org/oas/v3.2.0.html#oauth-flows-device-authorization
// The scheme itself survives, so requirements naming it stay valid.
describe('3.2-only security scheme fields', () => {
  it.each([
    ['removes deprecated: true', { deprecated: true, type: 'http' }, { type: 'http' }],
    ['removes deprecated: false', { deprecated: false, type: 'http' }, { type: 'http' }],
    ['removes a malformed deprecated', { deprecated: 'yes', type: 'http' }, { type: 'http' }],
    ['removes oauth2MetadataUrl', { oauth2MetadataUrl: 'https://example.com/meta', type: 'oauth2' }, { type: 'oauth2' }],
    ['removes a malformed oauth2MetadataUrl', { oauth2MetadataUrl: 42, type: 'oauth2' }, { type: 'oauth2' }],
    [
      'removes the deviceAuthorization flow and keeps the other flows',
      {
        flows: {
          authorizationCode: flow,
          deviceAuthorization: { deviceAuthorizationUrl: 'https://example.com/device', scopes: {}, tokenUrl: flow.tokenUrl },
        },
        type: 'oauth2',
      },
      { flows: { authorizationCode: flow }, type: 'oauth2' },
    ],
    ['removes a malformed deviceAuthorization', { flows: { deviceAuthorization: 'junk' }, type: 'oauth2' }, { flows: {}, type: 'oauth2' }],
    ['clones malformed flows through', { flows: 'junk', type: 'oauth2' }, { flows: 'junk', type: 'oauth2' }],
    ['clones references through', { $ref: '#/components/securitySchemes/Other' }, { $ref: '#/components/securitySchemes/Other' }],
    ['passes a non-object scheme through', 'junk', 'junk'],
  ])('%s', (_name, scheme, expected) => {
    expect(convertComponent('securitySchemes', scheme)).toEqual(expected)
  })

  // An oauth2 scheme whose only flow was the device flow keeps an empty
  // `flows`, which the official 3.1 schema accepts. Requirements that name
  // the scheme are left intact rather than silently dropped.
  it('keeps a scheme left with no flows, and the requirements that name it', () => {
    const result = convertSpec({
      components: {
        securitySchemes: {
          device: {
            flows: { deviceAuthorization: { deviceAuthorizationUrl: 'https://example.com/device', scopes: { read: 'Read' }, tokenUrl: flow.tokenUrl } },
            type: 'oauth2',
          },
        },
      },
      security: [{ device: ['read'] }],
    })
    expect(result.components).toEqual({ securitySchemes: { device: { flows: {}, type: 'oauth2' } } })
    expect(result.security).toEqual([{ device: ['read'] }])
  })
})
