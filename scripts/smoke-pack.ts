// Checks the tarballs `pnpm publish` would upload, not the sources the tests
// run against: packs every workspace package, installs the tarballs into a
// scratch project outside the workspace, then imports every `exports` entry
// point and typechecks a consumer that imports each of them.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT_DIR = process.cwd()

interface PackageJson {
  dependencies?: Record<string, string>
  exports?: Record<string, unknown>
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

async function readPackageJson(dir: string): Promise<PackageJson> {
  // SAFETY: only reads package.json files written by this script, pnpm or npm.
  return JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf-8')) as PackageJson
}

async function main(): Promise<void> {
  const scratchDir = await mkdtemp(path.join(tmpdir(), 'openapi-spec-smoke-pack-'))

  try {
    const packDir = path.join(scratchDir, 'packs')
    const consumerDir = path.join(scratchDir, 'consumer')

    run('pnpm', ['--filter=./packages/*', 'pack', '--pack-destination', packDir], ROOT_DIR)

    const tarballs = (await readdir(packDir))
      .filter((file) => file.endsWith('.tgz'))
      .map((file) => path.join(packDir, file))

    if (tarballs.length === 0) {
      throw new Error('pnpm pack produced no tarballs')
    }

    // Installing every tarball at once lets internal dependencies resolve to
    // each other, so nothing is fetched for a version npm does not have yet.
    await mkdir(consumerDir)
    await writeFile(
      path.join(consumerDir, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' })}\n`,
    )
    run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...tarballs], consumerDir)

    const specifiers: string[] = []
    const { dependencies = {} } = await readPackageJson(consumerDir)

    for (const name of Object.keys(dependencies)) {
      const { exports = {} } = await readPackageJson(path.join(consumerDir, 'node_modules', name))

      for (const subpath of Object.keys(exports)) {
        if (!subpath.endsWith('.json') && !subpath.includes('*')) {
          specifiers.push(path.posix.join(name, subpath))
        }
      }
    }

    await writeFile(
      path.join(consumerDir, 'smoke.mjs'),
      specifiers.map((specifier) => `import ${JSON.stringify(specifier)}\n`).join(''),
    )
    await writeFile(
      path.join(consumerDir, 'smoke.ts'),
      specifiers
        .map((specifier, i) => `import type * as entry${i} from ${JSON.stringify(specifier)}\n`)
        .join(''),
    )
    await writeFile(
      path.join(consumerDir, 'tsconfig.json'),
      `${JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['smoke.ts'],
      })}\n`,
    )

    run(process.execPath, ['smoke.mjs'], consumerDir)
    run('pnpm', ['exec', 'tsc', '-p', path.join(consumerDir, 'tsconfig.json')], ROOT_DIR)

    // oxlint-disable-next-line no-console
    console.log(`Smoke-tested ${specifiers.length} entry points:\n${specifiers.join('\n')}`)
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (error) {
  // A failed command has already printed its own output.
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
