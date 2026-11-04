import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 300_000,
    retry: 2,
  },
})
