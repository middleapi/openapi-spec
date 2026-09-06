import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  rules: {
    'yaml/sort-keys': 'off',
    'pnpm/json-enforce-catalog': 'off',
    'pnpm/yaml-enforce-settings': 'off',
    'ts/method-signature-style': 'off',
  },
}, {
  files: ['**/*.test.ts', '**/*.test-d.ts'],
  rules: {
    'unused-imports/no-unused-vars': 'off',
    'antfu/no-top-level-await': 'off',
  },
})
