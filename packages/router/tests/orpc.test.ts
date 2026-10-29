import type { RouterMatch } from '@openapi-spec/router'
import { createPrefixMatcher, Router } from '@openapi-spec/router'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Routes the way oRPC adds them: with a method, and the method and path as data. */
function routerOf(routes: readonly (readonly [Method, `/${string}`])[]): Router<string> {
  const router = new Router<string>()
  for (const [method, path] of routes) {
    router.add(method, path, `${method} ${path}`)
  }
  return router
}

describe('oRPC-style routes', () => {
  it('matches a REST contract with procedures of every kind', () => {
    const router = routerOf([
      ['GET', '/planets'],
      ['POST', '/planets'],
      ['GET', '/planets/search'],
      ['GET', '/planets/{id}'],
      ['PUT', '/planets/{id}'],
      ['PATCH', '/planets/{id}'],
      ['DELETE', '/planets/{id}'],
      ['GET', '/planets/{planetId}/moons/{moonId}'],
      ['GET', '/me'],
      ['POST', '/auth/sign-in'],
      ['GET', '/files/{+path}'],
      ['GET', '/files/{+path}/meta'],
      ['GET', '/{workspaceId}/settings'],
      ['GET', '/v1/items:batchGet'],
      // a procedure without a path, which oRPC exposes at its name
      ['POST', '/planet/create'],
    ])

    const cases: [Method, `/${string}`, RouterMatch<string> | undefined][] = [
      ['GET', '/planets', { data: 'GET /planets', params: undefined }],
      ['GET', '/planets/', { data: 'GET /planets', params: undefined }],
      ['POST', '/planets', { data: 'POST /planets', params: undefined }],
      ['GET', '/planets/search', { data: 'GET /planets/search', params: undefined }],
      ['GET', '/planets/earth', { data: 'GET /planets/{id}', params: { id: 'earth' } }],
      ['GET', '/planets/s%65arch', { data: 'GET /planets/search', params: undefined }],
      ['GET', '/planets/search%20me', { data: 'GET /planets/{id}', params: { id: 'search me' } }],
      ['PUT', '/planets/search', { data: 'PUT /planets/{id}', params: { id: 'search' } }],
      ['PATCH', '/planets/1', { data: 'PATCH /planets/{id}', params: { id: '1' } }],
      ['DELETE', '/planets/1/', { data: 'DELETE /planets/{id}', params: { id: '1' } }],
      [
        'GET',
        '/planets/earth/moons/luna',
        {
          data: 'GET /planets/{planetId}/moons/{moonId}',
          params: { planetId: 'earth', moonId: 'luna' },
        },
      ],
      ['GET', '/planets/earth/moons', undefined],
      ['GET', '/me', { data: 'GET /me', params: undefined }],
      [
        'GET',
        '/me/settings',
        { data: 'GET /{workspaceId}/settings', params: { workspaceId: 'me' } },
      ],
      [
        'GET',
        '/w1/settings',
        { data: 'GET /{workspaceId}/settings', params: { workspaceId: 'w1' } },
      ],
      ['POST', '/auth/sign-in', { data: 'POST /auth/sign-in', params: undefined }],
      ['GET', '/auth/sign-in', undefined],
      ['GET', '/files/a.txt', { data: 'GET /files/{+path}', params: { path: 'a.txt' } }],
      [
        'GET',
        '/files/a/b.txt/meta',
        { data: 'GET /files/{+path}/meta', params: { path: 'a/b.txt' } },
      ],
      ['GET', '/files/meta', { data: 'GET /files/{+path}', params: { path: 'meta' } }],
      // the literal `files` beats `{workspaceId}`, whatever comes after it
      ['GET', '/files/settings', { data: 'GET /files/{+path}', params: { path: 'settings' } }],
      ['GET', '/files', undefined],
      ['GET', '/v1/items:batchGet', { data: 'GET /v1/items:batchGet', params: undefined }],
      ['GET', '/v1/items%3AbatchGet', { data: 'GET /v1/items:batchGet', params: undefined }],
      ['POST', '/planet/create', { data: 'POST /planet/create', params: undefined }],
      ['GET', '/planet/create', undefined],
      ['OPTIONS' as Method, '/planets', undefined],
    ]

    for (const [method, path, expected] of cases) {
      expect(router.match(method, path), `${method} ${path}`).toStrictEqual(expected)
    }
  })

  it('matches the routes of lazy routers loaded by prefix between requests', () => {
    const router = routerOf([
      ['GET', '/me'],
      ['GET', '/{workspaceId}'],
    ])
    const lazies = [
      {
        prefix: '/planets',
        routes: [
          ['GET', '/planets/{id}'],
          ['GET', '/planets/{planetId}/moons/{moonId}'],
        ],
      },
      {
        prefix: '/{workspaceId}/members',
        routes: [
          ['GET', '/{workspaceId}/members/{id}'],
          ['DELETE', '/{workspaceId}/members/{id}'],
        ],
      },
      {
        prefix: '/files/{+path}',
        routes: [
          ['GET', '/files/{+path}'],
          ['GET', '/files/{+path}/meta'],
        ],
      },
    ] as const
    const pending = lazies.map((lazy) => ({ ...lazy, matches: createPrefixMatcher(lazy.prefix) }))
    const loaded: string[] = []

    /** Loads the lazy routers whose prefix a request path can match first, as oRPC does. */
    function match(method: Method, pathname: `/${string}`): RouterMatch<string> | undefined {
      for (const lazy of pending.filter((lazy) => lazy.matches(pathname))) {
        pending.splice(pending.indexOf(lazy), 1)
        loaded.push(lazy.prefix)
        for (const [routeMethod, path] of lazy.routes) {
          router.add(routeMethod, path, `${routeMethod} ${path}`)
        }
      }
      return router.match(method, pathname)
    }

    expect(match('GET', '/me')).toStrictEqual({ data: 'GET /me', params: undefined })
    expect(match('GET', '/w1')).toStrictEqual({
      data: 'GET /{workspaceId}',
      params: { workspaceId: 'w1' },
    })
    expect(loaded).toEqual([])

    expect(match('GET', '/planets/earth')).toStrictEqual({
      data: 'GET /planets/{id}',
      params: { id: 'earth' },
    })
    expect(match('DELETE', '/w1/members/7')).toStrictEqual({
      data: 'DELETE /{workspaceId}/members/{id}',
      params: { workspaceId: 'w1', id: '7' },
    })
    expect(match('GET', '/files/a/b/meta')).toStrictEqual({
      data: 'GET /files/{+path}/meta',
      params: { path: 'a/b' },
    })
    expect(loaded).toEqual(['/planets', '/{workspaceId}/members', '/files/{+path}'])

    expect(match('GET', '/w1/members/7')).toStrictEqual({
      data: 'GET /{workspaceId}/members/{id}',
      params: { workspaceId: 'w1', id: '7' },
    })
    expect(match('GET', '/planets/earth/moons/luna')).toStrictEqual({
      data: 'GET /planets/{planetId}/moons/{moonId}',
      params: { planetId: 'earth', moonId: 'luna' },
    })
    expect(match('GET', '/planets')).toStrictEqual({
      data: 'GET /{workspaceId}',
      params: { workspaceId: 'planets' },
    })
    expect(match('GET', '/files')).toStrictEqual({
      data: 'GET /{workspaceId}',
      params: { workspaceId: 'files' },
    })
    expect(match('GET', '/w1/members')).toBeUndefined()
  })

  it('keeps the routes of a lazy router that failed partway when it loads again', () => {
    const router = new Router<string>()
    router.add('GET', '/planets', 'list')
    expect(router.match('GET', '/planets/1')).toBeUndefined()

    // the first load adds one route, then fails
    router.add('GET', '/planets/{id}', 'find')
    expect(router.match('GET', '/planets/1')).toStrictEqual({ data: 'find', params: { id: '1' } })

    // the retry adds every route again
    router.add('GET', '/planets', 'list again')
    router.add('GET', '/planets/{id}', 'find again')
    router.add('GET', '/planets/{id}/moons', 'moons')

    expect(router.match('GET', '/planets')).toStrictEqual({ data: 'list', params: undefined })
    expect(router.match('GET', '/planets/1')).toStrictEqual({ data: 'find', params: { id: '1' } })
    expect(router.match('GET', '/planets/1/moons')).toStrictEqual({
      data: 'moons',
      params: { id: '1' },
    })
  })
})
