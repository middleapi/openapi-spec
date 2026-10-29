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
  /** The text of the only literal child, if there is just one. */
  literal: string | undefined
  /** The only literal child, if there is just one. */
  literalNode: Node<T> | undefined
  param: Node<T> | undefined
  /** The routes whose catch-all param starts here, most specific first. */
  catchAlls: CatchAll<T>[] | undefined
  route: Route<T> | undefined
}

interface MethodRoutes<T> {
  readonly root: Node<T>
  /**
   * The routes whose segments hold no `{`, `/`, or `%` once decoded, by
   * decoded path, for a request path without `%`.
   */
  readonly statics: Map<string, Route<T>>
  /**
   * Marks the slot of each path in `statics`, so that most request paths for
   * routes with params skip hashing to look there. Building it costs more
   * than a cold start gains back, so it waits for the tree to serve
   * `FILTER_AFTER` requests, and is dropped when a path is added to `statics`.
   */
  filter: Uint8Array | undefined
  /** The requests the tree has served without `filter`. */
  unfiltered: number
  /**
   * How many of the paths in `statics`, in the order they were added, are in
   * the tree too, where only a request path with `%` looks for them.
   */
  indexed: number
  /**
   * The other routes, in the order they were added, not yet in the tree, so
   * a method that no request looks up in the tree never builds one.
   */
  pending: PendingRoute<T>[]
  /** Whether a route can match only through the tree. */
  dynamic: boolean
}

interface PendingRoute<T> {
  readonly path: `/${string}`
  readonly data: T
}

/** A literal segment's decoded text, or a param. */
type Segment = string | { readonly name: string; readonly catchAll: boolean }

const PARAM_NAME = /^[\w-]+$/

