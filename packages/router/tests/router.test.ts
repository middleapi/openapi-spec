import { Router } from '@openapi-spec/router'

import { expectMatches, routerOf } from './helpers'

describe('Router', () => {
  describe('literal segments', () => {
    it('matches a route by method and path', () => {
      const router = new Router<string>()
      router.add('POST', '/planet/create', 'create')
      router.add('GET', '/planet/create', 'read')

      expectMatches(
        router,
        { '/planet/create': ['create'], '/planet': undefined, '/planet/create/more': undefined },
        'POST',
      )
      expectMatches(router, { '/planet/create': ['read'] })
      expectMatches(router, { '/planet/create': undefined }, 'PUT')
      expectMatches(router, { '/planet/create': undefined }, 'post')
    })

    it('matches a route whose data is `undefined`', () => {
      const router = new Router<string | undefined>()
      router.add('GET', '/a', undefined)
      router.add('GET', '/a', 'second')
      router.add('GET', '/b/{id}', undefined)

      expect(router.match('GET', '/a')).toStrictEqual({ data: undefined, params: undefined })
      expect(router.match('GET', '/%61')).toStrictEqual({ data: undefined, params: undefined })
      expect(router.match('GET', '/b/1')).toStrictEqual({ data: undefined, params: { id: '1' } })
      expect(router.match('GET', '/c')).toBeUndefined()
    })

    it('ignores one trailing slash in routes and requests', () => {
      expectMatches(routerOf('/', '/ping', '/echo/'), {
        '/': ['/'],
        '/ping/': ['/ping'],
        '/p%69ng/': ['/ping'],
        '/echo': ['/echo/'],
        '/echo/': ['/echo/'],
        // a second slash is an empty segment
        '/ping//': undefined,
        '//': undefined,
      })
    })

    it('matches empty segments only as written', () => {
      expectMatches(routerOf('/a/b', '/a//c'), {
        '/a//b': undefined,
        '//a/b': undefined,
        '/a//c': ['/a//c'],
        '/a/c': undefined,
      })

      // the root path has no segments, not one empty segment
      const root = routerOf('//', '/{id}')
      expectMatches(root, { '/': undefined, '//': ['//'] })

      // also once a request path with `%` has put the static routes in the tree
      expectMatches(root, { '/%31': ['/{id}', { id: '1' }], '/': undefined })
    })

    it('matches path text literally, even characters that are route syntax elsewhere', () => {
      const literals = [
        '/.',
        '/./ping',
        '/../ping',
        '/*',
        '/(x)',
        '/items:batchGet',
        '/{}',
        '/{+}',
        '/{a.b}',
        '/{id',
        '/id}',
      ] as const
      const router = routerOf(...literals, '/a/{id}.json', '/what%3F', '/id}/{x}', '/f/{+p}/id}')

      for (const path of literals) {
        expectMatches(router, { [path]: [path] })
      }

      expectMatches(router, {
        '/anything': undefined,
        '/x': undefined,
        '/itemsfoo': undefined,
        '/f/1/id}': ['/f/{+p}/id}', { p: '1' }],
        '/f/1/id': undefined,
        // only a whole-segment `{name}` is a param
        '/a/%7Bid%7D.json': ['/a/{id}.json'],
        '/a/id.json': undefined,
        '/id}/1': ['/id}/{x}', { x: '1' }],
        '/what%3F': ['/what%3F'],
        '/what': undefined,
      })
    })
  })

  describe('params', () => {
    it('matches a non-empty segment and decodes its value', () => {
      expectMatches(routerOf('/nested/echo/{value}'), {
        '/nested/echo/world': ['/nested/echo/{value}', { value: 'world' }],
        '/nested/%65cho/dinwwwh%2F': ['/nested/echo/{value}', { value: 'dinwwwh/' }],
        '/nested/echo/a%20b/': ['/nested/echo/{value}', { value: 'a b' }],
        '/nested/echo': undefined,
        '/nested/echo/': undefined,
        '/nested/echo//': undefined,
        '/nested/echo/a/b': undefined,
      })
    })

    it('supports names that are not identifiers, and repeated names, the last value winning', () => {
      expectMatches(routerOf('/users/{user-id}', '/digits/{0}/{1st}', '/repeated/{id}/{id}'), {
        '/users/a-id': ['/users/{user-id}', { 'user-id': 'a-id' }],
        '/digits/a/b': ['/digits/{0}/{1st}', { '0': 'a', '1st': 'b' }],
        '/repeated/a/b': ['/repeated/{id}/{id}', { id: 'b' }],
      })
    })

    it('returns a new params object for each match', () => {
      const router = routerOf('/a/{id}')

      expect(router.match('GET', '/a/1')!.params).not.toBe(router.match('GET', '/a/1')!.params)
    })

    it('matches a route that starts like the one added before it', () => {
      expectMatches(routerOf('/a/{x}', '/{p}/b', '/{p}/c', '/a/b/{y}', '/a/b/{y}/z'), {
        '/z/c': ['/{p}/c', { p: 'z' }],
        '/a/b/1/z': ['/a/b/{y}/z', { y: '1' }],
      })
    })
  })

  describe('catch-all params', () => {
    it('matches one or more segments, decoding them and keeping empty ones, but not an empty value', () => {
      expectMatches(routerOf('/files/{+path}'), {
        '/files/a': ['/files/{+path}', { path: 'a' }],
        '/files/a/b/c%2Fd/': ['/files/{+path}', { path: 'a/b/c/d' }],
        '/files/https%3A//example.com/a': ['/files/{+path}', { path: 'https://example.com/a' }],
        '/files//etc/hosts': ['/files/{+path}', { path: '/etc/hosts' }],
        '/files/a//': ['/files/{+path}', { path: 'a/' }],
        '/files/%2F': ['/files/{+path}', { path: '/' }],
        '/files///': ['/files/{+path}', { path: '/' }],
        '/files': undefined,
        '/files/': undefined,
        '/files//': undefined,
      })
    })

    it('matches segments after it', () => {
      expectMatches(routerOf('/files/{+path}/raw', '/{name}/{+rest}', '/blobs/{+path}/{version}'), {
        '/files/a/b/raw': ['/files/{+path}/raw', { path: 'a/b' }],
        '/files/raw': ['/{name}/{+rest}', { name: 'files', rest: 'raw' }],
        '/blobs/a/b/v2': ['/blobs/{+path}/{version}', { path: 'a/b', version: 'v2' }],
        '/a/b/c%2Fd/': ['/{name}/{+rest}', { name: 'a', rest: 'b/c/d' }],
      })
    })

    it('falls back to the next route when its value would be empty', () => {
      const router = routerOf('/files/{+path}', '/{+path}', '/{name}')

      // repeated, so a result that depends on state left by a match would show up
      for (let i = 0; i < 2; i++) {
        expectMatches(router, { '/files': ['/{name}', { name: 'files' }] })
      }

      expectMatches(router, {
        '/files/a': ['/files/{+path}', { path: 'a' }],
        '/a/b': ['/{+path}', { path: 'a/b' }],
      })
    })
  })

  describe('invalid paths', () => {
    it('throws for more than one catch-all param, adding nothing', () => {
      const router = new Router<string>()

      expect(() => router.add('GET', '/{+a}/x/{+b}', 'invalid')).toThrowError(
        new TypeError(
          'OpenAPI path "/{+a}/x/{+b}" has more than one catch-all param ({+name}), but only one is supported per path.',
        ),
      )
      expect(router.match('GET', '/a/x/b')).toBeUndefined()
    })

    it('accepts `{+` more than once when only one is a catch-all param', () => {
      expectMatches(routerOf('/{+a}/x{+b}', '/{id}/{+c}/{+d'), {
        '/1/2/x{+b}': ['/{+a}/x{+b}', { a: '1/2' }],
        '/1/2/3/{+d': ['/{id}/{+c}/{+d', { id: '1', c: '2/3' }],
      })
    })
  })
})
