import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { publint } from 'publint'
import { formatMessage } from 'publint/utils'

// Tests the tarballs `pnpm publish` uploads instead of the sources. The
// sources resolve through the development `exports`, so an error that exists
// only in the built files, like TS2749 in the 0.1.0 `.d.mts`, passes every
// other test. Each package is packed, installed into a throwaway consumer
// project, and loaded the way users load it.

interface Manifest {
  name: string
  private?: boolean
  exports: Record<string, string | Record<string, string>>
}

interface Entry {
  specifier: string
  /** The published declaration file */
  types: string
  /** The source file of the development `exports` */
  source: string
}

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../..', import.meta.url))
const fixture = mkdtempSync(join(tmpdir(), 'openapi-spec-package-'))

const packages = readdirSync(join(root, 'packages'))
  .map((name) => {
    const dir = join(root, 'packages', name)
    return { dir, manifest: readJson<Manifest>(join(dir, 'package.json')) }
  })
  .filter(({ manifest }) => !manifest.private)

const resolutions = {
  node16: { module: 'node16', moduleResolution: 'node16' },
  nodenext: { module: 'nodenext', moduleResolution: 'nodenext' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
}

const loaders = {
  'import.mjs': 'await import(specifier)',
  'require.cjs': 'require(specifier)',
}

let entries: Entry[] = []

beforeAll(() => {
  exec(
    'pnpm',
    ['--filter', './packages/*', 'pack', '--out', join(fixture, 'tarballs/%s.tgz')],
    root,
  )

  // Overriding the packages also points their dependencies on each other at
  // the tarballs, and `--offline` fails instead of falling back to the
  // registry. JSON is valid YAML.
  const tarballs = Object.fromEntries(
    packages.map(({ manifest }) => [manifest.name, `file:${tarball(manifest.name)}`]),
  )
  writeJson(join(fixture, 'package.json'), {
    private: true,
    type: 'module',
    dependencies: tarballs,
  })
  writeJson(join(fixture, 'pnpm-workspace.yaml'), { overrides: tarballs })
  exec('pnpm', ['install', '--offline', '--no-frozen-lockfile'], fixture)

  entries = packages.flatMap(({ dir, manifest }) => {
    const installed = join(fixture, 'node_modules', manifest.name)
    const { exports } = readJson<Manifest>(join(installed, 'package.json'))

    return Object.entries(exports)
      .filter(([subpath]) => subpath !== './package.json')
      .map(([subpath, conditions]) => ({
        specifier: `${manifest.name}${subpath.slice(1)}`,
        types: join(installed, (conditions as Record<string, string>).types!),
        source: join(dir, manifest.exports[subpath] as string),
      }))
  })

  for (const { dir, manifest } of packages) {
    for (const file of readdirSync(join(dir, 'src'), { encoding: 'utf8', recursive: true })) {
      if (file.endsWith('.test-d.ts')) {
        const copy = join(fixture, 'src', basename(dir), file)
        mkdirSync(dirname(copy), { recursive: true })
        writeFileSync(copy, toPackageImports(join(dir, 'src', file), dir, manifest))
      }
    }
  }

  // Loads every published declaration file, including those of packages
  // without `*.test-d.ts` files.
  writeFileSync(
    join(fixture, 'src/entries.ts'),
    entries.map(({ specifier }, i) => `import type * as Entry${i} from '${specifier}'\n`).join(''),
  )

  for (const [name, options] of Object.entries(resolutions)) {
    writeJson(join(fixture, `tsconfig.${name}.json`), {
      compilerOptions: {
        ...options,
        target: 'es2022',
        lib: ['es2022'],
        types: [],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['src'],
    })
  }

  for (const [file, load] of Object.entries(loaders)) {
    const script = [
      'const loaded = {}',
      `for (const specifier of process.argv.slice(2)) loaded[specifier] = Object.keys(${load}).sort()`,
      'console.log(JSON.stringify(loaded))',
    ]
    writeFileSync(join(fixture, file), `${script.join('\n')}\n`)
  }
})

afterAll(() => {
  rmSync(fixture, { force: true, recursive: true })
})

it.each(Object.keys(resolutions))(
  'type-checks the *.test-d.ts files and every entry under moduleResolution %s',
  (name) => {
    const { output, status } = run(
      process.execPath,
      [bin('typescript', 'tsc'), '-p', `tsconfig.${name}.json`],
      fixture,
    )

    expect(status, output).toBe(0)
  },
)

// `require` loads every entry through require(esm) on Node 20.19+ and 22.12+.
it.each(Object.keys(loaders))(
  '%s loads every entry with the exports of its source',
  async (file) => {
    const specifiers = entries.map(({ specifier }) => specifier)
    const { output, status, stdout } = run(process.execPath, [file, ...specifiers], fixture)
    expect(status, output).toBe(0)

    const expected: Record<string, string[]> = {}
    for (const { source, specifier } of entries) {
      expected[specifier] = Object.keys(await import(source)).sort()
    }
    expect(JSON.parse(stdout)).toEqual(expected)
  },
)

describe.each(packages.map(({ manifest }) => manifest.name))('%s', (name) => {
  it('passes publint', async () => {
    const { messages, pkg } = await publint({
      pack: { tarball: new Uint8Array(readFileSync(tarball(name))).buffer },
      strict: true,
    })

    expect(messages.map((message) => formatMessage(message, pkg, { color: false }))).toEqual([])
  })

  // The packages ship only ESM, so the CommonJS resolutions would only report
  // that. The require.cjs test covers loading them from CommonJS.
  it('passes attw', () => {
    const { output, status } = run(
      process.execPath,
      [bin('@arethetypeswrong/cli', 'attw'), tarball(name), '--profile', 'esm-only'],
      fixture,
    )

    expect(status, output).toBe(0)
  })
})

describe('namespace.test-d.ts', () => {
  // Without comments, so a member named in one can't stand in for a reference.
  const file = join(root, 'packages/types/src/namespace.test-d.ts')
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
  const namespaces = Array.from(
    source.matchAll(/^import type \* as (\w+) from '([^']+)'/gm),
    ([, name, specifier]) => ({ name: name!, specifier: specifier! }),
  )

  it('imports every @openapi-spec/types entry as a namespace', () => {
    expect(namespaces.map(({ specifier }) => specifier).sort()).toEqual(
      entries
        .map(({ specifier }) => specifier)
        .filter((specifier) => specifier.startsWith('@openapi-spec/types/'))
        .sort(),
    )
  })

  it.each(namespaces)('references every $specifier member as a type', ({ name, specifier }) => {
    const referenced = new Set(
      Array.from(source.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g')), ([, member]) => member!),
    )
    const exported = declaredExports(entries.find((entry) => entry.specifier === specifier)!.types)

    expect(exported.length).toBeGreaterThan(0)
    expect([...referenced].sort()).toEqual(exported)
  })
})

// rollup-plugin-dts gathers the exports of a declaration file, re-exports
// included, into `export { ... }` and `export type { ... }` lists. Any other
// form throws, so a change in its output can't hide members.
function declaredExports(file: string): string[] {
  const statements = readFileSync(file, 'utf8').match(/^export\b[^;]*;/gm) ?? []

  return statements
    .flatMap((statement) => {
      const list = /^export (?:type )?\{([^}]*)\}(?: from '[^']*')?;$/.exec(statement)?.[1]
      if (list === undefined) throw new Error(`Unexpected export in ${file}: ${statement}`)

      // The exported name ends each specifier, as in `type A as B`
      return list.split(',').flatMap((specifier) => specifier.match(/[\w$]+(?=\s*$)/) ?? [])
    })
    .sort()
}

// Rewrites relative imports of an entry's source, e.g. `'./v3.1'`, to the
// entry, `'@openapi-spec/types/v3.1'`.
function toPackageImports(file: string, dir: string, manifest: Manifest): string {
  return readFileSync(file, 'utf8').replace(/(?<=\bfrom ')\.\.?\/[^']*(?=')/g, (specifier) => {
    const path = `./${relative(dir, resolve(dirname(file), specifier))}`
    const subpath = Object.keys(manifest.exports).find((key) =>
      [path, `${path}.ts`].includes(manifest.exports[key] as string),
    )
    if (subpath === undefined) {
      throw new Error(`${file} imports ${specifier}, which isn't an entry of ${manifest.name}`)
    }

    return `${manifest.name}${subpath.slice(1)}`
  })
}

// The name `pnpm pack` gives `%s` in `--out`
function tarball(name: string): string {
  return join(fixture, 'tarballs', `${name.replace('@', '').replace('/', '-')}.tgz`)
}

function bin(name: string, command: string): string {
  const manifest = require.resolve(`${name}/package.json`)
  return join(dirname(manifest), readJson<{ bin: Record<string, string> }>(manifest).bin[command]!)
}

function run(command: string, args: string[], cwd: string) {
  const { error, status, stderr, stdout } = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (error) throw error

  return { output: stdout + stderr, status, stdout }
}

function exec(command: string, args: string[], cwd: string): void {
  const { output, status } = run(command, args, cwd)
  if (status !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` exited with ${status}\n${output}`)
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
