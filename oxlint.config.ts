import { defineConfig } from 'oxlint'
import { middleapi } from 'uncheck/oxlint'

export default defineConfig({
  extends: [middleapi],
  rules: {
    'unicorn/no-thenable': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test-d.ts'],
      rules: {
        'no-unused-vars': 'off',
      },
    },
  ],
})
