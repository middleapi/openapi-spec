import { Router } from '@openapi-spec/router'
import { expect } from 'vitest'

/** The data a request should match, and its params, if the route has any. */
export type Expected = readonly [data: string, params?: Record<string, string>] | undefined

/** A router with each path added for GET, with the path as its data. */
export function routerOf(...paths: `/${string}`[]): Router<string> {
  const router = new Router<string>()
  for (const path of paths) {
    router.add('GET', path, path)
  }
  return router
}

/** Matches each request path in order, checking what it matches, or that it matches nothing. */
export function expectMatches(
  router: Router<string>,
  expected: Record<string, Expected>,
  method = 'GET',
): void {
  for (const [path, match] of Object.entries(expected)) {
    expect(router.match(method, path as `/${string}`), `${method} ${path}`).toStrictEqual(
      match && { data: match[0], params: match[1] },
    )
  }
}
