import { Router } from '@openapi-spec/router'

import { expectMatches, routerOf } from './helpers'

describe('priority', () => {
  it('backtracks through several segments to the next best route', () => {
    const router = routerOf('/a/b/c/d', '/a/{x}/c/e', '/{y}/b/{z}/f', '/a/{+rest}/g', '/{+all}')

    expectMatches(router, {
      '/a/b/c/d': ['/a/b/c/d'],
      '/a/b/c/e': ['/a/{x}/c/e', { x: 'b' }],
      '/a/b/c/f': ['/{y}/b/{z}/f', { y: 'a', z: 'c' }],
      '/a/b/c/g': ['/a/{+rest}/g', { rest: 'b/c' }],
      '/a/b/g': ['/a/{+rest}/g', { rest: 'b' }],
      '/a/b/c/h': ['/{+all}', { all: 'a/b/c/h' }],
      '/a/b/c': ['/{+all}', { all: 'a/b/c' }],
      // `{+rest}` needs a segment before `/g`
      '/a/g': ['/{+all}', { all: 'a/g' }],
      '/q/b/c/f': ['/{y}/b/{z}/f', { y: 'q', z: 'c' }],
      '/': undefined,
    })
  })

  it('decides at the first segment that differs, whatever comes after it', () => {
    const router = routerOf('/{a}/x/y', '/b/{c}/{d}', '/{+p}/x/y/z', '/{e}/{f}/{g}/{h}')

    expectMatches(router, {
      // a literal first segment beats two literals after a param
      '/b/x/y': ['/b/{c}/{d}', { c: 'x', d: 'y' }],
      '/q/x/y': ['/{a}/x/y', { a: 'q' }],
      // a param beats a catch-all param, even with literals after it
      '/1/x/y/z': ['/{e}/{f}/{g}/{h}', { e: '1', f: 'x', g: 'y', h: 'z' }],
      '/1/2/x/y/z': ['/{+p}/x/y/z', { p: '1/2' }],
      '/1/2/3': undefined,
    })
  })

  it('prefers a literal child, then a param, at every level of a resource', () => {
    const router = routerOf('/r/{id}', '/r/a', '/r/b/{x}', '/r/c/d', '/r/{id}/e')

    expectMatches(router, {
      '/r/a': ['/r/a'],
      '/r/b': ['/r/{id}', { id: 'b' }],
      '/r/b/1': ['/r/b/{x}', { x: '1' }],
      '/r/c/d': ['/r/c/d'],
      '/r/c/e': ['/r/{id}/e', { id: 'c' }],
      '/r/a/e': ['/r/{id}/e', { id: 'a' }],
      '/r/c': ['/r/{id}', { id: 'c' }],
      '/r/b/1/e': undefined,
      '/r': undefined,
    })
  })

  it('falls back from a param to a catch-all param at the same segment', () => {
    const router = routerOf('/f/{+p}/raw', '/f/{name}/{v}', '/a/{x}/b', '/a/{+r}')

    expectMatches(router, {
      '/f/a/raw': ['/f/{name}/{v}', { name: 'a', v: 'raw' }],
      '/f/a/b/raw': ['/f/{+p}/raw', { p: 'a/b' }],
      '/f/a//raw': ['/f/{+p}/raw', { p: 'a/' }],
      '/f/a': undefined,
      '/f//raw': undefined,

      // a param never matches an empty segment, but a catch-all param can hold one
      '/a//b': ['/a/{+r}', { r: '/b' }],
      '/a/1/b': ['/a/{x}/b', { x: '1' }],
      '/a/1/c': ['/a/{+r}', { r: '1/c' }],
      '/a/': undefined,
    })
  })

  it('tries catch-all params that start further along the path first', () => {
    const router = routerOf('/{+p}/z', '/a/{+q}/z')

    expectMatches(router, {
      '/a/b/z': ['/a/{+q}/z', { q: 'b' }],
      '/a/b/c/z': ['/a/{+q}/z', { q: 'b/c' }],
      '/a/z': ['/{+p}/z', { p: 'a' }],
      '/b/z': ['/{+p}/z', { p: 'b' }],
      '/z': undefined,
    })
  })

  it('orders catch-all params at the same segment by the segments after them, from the last one', () => {
    // added in the opposite of the order they are tried in
    const router = routerOf(
      '/f/{+p}',
      '/f/{+p}/{v}',
      '/f/{+p}/{u}/{v}',
      '/f/{+p}/x/{b}',
      '/f/{+p}/raw',
      '/f/{+p}/{a}/x',
      '/f/{+p}/a/raw',
    )

    expectMatches(router, {
      '/f/1/a/raw': ['/f/{+p}/a/raw', { p: '1' }],
      '/f/1/b/raw': ['/f/{+p}/raw', { p: '1/b' }],
      '/f/1/x/x': ['/f/{+p}/{a}/x', { p: '1', a: 'x' }],
      '/f/1/2/3/x': ['/f/{+p}/{a}/x', { p: '1/2', a: '3' }],
      '/f/1/x/y': ['/f/{+p}/x/{b}', { p: '1', b: 'y' }],
      '/f/1/z/y': ['/f/{+p}/{u}/{v}', { p: '1', u: 'z', v: 'y' }],
      '/f/1/y': ['/f/{+p}/{v}', { p: '1', v: 'y' }],
      // the empty segment rules out every route with a param or literal there
      '/f/1//x': ['/f/{+p}/{v}', { p: '1/', v: 'x' }],
      '/f/1': ['/f/{+p}', { p: '1' }],
      '/f': undefined,
    })
  })
})