const FILTER_AFTER = 1024

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
   * @throws {TypeError} if `path` has more than one catch-all param, before adding anything
   */
  add(method: string, path: `/${string}`, data: T): void {
    // Without `{` or `%`, a path has only literal segments, which read the same decoded.
    if (!path.includes('{') && !path.includes('%')) {
      this.addStatic(method, trimTrailingSlash(path), data)
      return
    }

    this.addParsed(method, path, data)
  }

  // Separate from `add`, so V8 compiles it only once a path has `{` or `%`,
  // which keeps cold starts short for route sets without any.
  private addParsed(method: string, path: `/${string}`, data: T): void {
    if (path.includes('{')) {
      // Only a path with `{+` twice can have two catch-all params.
      if (
        path.indexOf('{+') !== path.lastIndexOf('{+') &&
        parse(path).filter((segment) => typeof segment !== 'string' && segment.catchAll).length > 1
      ) {
        throw new TypeError(
          `OpenAPI path "${path}" has more than one catch-all param ({+name}), but only one is supported per path.`,
        )
      }
    } else {
      const segments = parse(path)
      // Paths with `{` wait in `pending`, so one whose decoded text has a `{`
      // waits there too, keeping the first of two that read the same.
      if (
        segments.every(
          (segment) =>
            typeof segment === 'string' &&
            !segment.includes('/') &&
            !segment.includes('%') &&
            !segment.includes('{'),
        )
      ) {
        this.addStatic(method, `/${segments.join('/')}`, data)
        return
      }
    }

    const routes = this.routesOf(method)
    routes.dynamic = true
    routes.pending.push({ path, data })
  }

  private routesOf(method: string): MethodRoutes<T> {
    let routes = this.methods.get(method)
    if (routes === undefined) {
      routes = {
        root: createNode(),
        statics: new Map(),
        filter: undefined,
        unfiltered: 0,
        indexed: 0,
        pending: [],
        dynamic: false,
      }
      this.methods.set(method, routes)
    }
    return routes
  }

  private addStatic(method: string, path: string, data: T): void {
    const routes = this.routesOf(method)
    if (!routes.statics.has(path)) {
      routes.statics.set(path, { data, params: undefined, tail: 0 })
      routes.filter = undefined
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

    // No static path holds `%`, so a path with it never matches here, and
    // neither does one whose slot the filter leaves unmarked.
    const filter = routes.filter
    if (filter === undefined || filter[slot(path)] === 1) {
      const route = routes.statics.get(path)
      if (route !== undefined) {
        return { data: route.data, params: undefined }
      }
    }

    const encoded = path.includes('%')
    if (!encoded && !routes.dynamic) {
      return undefined
    }

    if (routes.pending.length > 0) {
      indexPending(routes)
    }

    if (filter === undefined && ++routes.unfiltered >= FILTER_AFTER) {
      routes.filter = filterOf(routes.statics)
    }

    if (encoded && routes.indexed !== routes.statics.size) {
      indexStatics(routes)
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
  const head: (string | undefined)[] = []

  for (const segment of parse(prefix)) {
    if (typeof segment === 'string') {
      head.push(segment)
    } else if (segment.catchAll) {
      break
    } else {
      head.push(undefined)
    }
  }

  // oRPC tests each pending lazy router's prefix on every request, so a prefix
  // of only literal text is compared at once for a path without `%`, and other
  // paths are read only as far as the prefix goes.
  const literal = head.every(
    (segment) => segment !== undefined && segment !== '' && !segment.includes('/'),
  )
    ? head.map((segment) => `/${segment}`).join('')
    : undefined

  return (pathname) => {
    if (literal !== undefined && !pathname.includes('%')) {
      return (
        pathname.startsWith(literal) &&
        (pathname.length === literal.length || pathname.charCodeAt(literal.length) === 47)
      )
    }

    let start = 1

    for (const expected of head) {
      // At the end, or at a trailing slash, the path has no more segments.
      if (start >= pathname.length) {
        return false
      }

      let end = pathname.indexOf('/', start)
      if (end === -1) {
        end = pathname.length
      }

      if (!matchesSegment(expected, decode(pathname.slice(start, end)))) {
        return false
      }

      start = end + 1
    }

    return true
  }
}

function filterOf(statics: Map<string, unknown>): Uint8Array {
  const filter = new Uint8Array(1024)
  for (const path of statics.keys()) {
    filter[slot(path)] = 1
  }
  return filter
}

/**
 * Adds the routes in `statics` to the tree, once a request path needs
 * decoding, so that adding them stays cheap for apps that never see one.
 * Counting the paths already added spares `add` from listing the others.
 */
function indexStatics<T>(routes: MethodRoutes<T>): void {
  let indexed = 0
  for (const [path, route] of routes.statics) {
    if (indexed++ < routes.indexed) {
      continue
    }
    let node = routes.root
    for (const segment of path.split('/').slice(1)) {
      node = literalChild(node, segment)
    }
    node.route = route
  }

  routes.indexed = indexed
}

/**
 * Adds the routes in `pending` to the tree, in one loop rather than a call
 * per route, which V8 would see as hot and optimize during a cold start.
 */
function indexPending<T>(routes: MethodRoutes<T>): void {
  const pending = routes.pending
  // The parts of the previous route, how many of them come before its first
  // param, and the node after each of those, so that the next route skips
  // parsing the parts it shares with them.
  let shared: string[] = []
  let literals = 0
  const nodes: Node<T>[] = [routes.root]

  next: for (let p = 0; p < pending.length; p++) {
    const { path, data } = pending[p]!
    const parts = trimTrailingSlash(path).split('/')
    let start = 1
    while (start < literals && parts[start] === shared[start]) {
      start++
    }
    let node = nodes[start - 1]!
    let params: RouteParam[] | undefined
    shared = parts
    literals = parts.length

    for (let index = start; index < parts.length; index++) {
      const segment = toSegment(parts[index]!)

      if (typeof segment === 'string') {
        node = literalChild(node, segment)
        nodes[index] = node
        continue
      }

      const param = { name: segment.name, index, catchAll: segment.catchAll }
      // An array literal holds just its items, where a push to `[]` reserves 17.
      if (params === undefined) {
        literals = index
        params = [param]
      } else {
        params.push(param)
      }

      if (!segment.catchAll) {
        node.param ??= createNode()
        node = node.param
        continue
      }

      const tail: (string | undefined)[] = []
      for (let i = index + 1; i < parts.length; i++) {
        const after = toSegment(parts[i]!)
        if (typeof after === 'string') {
          tail.push(after)
        } else {
          tail.push(undefined)
          params.push({ name: after.name, index: i - parts.length, catchAll: false })
        }
      }

      addCatchAll(node, { tail, route: { data, params, tail: tail.length } })
      continue next
    }

    node.route ??= { data, params, tail: 0 }
  }

  routes.pending = []
}

// Separate from `indexPending`, whose loop would otherwise allocate a scope
// for the closure below on every segment.
function addCatchAll<T>(node: Node<T>, catchAll: CatchAll<T>): void {
  node.catchAlls ??= []
  if (!node.catchAlls.some((other) => sameTail(other.tail, catchAll.tail))) {
    node.catchAlls.push(catchAll)
    node.catchAlls.sort(compareCatchAlls)
  }
}

function literalChild<T>(node: Node<T>, segment: string): Node<T> {
  node.literals ??= new Map()
  let child = node.literals.get(segment)
  if (child === undefined) {
    child = createNode()
    node.literals.set(segment, child)
    const only = node.literals.size === 1
    node.literal = only ? segment : undefined
    node.literalNode = only ? child : undefined
  }
  return child
}

function createNode<T>(): Node<T> {
  return {
    literals: undefined,
    literal: undefined,
    literalNode: undefined,
    param: undefined,
    catchAlls: undefined,
    route: undefined,
  }
}

function parse(path: `/${string}`): Segment[] {
  return trimTrailingSlash(path).split('/').slice(1).map(toSegment)
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

/** Paths that share a slot have the same length modulo 8 and last char modulo 128. */
function slot(path: string): number {
  return ((path.length & 7) << 7) | (path.charCodeAt(path.length - 1) & 127)
}

function trimTrailingSlash(path: string): string {
  return path.charCodeAt(path.length - 1) === 47 ? path.slice(0, -1) : path
}

/**
 * Splits a path with its trailing slash trimmed, keeping the empty string
 * before its first slash. A loop is faster than `path.split('/')`, which V8
 * makes cheap only for strings it has interned, unlike request paths.
 */
function split(path: string, encoded: boolean): string[] {
  const segments: string[] = []
  let start = 0

  for (let end = path.indexOf('/'); end !== -1; end = path.indexOf('/', start)) {
    const segment = path.slice(start, end)
    segments.push(encoded ? decode(segment) : segment)
    start = end + 1
  }

  const segment = path.slice(start)
  segments.push(encoded ? decode(segment) : segment)

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
    // Comparing with an only literal is cheaper than hashing the segment.
    const child =
      node.literal === undefined
        ? node.literals.get(segment)
        : segment === node.literal
          ? node.literalNode
          : undefined
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
    let value = segments[index < 0 ? segments.length + index : index]!

    // Faster than `segments.slice(index, end).join('/')`.
    if (catchAll) {
      for (let i = index + 1; i < end; i++) {
        value += `/${segments[i]}`
      }
    }

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
