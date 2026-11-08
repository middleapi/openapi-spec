import { createPrefixMatcher, Router } from '@openapi-spec/router'
import { addRoute, createRouter, findRoute, routeToRegExp } from 'rou3'
import { bench, describe } from 'vitest'

import type { Requests, Routes } from './__shared__/routes.ts'
import {
  fresh,
  restRequests,
  restRoutes,
  rpcRequests,
  rpcRoutes,
  toRou3Path,
} from './__shared__/routes.ts'

// rou3 runs as is, without the percent-decoding oRPC does around it today,
// so each comparison is against less work than this router does.

// CodSpeed measures one call of each bench after a few warmup calls. Repeating
// the few requests of a match bench in each call lets V8 finish compiling them
// during the warmup, so a compile can't land in the measured call and swing its
// result many times.
const REPEAT = 16

function createOurs(routes: Routes): Router<string> {
  const router = new Router<string>()
  for (const [method, path] of routes) {
    router.add(method, path, path)
  }
  return router
}

function createRou3(routes: Routes): ReturnType<typeof createRouter<string>> {
  const router = createRouter<string>()
  for (const [method, path] of routes) {
    addRoute(router, method, toRou3Path(path), path)
  }
  return router
}

function compare(name: string, routes: Routes, requests: Requests): void {
  describe(name, () => {
    const ours = createOurs(routes)
    const rou3 = createRou3(routes)

    bench('@openapi-spec/router', () => {
      for (let i = 0; i < REPEAT; i++) {
        for (const [method, pathname] of requests) {
          ours.match(method, fresh(pathname))
        }
      }
    })

    bench('rou3', () => {
      for (let i = 0; i < REPEAT; i++) {
        for (const [method, pathname] of requests) {
          findRoute(rou3, method, fresh(pathname))
        }
      }
    })
  })
}

compare('match, 250 RPC-style procedures', rpcRoutes(50), rpcRequests(50))
compare('match, 703 REST-style procedures', restRoutes(100), restRequests(100))

describe('add, then a request for each method, 703 REST-style procedures', () => {
  const routes = restRoutes(100)
  // This router builds a method's tree on its first request that needs one.
  const requests = [
    ['GET', '/api/v1/resource0/1'],
    ['PATCH', '/api/v1/resource0/1'],
    ['DELETE', '/api/v1/resource0/1'],
  ] as const

  bench('@openapi-spec/router', () => {
    const router = createOurs(routes)
    for (const [method, pathname] of requests) {
      router.match(method, fresh(pathname))
    }
  })

  bench('rou3', () => {
    const router = createRou3(routes)
    for (const [method, pathname] of requests) {
      findRoute(router, method, fresh(pathname))
    }
  })
})

describe('prefix match, 10 pending lazy routers', () => {
  // oRPC tests each pending lazy router's prefix on every request until it loads.
  const prefixes = Array.from({ length: 10 }, (_, i) => `/api/v1/lazy${i}` as const)
  const ours = prefixes.map(createPrefixMatcher)
  const rou3 = prefixes.map((prefix) => routeToRegExp(`${toRou3Path(prefix)}/**`))
  const requests = restRequests(100)

  bench('@openapi-spec/router', () => {
    for (const [, pathname] of requests) {
      const path = fresh(pathname)
      for (const matches of ours) {
        matches(path)
      }
    }
  })

  bench('rou3', () => {
    for (const [, pathname] of requests) {
      const path = fresh(pathname)
      for (const regExp of rou3) {
        regExp.test(path)
      }
    }
  })
})

describe('load 10 lazy routers in turn, a request into each, 703 REST-style procedures', () => {
  // oRPC adds a lazy router's routes when a request first needs it, after the
  // requests that came before, then matches that request.
  const routes = restRoutes(100)
  const lazyRouters = Array.from({ length: 10 }, (_, i) => routes.slice(i * 70, i * 70 + 70))
  const requests = lazyRouters.map((_, i) => `/api/v1/resource${i * 10}/1` as const)

  bench('@openapi-spec/router', () => {
    const router = new Router<string>()
    for (const [i, lazyRouter] of lazyRouters.entries()) {
      for (const [method, path] of lazyRouter) {
        router.add(method, path, path)
      }
      router.match('GET', fresh(requests[i]!))
    }
  })

  bench('rou3', () => {
    const router = createRouter<string>()
    for (const [i, lazyRouter] of lazyRouters.entries()) {
      for (const [method, path] of lazyRouter) {
        addRoute(router, method, toRou3Path(path), path)
      }
      findRoute(router, 'GET', fresh(requests[i]!))
    }
  })
})
