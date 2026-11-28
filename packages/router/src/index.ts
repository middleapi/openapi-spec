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
  /** The template of its segment, for a param with literal text around it there. */
  readonly template: Template | undefined
  /** Which of the template's params this is. */
  readonly place: number
}

/**
 * A segment with params and literal text around them, as in `{id}.json` or
 * `{name}-{version}.zip`.
 */
interface Template {
  /** Matches a decoded segment, capturing the value of each param. */
  readonly pattern: RegExp
  readonly names: readonly string[]
  /** The length of its literal text, which sorts the more specific template first. */
  readonly size: number
}

interface CatchAll<T> {
  /** Each segment after the catch-all param: its literal text, its template, or `undefined` for a param. */
  readonly tail: readonly (string | Template | undefined)[]
  /**
   * Sorts the more specific of two catch-alls starting at the same segment
   * first: a digit for each segment after the param, from the last one, `0`
   * for a literal, `1` for a template and `2` for a param, then `3`, for none.
   */
  readonly order: string
  readonly route: Route<T>
}

interface Node<T> {
  /** The literal children by their text, once there are two or more. */
  literals: Map<string, Node<T>> | undefined
  /** The text of the only literal child, if there is just one. */
  literal: string | undefined
  /** The only literal child, while `literal` holds its text. */
  literalNode: Node<T> | undefined
  /** The children for segments with a template, most specific first. */
  templates: { readonly template: Template; readonly node: Node<T> }[] | undefined
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
   * `FILTER_AFTER` requests.
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
}

/** A literal segment's decoded text, a param, or a template. */
type Segment = string | RouteParam | Template

const PARAM_NAME = /^[\w-]+$/

const TEMPLATE_PARAM = /\{([\w-]+)\}/

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
  templates: undefined,
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
 * - `{name}` with literal text around it in a segment, as in `{id}.json`, is
 *   a param too, with a non-empty value. Params in one segment need text
 *   between them, and each takes the shortest value that lets the rest match.
 * - `{+name}` as a whole segment is a catch-all param, matching one or more
 *   segments, slashes included, with a non-empty value. A path can have one,
 *   and segments can follow it, as in `/files/{+path}/raw`.
 * - Any other text is literal, however it is percent-encoded in the route or
 *   the request: `/café` matches `/caf%C3%A9`, and `%2F` stays inside its
 *   segment.
 * - One trailing slash is ignored, in routes and requests.
 * - Segments compare from left to right, and at each one a literal beats a
 *   param with text around it, which beats a param, which beats a catch-all
 *   param, falling back to the next one when the rest of the path does not
 *   match. Of two params with text around them, the one with more literal text
 *   wins. Catch-all params starting at the same segment compare the segments
 *   after them from the end.
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

    // Adds the routes in `pending` to the tree, each up to where it waits.
    if (routes.pending.length > 0) {
      expand(routes.root, routes.pending, 1)
      routes.pending = []
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
      parse(path).filter((segment) => (segment as Partial<RouteParam>).catchAll === true).length > 1
    ) {
      throw new TypeError(
        `OpenAPI path "${path}" has more than one catch-all param ({+name}), but only one is supported per path.`,
      )
    }
  } else {
    // Without `{`, every segment is literal text.
    const segments = parse(path) as string[]
    // Paths with `{` wait in `pending`, so one whose decoded text has a `{`
    // waits there too, keeping the first of two that read the same.
    if (
      segments.every(
        (segment) => !segment.includes('/') && !segment.includes('%') && !segment.includes('{'),
      )
    ) {
      addStatic(methods, method, `/${segments.join('/')}`, data)
      return
    }
  }

  routesOf(methods, method).pending.push(path, data, undefined)
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
    // Marking the slot, rather than dropping the filter for the next request to
    // build again, keeps adding routes between requests, as lazy routers do,
    // from costing a pass over every static path each time.
    if (routes.filter !== undefined) {
      routes.filter[slot(path)] = 1
    }
  }
}

/**
 * Creates a test of whether a request path can match a route under `prefix`,
 * such as one of a lazy router, to know when to load it. Segments after the
 * prefix, or from its catch-all param on, are not checked.
 */
