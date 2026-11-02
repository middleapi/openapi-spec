import { Router } from '@openapi-spec/router'

import type { Expected } from './helpers'
import { expectMatches, routerOf } from './helpers'

describe('routes added after requests', () => {
  it('matches routes added at every part of a tree that requests built only in part', () => {
    const router = routerOf('/a/{x}/b/{y}', '/a/{x}/c', '/d/{+p}/e')
    // builds `/a/{x}`, but not `/a/{x}/b/{y}` or `/d/{+p}`
    expectMatches(router, { '/a/1/c': ['/a/{x}/c', { x: '1' }] })

    router.add('GET', '/a/{z}/b/{w}', 'duplicate')
    router.add('GET', '/a/{x}/b/lit', '/a/{x}/b/lit')
    router.add('GET', '/a/{x}/b/{+q}', '/a/{x}/b/{+q}')
    router.add('GET', '/d/{+r}/e', 'duplicate')
    router.add('GET', '/d/f', '/d/f')
    router.add('GET', '/d/{x}', '/d/{x}')
    // shares its parts up to `t` with the route before it
    router.add('GET', '/s/{x}/t/{y}', '/s/{x}/t/{y}')
    router.add('GET', '/s/{x}/t/u', '/s/{x}/t/u')

    expectMatches(router, {
      '/a/1/b/2': ['/a/{x}/b/{y}', { x: '1', y: '2' }],
      '/a/1/b/lit': ['/a/{x}/b/lit', { x: '1' }],
      '/a/1/b/2/3': ['/a/{x}/b/{+q}', { x: '1', q: '2/3' }],
      '/d/1/e': ['/d/{+p}/e', { p: '1' }],
      '/d/1': ['/d/{x}', { x: '1' }],
      '/d/f': ['/d/f'],
      '/d/f/e': ['/d/{+p}/e', { p: 'f' }],
      '/%64/f': ['/d/f'],
      '/a/1/c': ['/a/{x}/c', { x: '1' }],
      '/s/1/t/2': ['/s/{x}/t/{y}', { x: '1', y: '2' }],
      '/s/1/t/u': ['/s/{x}/t/u', { x: '1' }],
    })
  })

  it('keeps the first of two duplicates however far requests built the tree before the second', () => {
    const duplicates: [
      first: `/${string}`,
      second: `/${string}`,
      request: `/${string}`,
      params: Record<string, string>,
    ][] = [
      ['/a/{x}/b/{y}', '/a/{p}/b/{q}', '/a/1/b/2', { x: '1', y: '2' }],
      ['/a/{x}/b/{+y}', '/a/{p}/b/{+q}/', '/a/1/b/2/3', { x: '1', y: '2/3' }],
      ['/a/{x}/b/{+y}/c', '/a/{p}/b/{+q}/c', '/a/1/b/2/c', { x: '1', y: '2' }],
      ['/a/%7Bx%7D/b/{y}', '/a/%7bx%7d/b/{q}', '/a/%7Bx%7D/b/2', { y: '2' }],
      ['/a/{x}/%7Bb%7D/{y}', '/a/{p}/%7bb%7d/{q}/', '/a/1/{b}/2', { x: '1', y: '2' }],
      ['/a/{x}/{a.b}/{y}', '/a/{p}/%7Ba.b%7D/{q}', '/a/1/{a.b}/2', { x: '1', y: '2' }],
    ]
    const warmups: `/${string}`[][] = [
      [],
      ['/x'],
      ['/a'],
      ['/a/1'],
      ['/a/1/b'],
      ['/a/1/b/2'],
      ['/a/1/b/2/3'],
      ['/a/%7Bx%7D/b/1', '/a/1/{a.b}', '/a/1/%7Bb%7D/2'],
    ]

    for (const [first, second, request, params] of duplicates) {
      for (const warmup of warmups) {
        const router = new Router<string>()
        router.add('GET', first, 'first')
        for (const path of warmup) {
          router.match('GET', path)
        }
        router.add('GET', second, 'second')

        expect(router.match('GET', request), `${first} after ${warmup.join(', ')}`).toStrictEqual({
          data: 'first',
          params,
        })
      }
    }
  })

  it('prefers a literal added later over routes waiting at the same segment', () => {
    const router = routerOf('/a/{x}', '/a/{+rest}')
    // builds the root, where both routes wait at `/a`
    expectMatches(router, { '/b': undefined })

    router.add('GET', '/a/me', '/a/me')
    router.add('GET', '/a/%7Bme%7D', '/a/%7Bme%7D')
    router.add('GET', '/a/me/{+more}', '/a/me/{+more}')

    expectMatches(router, {
      '/a/me': ['/a/me'],
      '/a/%7Bme%7D': ['/a/%7Bme%7D'],
      '/a/{me}': ['/a/%7Bme%7D'],
      '/a/1': ['/a/{x}', { x: '1' }],
      '/a/me/1': ['/a/me/{+more}', { more: '1' }],
      '/a/1/2': ['/a/{+rest}', { rest: '1/2' }],
    })
  })

  it('gives the same results whatever order routes are added in, with requests between them', () => {
    const routes: `/${string}`[] = [
      '/a/{x}',
      '/a/b/{y}',
      '/a/{+p}/c',
      '/{z}/b/c',
      '/a/%7Bb%7D/{w}',
      '/a/%7Bb%7D/c',
      '/a/b',
    ]
    const expected: Record<`/${string}`, Expected> = {
      '/a/1': ['/a/{x}', { x: '1' }],
      '/a/b': ['/a/b'],
      '/a/b/1': ['/a/b/{y}', { y: '1' }],
      '/a/b/c': ['/a/b/{y}', { y: 'c' }],
      '/a/1/c': ['/a/{+p}/c', { p: '1' }],
      '/a/1/2/c': ['/a/{+p}/c', { p: '1/2' }],
      '/q/b/c': ['/{z}/b/c', { z: 'q' }],
      '/a/{b}/1': ['/a/%7Bb%7D/{w}', { w: '1' }],
      '/a/%7Bb%7D/c': ['/a/%7Bb%7D/c'],
      '/a/{b}/c': ['/a/%7Bb%7D/c'],
      '/a/{b}/d': ['/a/%7Bb%7D/{w}', { w: 'd' }],
      '/a/{b}': ['/a/{x}', { x: '{b}' }],
      '/a/b/1/c': ['/a/{+p}/c', { p: 'b/1' }],
      '/a': undefined,
    }
    const requests = Object.keys(expected) as `/${string}`[]

    let first = 0
    for (const order of permutations(routes)) {
      const router = new Router<string>()
      for (const [i, path] of order.entries()) {
        router.add('GET', path, path)
        // a different request after each add, building different parts of the tree
        router.match('GET', requests[(i * 5) % requests.length]!)
      }

      // checks build the tree too, so each router starts them at another request
      first = (first + 1) % requests.length
      for (const request of [...requests.slice(first), ...requests.slice(0, first)]) {
        expectMatches(router, { [request]: expected[request] })
      }
    }
  })

  it('keeps matching routes added after more than a thousand requests', () => {
    const router = routerOf('/users/{id}', '/users/all', '/')
    for (let id = 0; id < 1100; id++) {
      router.match('GET', `/users/${id}`)
    }

    // once the tree has served enough requests to build the filter of static paths, these need it to hold them
    router.add('GET', '/users/me', '/users/me')
    router.add('GET', '/teams/{id}', '/teams/{id}')
    router.add('GET', '/users/{id}/posts', '/users/{id}/posts')
    expectMatches(router, {
      '/users/me': ['/users/me'],
      '/users/1': ['/users/{id}', { id: '1' }],
      '/users/all': ['/users/all'],
      '/users/me/': ['/users/me'],
      '/': ['/'],
      '/teams/1': ['/teams/{id}', { id: '1' }],
      '/users/1/posts': ['/users/{id}/posts', { id: '1' }],
      '/%75sers/me': ['/users/me'],
      // the same length and last char as `/users/me` and `/users/all`
      '/users/xe': ['/users/{id}', { id: 'xe' }],
      '/users/xll': ['/users/{id}', { id: 'xll' }],
    })

    for (let id = 0; id < 1100; id++) {
      router.match('GET', `/teams/${id}`)
    }
    router.add('GET', '/users/you', '/users/you')
    router.add('GET', '/users/them', '/users/them')

    expectMatches(router, {
      '/users/1': ['/users/{id}', { id: '1' }],
      '/users/you': ['/users/you'],
      '/users/them': ['/users/them'],
      '/users/%79ou': ['/users/you'],
      '/users/me': ['/users/me'],
      '/users/all': ['/users/all'],
    })
  })
})

