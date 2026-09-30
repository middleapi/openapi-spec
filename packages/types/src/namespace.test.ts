import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const testFile = fileURLToPath(new URL('./namespace.test-d.ts', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const program = ts.createProgram([testFile], {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
})
const checker = program.getTypeChecker()
const source = program.getSourceFile(testFile)!

const namespaces = new Map<string, { exported: string[], referenced: Set<string> }>()
const specifiers: string[] = []

for (const statement of source.statements) {
  const bindings = ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
  if (bindings && ts.isNamespaceImport(bindings)) {
    const specifier = statement.moduleSpecifier as ts.StringLiteral
    const module = checker.getSymbolAtLocation(specifier)!
    specifiers.push(specifier.text)
    namespaces.set(bindings.name.text, {
      exported: checker.getExportsOfModule(module).map(symbol => symbol.name).sort(),
      referenced: new Set(),
    })
  }
}

source.forEachChild(function visit(node) {
  if (ts.isQualifiedName(node) && ts.isIdentifier(node.left))
    namespaces.get(node.left.text)?.referenced.add(node.right.text)
  node.forEachChild(visit)
})

it('imports every version entry as a namespace', () => {
  const entries = Object.keys(pkg.exports)
    .filter(entry => entry !== './package.json')
    .map(entry => `${pkg.name}/${entry.slice(2)}`)

  expect(specifiers.sort()).toEqual(entries.sort())
})

it.each([...namespaces])('references every %s member as a type', (_, { exported, referenced }) => {
  expect(exported.length).toBeGreaterThan(0)
  expect([...referenced].sort()).toEqual(exported)
})
