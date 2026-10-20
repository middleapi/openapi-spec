import { defineConfig } from 'vitest/config'

// Packs and builds every package, so it stays out of the default `vitest run`
// and runs on its own through `pnpm run test:package`.
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/package/**/*.test.ts'],
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
