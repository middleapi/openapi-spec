import { Router } from '@openapi-spec/router'

import { expectMatches, routerOf } from './helpers'

describe('percent-encoding', () => {
  it('decodes each escape in a param value once', () => {
    const router = routerOf('/v/{value}')

    expectMatches(router, {
      '/v/%2525': ['/v/{value}', { value: '%25' }],
      '/v/%25': ['/v/{value}', { value: '%' }],
      '/v/%C3%A9t%C3%A9': ['/v/{value}', { value: 'été' }],
      '/v/a%20b': ['/v/{value}', { value: 'a b' }],
      '/v/a+b': ['/v/{value}', { value: 'a+b' }],
      '/v/%7Bid%7D': ['/v/{value}', { value: '{id}' }],
      '/v/%00': ['/v/{value}', { value: '\0' }],
    })
  })

  it('keeps a whole segment as written when any of its escapes is malformed', () => {
    const router = routerOf('/v/{value}', '/files/{+path}')

    expectMatches(router, {
      '/v/%': ['/v/{value}', { value: '%' }],
      '/v/%ZZ': ['/v/{value}', { value: '%ZZ' }],
      '/v/a%20%ZZ': ['/v/{value}', { value: 'a%20%ZZ' }],
      // not UTF-8
      '/v/caf%E9': ['/v/{value}', { value: 'caf%E9' }],
      '/v/%C3': ['/v/{value}', { value: '%C3' }],
      // the segments of a catch-all param decode one by one
      '/files/a%20b/%ZZ/c%2Fd': ['/files/{+path}', { path: 'a b/%ZZ/c/d' }],
    })
  })

  it('matches literal text whose malformed escapes read the same as a decoded request', () => {
    const router = routerOf('/a%25b', '/c%ZZ', '/caf%E9')

    expectMatches(router, {
      '/a%25b': ['/a%25b'],
      '/a%b': ['/a%25b'],
      '/c%ZZ': ['/c%ZZ'],
      '/c%25ZZ': ['/c%ZZ'],
      '/caf%E9': ['/caf%E9'],
      '/café': undefined,
      '/caf%C3%A9': undefined,
      '/ab': undefined,
    })
  })

  it('keeps an encoded slash inside its segment, in literals, params, and catch-all params', () => {
    const router = routerOf(
      '/x%2Fy/{+rest}',
      '/x/y/{id}',
      '/f/{+p}/r%2Fw',
      '/files/{+path}',
      '/{a}/{b}',
    )

    expectMatches(router, {
      '/x%2Fy/1/2': ['/x%2Fy/{+rest}', { rest: '1/2' }],
      '/x%2fy/1%2F2': ['/x%2Fy/{+rest}', { rest: '1/2' }],
      '/x/y/1': ['/x/y/{id}', { id: '1' }],
      '/x/y%2F1': ['/{a}/{b}', { a: 'x', b: 'y/1' }],
      '/f/a/r%2Fw': ['/f/{+p}/r%2Fw', { p: 'a' }],
      '/f/a%2Fb/r%2fw': ['/f/{+p}/r%2Fw', { p: 'a/b' }],
      '/f/a/r/w': undefined,
      '/files/a%2F%2Fb': ['/files/{+path}', { path: 'a//b' }],
      '/files/%2F%2F': ['/files/{+path}', { path: '//' }],
    })
  })

  it('matches the same routes for raw and encoded text in a request path', () => {
    const router = routerOf('/users/{id}', '/users/all', '/users/{id}/posts', '/caf%C3%A9/{x}')

    for (const [paths, expected] of [
      [
        ['/users/all', '/users/%61ll', '/%75sers/all', '/%75%73%65%72%73/%61%6C%6C'],
        ['/users/all'],
      ],
      [
        ['/users/1', '/users/%31', '/%75sers/1/'],
        ['/users/{id}', { id: '1' }],
      ],
      [
        ['/users/all/posts', '/users/%61ll/posts', '/users/all/p%6Fsts/'],
        ['/users/{id}/posts', { id: 'all' }],
      ],
      [
        ['/café/1', '/caf%C3%A9/1', '/caf%c3%a9/%31'],
        ['/caf%C3%A9/{x}', { x: '1' }],
      ],
    ] as const) {
      for (const path of paths) {
        expectMatches(router, { [path]: expected })
      }
    }
  })

  it('matches chars however the route and the request write them, raw or percent-encoded', () => {
    const chars = [
      ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)),
      'é',
      '日',
      '😀',
      ' ',
    ].filter((char) => char !== '/')
    const escapes = (char: string, hex: (byte: number) => string): string =>
      Array.from(new TextEncoder().encode(char), (byte) => `%${hex(byte).padStart(2, '0')}`).join(
        '',
      )
    const forms = [
      (char: string) => char,
      encodeURIComponent,
      (char: string) => escapes(char, (byte) => byte.toString(16).toUpperCase()),
      (char: string) => escapes(char, (byte) => byte.toString(16)),
    ]

    for (const route of forms) {
      const router = new Router<string>()
      for (const char of chars) {
        router.add('GET', `/x${route(char)}y`, char)
        router.add('GET', `/p/x${route(char)}y/{id}`, char)
      }

      for (const request of forms) {
        for (const char of chars) {
          expect(router.match('GET', `/x${request(char)}y`)).toStrictEqual({
            data: char,
            params: undefined,
          })
          expect(router.match('GET', `/p/x${request(char)}y/v${request(char)}`)).toStrictEqual({
            data: char,
            params: { id: `v${char}` },
          })
        }
      }
    }
  })
})

