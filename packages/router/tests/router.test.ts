import { createPrefixMatcher, Router } from '@openapi-spec/router'

/** A router with each path added for GET, with the path as its data. */
function routerOf(...paths: `/${string}`[]): Router<string> {
  const router = new Router<string>()
  for (const path of paths) {
    router.add('GET', path, path)
  }
  return router
}

describe('Router', () => {
  describe('literal segments', () => {
    it('matches a route by method and path', () => {
      const router = new Router<string>()
      router.add('POST', '/planet/create', 'create')
      router.add('GET', '/planet/create', 'read')

      expect(router.match('POST', '/planet/create')).toEqual({ data: 'create', params: undefined })
      expect(router.match('GET', '/planet/create')).toEqual({ data: 'read', params: undefined })
      expect(router.match('PUT', '/planet/create')).toBeUndefined()
      expect(router.match('post', '/planet/create')).toBeUndefined()
      expect(router.match('POST', '/planet')).toBeUndefined()
      expect(router.match('POST', '/planet/create/more')).toBeUndefined()
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
      const router = routerOf('/', '/ping', '/echo/')

      expect(router.match('GET', '/')).toEqual({ data: '/', params: undefined })
      expect(router.match('GET', '/ping/')).toEqual({ data: '/ping', params: undefined })
      expect(router.match('GET', '/p%69ng/')).toEqual({ data: '/ping', params: undefined })
      expect(router.match('GET', '/echo')).toEqual({ data: '/echo/', params: undefined })
      expect(router.match('GET', '/echo/')).toEqual({ data: '/echo/', params: undefined })

      // a second slash is an empty segment
      expect(router.match('GET', '/ping//')).toBeUndefined()
      expect(router.match('GET', '//')).toBeUndefined()
    })

    it('matches empty segments only as written', () => {
      const router = routerOf('/a/b', '/a//c')

      expect(router.match('GET', '/a//b')).toBeUndefined()
      expect(router.match('GET', '//a/b')).toBeUndefined()
      expect(router.match('GET', '/a//c')).toEqual({ data: '/a//c', params: undefined })
      expect(router.match('GET', '/a/c')).toBeUndefined()

      // the root path has no segments, not one empty segment
      const root = routerOf('//', '/{id}')
      expect(root.match('GET', '/')).toBeUndefined()
      expect(root.match('GET', '//')).toEqual({ data: '//', params: undefined })

      // also once a request path with `%` has put the static routes in the tree
      expect(root.match('GET', '/%31')).toEqual({ data: '/{id}', params: { id: '1' } })
      expect(root.match('GET', '/')).toBeUndefined()
    })

    it('matches routes added after earlier matches, raw or percent-encoded', () => {
      const router = routerOf('/a', '/a/{id}')
      expect(router.match('GET', '/%61')).toEqual({ data: '/a', params: undefined })
      expect(router.match('GET', '/a/1')).toEqual({ data: '/a/{id}', params: { id: '1' } })

      router.add('GET', '/b', '/b')
      router.add('GET', '/b/{id}', '/b/{id}')
      expect(router.match('GET', '/b')).toEqual({ data: '/b', params: undefined })
      expect(router.match('GET', '/%62')).toEqual({ data: '/b', params: undefined })
      expect(router.match('GET', '/b/1')).toEqual({ data: '/b/{id}', params: { id: '1' } })
    })

    it('matches path text literally, even characters that are route syntax elsewhere', () => {
      const router = routerOf(
        '/.',
        '/./ping',
        '/../ping',
        '/*',
        '/(x)',
        '/items:batchGet',
        '/a/{id}.json',
        '/what%3F',
        '/{}',
        '/{+}',
        '/{a.b}',
        '/{id',
        '/id}',
        '/id}/{x}',
      )

      for (const path of [
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
      ] as const) {
        expect(router.match('GET', path)).toEqual({ data: path, params: undefined })
      }

      expect(router.match('GET', '/anything')).toBeUndefined()
      expect(router.match('GET', '/x')).toBeUndefined()
      expect(router.match('GET', '/itemsfoo')).toBeUndefined()

      // only a whole-segment `{name}` is a param
      expect(router.match('GET', '/a/%7Bid%7D.json')).toEqual({
        data: '/a/{id}.json',
        params: undefined,
      })
      expect(router.match('GET', '/a/id.json')).toBeUndefined()
      expect(router.match('GET', '/id}/1')).toEqual({ data: '/id}/{x}', params: { x: '1' } })

      expect(router.match('GET', '/what%3F')).toEqual({ data: '/what%3F', params: undefined })
      expect(router.match('GET', '/what')).toBeUndefined()
    })

    it('matches non-ASCII text against the percent-encoded request path', () => {
      const router = routerOf('/café/{id}')

      for (const path of ['/caf%C3%A9/1', '/caf%c3%a9/1', '/café/1'] as const) {
        expect(router.match('GET', path)).toEqual({ data: '/café/{id}', params: { id: '1' } })
      }
    })

    it('matches text that requests leave raw but routes encode, and the other way around', () => {
      const router = routerOf(
        '/v1^beta/items:batchGet/{id}',
        '/a:b%7Bc%7D',
        '/x%3Ay/b',
        '/x%3Ay/a%2Fb/{id}',
      )

      for (const path of [
        '/v1^beta/items:batchGet/a^b',
        '/v1%5Ebeta/items:batchGet/a^b',
        '/v1%5ebeta/items%3AbatchGet/a%5Eb',
      ] as const) {
        expect(router.match('GET', path)).toEqual({
          data: '/v1^beta/items:batchGet/{id}',
          params: { id: 'a^b' },
        })
      }

      for (const path of ['/a:b%7Bc%7D', '/a%3Ab%7bc%7d', '/a:b{c}'] as const) {
        expect(router.match('GET', path)).toEqual({ data: '/a:b%7Bc%7D', params: undefined })
      }

      for (const path of ['/x:y/b', '/x%3Ay/b', '/x%3ay/b'] as const) {
        expect(router.match('GET', path)).toEqual({ data: '/x%3Ay/b', params: undefined })
      }

      for (const path of ['/x:y/a%2Fb/1', '/x%3Ay/a%2fb/1'] as const) {
        expect(router.match('GET', path)).toEqual({
          data: '/x%3Ay/a%2Fb/{id}',
          params: { id: '1' },
        })
      }

      expect(router.match('GET', '/v1beta/items:batchGet/a^b')).toBeUndefined()

      // an encoded slash stays inside its segment
      expect(router.match('GET', '/x:y/a/b/1')).toBeUndefined()

      const docs = routerOf('/docs/a%2Fb', '/docs/a/b', '/a%2Fb')
      expect(docs.match('GET', '/docs/a%2Fb')).toEqual({ data: '/docs/a%2Fb', params: undefined })
      expect(docs.match('GET', '/docs/a%2fb')).toEqual({ data: '/docs/a%2Fb', params: undefined })
      expect(docs.match('GET', '/docs/a/b')).toEqual({ data: '/docs/a/b', params: undefined })
      expect(docs.match('GET', '/a%2Fb')).toEqual({ data: '/a%2Fb', params: undefined })
      expect(docs.match('GET', '/a/b')).toBeUndefined()
    })

    it('keeps text whose percent-encoding is malformed as written', () => {
      const router = routerOf('/a%ZZ', '/b%25/{id}', '/c%2525')

      expect(router.match('GET', '/a%ZZ')).toEqual({ data: '/a%ZZ', params: undefined })
      expect(router.match('GET', '/c%2525')).toEqual({ data: '/c%2525', params: undefined })
      expect(router.match('GET', '/c%25')).toBeUndefined()
      expect(router.match('GET', '/b%/x%ZZ')).toEqual({
        data: '/b%25/{id}',
        params: { id: 'x%ZZ' },
      })
      expect(router.match('GET', '/b%25/%E0%A4%A')).toEqual({
        data: '/b%25/{id}',
        params: { id: '%E0%A4%A' },
      })
    })

    it('matches every printable ASCII char in path text, raw or percent-encoded', () => {
      const chars = Array.from({ length: 0x7f - 0x20 }, (_, i) =>
        String.fromCharCode(0x20 + i),
      ).filter((char) => char !== '/')
      const router = new Router<string>()
      for (const char of chars) {
        router.add('GET', `/x${char}y`, char)
      }

      for (const char of chars) {
        for (const path of [
          `/x${char}y`,
          `/x${encodeURIComponent(char)}y`,
          `/x%${char.charCodeAt(0).toString(16)}y`,
        ] as const) {
          expect(router.match('GET', path)).toEqual({ data: char, params: undefined })
        }
      }
    })

    it('matches static routes after many requests, and ones added after them', () => {
      const router = routerOf('/users/{id}', '/users/all')
      for (let id = 0; id < 2000; id++) {
        expect(router.match('GET', `/users/${id}`)).toEqual({
          data: '/users/{id}',
          params: { id: `${id}` },
        })
      }

      expect(router.match('GET', '/users/all')).toEqual({ data: '/users/all', params: undefined })
      expect(router.match('GET', '/users/me')).toEqual({
        data: '/users/{id}',
        params: { id: 'me' },
      })

      router.add('GET', '/users/me', '/users/me')

      expect(router.match('GET', '/users/me')).toEqual({ data: '/users/me', params: undefined })
      expect(router.match('GET', '/users/all')).toEqual({ data: '/users/all', params: undefined })
    })
  })

  describe('params', () => {
    it('matches a non-empty segment and decodes its value', () => {
      const router = routerOf('/nested/echo/{value}')

      expect(router.match('GET', '/nested/echo/world')).toEqual({
        data: '/nested/echo/{value}',
        params: { value: 'world' },
      })
      expect(router.match('GET', '/nested/%65cho/dinwwwh%2F')).toEqual({
        data: '/nested/echo/{value}',
        params: { value: 'dinwwwh/' },
      })
      expect(router.match('GET', '/nested/echo/a%20b/')).toEqual({
        data: '/nested/echo/{value}',
        params: { value: 'a b' },
      })

      expect(router.match('GET', '/nested/echo')).toBeUndefined()
      expect(router.match('GET', '/nested/echo/')).toBeUndefined()
      expect(router.match('GET', '/nested/echo//')).toBeUndefined()
      expect(router.match('GET', '/nested/echo/a/b')).toBeUndefined()
    })

    it('supports names that are not identifiers, and repeated names, the last value winning', () => {
      const router = routerOf('/users/{user-id}', '/digits/{0}/{1st}', '/repeated/{id}/{id}')

      expect(router.match('GET', '/users/a-id')).toEqual({
        data: '/users/{user-id}',
        params: { 'user-id': 'a-id' },
      })
      expect(router.match('GET', '/digits/a/b')).toEqual({
        data: '/digits/{0}/{1st}',
        params: { '0': 'a', '1st': 'b' },
      })
      expect(router.match('GET', '/repeated/a/b')).toEqual({
        data: '/repeated/{id}/{id}',
        params: { id: 'b' },
      })
    })

    it('keeps a param named __proto__ as an own key of a plain object', () => {
      const params = routerOf('/a/{__proto__}').match('GET', '/a/value')!.params!

      expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
      expect(Object.keys(params)).toEqual(['__proto__'])
      expect(Object.getOwnPropertyDescriptor(params, '__proto__')).toEqual({
        value: 'value',
        writable: true,
        enumerable: true,
        configurable: true,
      })
    })

    it('returns a new params object for each match', () => {
      const router = routerOf('/a/{id}')

      expect(router.match('GET', '/a/1')!.params).not.toBe(router.match('GET', '/a/1')!.params)
    })

    it('matches a route that starts like the one added before it', () => {
      const router = routerOf('/a/{x}', '/{p}/b', '/{p}/c', '/a/b/{y}', '/a/b/{y}/z')

      expect(router.match('GET', '/z/c')).toEqual({ data: '/{p}/c', params: { p: 'z' } })
      expect(router.match('GET', '/a/b/1/z')).toEqual({
        data: '/a/b/{y}/z',
        params: { y: '1' },
      })
    })
  })

  describe('catch-all params', () => {
    it('matches one or more segments, decoding them and keeping empty ones', () => {
      const router = routerOf('/files/{+path}')

      expect(router.match('GET', '/files/a')).toEqual({
        data: '/files/{+path}',
        params: { path: 'a' },
      })
      expect(router.match('GET', '/files/a/b/c%2Fd/')).toEqual({
        data: '/files/{+path}',
        params: { path: 'a/b/c/d' },
      })
      expect(router.match('GET', '/files/https%3A//example.com/a')).toEqual({
        data: '/files/{+path}',
        params: { path: 'https://example.com/a' },
      })
      expect(router.match('GET', '/files//etc/hosts')).toEqual({
        data: '/files/{+path}',
        params: { path: '/etc/hosts' },
      })
      expect(router.match('GET', '/files/a//')).toEqual({
        data: '/files/{+path}',
        params: { path: 'a/' },
      })
      expect(router.match('GET', '/files/%2F')).toEqual({
        data: '/files/{+path}',
        params: { path: '/' },
      })
    })

    it('requires a non-empty value', () => {
      const router = routerOf('/files/{+path}')

      expect(router.match('GET', '/files')).toBeUndefined()
      expect(router.match('GET', '/files/')).toBeUndefined()
      expect(router.match('GET', '/files//')).toBeUndefined()
      expect(router.match('GET', '/files///')).toEqual({
        data: '/files/{+path}',
        params: { path: '/' },
      })
    })

    it('matches segments after it', () => {
      const router = routerOf('/files/{+path}/raw', '/{name}/{+rest}', '/blobs/{+path}/{version}')

      expect(router.match('GET', '/files/a/b/raw')).toEqual({
        data: '/files/{+path}/raw',
        params: { path: 'a/b' },
      })
      expect(router.match('GET', '/files/raw')).toEqual({
        data: '/{name}/{+rest}',
        params: { name: 'files', rest: 'raw' },
      })
      expect(router.match('GET', '/blobs/a/b/v2')).toEqual({
        data: '/blobs/{+path}/{version}',
        params: { path: 'a/b', version: 'v2' },
      })
      expect(router.match('GET', '/a/b/c%2Fd/')).toEqual({
        data: '/{name}/{+rest}',
        params: { name: 'a', rest: 'b/c/d' },
      })
    })

    it('falls back to the next route when its value would be empty', () => {
      const router = routerOf('/files/{+path}', '/{+path}', '/{name}')

      // repeated, so a result that depends on state left by a match would show up
      for (let i = 0; i < 2; i++) {
        expect(router.match('GET', '/files')).toEqual({
          data: '/{name}',
          params: { name: 'files' },
        })
      }

      expect(router.match('GET', '/files/a')).toEqual({
        data: '/files/{+path}',
        params: { path: 'a' },
      })
      expect(router.match('GET', '/a/b')).toEqual({ data: '/{+path}', params: { path: 'a/b' } })
    })
  })

  describe('priority', () => {
    it('prefers a literal, then a param, then a catch-all param, segment by segment', () => {
      const router = routerOf(
        '/users/{id}',
        '/users/me',
        '/users/{+rest}/e',
        '/{a}/{b}/c',
        '/users/{id}/d',
      )

      expect(router.match('GET', '/users/me')).toEqual({ data: '/users/me', params: undefined })
      expect(router.match('GET', '/users/m%65')).toEqual({ data: '/users/me', params: undefined })
      expect(router.match('GET', '/users/1')).toEqual({ data: '/users/{id}', params: { id: '1' } })
      expect(router.match('GET', '/users/m%2Fe')).toEqual({
        data: '/users/{id}',
        params: { id: 'm/e' },
      })
      expect(router.match('GET', '/users/1/d')).toEqual({
        data: '/users/{id}/d',
        params: { id: '1' },
      })

      // falls back when the rest of the path does not match
      expect(router.match('GET', '/users/1/c')).toEqual({
        data: '/{a}/{b}/c',
        params: { a: 'users', b: '1' },
      })
      expect(router.match('GET', '/users/me/c')).toEqual({
        data: '/{a}/{b}/c',
        params: { a: 'users', b: 'me' },
      })
      expect(router.match('GET', '/users/1/e')).toEqual({
        data: '/users/{+rest}/e',
        params: { rest: '1' },
      })
      expect(router.match('GET', '/users/1/2/e')).toEqual({
        data: '/users/{+rest}/e',
        params: { rest: '1/2' },
      })
    })

    it('prefers a literal over a param when the request path needs decoding', () => {
      const router = routerOf('/{version}/items', '/v1^beta/items')

      for (const path of ['/v1^beta/items', '/v1%5Ebeta/items', '/v1%5ebeta/items'] as const) {
        expect(router.match('GET', path)).toEqual({ data: '/v1^beta/items', params: undefined })
      }

      expect(router.match('GET', '/v2^beta/items')).toEqual({
        data: '/{version}/items',
        params: { version: 'v2^beta' },
      })
    })

    it('compares the segments before a catch-all param first', () => {
      const router = routerOf('/{+path}/raw', '/files/{name}', '/{a}/{+rest}', '/{+path}/x')

      expect(router.match('GET', '/files/raw')).toEqual({
        data: '/files/{name}',
        params: { name: 'raw' },
      })
      expect(router.match('GET', '/q/w/x')).toEqual({
        data: '/{a}/{+rest}',
        params: { a: 'q', rest: 'w/x' },
      })
    })

    it('compares catch-all params starting at the same segment by the segments after them, from the end', () => {
      const router = routerOf(
        '/f/{+path}',
        '/f/{+path}/{version}',
        '/f/{+path}/raw',
        '/f/{+path}/a/raw',
        '/f/{+path}/{id}/raw',
      )

      expect(router.match('GET', '/f/a')).toEqual({ data: '/f/{+path}', params: { path: 'a' } })
      expect(router.match('GET', '/f/a/b')).toEqual({
        data: '/f/{+path}/{version}',
        params: { path: 'a', version: 'b' },
      })
      expect(router.match('GET', '/f/a/raw')).toEqual({
        data: '/f/{+path}/raw',
        params: { path: 'a' },
      })
      expect(router.match('GET', '/f/x/a/raw')).toEqual({
        data: '/f/{+path}/a/raw',
        params: { path: 'x' },
      })
      expect(router.match('GET', '/f/x/b/raw')).toEqual({
        data: '/f/{+path}/{id}/raw',
        params: { path: 'x', id: 'b' },
      })
      expect(router.match('GET', '/f/raw')).toEqual({ data: '/f/{+path}', params: { path: 'raw' } })
    })

    it('keeps the first of routes with the same method and segments', () => {
      const router = new Router<string>()
      router.add('GET', '/users/{id}', 'first')
      router.add('GET', '/users/{userId}/', 'second')
      router.add('GET', '/static', 'first')
      router.add('GET', '/st%61tic', 'second')
      router.add('GET', '/%6Fther', 'first')
      router.add('GET', '/other', 'second')
      router.add('GET', '/files/{+path}/{a}', 'first')
      router.add('GET', '/files/{+rest}/{b}', 'second')
      router.add('GET', '/a/{x}.json', 'first')
      router.add('GET', '/a/%7Bx%7D.json', 'second')
      router.add('GET', '/b/%7Bx%7D.json', 'first')
      router.add('GET', '/b/{x}.json', 'second')
      router.add('POST', '/users/{userId}', 'post')

      expect(router.match('GET', '/users/1')).toEqual({ data: 'first', params: { id: '1' } })
      expect(router.match('GET', '/static')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/st%61tic')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/other')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/%6Fther')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/files/a/b')).toEqual({
        data: 'first',
        params: { path: 'a', a: 'b' },
      })
      expect(router.match('POST', '/users/1')).toEqual({ data: 'post', params: { userId: '1' } })
      expect(router.match('GET', '/a/{x}.json')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/a/%7Bx%7D.json')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/b/{x}.json')).toEqual({ data: 'first', params: undefined })
      expect(router.match('GET', '/b/%7Bx%7D.json')).toEqual({ data: 'first', params: undefined })
    })

    it('keeps the same order for routes added after requests built part of the tree', () => {
      const router = new Router<string>()
      router.add('GET', '/a/{x}/b', 'first')
      router.add('GET', '/c/%7Bx%7D/{id}', '/c/%7Bx%7D/{id}')
      // builds the tree up to `/a`, and past `/c/{x}`
      expect(router.match('GET', '/a')).toBeUndefined()
      expect(router.match('GET', '/c/%7Bx%7D/1')).toEqual({
        data: '/c/%7Bx%7D/{id}',
        params: { id: '1' },
      })

      router.add('GET', '/a/{y}/b', 'second')
      router.add('GET', '/c/%7Bx%7D/d', '/c/%7Bx%7D/d')
      expect(router.match('GET', '/a/1/b')).toEqual({ data: 'first', params: { x: '1' } })
      expect(router.match('GET', '/c/%7Bx%7D/d')).toEqual({
        data: '/c/%7Bx%7D/d',
        params: undefined,
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
      const router = routerOf('/{+a}/x{+b}', '/{id}/{+c}/{+d')

      expect(router.match('GET', '/1/2/x{+b}')).toEqual({
        data: '/{+a}/x{+b}',
        params: { a: '1/2' },
      })
      expect(router.match('GET', '/1/2/3/{+d')).toEqual({
        data: '/{id}/{+c}/{+d',
        params: { id: '1', c: '2/3' },
      })
    })
  })
})

