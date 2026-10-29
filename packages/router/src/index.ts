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
  /**
   * Sorts the more specific of two catch-alls starting at the same segment
   * first: a digit for each segment after the param, from the last one, `0`
   * for a literal and `1` for a param, then `2`, for none.
   */
  readonly order: string
  readonly route: Route<T>
}

interface Node<T> {
  /** The literal children by their text, once there are two or more. */
  literals: Map<string, Node<T>> | undefined
  /** The text of the only literal child, if there is just one. */
  literal: string | undefined
  /** The only literal child, if there is just one. */
  literalNode: Node<T> | undefined
  param: Node<T> | undefined
  /** The routes whose catch-all param starts here, most specific first. */
  catchAlls: CatchAll<T>[] | undefined
  route: Route<T> | undefined
  /**
   * The routes waiting here, before a part that starts with `{` once decoded,
   * until a request needs the tree past this node, so that a cold start builds
   * only the params its requests need: the split path of each, its data, and
   * its params so far, in the order they were added.
   */
  pending: unknown[] | undefined
}

interface MethodRoutes<T> {
  readonly root: Node<T>
  /**
   * The data of each route whose segments hold no `{`, `/`, or `%` once
   * decoded, by decoded path, for a request path without `%`. Keeping the
   * data, not a route object, makes adding these routes cheaper.
   */
  readonly statics: Map<string, T>
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
   * The path, the data, and the params, `undefined` so far, of each other
   * route not yet in the tree, in the order they were added, so a method that
   * no request looks up in the tree never builds one. A flat list is cheaper
   * to add to than an object per route.
   */
  pending: unknown[]
  /** Whether a route can match only through the tree. */
  dynamic: boolean
}

/** A literal segment's decoded text, or a param. */
type Segment = string | RouteParam

const PARAM_NAME = /^[\w-]+$/

const FILTER_AFTER = 1024

/**
 * Each node starts as a copy of this one, which V8 makes in one step. An
 * object literal with `undefined` values would define each property in turn,
 * which adds up while a cold start builds the tree.
 */
