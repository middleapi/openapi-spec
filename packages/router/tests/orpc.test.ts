import type { RouterMatch } from '@openapi-spec/router'
import { createPrefixMatcher, Router } from '@openapi-spec/router'

import { expectMatches } from './helpers'

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

    expectMatches(router, {
      '/planets': ['GET /planets'],
      '/planets/': ['GET /planets'],
      '/planets/search': ['GET /planets/search'],
      '/planets/earth': ['GET /planets/{id}', { id: 'earth' }],
      '/planets/s%65arch': ['GET /planets/search'],
      '/planets/search%20me': ['GET /planets/{id}', { id: 'search me' }],
      '/planets/earth/moons/luna': [
        'GET /planets/{planetId}/moons/{moonId}',
        { planetId: 'earth', moonId: 'luna' },
      ],
      '/planets/earth/moons': undefined,
      '/me': ['GET /me'],
      '/me/settings': ['GET /{workspaceId}/settings', { workspaceId: 'me' }],
      '/w1/settings': ['GET /{workspaceId}/settings', { workspaceId: 'w1' }],
      '/auth/sign-in': undefined,
      '/files/a.txt': ['GET /files/{+path}', { path: 'a.txt' }],
      '/files/a/b.txt/meta': ['GET /files/{+path}/meta', { path: 'a/b.txt' }],
      '/files/meta': ['GET /files/{+path}', { path: 'meta' }],
      // the literal `files` beats `{workspaceId}`, whatever comes after it
      '/files/settings': ['GET /files/{+path}', { path: 'settings' }],
      '/files': undefined,
      '/v1/items:batchGet': ['GET /v1/items:batchGet'],
      '/v1/items%3AbatchGet': ['GET /v1/items:batchGet'],
      '/planet/create': undefined,
    })
    expectMatches(
      router,
      {
        '/planets': ['POST /planets'],
        '/auth/sign-in': ['POST /auth/sign-in'],
        '/planet/create': ['POST /planet/create'],
      },
      'POST',
    )
    expectMatches(router, { '/planets/search': ['PUT /planets/{id}', { id: 'search' }] }, 'PUT')
    expectMatches(router, { '/planets/1': ['PATCH /planets/{id}', { id: '1' }] }, 'PATCH')
    expectMatches(router, { '/planets/1/': ['DELETE /planets/{id}', { id: '1' }] }, 'DELETE')
    expectMatches(router, { '/planets': undefined }, 'OPTIONS')
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
    expectMatches(router, { '/planets/1': undefined })

    // the first load adds one route, then fails
    router.add('GET', '/planets/{id}', 'find')
    expectMatches(router, { '/planets/1': ['find', { id: '1' }] })

    // the retry adds every route again
    router.add('GET', '/planets', 'list again')
    router.add('GET', '/planets/{id}', 'find again')
    router.add('GET', '/planets/{id}/moons', 'moons')

    expectMatches(router, {
      '/planets': ['list'],
      '/planets/1': ['find', { id: '1' }],
      '/planets/1/moons': ['moons', { id: '1' }],
    })
  })
})
