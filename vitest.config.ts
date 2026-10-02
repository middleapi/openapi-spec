import codspeedPlugin from '@codspeed/vitest-plugin'
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    coverage: {
      exclude: ['**.bench.*', '**.test-d.*', '**.test.*'],
      include: ['apps/*/src/**', 'packages/*/src/**'],
    },
    exclude: [...defaultExclude, '**/.claude/**'],
    globals: true,
    include: ['**/*.test.ts'],
    passWithNoTests: true,
    benchmark: {
      include: ['**/*.bench.ts'],
      exclude: [...defaultExclude, '**/.claude/**'],
    },
  },
})
