import { defineConfig } from 'oxlint'

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
  },
  categories: {
    correctness: 'error',
    suspicious: 'error',
  },
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import'],
  rules: {
    'typescript/no-unsafe-type-assertion': 'off',
    'no-underscore-dangle': 'off',
    'unicorn/no-thenable': 'off',

    'eqeqeq': 'error',
    'guard-for-in': 'error',
    'no-prototype-builtins': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-var': 'error',
    'prefer-const': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'unicorn/prefer-node-protocol': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test-d.ts', '**/benches/**'],
      rules: {
        'no-unused-vars': 'off',
        'no-shadow': 'off',
        'unicorn/consistent-function-scoping': 'off',
        'typescript/no-generated-empty-object-type': 'off',
      },
    },
  ],
})
