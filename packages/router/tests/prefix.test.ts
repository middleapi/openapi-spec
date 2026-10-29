import { createPrefixMatcher } from '@openapi-spec/router'

import { routerOf } from './helpers'

/** Checks each request path against a prefix, by whether it should match. */
function expectPrefix(prefix: `/${string}`, expected: Record<`/${string}`, boolean>): void {
  const matches = createPrefixMatcher(prefix)
  for (const [path, match] of Object.entries(expected)) {
    expect(matches(path as `/${string}`), `${prefix} for ${path}`).toBe(match)
  }
}

describe('createPrefixMatcher', () => {
  it('matches params and literals before a catch-all param', () => {
    expectPrefix('/{org}/{repo}/files/{+path}', {
      '/o/r/files': true,
      '/o/r/files/': true,
      '/o/r/files/a/b': true,
      '/%6F/r/%66iles/a': true,
      '/o/r/filesx': false,
      '/o//files': false,
      '/o/r': false,
      '/o/r/blobs/a': false,
    })
  })

  it('matches every path from a catch-all param in the first segment', () => {
    expectPrefix('/{+path}', { '/': true, '//': true, '/a': true, '/a/b%2F': true })
  })

  it('needs a non-empty segment for a param', () => {
    expectPrefix('/{id}', {
      '/x': true,
      '/x/': true,
      '/%2F': true,
      '/x//y': true,
      '/': false,
      '//': false,
      '//x': false,
    })
  })

  it('compares decoded text, keeping malformed escapes as written', () => {
    expectPrefix('/a%25b', {
      '/a%25b': true,
      '/a%25b/x': true,
      '/a%b': true,
      '/ab': false,
      '/a%2525b': false,
    })
    expectPrefix('/api', { '/api/%ZZ': true, '/api/%': true, '/%ZZ': false, '/api%ZZ': false })
    expectPrefix('/caf%C3%A9', {
      '/café': true,
      '/café/x': true,
      '/caf%c3%a9/x': true,
      '/cafe': false,
      '/caf%E9': false,
    })
    expectPrefix('/%7Bid%7D', { '/{id}': true, '/%7bid%7d/x': true, '/1': false })
  })

  it('matches names that objects inherit as literal text', () => {
    expectPrefix('/__proto__/{id}', {
      '/__proto__/1': true,
      '/%5F_proto__/1/x': true,
      '/__proto__': false,
      '/constructor/1': false,
    })
  })

  it('matches every request that a route under the prefix matches', () => {
    const prefixes: `/${string}`[] = [
      '/',
      '/api',
      '/api/v1/',
      '/{workspace}',
      '/{workspace}/planets',
      '/caf%C3%A9',
      '/x%2Fy',
      '/a//b',
      '/%7Bid%7D',
      '/__proto__',
      '/a%25b',
      '/files/{+path}',
      '/{id}/{+rest}',
    ]
    const suffixes = ['', '/', '/{id}', '/items', '/items/{id}', '/{+more}', '/{a}/x', '//', '/%61']
    const requests: `/${string}`[] = [
      '/',
      '//',
      '/api',
      '/api/items',
      '/api/v1',
      '/api/v1/items',
      '/api/v1/items/1',
      '/api/v1//',
      '/api/v1/%61',
      '/api/v2/items',
      '/w1',
      '/w1/planets',
      '/w1/planets/earth',
      '/w1/planets/a/x',
      '/w1/moons',
      '//planets',
      '/café/items',
      '/caf%C3%A9/items/1',
      '/x%2Fy/1',
      '/x/y/1',
      '/a//b/1',
      '/a//b//',
      '/a/b/1',
      '/{id}/items',
      '/%7Bid%7D/a/x',
      '/__proto__/1',
      '/%5F_proto__/items',
      '/files',
      '/files/a/b',
      '/files/a/b/items',
      '/a%25b/a',
      '/a%b/items/1',
      '/1/2/3',
    ]

    let matched = 0
    for (const prefix of prefixes) {
      const matches = createPrefixMatcher(prefix)
      for (const suffix of suffixes) {
        const route = `${prefix.endsWith('/') ? prefix.slice(0, -1) : prefix}${suffix}`
        if ((route.match(/\{\+/g) ?? []).length > 1) {
          continue
        }
        const router = routerOf(route === '' ? '/' : (route as `/${string}`))
        for (const request of requests) {
          if (router.match('GET', request) !== undefined) {
            matched++
            expect(matches(request), `${prefix} for ${request}, which ${route} matches`).toBe(true)
          }
        }
      }
    }

    // most pairs match nothing, so make sure enough do for the check to mean something
    expect(matched).toBeGreaterThan(100)
  })
})
