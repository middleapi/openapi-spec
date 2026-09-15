import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  rules: {
    'yaml/sort-keys': 'off',
    'pnpm/json-enforce-catalog': 'off',
    'pnpm/yaml-enforce-settings': 'off',
    'ts/method-signature-style': 'off',
    'guard-for-in': 'error',
    'no-restricted-syntax': [
      'error',
      // Keep the selectors from the antfu preset, since overriding a rule replaces its options.
      'TSEnumDeclaration[const=true]',
      'TSExportAssignment',
      {
        selector: 'ForInStatement',
        message: 'Prefer Object.keys(), Object.entries(), or Object.values() to iterate over an object instead of for...in.',
      },
    ],
  },
}, {
  files: ['**/*.test.ts', '**/*.test-d.ts'],
  rules: {
    'unused-imports/no-unused-vars': 'off',
    'antfu/no-top-level-await': 'off',
  },
})