describe('methods', () => {
  it('keeps the routes of each method apart, building each one when it needs to', () => {
    const router = new Router<string>()
    for (const method of ['GET', 'POST', 'PUT']) {
      router.add(method, '/items', `${method} /items`)
      router.add(method, '/items/{id}', `${method} /items/{id}`)
    }
    router.add('DELETE', '/items/{id}', 'DELETE /items/{id}')
    router.add('PURGE', '/cache', 'PURGE /cache')
    router.add('', '/', 'no method')

    // builds the tree of GET only
    expectMatches(router, { '/items/1': ['GET /items/{id}', { id: '1' }] })

    router.add('GET', '/items/{id}/tags', 'GET /items/{id}/tags')
    router.add('POST', '/items/{id}/tags', 'POST /items/{id}/tags')
    router.add('POST', '/items/{other}', 'duplicate')

    expectMatches(router, { '/items/1/tags': ['GET /items/{id}/tags', { id: '1' }] })
    expectMatches(
      router,
      {
        '/items': ['POST /items'],
        '/items/1': ['POST /items/{id}', { id: '1' }],
        '/items/1/tags': ['POST /items/{id}/tags', { id: '1' }],
      },
      'POST',
    )
    expectMatches(
      router,
      { '/items/1/tags': undefined, '/items/1': ['PUT /items/{id}', { id: '1' }] },
      'PUT',
    )
    expectMatches(
      router,
      { '/items': undefined, '/items/%31': ['DELETE /items/{id}', { id: '1' }] },
      'DELETE',
    )
    expectMatches(router, { '/cache': ['PURGE /cache'], '/c%61che': ['PURGE /cache'] }, 'PURGE')
    expectMatches(router, { '/': ['no method'], '/items': undefined }, '')

    expect(router.match('get', '/items')).toBeUndefined()
    expect(router.match('PATCH', '/items/1')).toBeUndefined()
  })

  it('matches nothing past the static routes of a method without others', () => {
    const router = routerOf('/a', '/b/c')

    expectMatches(router, {
      '/a': ['/a'],
      '/b/c': ['/b/c'],
      '/a/b': undefined,
      '/b/%63': ['/b/c'],
      '/%62': undefined,
      '/x%2Fy': undefined,
    })
  })
})

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items]
    return
  }
  for (const [i, item] of items.entries()) {
    for (const rest of permutations(items.toSpliced(i, 1))) {
      yield [item, ...rest]
    }
  }
}
