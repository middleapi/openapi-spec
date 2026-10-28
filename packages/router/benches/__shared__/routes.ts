// Route sets the way oRPC adds them, as [method, path] pairs, and requests
// against each: hits of every kind of route, and misses.

export type Routes = readonly (readonly [method: string, path: `/${string}`])[]

export type Requests = readonly (readonly [method: string, pathname: `/${string}`])[]

const PROCEDURES = ['list', 'find', 'create', 'update', 'delete'] as const

/** Procedures without OpenAPI paths, which oRPC exposes as `POST /<resource>/<procedure>`. */
export function rpcRoutes(resources: number): Routes {
  return Array.from({ length: resources }, (_, i) =>
    PROCEDURES.map((procedure) => ['POST', `/resource${i}/${procedure}`] as const),
  ).flat()
}

export function rpcRequests(resources: number): Requests {
  const last = resources - 1
  return [
    ['POST', '/resource0/list'],
    ['POST', `/resource${last}/delete/`],
    ['POST', `/resource${last}/unknown`],
    ['GET', '/resource0/list'],
  ]
}

/** Procedures with REST paths under a prefix, as the oRPC docs write them. */
export function restRoutes(resources: number): Routes {
  const routes: (readonly [string, `/${string}`])[] = Array.from({ length: resources }, (_, i) => {
    const base = `/api/v1/resource${i}` as const
    return [
      ['GET', base],
      ['POST', base],
      ['GET', `${base}/me`],
      ['GET', `${base}/{id}`],
      ['PATCH', `${base}/{id}`],
      ['DELETE', `${base}/{id}`],
      ['GET', `${base}/{id}/items/{itemId}`],
    ] as const
  }).flat()

  routes.push(
    ['GET', '/api/v1/files/{+path}'],
    ['GET', '/api/v1/files/{+path}/raw'],
    ['GET', '/{workspaceId}/planets/{id}'],
  )

  return routes
}

export function restRequests(resources: number): Requests {
  const base = `/api/v1/resource${resources - 1}` as const
  return [
    ['GET', base],
    ['GET', `${base}/me`],
    ['GET', `${base}/123`],
    ['PATCH', `${base}/a%20b`],
    ['GET', `${base}/123/items/456`],
    ['GET', '/api/v1/files/docs/guide/intro.md'],
    ['GET', '/api/v1/files/docs/guide/intro.md/raw'],
    ['GET', '/workspace/planets/earth'],
    ['GET', '/api/v2/resource0/123'],
  ]
}

/** The same path in rou3's syntax. */
export function toRou3Path(path: string): string {
  return path.replaceAll(/\{\+([\w-]+)\}/g, '**:$1').replaceAll(/\{([\w-]+)\}/g, ':$1')
}

/**
 * A new copy of a request path, as a server parses one for each request. V8
 * caches what `split` returns for a string literal, so matching the same
 * literal over and over would hide part of the cost of a real request.
 */
export function fresh(pathname: `/${string}`): `/${string}` {
  return `/${pathname.slice(1)}`
}