export function createPrefixMatcher(prefix: `/${string}`): (pathname: `/${string}`) => boolean {
  const head: (string | Template | undefined)[] = []
  // Built in this loop rather than with `every` and `map`, which a cold start
  // would compile as two more functions.
  let text: string | undefined = ''

  for (const segment of parse(prefix)) {
    if (typeof segment === 'string') {
      head.push(segment)
      if (segment === '' || segment.includes('/')) {
        text = undefined
      } else if (text !== undefined) {
        text += '/' + segment
      }
    } else if ('pattern' in segment) {
      head.push(segment)
      text = undefined
    } else if (segment.catchAll) {
      break
    } else {
      head.push(undefined)
      text = undefined
    }
  }

  // oRPC tests each pending lazy router's prefix on every request, so a prefix
  // of only literal text is compared at once for a path without `%` before the
  // prefix's length, and other paths are read only as far as the prefix goes.
  // The second `%` search runs only for a path with one. A `const` lets V8
  // fold `literal` into the matcher.
  const literal = text

  return (pathname) => {
    if (
      literal !== undefined &&
      (!pathname.includes('%') || pathname.indexOf('%') >= literal.length)
    ) {
      return (
        pathname.startsWith(literal) &&
        (pathname.length === literal.length || pathname.charCodeAt(literal.length) === 47)
      )
    }

    return matchesHead(head, pathname)
  }
}

/**
 * Whether `pathname` starts with the segments in `head`, `undefined` standing
 * for a param. Kept out of the prefix matcher, so that a cold start compiles it
 * only for a prefix with params or a path with `%` inside the prefix.
 */
function matchesHead(head: readonly (string | Template | undefined)[], pathname: string): boolean {
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

    if (!matchesPart(expected, decode(pathname.slice(start, end)))) {
      return false
    }

    start = end + 1
  }

  return true
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
 * Adds the routes waiting at `node`, which is at `start` in the split path, to
 * the tree, in one loop rather than a call per route, which V8 would see as
 * hot and optimize during a cold start. Each route goes in up to where it
 * waits again.
 */
function expand<T>(node: Node<T>, pending: unknown[], start: number): void {
  node.pending = undefined
  // The parts of the previous route, how many of them come before its first
  // part starting with `{` once decoded, and the node after each of those, so
  // that the next route skips parsing the parts it shares with them.
  let shared: string[] = []
  let literals = 0
  const nodes: Node<T>[] = [node]
  // The part starting with `{` parsed last, its index, and its segment. Routes
  // waiting at one node often start with the same param, as in
  // `/repos/{owner}/{repo}/...`, and reuse its segment instead of parsing it.
  let lastPart: string | undefined
  let lastIndex = 0
  let lastSegment: Segment = ''

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

      // Only a part with `{` once decoded can have a param. Past its first
      // part, a route waits before one, and before literal text like it,
      // which keeps the first of two that read the same. It waits even where
      // the tree has grown, as for a route added after requests, unless the
      // node has a literal child with this text, which `find` tries before
      // the routes waiting there. Then it goes after them.
      if (segment.includes('{')) {
        if (index < literals) {
          literals = index
        }
        if (index > start && child.literal !== segment && child.literals?.has(segment) !== true) {
          ;(child.pending ??= []).push(parts, data, params)
          continue next
        }
        if (child.pending !== undefined) {
          expand(child, child.pending, index)
        }
        if (part !== lastPart || index !== lastIndex) {
          lastPart = part
          lastIndex = index
          lastSegment = toSegment(part, index)
        }
        segment = lastSegment
      }

      if (typeof segment === 'string') {
        child = literalChild(child, segment)
        nodes[index - start + 1] = child
        continue
      }

      if ('pattern' in segment) {
        params = pushTemplateParams(params, segment, index)
        child = templateChild(child, segment)
        continue
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
  const tail: (string | Template | undefined)[] = []
  let order = '3'
  for (let i = index + 1; i < parts.length; i++) {
    const after = toSegment(parts[i]!, i - parts.length)
    if (typeof after === 'string') {
      tail.push(after)
      order = `0${order}`
    } else if ('pattern' in after) {
      tail.push(after)
      pushTemplateParams(params, after, i - parts.length)
      order = `1${order}`
    } else {
      tail.push(undefined)
      params.push(after)
      order = `2${order}`
    }
  }

  // A stable sort keeps a route with the same segments as an earlier one
  // after it, where it never matches.
  node.catchAlls ??= []
  node.catchAlls.push({ tail, order, route: { data, params, tail: tail.length } })
  node.catchAlls.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
}

function pushTemplateParams(
  params: RouteParam[] | undefined,
  template: Template,
  index: number,
): RouteParam[] {
  const list = params ?? []
  for (let place = 0; place < template.names.length; place++) {
    list.push({ name: template.names[place]!, index, catchAll: false, template, place })
  }
  return list
}

/**
 * The child for `template`, the one already there for a template with the
 * same literal text, with any param names, or a new one, kept after those
 * with more literal text.
 */
function templateChild<T>(node: Node<T>, template: Template): Node<T> {
  const templates = (node.templates ??= [])
  // A pattern's source is its literal text, escaped.
  const source = template.pattern.source
  for (const entry of templates) {
    if (entry.template.pattern.source === source) {
      return entry.node
    }
  }

  const child = { ...EMPTY_NODE }
  templates.push({ template, node: child })
  // Templates with as much literal text compare by it, so that their order does
  // not depend on the order routes were added.
  templates.sort(
    (a, b) =>
      b.template.size - a.template.size ||
      (a.template.pattern.source < b.template.pattern.source ? -1 : 1),
  )
  return child
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
      return { name, index, catchAll, template: undefined, place: 0 }
    }
  }

  return (text.includes('{') && toTemplate(text)) || decode(text)
}

