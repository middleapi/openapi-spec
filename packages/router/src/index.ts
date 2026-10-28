export interface RouterMatch<T> {
  /** The data the route was added with. */
  data: T
  /** The decoded value of each path param, or `undefined` for a route without any. */
  params: Record<string, string> | undefined
}

interface Route<T> {
  readonly data: T
  readonly params: readonly RouteParam[] | undefined
  /** The number of segments after the catch-all param. */
  readonly tail: number
}

interface RouteParam {
  readonly name: string
  /** The index into the split path, or a negative one from its end for a segment after the catch-all param. */
  readonly index: number
  readonly catchAll: boolean
}

interface CatchAll<T> {
  /** Each segment after the catch-all param: its literal text, or `undefined` for a param. */
  readonly tail: readonly (string | undefined)[]
  readonly route: Route<T>
}

interface Node<T> {
  literals: Map<string, Node<T>> | undefined
  param: Node<T> | undefined
  /** The routes whose catch-all param starts here, most specific first. */
  catchAlls: CatchAll<T>[] | undefined
  route: Route<T> | undefined
}

interface MethodRoutes<T> {
  readonly root: Node<T>
  /** The routes without params, by path, for a request path without `%`. */
  readonly statics: Map<string, Route<T>>
  /** Whether a route can match only through the tree. */
  dynamic: boolean
}

/** A literal segment's decoded text, or a param. */
type Segment = string | { readonly name: string; readonly catchAll: boolean }

const PARAM_NAME = /^[\w-]+$/

/**
 * Matches request paths against OpenAPI path templates, the way oRPC routes
 * them:
 *
 * - `{name}` as a whole segment is a param, matching one non-empty segment.
 * - `{+name}` as a whole segment is a catch-all param, matching one or more
 *   segments, slashes included, with a non-empty value. A path can have one,
 *   and segments can follow it, as in `/files/{+path}/raw`.
 * - Any other text is literal, however it is percent-encoded in the route or
 *   the request: `/café` matches `/caf%C3%A9`, and `%2F` stays inside its
 *   segment.
 * - One trailing slash is ignored, in routes and requests.
 * - Segments compare from left to right, and at each one a literal beats a
 *   param, which beats a catch-all param, falling back to the next one when
 *   the rest of the path does not match. Catch-all params starting at the same
 *   segment compare the segments after them from the end.
 * - A route with the same method and segments as an earlier one is ignored.
 */
export class Router<T> {
  private readonly methods = new Map<string, MethodRoutes<T>>()

  /**
   * Adds a route for requests with exactly this `method`.
   *
   * @throws {TypeError} if `path` does not start with `/` or has more than one catch-all param, before adding anything
   */
  add(method: string, path: `/${string}`, data: T): void {
    const segments = parse(path)

    let routes = this.methods.get(method)
    if (routes === undefined) {
      routes = { root: createNode(), statics: new Map(), dynamic: false }
      this.methods.set(method, routes)
    }

    let node = routes.root
    let params: RouteParam[] | undefined
    let isStatic = true

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      const index = i + 1

      if (typeof segment === 'string') {
        node.literals ??= new Map()
        let child = node.literals.get(segment)
        if (child === undefined) {
          child = createNode()
          node.literals.set(segment, child)
        }
        node = child
        if (segment.includes('/') || segment.includes('%')) {
          isStatic = false
        }
        continue
      }

      params ??= []

      if (!segment.catchAll) {
        params.push({ name: segment.name, index, catchAll: false })
        node.param ??= createNode()
        node = node.param
        continue
      }

      const rest = segments.slice(i + 1)
      params.push({ name: segment.name, index, catchAll: true })
      for (let j = 0; j < rest.length; j++) {
        const after = rest[j]!
        if (typeof after !== 'string') {
          params.push({ name: after.name, index: j - rest.length, catchAll: false })
        }
      }

      const tail = rest.map((after) => (typeof after === 'string' ? after : undefined))
      node.catchAlls ??= []
      if (!node.catchAlls.some((other) => sameTail(other.tail, tail))) {
        node.catchAlls.push({ tail, route: { data, params, tail: tail.length } })
        node.catchAlls.sort(compareCatchAlls)
        routes.dynamic = true
      }
      return
    }

    if (node.route !== undefined) {
      return
    }

    node.route = { data, params, tail: 0 }

    if (params === undefined && isStatic) {
      routes.statics.set(segments.length === 0 ? '' : `/${segments.join('/')}`, node.route)
    } else {
      routes.dynamic = true
    }
  }

  /**
   * Finds the route for a request, given its percent-encoded path without the
   * query string.
   */
  match(method: string, pathname: `/${string}`): RouterMatch<T> | undefined {
    const routes = this.methods.get(method)
    if (routes === undefined) {
      return undefined
    }

    const path = trimTrailingSlash(pathname)

    // No static path holds `%`, so a path with it never matches here.
    const route = routes.statics.get(path)
    if (route !== undefined) {
      return { data: route.data, params: undefined }
    }

    const encoded = path.includes('%')
    if (!encoded && !routes.dynamic) {
      return undefined
    }

    const segments = split(path, encoded)
    const found = find(routes.root, segments, 1)

    if (found === undefined) {
      return undefined
    }

    return { data: found.data, params: found.params && toParams(found, segments) }
  }
}