describe('duplicates', () => {
  it('keeps the first of routes that differ only in param names, a trailing slash, or encoding', () => {
    const router = new Router<string>()
    router.add('GET', '/a/{x}', 'first')
    router.add('GET', '/a/{y}/', 'second')
    router.add('GET', '/f/{+p}/r%61w', 'first')
    router.add('GET', '/f/{+q}/raw/', 'second')
    router.add('GET', '/c/%7Bx%7D/{id}', 'first')
    router.add('GET', '/c/%7bx%7d/{other}', 'second')
    router.add('GET', '/b/{a.b}', 'first')
    router.add('GET', '/b/%7Ba.b%7D', 'second')
    router.add('GET', '/caf%C3%A9', 'first')
    router.add('GET', '/café', 'second')
    router.add('GET', '/static', 'first')
    router.add('GET', '/st%61tic', 'second')
    router.add('GET', '/g/{+p}/{a}', 'first')
    router.add('GET', '/g/{+q}/{b}', 'second')
    router.add('GET', '/d/%7Bx%7D.json', 'first')
    router.add('GET', '/d/{x}.json', 'second')

    expectMatches(router, {
      '/a/1': ['first', { x: '1' }],
      '/f/1/raw': ['first', { p: '1' }],
      '/c/{x}/1': ['first', { id: '1' }],
      '/c/%7Bx%7D/1': ['first', { id: '1' }],
      '/b/{a.b}': ['first'],
      '/b/%7Ba.b%7D': ['first'],
      '/café': ['first'],
      '/caf%C3%A9': ['first'],
      '/static': ['first'],
      '/st%61tic': ['first'],
      '/g/1/2': ['first', { p: '1', a: '2' }],
      '/d/{x}.json': ['first'],
      '/d/%7Bx%7D.json': ['first'],
    })
  })

  it('keeps routes apart that read the same but differ in kind', () => {
    const router = routerOf('/{x}', '/%7Bx%7D', '/{+x}', '/%7B+x%7D', '/{a}/{+b}', '/{a}/%7B+b%7D')

    expectMatches(router, {
      '/{x}': ['/%7Bx%7D'],
      '/%7Bx%7D': ['/%7Bx%7D'],
      '/1': ['/{x}', { x: '1' }],
      '/{+x}': ['/%7B+x%7D'],
      '/1/{+b}': ['/{a}/%7B+b%7D', { a: '1' }],
      '/1/2': ['/{a}/{+b}', { a: '1', b: '2' }],
      '/1/2/3': ['/{a}/{+b}', { a: '1', b: '2/3' }],
    })
  })
})