describe('trailing and empty segments', () => {
  it('ignores only one trailing slash', () => {
    const router = routerOf('/a/{x}', '/b/{x}/')

    expectMatches(router, {
      '/a/1': ['/a/{x}', { x: '1' }],
      '/a/1/': ['/a/{x}', { x: '1' }],
      '/b/1': ['/b/{x}/', { x: '1' }],
      '/b/1/': ['/b/{x}/', { x: '1' }],
      '/a/1//': undefined,
      '/b/1//': undefined,
      // an encoded slash is not a trailing slash
      '/a/1%2F': ['/a/{x}', { x: '1/' }],
    })
  })

  it('matches empty segments before, between, and after params', () => {
    const router = routerOf('/a//{x}', '/{a}//{b}', '/c/{x}//')

    expectMatches(router, {
      '/a//1': ['/a//{x}', { x: '1' }],
      '/a/1': undefined,
      '/a///1': undefined,
      '/p//q': ['/{a}//{b}', { a: 'p', b: 'q' }],
      '/p/q': undefined,
      '//p/q': undefined,
      '/c/1//': ['/c/{x}//', { x: '1' }],
      '/c/1///': undefined,
      '/c/1/': undefined,
    })
  })

  it('takes empty segments into a catch-all param, but never an empty value', () => {
    const router = routerOf('/{+p}', '/f/{+p}/x')

    expectMatches(router, {
      '/': undefined,
      '//': undefined,
      '///': ['/{+p}', { p: '/' }],
      '//a': ['/{+p}', { p: '/a' }],
      '/f/a//b/x': ['/f/{+p}/x', { p: 'a//b' }],
      '/f//x': ['/{+p}', { p: 'f//x' }],
      '/f///x': ['/f/{+p}/x', { p: '/' }],
    })
  })
})

describe('names that objects inherit', () => {
  const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'] as const

  it('matches them as literal text, raw or percent-encoded', () => {
    const router = new Router<string>()
    for (const name of NAMES) {
      router.add('GET', `/${name}`, name)
      router.add('GET', `/${name}/{id}`, `${name} id`)
    }
    router.add('GET', '/{other}', 'other')

    for (const name of NAMES) {
      const encoded = `/%${name.charCodeAt(0).toString(16)}${name.slice(1)}` as const
      expectMatches(router, {
        [`/${name}`]: [name],
        [encoded]: [name],
        [`/${name}/1`]: [`${name} id`, { id: '1' }],
        [`${encoded}/1`]: [`${name} id`, { id: '1' }],
      })
    }

    expectMatches(router, {
      '/prototype': ['other', { other: 'prototype' }],
      '/__proto__x': ['other', { other: '__proto__x' }],
    })
  })

  it('takes them as request text for params', () => {
    const router = routerOf('/{id}/{+rest}', '/{id}')

    for (const name of NAMES) {
      expectMatches(router, {
        [`/${name}`]: ['/{id}', { id: name }],
        [`/${name}/${name}`]: ['/{id}/{+rest}', { id: name, rest: name }],
      })
    }
  })

  it('keeps them as own keys of plain params objects', () => {
    const router = new Router<string>()
    for (const name of NAMES) {
      router.add('GET', `/p/${name}/{${name}}`, 'param')
      router.add('GET', `/c/${name}/{+${name}}`, 'catch-all')
      router.add('GET', `/t/${name}/{+rest}/{${name}}`, 'tail')
    }

    for (const name of NAMES) {
      for (const [path, value] of [
        [`/p/${name}/v`, 'v'],
        [`/c/${name}/a/b`, 'a/b'],
        [`/t/${name}/a/b`, 'b'],
      ] as const) {
        const params = router.match('GET', path)!.params!

        expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
        expect(Object.getOwnPropertyDescriptor(params, name)).toEqual({
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      }
    }
  })

  it('keeps routes apart for methods with these names', () => {
    const router = new Router<string>()
    for (const name of NAMES) {
      router.add(name, '/a', name)
      router.add(name, '/a/{id}', `${name} id`)
    }

    for (const name of NAMES) {
      expectMatches(router, { '/a': [name], '/a/1': [`${name} id`, { id: '1' }] }, name)
    }

    expect(router.match('isPrototypeOf', '/a')).toBeUndefined()
    expect(router.match('GET', '/a')).toBeUndefined()
  })
})