/**
 * Creates a test of whether a request path can match a route under `prefix`,
 * such as one of a lazy router, to know when to load it. Segments after the
 * prefix, or from its catch-all param on, are not checked.
 */
export function createPrefixMatcher(prefix: `/${string}`): (pathname: `/${string}`) => boolean {
  if (prefix.charCodeAt(0) !== 47) {
    throw new TypeError(`OpenAPI path "${prefix}" must start with "/".`)
  }

  const head: (string | undefined)[] = []

  for (const text of trimTrailingSlash(prefix).split('/').slice(1)) {
    const segment = toSegment(text)
    if (typeof segment === 'string') {
      head.push(segment)
    } else if (segment.catchAll) {
      break
    } else {
      head.push(undefined)
    }
  }

  return (pathname) => {
    const path = trimTrailingSlash(pathname)
    const segments = split(path, path.includes('%'))

    if (segments.length <= head.length) {
      return false
    }

    for (let i = 0; i < head.length; i++) {
      if (!matchesSegment(head[i], segments[i + 1]!)) {
        return false
      }
    }

    return true
  }
}

function createNode<T>(): Node<T> {
  return { literals: undefined, param: undefined, catchAlls: undefined, route: undefined }
}

function parse(path: string): Segment[] {
  if (path.charCodeAt(0) !== 47) {
    throw new TypeError(`OpenAPI path "${path}" must start with "/".`)
  }

  const segments = trimTrailingSlash(path).split('/').slice(1).map(toSegment)

  if (segments.filter((segment) => typeof segment !== 'string' && segment.catchAll).length > 1) {
    throw new TypeError(
      `OpenAPI path "${path}" has more than one catch-all param ({+name}), but only one is supported per path.`,
    )
  }

  return segments
}

function toSegment(text: string): Segment {
  if (text.charCodeAt(0) === 123 && text.charCodeAt(text.length - 1) === 125) {
    const catchAll = text.charCodeAt(1) === 43
    const name = text.slice(catchAll ? 2 : 1, -1)
    if (PARAM_NAME.test(name)) {
      return { name, catchAll }
    }
  }

  return decode(text)
}

function trimTrailingSlash(path: string): string {
  return path.charCodeAt(path.length - 1) === 47 ? path.slice(0, -1) : path
}

/** Splits a path with its trailing slash trimmed, keeping the empty string before its first slash. */
function split(path: string, encoded: boolean): string[] {
  const segments = path.split('/')

  if (encoded) {
    for (let i = 1; i < segments.length; i++) {
      segments[i] = decode(segments[i]!)
    }
  }

  return segments
}

function decode(text: string): string {
  if (!text.includes('%')) {
    return text
  }

  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function find<T>(node: Node<T>, segments: readonly string[], index: number): Route<T> | undefined {
  if (index === segments.length) {
    return node.route
  }

  const segment = segments[index]!

  if (node.literals !== undefined) {
    const child = node.literals.get(segment)
    if (child !== undefined) {
      const route = find(child, segments, index + 1)
      if (route !== undefined) {
        return route
      }
    }
  }

  if (node.param !== undefined && segment !== '') {
    const route = find(node.param, segments, index + 1)
    if (route !== undefined) {
      return route
    }
  }

  if (node.catchAlls !== undefined) {
    for (const catchAll of node.catchAlls) {
      if (matchesCatchAll(catchAll.tail, segments, index)) {
        return catchAll.route
      }
    }
  }

  return undefined
}

function matchesCatchAll(
  tail: readonly (string | undefined)[],
  segments: readonly string[],
  index: number,
): boolean {
  const end = segments.length - tail.length

  // The catch-all param needs a segment, and a non-empty value.
  if (end <= index || (end === index + 1 && segments[index] === '')) {
    return false
  }

  for (let i = 0; i < tail.length; i++) {
    if (!matchesSegment(tail[i], segments[end + i]!)) {
      return false
    }
  }

  return true
}

function matchesSegment(expected: string | undefined, segment: string): boolean {
  return expected === undefined ? segment !== '' : segment === expected
}

function sameTail(a: readonly (string | undefined)[], b: readonly (string | undefined)[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i])
}

/** Puts first the catch-all whose segments after it are more specific, comparing from the last one: a literal, then a param, then none. */
function compareCatchAlls<T>(a: CatchAll<T>, b: CatchAll<T>): number {
  for (let i = 1; i <= Math.max(a.tail.length, b.tail.length); i++) {
    const order = rank(a.tail, i) - rank(b.tail, i)
    if (order !== 0) {
      return order
    }
  }

  return 0
}

function rank(tail: readonly (string | undefined)[], fromEnd: number): number {
  if (fromEnd > tail.length) {
    return 2
  }

  return tail[tail.length - fromEnd] === undefined ? 1 : 0
}

function toParams<T>(route: Route<T>, segments: readonly string[]): Record<string, string> {
  const params: Record<string, string> = {}
  const end = segments.length - route.tail

  for (const { name, index, catchAll } of route.params!) {
    const value = catchAll
      ? segments.slice(index, end).join('/')
      : segments[index < 0 ? segments.length + index : index]!

    // Assigning `__proto__` would set the prototype instead of adding a key.
    if (name === '__proto__') {
      Object.defineProperty(params, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      })
    } else {
      params[name] = value
    }
  }

  return params
}
