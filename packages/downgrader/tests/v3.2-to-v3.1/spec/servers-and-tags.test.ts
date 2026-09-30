import { convertSpec } from './helpers'

describe('servers', () => {
  // Server `name` is new in 3.2: https://spec.openapis.org/oas/v3.2.0.html#server-name
  it('removes server name at the root, path item, operation, and link levels', () => {
    expect(convertSpec({
      components: { links: { L: { operationId: 'op', server: { name: 's', url: '/u' } } } },
      paths: {
        '/a': {
          get: { responses: {}, servers: [{ name: 's', url: '/u' }] },
          servers: [{ name: 's', url: '/u' }],
        },
      },
      servers: [{ description: 'd', name: 'prod', url: 'https://example.com' }],
    })).toEqual({
      components: { links: { L: { operationId: 'op', server: { url: '/u' } } } },
      openapi: '3.1.2',
      paths: {
        '/a': {
          get: { responses: {}, servers: [{ url: '/u' }] },
          servers: [{ url: '/u' }],
        },
      },
      servers: [{ description: 'd', url: 'https://example.com' }],
    })
  })

  it('clones non-array servers and non-object server entries through', () => {
    expect(convertSpec({ paths: { '/a': { servers: 'junk' } }, servers: [5, null] })).toEqual({
      openapi: '3.1.2',
      paths: { '/a': { servers: 'junk' } },
      servers: [5, null],
    })
  })
})

describe('tags', () => {
  // 3.2 turns tags into a hierarchy with `summary`, `parent`, and `kind`:
  // https://spec.openapis.org/oas/v3.2.0.html#tag-object
  // 3.1 tags are flat, so the hierarchy is lost. Operations keep referring to
  // every tag by name, so no operation loses a tag.
  it('removes tag summary, parent, and kind and keeps the other fields', () => {
    expect(convertSpec({
      tags: [
        { description: 'd', externalDocs: { url: 'https://example.com' }, kind: 'nav', name: 'pets', parent: 'animals', summary: 'Pets' },
        'junk',
        1,
      ],
    }).tags).toEqual([
      { description: 'd', externalDocs: { url: 'https://example.com' }, name: 'pets' },
      'junk',
      1,
    ])
  })
})