const EMPTY_NODE: Readonly<Node<never>> = {
  literals: undefined,
  literal: undefined,
  literalNode: undefined,
  param: undefined,
  catchAlls: undefined,
  route: undefined,
  pending: undefined,
}

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
    const braced = path.includes('{')
    if (!braced && !path.includes('%')) {
      addStatic(this.methods, method, trimTrailingSlash(path), data)
      return
    }

    addParsed(this.methods, method, path, data, braced)
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
      const data = routes.statics.get(path)
      // A route's data can be `undefined` too.
      if (data !== undefined || routes.statics.has(path)) {
        return { data: data as T, params: undefined }
      }
    }

    const encoded = path.includes('%')
    if (!encoded && !routes.dynamic) {
      return undefined
    }

    if (routes.pending.length > 0) {
      build(routes)
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

// The helpers of `add` are functions, not methods, which a cold start calls
// more cheaply. This one is separate from `add`, so V8 compiles it only once a
// path has `{` or `%`, which keeps cold starts short for route sets without any.
function addParsed<T>(
  methods: Map<string, MethodRoutes<T>>,
  method: string,
  path: `/${string}`,
  data: T,
  braced: boolean,
): void {
  if (braced) {
    // Only a path with `{+` twice can have two catch-all params. `lastIndexOf`
    // would cost more, as V8 runs it outside its fast builtins.
    const catchAll = path.indexOf('{+')
    if (
      catchAll !== -1 &&
      path.includes('{+', catchAll + 2) &&
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
      addStatic(methods, method, `/${segments.join('/')}`, data)
      return
    }
  }

  const routes = routesOf(methods, method)
  routes.dynamic = true
  routes.pending.push(path, data, undefined)
}

function routesOf<T>(methods: Map<string, MethodRoutes<T>>, method: string): MethodRoutes<T> {
  let routes = methods.get(method)
  if (routes === undefined) {
    routes = {
      root: { ...EMPTY_NODE },
      statics: new Map(),
      filter: undefined,
      unfiltered: 0,
      indexed: 0,
      pending: [],
      dynamic: false,
    }
    methods.set(method, routes)
  }
  return routes
}

function addStatic<T>(
  methods: Map<string, MethodRoutes<T>>,
  method: string,
  path: string,
  data: T,
): void {
  const routes = routesOf(methods, method)
  const statics = routes.statics
  if (!statics.has(path)) {
    statics.set(path, data)
    routes.filter = undefined
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
  for (const [path, data] of routes.statics) {
    if (indexed++ < routes.indexed) {
      continue
    }
    let node = routes.root
    for (const segment of path.split('/').slice(1)) {
      node = literalChild(node, segment)
    }
    node.route = { data, params: undefined, tail: 0 }
  }

  routes.indexed = indexed
}

/**
 * Adds the routes in `pending` to the tree. Once the tree has served a
 * request, each goes in whole, as routes may no longer wait where the tree
 * has grown past them.
 */
function build<T>(routes: MethodRoutes<T>): void {
  expand(routes.root, routes.pending, 1, routes.unfiltered > 0)
  routes.pending = []
}

/**
 * Adds the routes waiting at `node`, which is at `start` in the split path, to
 * the tree, in one loop rather than a call per route, which V8 would see as
 * hot and optimize during a cold start. Each route goes in `whole`, or up to
 * where it waits again.
 */
function expand<T>(node: Node<T>, pending: unknown[], start: number, whole: boolean): void {
  node.pending = undefined
  // The parts of the previous route, how many of them come before its first
  // param or wait, and the node after each of those, so that the next route
  // skips parsing the parts it shares with them.
  let shared: string[] = []
  let literals = 0
  const nodes: Node<T>[] = [node]

  next: for (let p = 0; p < pending.length; p += 3) {
    const path = pending[p]
    const parts = typeof path === 'string' ? trimTrailingSlash(path).split('/') : (path as string[])
    const data = pending[p + 1] as T
    let params = pending[p + 2] as RouteParam[] | undefined
    let index = start
    while (index < literals && parts[index] === shared[index]) {
      index++
    }
    let child = nodes[index - start]!
    shared = parts
    literals = parts.length

    for (; index < parts.length; index++) {
      const part = parts[index]!
      let segment: Segment = part.includes('%') ? decode(part) : part

      // Only a part starting with `{` once decoded can be a param. Past its
      // first part, a route waits before one, and before literal text like it,
      // which keeps the first of two that read the same. A route added whole
      // goes after the routes waiting there.
      if (segment[0] === '{') {
        if (!whole && index > start) {
          if (index < literals) {
            literals = index
          }
          ;(child.pending ??= []).push(parts, data, params)
          continue next
        }
        if (child.pending !== undefined) {
          expand(child, child.pending, index, false)
        }
        segment = toSegment(part, index)
      }

      if (typeof segment === 'string') {
        child = literalChild(child, segment)
        nodes[index - start + 1] = child
        continue
      }

      if (index < literals) {
        literals = index
      }
      // An array literal holds just its items, where a push to `[]` reserves 17.
      if (params === undefined) {
        params = [segment]
      } else {
        params.push(segment)
      }

      if (!segment.catchAll) {
        child.param ??= { ...EMPTY_NODE }
        child = child.param
        continue
      }

      addCatchAll(child, parts, index, data, params)
      continue next
    }

    child.route ??= { data, params, tail: 0 }
  }
}

/**
 * Adds a route whose catch-all param is the part at `index`. Keeping this out
 * of `expand` makes the code V8 compiles for a cold start's first request
 * smaller.
 */
function addCatchAll<T>(
  node: Node<T>,
  parts: readonly string[],
  index: number,
  data: T,
  params: RouteParam[],
): void {
  const tail: (string | undefined)[] = []
  let order = '2'
  for (let i = index + 1; i < parts.length; i++) {
    const after = toSegment(parts[i]!, i - parts.length)
    if (typeof after === 'string') {
      tail.push(after)
      order = `0${order}`
    } else {
      tail.push(undefined)
      params.push(after)
      order = `1${order}`
    }
  }

  // A stable sort keeps a route with the same segments as an earlier one
  // after it, where it never matches.
  node.catchAlls ??= []
  node.catchAlls.push({ tail, order, route: { data, params, tail: tail.length } })
  node.catchAlls.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
}

function literalChild<T>(node: Node<T>, segment: string): Node<T> {
  if (node.literals === undefined) {
    if (node.literalNode === undefined) {
      node.literal = segment
      node.literalNode = { ...EMPTY_NODE }
      return node.literalNode
    }
    if (segment === node.literal) {
      return node.literalNode
    }
    node.literals = new Map()
    node.literals.set(node.literal!, node.literalNode)
    node.literal = undefined
    node.literalNode = undefined
  }

  let child = node.literals.get(segment)
  if (child === undefined) {
    child = { ...EMPTY_NODE }
    node.literals.set(segment, child)
  }
  return child
}

function parse(path: `/${string}`): Segment[] {
  return trimTrailingSlash(path).split('/').map(toSegment).slice(1)
}

function toSegment(text: string, index: number): Segment {
  if (text.charCodeAt(0) === 123 && text.charCodeAt(text.length - 1) === 125) {
    const catchAll = text.charCodeAt(1) === 43
    const name = text.slice(catchAll ? 2 : 1, -1)
    if (PARAM_NAME.test(name)) {
      return { name, index, catchAll }
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
  // Every path but the root's, which is empty, starts with a slash, so the
  // first segment needs no search.
  const segments = ['']
  if (path === '') {
    return segments
  }

  let start = 1

  for (let end = path.indexOf('/', start); end !== -1; end = path.indexOf('/', start)) {
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

  // Comparing with an only literal is cheaper than hashing the segment.
  const child =
    node.literal !== undefined
      ? segment === node.literal
        ? node.literalNode
        : undefined
      : node.literals?.get(segment)
  if (child !== undefined) {
    const route = find(child, segments, index + 1)
    if (route !== undefined) {
      return route
    }
  }

  // Routes wait here only before a part starting with `{`, and only while the
  // tree has no such part here, so any literal child beats them, and they can
  // wait until it fails.
  if (node.pending !== undefined) {
    expand(node, node.pending, index, false)
    return find(node, segments, index)
  }

  if (node.param !== undefined && segment !== '') {
    const route = find(node.param, segments, index + 1)
    if (route !== undefined) {
      return route
    }
  }

  // An index loop, unlike `for...of`, keeps `find` small enough for V8 to
  // inline it into `match`.
  const catchAlls = node.catchAlls
  if (catchAlls !== undefined) {
    for (let i = 0; i < catchAlls.length; i++) {
      if (matchesCatchAll(catchAlls[i]!.tail, segments, index)) {
        return catchAlls[i]!.route
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

// `params` is spread only for a param named `__proto__`, not on every pass.
/* oxlint-disable oxc/no-accumulating-spread */
function toParams<T>(route: Route<T>, segments: readonly string[]): Record<string, string> {
  let params: Record<string, string> = {}
  const end = segments.length - route.tail

  for (const { name, index, catchAll } of route.params!) {
    let value = segments[index < 0 ? segments.length + index : index]!

    // Faster than `segments.slice(index, end).join('/')`.
    if (catchAll) {
      for (let i = index + 1; i < end; i++) {
        value += `/${segments[i]}`
      }
    }

    // Assigning `__proto__` would set the prototype, where a computed key in
    // an object literal adds it.
    if (name === '__proto__') {
      params = { ...params, [name]: value }
    } else {
      params[name] = value
    }
  }

  return params
}
/* oxlint-enable oxc/no-accumulating-spread */