/**
 * Reads a segment with `{name}` params inside literal text, as in `{id}.json`,
 * or returns `undefined` when it has none, or two with no text between them,
 * which would make their values ambiguous.
 */
function toTemplate(text: string): Template | undefined {
  // Splitting on a pattern with a group puts each param name between the texts around it.
  const parts = text.split(TEMPLATE_PARAM)
  const names: string[] = []
  let source = '^'
  let size = 0
  for (let i = 0; i < parts.length; i += 2) {
    const literal = decode(parts[i]!)
    if (literal === '' && i > 0 && i < parts.length - 1) {
      return undefined
    }
    size += literal.length
    source += literal.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')
    if (i < parts.length - 1) {
      names.push(parts[i + 1]!)
      // Lazy, so that each text between two params matches where it first
      // appears, as ordered as the params' values read.
      source += '(.+?)'
    }
  }

  return names.length === 0 ? undefined : { pattern: new RegExp(`${source}$`, 's'), names, size }
}

/**
 * Whether a decoded segment matches literal text, a template, or, for
 * `undefined`, a param, which needs a non-empty segment.
 */
function matchesPart(expected: string | Template | undefined, segment: string): boolean {
  return expected === undefined
    ? segment !== ''
    : typeof expected === 'string'
      ? segment === expected
      : expected.pattern.test(segment)
}

/**
 * Spreads paths over 1024 slots by their length and last char. Paths whose
 * lengths differ by 8 land 8 slots apart, where a step of 128 per length would
 * put them in the same slot for the same last char, as happens to many paths
 * of real APIs.
 */
function slot(path: string): number {
  return (path.length * 127 + path.charCodeAt(path.length - 1)) & 1023
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

  // Each value is ready before `segments.push` is read: V8 inlines the push
  // only when no call, such as to `decode`, runs between the two.
  for (let end = path.indexOf('/', start); end !== -1; end = path.indexOf('/', start)) {
    const segment = path.slice(start, end)
    const value = encoded ? decode(segment) : segment
    segments.push(value)
    start = end + 1
  }

  const segment = path.slice(start)
  const value = encoded ? decode(segment) : segment
  segments.push(value)

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

  // Routes wait here only before a part starting with `{` that is not the text
  // of a literal child here, so any literal child beats them, and they can
  // wait until it fails.
  if (node.pending !== undefined) {
    expand(node, node.pending, index)
    return find(node, segments, index)
  }

  if (node.templates !== undefined) {
    const route = findTemplate(node.templates, segments, index)
    if (route !== undefined) {
      return route
    }
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

/**
 * Tries the templates at a node in turn. Kept out of `find`, so that V8
 * compiles it only for route sets with templates.
 */
function findTemplate<T>(
  templates: readonly { readonly template: Template; readonly node: Node<T> }[],
  segments: readonly string[],
  index: number,
): Route<T> | undefined {
  for (const { template, node } of templates) {
    if (template.pattern.test(segments[index]!)) {
      const route = find(node, segments, index + 1)
      if (route !== undefined) {
        return route
      }
    }
  }
  return undefined
}

function matchesCatchAll(
  tail: readonly (string | Template | undefined)[],
  segments: readonly string[],
  index: number,
): boolean {
  const end = segments.length - tail.length

  // The catch-all param needs a segment, and a non-empty value.
  if (end <= index || (end === index + 1 && segments[index] === '')) {
    return false
  }

  for (let i = 0; i < tail.length; i++) {
    const expected = tail[i]
    const segment = segments[end + i]!
    if (!matchesPart(expected, segment)) {
      return false
    }
  }

  return true
}

function toParams<T>(route: Route<T>, segments: readonly string[]): Record<string, string> {
  let params: Record<string, string> = {}
  const end = segments.length - route.tail

  for (const { name, index, catchAll, template, place } of route.params!) {
    let value = segments[index < 0 ? segments.length + index : index]!
    if (template !== undefined) {
      value = template.pattern.exec(value)![place + 1]!
    }

    // Faster than `segments.slice(index, end).join('/')`. A template literal
    // would call `ToString` on each segment, which is already a string.
    if (catchAll) {
      for (let i = index + 1; i < end; i++) {
        value += '/' + segments[i]
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
