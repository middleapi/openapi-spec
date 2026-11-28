import { createPrefixMatcher, Router } from '@openapi-spec/router'

import { expectMatches, routerOf } from './helpers'

describe('params with text around them in a segment', () => {
  it('matches the text around the param and decodes its value', () => {
    const router = routerOf('/files/{name}.json', '/apps/{id}:publish', '/v{version}/ping')

    expectMatches(router, {
      '/files/report.json': ['/files/{name}.json', { name: 'report' }],
      '/files/a%20b.json': ['/files/{name}.json', { name: 'a b' }],
      '/files/a.b.json': ['/files/{name}.json', { name: 'a.b' }],
      '/files/report%2Ejson': ['/files/{name}.json', { name: 'report' }],
      '/files/.json': undefined,
      '/files/report.xml': undefined,
      '/files/report.json/': ['/files/{name}.json', { name: 'report' }],
      '/apps/42:publish': ['/apps/{id}:publish', { id: '42' }],
      '/apps/42%3Apublish': ['/apps/{id}:publish', { id: '42' }],
      '/apps/:publish': undefined,
      '/v2/ping': ['/v{version}/ping', { version: '2' }],
      '/v/ping': undefined,
    })
  })

  it('reads params with text between them from left to right', () => {
    const router = routerOf('/p/{name}-{version}.zip', '/q/{a}.{b}')

    expectMatches(router, {
      '/p/router-1.2.zip': ['/p/{name}-{version}.zip', { name: 'router', version: '1.2' }],
      '/p/open-api-1.zip': ['/p/{name}-{version}.zip', { name: 'open', version: 'api-1' }],
      '/p/-1.zip': undefined,
      '/p/a-.zip': undefined,
      '/q/a.b.c': ['/q/{a}.{b}', { a: 'a', b: 'b.c' }],
      '/q/a%0Ab.c': ['/q/{a}.{b}', { a: 'a\nb', b: 'c' }],
    })
  })

  it('reads a long segment in linear time, where a lazy RegExp would backtrack', () => {
    const router = routerOf('/p/{a}-{b}-{c}.zip')

    expect(router.match('GET', `/p/${'-'.repeat(100_000)}`)).toBeUndefined()
    expect(router.match('GET', `/p/${'a-'.repeat(50_000)}.zip`)).toStrictEqual({
      data: '/p/{a}-{b}-{c}.zip',
      params: { a: 'a', b: 'a', c: 'a-'.repeat(49_998) },
    })
  })

  it('ranks them after literals and before params, more literal text first', () => {
    const router = routerOf(
      '/f/{x}',
      '/f/{a}.{b}',
      '/f/{name}.json',
      '/f/me.json',
      '/f/{+rest}',
      '/g/{x}.{y}/raw',
      '/g/{id}/{+rest}',
    )

    expectMatches(router, {
      '/f/me.json': ['/f/me.json'],
      '/f/you.json': ['/f/{name}.json', { name: 'you' }],
      '/f/you.xml': ['/f/{a}.{b}', { a: 'you', b: 'xml' }],
      '/f/you': ['/f/{x}', { x: 'you' }],
      '/f/a/b': ['/f/{+rest}', { rest: 'a/b' }],
      '/g/a.b/raw': ['/g/{x}.{y}/raw', { x: 'a', y: 'b' }],
      // falls back to the param when the rest of the path does not match
      '/g/a.b/other': ['/g/{id}/{+rest}', { id: 'a.b', rest: 'other' }],
    })
  })

  it('falls back to the next one when the rest of the path does not match', () => {
    const router = routerOf('/h/{name}.json/raw', '/h/{a}.{b}/other')

    expectMatches(router, {
      '/h/x.json/raw': ['/h/{name}.json/raw', { name: 'x' }],
      '/h/x.json/other': ['/h/{a}.{b}/other', { a: 'x', b: 'json' }],
    })
  })

  it('orders two with as much literal text the same way, whatever the order routes were added in', () => {
    const paths = ['/{a}-x', '/x-{b}'] as const

    for (const router of [routerOf(...paths), routerOf(...paths.toReversed())]) {
      expect(router.match('GET', '/x-x')).toStrictEqual({ data: '/{a}-x', params: { a: 'x' } })
    }
  })

  it('keeps braces literal around other names, and segments where two params touch', () => {
    const router = routerOf('/a/{x}{y}', '/b/{x}.{a.b}', '/c/{+x}.json')

    expectMatches(router, {
      '/a/%7Bx%7D%7By%7D': ['/a/{x}{y}'],
      '/a/12': undefined,
      '/b/1.%7Ba.b%7D': ['/b/{x}.{a.b}', { x: '1' }],
      '/b/1.2': undefined,
      '/c/%7B+x%7D.json': ['/c/{+x}.json'],
      '/c/a.json': undefined,
    })
  })

  it('ignores a later route with the same text around other param names', () => {
    const router = routerOf(
      '/files/{name}.json',
      '/files/{id}.json',
      '/files/%7Bname%7D.json',
      '/raw/{+path}/{name}.json',
      '/raw/{+file}/{id}.json',
    )

    expectMatches(router, {
      '/files/a.json': ['/files/{name}.json', { name: 'a' }],
      '/raw/a/b.json': ['/raw/{+path}/{name}.json', { path: 'a', name: 'b' }],
      '/files/%7Bname%7D.json': ['/files/%7Bname%7D.json'],
    })
  })

  it('matches after a catch-all param', () => {
    const router = routerOf('/files/{+path}/{name}.json', '/files/{+path}')

    expectMatches(router, {
      '/files/a/b/c.json': ['/files/{+path}/{name}.json', { path: 'a/b', name: 'c' }],
      '/files/a/b/c.xml': ['/files/{+path}', { path: 'a/b/c.xml' }],
      '/files/c.json': ['/files/{+path}', { path: 'c.json' }],
    })
  })

  it('ranks templates after a catch-all param the same way', () => {
    const paths = ['/f/{+p}/{a}-{b}', '/f/{+p}/{name}.json'] as const

    for (const router of [routerOf(...paths), routerOf(...paths.toReversed())]) {
      expectMatches(router, {
        '/f/x/a-b.json': ['/f/{+p}/{name}.json', { p: 'x', name: 'a-b' }],
        '/f/x/a-b': ['/f/{+p}/{a}-{b}', { p: 'x', a: 'a', b: 'b' }],
      })
    }
  })

  it('matches routes added after requests', () => {
    const router = new Router<string>()
    router.add('GET', '/r/{id}', 'param')
    expect(router.match('GET', '/r/1.json')).toStrictEqual({
      data: 'param',
      params: { id: '1.json' },
    })

    router.add('GET', '/r/{id}.json', 'json')
    router.add('GET', '/r/v{n}', 'version')
    expect(router.match('GET', '/r/1.json')).toStrictEqual({ data: 'json', params: { id: '1' } })
    expect(router.match('GET', '/r/v2')).toStrictEqual({ data: 'version', params: { n: '2' } })
  })

  it('checks them in a prefix', () => {
    const matches = createPrefixMatcher('/v{version}/api')

    expect(matches('/v1/api/users')).toBe(true)
    expect(matches('/v/api/users')).toBe(false)
    expect(matches('/x1/api')).toBe(false)
  })
})