describe('createPrefixMatcher', () => {
  it('matches the segments of the prefix, then anything', () => {
    const matches = createPrefixMatcher('/users/{userId}')

    expect(matches('/users/din')).toBe(true)
    expect(matches('/users/din/')).toBe(true)
    expect(matches('/users/din/info/settings')).toBe(true)
    expect(matches('/users/%64in')).toBe(true)
    expect(matches('/%75sers/din')).toBe(true)

    expect(matches('/users')).toBe(false)
    expect(matches('/users/')).toBe(false)
    expect(matches('/users//info')).toBe(false)
    expect(matches('/usersx/din')).toBe(false)
    expect(matches('/projects/42/info')).toBe(false)
  })

  it('matches a prefix of several literal segments', () => {
    const matches = createPrefixMatcher('/api/v1')

    expect(matches('/api/v1')).toBe(true)
    expect(matches('/api/v1/')).toBe(true)
    expect(matches('/api/v1/users')).toBe(true)
    expect(matches('/%61pi/v1/users')).toBe(true)

    expect(matches('/api')).toBe(false)
    expect(matches('/api/v1x')).toBe(false)
    expect(matches('/api/v2/users')).toBe(false)
    expect(matches('/api//v1')).toBe(false)
  })

  it('matches a prefix that starts with a param', () => {
    const matches = createPrefixMatcher('/{workspaceId}/planets')

    expect(matches('/w1/planets')).toBe(true)
    expect(matches('/w1/planets/earth')).toBe(true)

    expect(matches('//planets')).toBe(false)
    expect(matches('/w1/moons')).toBe(false)
    expect(matches('/planets')).toBe(false)
  })

  it('ignores the trailing slash of a prefix', () => {
    const matches = createPrefixMatcher('/api/')

    expect(matches('/api')).toBe(true)
    expect(matches('/api/')).toBe(true)
    expect(matches('/api/info')).toBe(true)
    expect(matches('/apiinfo')).toBe(false)
    expect(matches('/other/info')).toBe(false)
  })

  it('matches anything from a catch-all param on', () => {
    const matches = createPrefixMatcher('/files/{+path}/{+more}/x')

    expect(matches('/files')).toBe(true)
    expect(matches('/files/a/b/info')).toBe(true)
    expect(matches('/filesx')).toBe(false)
  })

  it('compares literal text the way routes do', () => {
    const matches = createPrefixMatcher('/v1^beta')

    expect(matches('/v1^beta/info')).toBe(true)
    expect(matches('/v1%5Ebeta/info')).toBe(true)
    expect(matches('/v1beta/info')).toBe(false)
  })

  it('keeps empty segments and encoded slashes in a prefix', () => {
    const slash = createPrefixMatcher('/x%2Fy')

    expect(slash('/x%2Fy')).toBe(true)
    expect(slash('/x%2fy/z')).toBe(true)
    expect(slash('/x/y')).toBe(false)

    const matches = createPrefixMatcher('/a//b%2Fc')

    expect(matches('/a//b%2Fc')).toBe(true)
    expect(matches('/a//b%2fc/info')).toBe(true)
    expect(matches('/a/b%2Fc')).toBe(false)
    expect(matches('/a//b/c')).toBe(false)

    const empty = createPrefixMatcher('/a//')

    expect(empty('/a//')).toBe(true)
    expect(empty('/a//info')).toBe(true)
    expect(empty('/a/')).toBe(false)
    expect(empty('/a')).toBe(false)

    const root = createPrefixMatcher('//')

    expect(root('//')).toBe(true)
    expect(root('/')).toBe(false)
  })

  it('matches every path for the root prefix', () => {
    const matches = createPrefixMatcher('/')

    expect(matches('/')).toBe(true)
    expect(matches('/a/b')).toBe(true)
  })
})
